import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from '../claims/claims.service';
import { StatusService } from '../intents/status.service';
import { RedisService } from '@/redis/redis.service';

export interface ProcessingResult {
  claimId: string;
  intentId: string;
  action: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class ClaimProcessorService {
  private readonly logger = new Logger(ClaimProcessorService.name);
  private isProcessing = false;
  private isSweeping = false;
  private isReclaiming = false;

  constructor(
    private readonly claimsService: ClaimsService,
    private readonly statusService: StatusService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * When not `'true'`, in-process cron and HTTP/manual triggers skip claim processing.
   */
  private isAutoProcessClaimsEnabled(): boolean {
    return this.configService.get<string>('AUTO_PROCESS_CLAIMS', 'true') === 'true';
  }

  /**
   * Process pending claims every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (!this.isAutoProcessClaimsEnabled()) {
      return;
    }

    await this.processPendingClaims();
  }

  /**
   * Retry burner sweeps for PRIVATE_TRANSFER_PENDING claims every minute.
   * Replaces the in-process setTimeout retry loop so sweeps survive server restarts.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleBurnerSweepRetries() {
    if (this.isSweeping) {
      this.logger.debug('[handleBurnerSweepRetries] Previous sweep still running, skipping');
      return;
    }
    this.isSweeping = true;
    try {
      await this.claimsService.cronSweepPendingBurners();
    } catch (e: any) {
      this.logger.error('[handleBurnerSweepRetries] Error:', e?.message);
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * Every 10 minutes: reclaim ATA rent from terminal claim burners (backstop for the inline
   * closeAccount instructions — see @/common/burner-reclaim and the 2026-07-29 rent audit).
   */
  @Cron('0 */10 * * * *')
  async handleBurnerRentReclaim() {
    if (!this.isAutoProcessClaimsEnabled()) return;
    if (this.isReclaiming) return;
    this.isReclaiming = true;
    try {
      await this.claimsService.cronReclaimFinishedClaimBurners();
    } catch (e: any) {
      this.logger.error('[handleBurnerRentReclaim] Error:', e?.message);
    } finally {
      this.isReclaiming = false;
    }
  }

  /**
   * Every 10 minutes: expire OPEN/PENDING_DEPOSIT claims past their expires_at (set at creation
   * only where the caller opted in, e.g. PayoutsService's 4h default) — "die out" for anything
   * created but never actually funded.
   */
  @Cron('0 */10 * * * *')
  async handleExpireStaleClaims() {
    if (!this.isAutoProcessClaimsEnabled()) return;
    try {
      await this.claimsService.expireStaleClaims();
    } catch (e: any) {
      this.logger.error('[handleExpireStaleClaims] Error:', e?.message);
    }
  }

  /**
   * Process all pending claims
   */
  async processPendingClaims(): Promise<ProcessingResult[]> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return [];
    }

    this.isProcessing = true;
    const results: ProcessingResult[] = [];

    try {
      // Get pending intents
      const pendingIntents = await this.claimsService.getPendingIntents();

      for (const intent of pendingIntents) {
        // Use distributed lock if Redis is available
        const lockKey = `claim:${intent.claim_id}`;
        
        const processResult = await this.redisService.withLock(
          lockKey,
          async () => this.processIntent(intent),
          60000, // 1 minute lock
        );

        if (processResult) {
          results.push(processResult);
        }
      }
    } catch (error: any) {
      this.logger.error('Error processing claims:', error?.message);
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  /**
   * Check if intent should be skipped (expired or too old)
   */
  private shouldSkipIntent(intent: any): { skip: boolean; reason?: string } {
    const { deadline, created_at } = intent;

    // Skip if deadline has passed
    if (deadline) {
      const deadlineDate = new Date(deadline);
      if (deadlineDate < new Date()) {
        return { skip: true, reason: 'Deadline expired' };
      }
    }

    // Skip if older than 1 month
    if (created_at) {
      const createdDate = new Date(created_at);
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      
      if (createdDate < oneMonthAgo) {
        return { skip: true, reason: 'Older than 1 month' };
      }
    }

    return { skip: false };
  }

  /**
   * Process a single intent
   */
  private async processIntent(intent: any): Promise<ProcessingResult | null> {
    const { id: intentId, claim_id: claimId, deposit_address: depositAddress, status } = intent;

    try {
      // Skip expired or old intents
      const skipCheck = this.shouldSkipIntent(intent);
      if (skipCheck.skip) {
        return {
          claimId,
          intentId,
          action: 'skipped',
          success: true,
          error: skipCheck.reason,
        };
      }

      // Skip if no deposit address
      if (!depositAddress) {
        return {
          claimId,
          intentId,
          action: 'skipped',
          success: true,
          error: 'No deposit address',
        };
      }

      // Check status from Near Intents
      const statusResult = await this.statusService.getNearIntentsStatus(depositAddress);

      // Update intent status if changed
      if (statusResult.status !== status) {
        await this.claimsService.updateIntent(intentId, {
          status: statusResult.status,
          lastStatusPayload: statusResult.raw,
        });
      }

      // Update claim status based on normalized status
      if (statusResult.isComplete) {
        // Near Intents completed - funds arrived at the claim's burner, not the recipient's real
        // wallet — the payer never gets that address directly (see PaymentLinksService / the
        // guest-checkout burner architecture). Do NOT mark recipient-claimed yet: private claims,
        // unresolved (pending-email/username) recipients, AND ordinary merchant/payment-links
        // claims (registered recipient, resolved at creation, still burner-mediated) all still
        // need an explicit claim/sweep. Going straight to SUCCESS here — the pre-existing branch
        // below, for a claim with a burner but neither private nor pending — left the recipient
        // with no visible claim action for funds that were, in fact, still sitting unswept.
        const claim = await this.claimsService.findOne(claimId);
        const recipientAddress = (claim.recipient_address || '').trim();
        const hasPendingRecipient =
          recipientAddress.startsWith('PENDING_EMAIL:') || recipientAddress.startsWith('PENDING_USERNAME:');
        const hasBurner = !!(claim as { claim_burner_address?: string | null }).claim_burner_address?.trim();
        if (claim.is_private === true || hasPendingRecipient || hasBurner) {
          await this.claimsService.updateStatus(claimId, 'PRIVATE_TRANSFER_PENDING', { txHash: statusResult.txHash });
          this.claimsService.notifyRecipientAfterPayment(claimId);
          return {
            claimId,
            intentId,
            action: 'private_transfer_pending',
            success: true,
          };
        }
        await this.claimsService.updateStatus(claimId, 'SUCCESS', { txHash: statusResult.txHash });
        this.claimsService.notifyRecipientAfterPayment(claimId);
        return {
          claimId,
          intentId,
          action: 'completed',
          success: true,
        };
      }

      if (statusResult.isFailed) {
        await this.claimsService.updateStatus(claimId, 'REFUNDED');
        return {
          claimId,
          intentId,
          action: 'failed',
          success: true,
        };
      }

      // Still pending/processing
      return {
        claimId,
        intentId,
        action: 'waiting',
        success: true,
      };
    } catch (error: any) {
      this.logger.error(`Error processing intent ${intentId}:`, error?.message);
      return {
        claimId,
        intentId,
        action: 'error',
        success: false,
        error: error?.message,
      };
    }
  }

  /**
   * Manually trigger processing (for API endpoint).
   * Respects AUTO_PROCESS_CLAIMS so HTTP cron cannot bypass the in-process @Cron guard.
   */
  async triggerProcessing(): Promise<{
    processed: number;
    results: ProcessingResult[];
    skipped?: boolean;
  }> {
    if (!this.isAutoProcessClaimsEnabled()) {
      this.logger.debug('triggerProcessing skipped: AUTO_PROCESS_CLAIMS is not true');
      return { processed: 0, results: [], skipped: true };
    }
    const results = await this.processPendingClaims();
    return {
      processed: results.length,
      results,
      skipped: false,
    };
  }

  /**
   * Get processing status
   */
  getProcessingStatus(): { isProcessing: boolean } {
    return { isProcessing: this.isProcessing };
  }
}
