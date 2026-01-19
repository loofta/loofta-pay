import { Injectable, Logger } from '@nestjs/common';
import { NearIntentsService } from './near-intents.service';

export interface UnifiedStatus {
  provider: 'near-intents' | 'rhinestone' | 'unknown';
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
  ) {}

  /**
   * Get unified status for any intent/transaction
   */
  async getStatus(params: {
    depositAddress?: string;
    rhinestoneId?: string;
  }): Promise<UnifiedStatus> {
    const { depositAddress, rhinestoneId } = params;

    // Try Near Intents first (most common)
    if (depositAddress) {
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

    // Rhinestone (placeholder - would need companion address tracking)
    if (rhinestoneId) {
      return {
        provider: 'rhinestone',
        status: 'PENDING',
        normalizedStatus: 'pending',
      };
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
