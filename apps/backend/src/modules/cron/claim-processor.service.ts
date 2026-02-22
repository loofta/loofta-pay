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

  constructor(
    private readonly claimsService: ClaimsService,
    private readonly statusService: StatusService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Process pending claims every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    // Check if auto-processing is enabled
    const autoProcess = this.configService.get<string>('AUTO_PROCESS_CLAIMS', 'true');
    if (autoProcess !== 'true') {
      return;
    }

    await this.processPendingClaims();
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
        // Near Intents completed - funds arrived. For any private claim, funds are in user's
        // embedded wallet; do NOT set SUCCESS until user completes Privacy Cash in the UI.
        const claim = await this.claimsService.findOne(claimId);
        if (claim.is_private === true) {
          await this.claimsService.updateStatus(claimId, 'PRIVATE_TRANSFER_PENDING');
          return {
            claimId,
            intentId,
            action: 'private_transfer_pending',
            success: true,
          };
        }
        await this.claimsService.updateStatus(claimId, 'SUCCESS');
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
   * Manually trigger processing (for API endpoint)
   */
  async triggerProcessing(): Promise<{ processed: number; results: ProcessingResult[] }> {
    const results = await this.processPendingClaims();
    return {
      processed: results.length,
      results,
    };
  }

  /**
   * Get processing status
   */
  getProcessingStatus(): { isProcessing: boolean } {
    return { isProcessing: this.isProcessing };
  }
}
