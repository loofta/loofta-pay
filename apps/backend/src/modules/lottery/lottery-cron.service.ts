import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LotteryService } from './lottery.service';

@Injectable()
export class LotteryCronService {
  private readonly logger = new Logger(LotteryCronService.name);

  constructor(
    private readonly lottery: LotteryService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('LotteryCronService: NODE_ENV != production — all lottery cron jobs are disabled on this instance (avoids racing the real production backend for the same DB rows, e.g. two instances both firing a MagicBlock transfer for the same withdrawal burner)');
    }
  }

  /**
   * Lottery crons touch shared, money-moving state (burners, MagicBlock transfers, Li.Fi
   * bridges) keyed only by DB row, with no per-instance ownership. Running this backend locally
   * against the same production Supabase project as Railway means two independent instances
   * poll and act on the same rows — even with atomic per-row claims, that's more racing than
   * necessary. Restricting lottery crons to the real production instance removes the class of
   * bug entirely instead of patching each race as it's found.
   */
  private get isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Every 5 seconds: check sent tickets for USDC + start bridge (overlap-guarded in service) */
  @Cron('*/5 * * * * *')
  async processSent(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.processSentTickets().catch(e =>
      this.logger.error(`processSentTickets: ${e.message}`),
    );
  }

  /** Every 10 seconds: check bridging tickets + buy on Megapot (overlap-guarded in service) */
  @Cron('*/10 * * * * *')
  async processBridging(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.processBridgingTickets().catch(e =>
      this.logger.error(`processBridgingTickets: ${e.message}`),
    );
  }

  /** Every 30 seconds: check pending private withdrawals (bridge → MagicBlock) — this cadence
   *  IS the withdrawal latency between pipeline steps, so keep it tight (overlap-guarded). */
  @Cron('*/30 * * * * *')
  async processWithdrawals(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.processPendingWithdrawals().catch(e =>
      this.logger.error(`processPendingWithdrawals: ${e.message}`),
    );
  }

  /** Every 15 minutes: resolve any 'active' ticket whose draw has passed (won/lost). Previously
   *  ran once/day, which meant a ticket that failed to resolve (RPC hiccup, etc.) silently sat
   *  unresolved for up to 24h before the next retry — this cadence closes that gap. Safe to run
   *  often: the query only ever touches tickets still 'active', and the service method itself is
   *  overlap-guarded. */
  @Cron('0 */15 * * * *')
  async checkDailyResults(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.checkDailyResults().catch(e =>
      this.logger.error(`checkDailyResults: ${e.message}`),
    );
  }

  /** Every 5 minutes: backfill NFT ball numbers for active tickets that don't have them yet */
  @Cron('0 */5 * * * *')
  async backfillNumbers(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.backfillTicketNumbers().catch(e =>
      this.logger.error(`backfillTicketNumbers: ${e.message}`),
    );
  }

  /** Every 5 minutes: sweep leftover SOL + USDC dust + token-account rent from finished burners */
  @Cron('*/5 * * * *')
  async sweepFinishedBurners(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.sweepFinishedBurners().catch(e =>
      this.logger.error(`sweepFinishedBurners: ${e.message}`),
    );
  }

  /** Every 2 minutes: refund the upfront fee for any purchase that failed or was abandoned */
  @Cron('*/2 * * * *')
  async refundOutstandingFees(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.refundOutstandingFees().catch(e =>
      this.logger.error(`refundOutstandingFees: ${e.message}`),
    );
  }

  /** Every 2 minutes: auto-refund tickets whose bridge stalled with no solver activity */
  @Cron('*/2 * * * *')
  async refundStalledBridges(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.refundStalledBridges().catch(e =>
      this.logger.error(`refundStalledBridges: ${e.message}`),
    );
  }

  /** Every 2 minutes: recover consolidated batches whose lead bridge never got submitted (crash). */
  @Cron('*/2 * * * *')
  async recoverStuckBatches(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.recoverStuckConsolidatedBatches().catch(e =>
      this.logger.error(`recoverStuckConsolidatedBatches: ${e.message}`),
    );
  }
}
