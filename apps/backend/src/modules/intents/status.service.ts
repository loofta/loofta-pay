import { Injectable, Logger } from '@nestjs/common';
import { NearIntentsService } from './near-intents.service';
import { RelayWithdrawalService } from './relay-withdrawal.service';

export interface UnifiedStatus {
  provider: 'near-intents' | 'relay' | 'unknown';
  status: string;
  normalizedStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';
  txHash?: string;
  error?: string;
  raw?: any;
}

// Status mappings to normalized status
const NEAR_STATUS_MAP: Record<string, UnifiedStatus['normalizedStatus']> = {
  PENDING: 'pending',
  WAITING: 'pending',
  PROCESSING: 'processing',
  DEPOSITED: 'processing',
  SWAPPED: 'processing',
  COMPLETED: 'completed',
  FILLED: 'completed',
  SUCCESS: 'completed',
  FAILED: 'failed',
  EXPIRED: 'failed',
  CANCELLED: 'failed',
  REFUNDED: 'failed',
  INCOMPLETE_DEPOSIT: 'failed',
};

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    private readonly nearIntentsService: NearIntentsService,
    private readonly relay: RelayWithdrawalService,
  ) {}

  /**
   * Relay withdrawals (Robinhood Chain) are keyed by the same deposit_address the NEAR flow uses,
   * so check our own orders first: a Relay deposit address is unknown to NEAR's 1Click API.
   * Returns null for non-Relay addresses, and also when Relay's status call itself fails (the
   * caller then retries on its next tick instead of mislabeling the withdrawal).
   */
  private async tryRelay(depositAddress: string): Promise<{ status: string; txHash?: string; raw: any } | null> {
    let requestId: string | null = null;
    try {
      requestId = await this.relay.findRequestIdByDepositAddress(depositAddress);
    } catch {
      return null; // lookup failure: fall through to the NEAR path rather than guess
    }
    if (!requestId) return null;
    try {
      return await this.relay.getStatus(requestId);
    } catch (e: any) {
      this.logger.debug(`Relay status check failed: ${e?.message}`);
      return { status: 'PENDING', raw: { error: e?.message } };
    }
  }

  /**
   * Get unified status for any intent/transaction
   */
  async getStatus(params: {
    depositAddress?: string;
  }): Promise<UnifiedStatus> {
    const { depositAddress } = params;

    if (depositAddress) {
      const relayStatus = await this.tryRelay(depositAddress);
      if (relayStatus) {
        return {
          provider: 'relay',
          status: relayStatus.status,
          normalizedStatus: NEAR_STATUS_MAP[relayStatus.status] || 'unknown',
          txHash: relayStatus.txHash,
          raw: relayStatus.raw,
        };
      }
      try {
        const status = await this.nearIntentsService.getExecutionStatus(depositAddress);
        const rawStatus = String(status?.status || status?.state || 'UNKNOWN').toUpperCase();

        return {
          provider: 'near-intents',
          status: rawStatus,
          normalizedStatus: NEAR_STATUS_MAP[rawStatus] || 'unknown',
          txHash: status?.txHash || status?.transactionHash,
          raw: status,
        };
      } catch (error: any) {
        this.logger.debug('Near Intents status check failed:', error?.message);
      }
    }

    return {
      provider: 'unknown',
      status: 'UNKNOWN',
      normalizedStatus: 'unknown',
      error: 'No valid identifier provided',
    };
  }

  /**
   * Get status specifically for Near Intents deposit
   */
  async getNearIntentsStatus(depositAddress: string): Promise<{
    status: string;
    normalizedStatus: UnifiedStatus['normalizedStatus'];
    isComplete: boolean;
    isFailed: boolean;
    txHash?: string;
    raw?: any;
  }> {
    const relayStatus = await this.tryRelay(depositAddress);
    if (relayStatus) {
      const normalizedStatus = NEAR_STATUS_MAP[relayStatus.status] || 'unknown';
      return {
        status: relayStatus.status,
        normalizedStatus,
        isComplete: normalizedStatus === 'completed',
        isFailed: normalizedStatus === 'failed',
        txHash: relayStatus.txHash,
        raw: relayStatus.raw,
      };
    }
    try {
      const status = await this.nearIntentsService.getExecutionStatus(depositAddress);
      const rawStatus = String(status?.status || status?.state || 'UNKNOWN').toUpperCase();
      const normalizedStatus = NEAR_STATUS_MAP[rawStatus] || 'unknown';

      return {
        status: rawStatus,
        normalizedStatus,
        isComplete: normalizedStatus === 'completed',
        isFailed: normalizedStatus === 'failed',
        txHash: status?.txHash || status?.transactionHash,
        raw: status,
      };
    } catch (error: any) {
      this.logger.error('Near Intents status error:', error?.message);
      throw error;
    }
  }

  /**
   * Batch status check for multiple deposit addresses
   */
  async getBatchStatus(
    depositAddresses: string[],
  ): Promise<Map<string, UnifiedStatus>> {
    const results = new Map<string, UnifiedStatus>();

    // Process in parallel with some concurrency control
    const batchSize = 10;
    for (let i = 0; i < depositAddresses.length; i += batchSize) {
      const batch = depositAddresses.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((addr) =>
          this.getStatus({ depositAddress: addr }).then((status) => ({
            address: addr,
            status,
          })),
        ),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.set(result.value.address, result.value.status);
        }
      }
    }

    return results;
  }
}
