import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import { ClaimsService } from '../claims/claims.service';
import { RedisService } from '@/redis/redis.service';

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
    const rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ||
      (this.configService.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.configService.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    this.connection = new Connection(rpcUrl, 'confirmed');
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
      const pending = await this.claimsService.getPendingTxHashClaims();
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
    claim: { id: string; sender_tx_hash: string },
    status: Awaited<ReturnType<Connection['getSignatureStatuses']>>['value'][0],
  ): Promise<TxVerifierResult> {
    const { id: claimId, sender_tx_hash: txHash } = claim;

    if (status?.err) {
      this.logger.warn(`[SolanaTxVerifier] tx ${txHash.slice(0, 12)}… failed on-chain for claim ${claimId}`);
      return { claimId, txHash, action: 'failed', error: JSON.stringify(status.err) };
    }

    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized' ||
      status?.confirmationStatus === 'processed'
    ) {
      this.logger.log(`[SolanaTxVerifier] ✅ ${txHash.slice(0, 12)}… confirmed — upgrading claim ${claimId} to SUCCESS`);
      await this.claimsService.updateStatus(claimId, 'SUCCESS', {
        txHash,
        isPrivate: true,
        paidWithToken: 'USDC',
        paidWithChain: 'solana',
      });
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
