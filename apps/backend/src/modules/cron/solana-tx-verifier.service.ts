import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import { ClaimsService } from '../claims/claims.service';
import { RedisService } from '@/redis/redis.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';

export interface TxVerifierResult {
  claimId: string;
  txHash: string;
  action: 'confirmed' | 'pending' | 'failed' | 'skipped' | 'error';
  error?: string;
}

@Injectable()
export class SolanaTxVerifierService {
  private readonly logger = new Logger(SolanaTxVerifierService.name);
  private isProcessing = false;
  private connection: Connection;

  constructor(
    private readonly claimsService: ClaimsService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.connection = new Connection(getMainnetSolanaRpcUrl(this.configService), 'confirmed');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.configService.get<string>('AUTO_PROCESS_CLAIMS', 'true') !== 'true') return;
    await this.verifyPendingTxHashes();
  }

  async verifyPendingTxHashes(): Promise<TxVerifierResult[]> {
    if (this.isProcessing) return [];
    this.isProcessing = true;
    const results: TxVerifierResult[] = [];

    try {
      const [burnerless, burnerRouted] = await Promise.all([
        this.claimsService.getPendingTxHashClaims(),
        this.claimsService.getBurnerInFlightTxHashClaims(),
      ]);
      // Tag each so applyStatus knows which completion path to take without a second DB read.
      const pending = [
        ...burnerless.map((c) => ({ ...c, hasBurner: false as const })),
        ...burnerRouted.map((c) => ({ ...c, hasBurner: true as const })),
      ];
      if (pending.length === 0) return results;

      const now = Date.now();
      const active = pending.filter((c) => {
        if (!c.created_at) return true;
        return now - new Date(c.created_at).getTime() < 24 * 60 * 60 * 1000;
      });
      const expired = pending.filter((c) => !active.includes(c));
      for (const c of expired) {
        this.logger.warn(`[SolanaTxVerifier] Skipping ${c.id} — tx older than 24h`);
        results.push({ claimId: c.id, txHash: c.sender_tx_hash, action: 'skipped', error: 'older than 24h' });
      }

      if (active.length === 0) return results;
      this.logger.log(`[SolanaTxVerifier] Batch checking ${active.length} tx hash(es) in 1 RPC call`);

      // Single batched RPC call for all pending signatures
      const signatures = active.map((c) => c.sender_tx_hash);
      const { value: statuses } = await this.connection.getSignatureStatuses(signatures, {
        searchTransactionHistory: true,
      });

      // Only acquire Redis locks + write DB for claims that changed state
      for (let i = 0; i < active.length; i++) {
        const claim = active[i];
        const status = statuses[i];
        const result = await this.redisService.withLock(
          `solana-tx-verify:${claim.id}`,
          () => this.applyStatus(claim, status),
          60_000,
        );
        if (result) results.push(result);
      }
    } catch (e: any) {
      this.logger.error('[SolanaTxVerifier] Error:', e?.message);
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  private async applyStatus(
    claim: { id: string; sender_tx_hash: string; hasBurner: boolean },
    status: Awaited<ReturnType<Connection['getSignatureStatuses']>>['value'][0],
  ): Promise<TxVerifierResult> {
    const { id: claimId, sender_tx_hash: txHash, hasBurner } = claim;

    if (status?.err) {
      this.logger.warn(`[SolanaTxVerifier] tx ${txHash.slice(0, 12)}… failed on-chain for claim ${claimId}`);
      return { claimId, txHash, action: 'failed', error: JSON.stringify(status.err) };
    }

    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized' ||
      status?.confirmationStatus === 'processed'
    ) {
      if (hasBurner) {
        // Burner-routed single payment: the sender's leg-1 tx (into the burner) just confirmed —
        // that is NOT the same as the recipient having their money, only that it's safely waiting
        // in the burner. updateStatus's own hasBurner guard downgrades 'SUCCESS' to
        // PRIVATE_TRANSFER_PENDING automatically here, same as the rest of the codebase already
        // relies on — this call intentionally does NOT pass recipientSwept, so it can never
        // fabricate a real SUCCESS/deliver funds itself. isPrivate:true because a funded burner
        // via this path only ever comes from the MagicBlock private-transfer flow (see
        // buildPrivateTransferForPayer / payWithLooftaBalance's private branch).
        this.logger.log(`[SolanaTxVerifier] ✅ ${txHash.slice(0, 12)}… confirmed — claim ${claimId} leg-1 done, moving IN_FLIGHT → PRIVATE_TRANSFER_PENDING`);
        await this.claimsService.updateStatus(claimId, 'SUCCESS', {
          txHash,
          isPrivate: true,
          paidWithToken: 'USDC',
          paidWithChain: 'solana',
        });
        this.claimsService.notifyRecipientAfterPayment(claimId);
        return { claimId, txHash, action: 'confirmed' };
      }
      this.logger.log(`[SolanaTxVerifier] ✅ ${txHash.slice(0, 12)}… confirmed — upgrading claim ${claimId} to SUCCESS`);
      // getPendingTxHashClaims() only ever returns burner_address IS NULL rows — a single-leg
      // sender→recipient transfer with no burner hop, which can never be private.
      await this.claimsService.updateStatus(claimId, 'SUCCESS', {
        txHash,
        recipientSwept: true,
        deliveredPrivately: false,
        paidWithToken: 'USDC',
        paidWithChain: 'solana',
      });
      this.claimsService.notifyRecipientAfterPayment(claimId);
      return { claimId, txHash, action: 'confirmed' };
    }

    this.logger.debug(`[SolanaTxVerifier] tx ${txHash.slice(0, 12)}… not yet indexed for claim ${claimId}`);
    return { claimId, txHash, action: 'pending' };
  }

  async triggerProcessing(): Promise<{ processed: number; results: TxVerifierResult[] }> {
    const results = await this.verifyPendingTxHashes();
    return { processed: results.length, results };
  }
}
