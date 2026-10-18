import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isCronEnabled } from '@/common/cron-gate';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LotteryService } from './lottery.service';
import { PackService } from './pack.service';
import { MegapotSubscriptionService } from './megapot-subscription.service';
import { WeeklyQuestService } from './weekly-quest.service';

@Injectable()
export class LotteryCronService {
  private readonly logger = new Logger(LotteryCronService.name);

  constructor(
    private readonly lottery: LotteryService,
    private readonly pack: PackService,
    private readonly subscriptions: MegapotSubscriptionService,
    private readonly weeklyQuest: WeeklyQuestService,
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
    return isCronEnabled(this.config);
  }

  /** Hourly: qualify users who hit this week's quest target and buy their free entry. Production only
   *  (it spends treasury funds), and does nothing unless an admin has enabled the quest. */
  @Cron(CronExpression.EVERY_HOUR)
  async processWeeklyQuest(): Promise<void> {
    if (!this.isProd) return;
    await this.weeklyQuest.processWeeklyQuest().catch(e =>
      this.logger.error(`processWeeklyQuest: ${e.message}`),
    );
  }

  /** Every 5 seconds: check sent tickets for USDC + start bridge (overlap-guarded in service) */
  @Cron('*/5 * * * * *')
  async processSent(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.processSentTickets().catch(e =>
      this.logger.error(`processSentTickets: ${e.message}`),
    );
  }

  /** Every 5 seconds: check bridging tickets + buy on Megapot (overlap-guarded in service). Was
   *  10s — the SOL→Base bridge finishes in single-digit seconds, so a 10s poll left a ticket
   *  sitting up to 10s after the bridge was already DONE before the buy fired. 5s halves that
   *  tail; the in-service overlap guard + atomic status claims keep it safe to run more often. */
  @Cron('*/5 * * * * *')
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

  /** Once a day, ~30 min after Megapot's daily draw closes. The draw is ~19:00 CET/CEST
   *  (~17:00–18:00 UTC), so 18:30 UTC is always ≥30 min after it settles. By then the
   *  15-minute checkDailyResults pass has already resolved the day's tickets to won/lost, so
   *  this just withdraws every won ticket at/above WITHDRAW_MIN_USDC to the winner's own wallet.
   *  Deliberately its own job (not folded into checkDailyResults): real money should move once
   *  per draw cycle, not on every settlement tick. */
  @Cron('0 30 18 * * *')
  async autoWithdrawWonTickets(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.autoWithdrawWonTickets().catch(e =>
      this.logger.error(`autoWithdrawWonTickets: ${e.message}`),
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

  /** Every 2 minutes: auto-retry tickets stuck in 'failed' status — so a buyer who isn't present
   *  to click "Retry purchase" isn't permanently stuck. Always checks Base chain for an existing
   *  ticket-NFT mint before doing anything, so it never re-buys a ticket that actually succeeded
   *  despite the 'failed' status (see LotteryService.reconcileOrRetryFailedTicket). Capped at
   *  MAX_AUTO_RETRIES attempts per ticket. */
  @Cron('*/2 * * * *')
  async autoRetryFailedTickets(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.autoRetryFailedTickets().catch(e =>
      this.logger.error(`autoRetryFailedTickets: ${e.message}`),
    );
  }

  /** Every 30 minutes: alert the operator by email if the fee wallet (funds bridge top-ups + gas)
   *  is running low. De-duped in the service so this cadence never spams. */
  @Cron('0 */30 * * * *')
  async checkFeeWalletBalance(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.checkFeeWalletBalance().catch(e =>
      this.logger.error(`checkFeeWalletBalance: ${e.message}`),
    );
  }

  /** Every 5 minutes: clean up pending_send tickets abandoned before ever signing (10min+ old,
   *  no sender_tx_hash) — e.g. the user cancelled the wallet prompt and the app never got a
   *  chance to call cancelTicket itself (killed, crashed, lost network). No funds ever moved for
   *  these, so it's always safe. */
  @Cron('0 */5 * * * *')
  async cancelAbandonedPendingSends(): Promise<void> {
    if (!this.isProd) return;
    await this.lottery.cancelAbandonedPendingSends().catch(e =>
      this.logger.error(`cancelAbandonedPendingSends: ${e.message}`),
    );
  }

  /** Every 2 minutes: retry the real Megapot ticket purchase for a Mystery Pack win whose
   *  treasury-funded purchase failed on the first attempt — the win itself was already recorded,
   *  this only affects when the actual ticket gets bought. Capped per-row (overlap-guarded in
   *  service).
   *
   *  Was briefly disabled on 2026-07-29: topUpFromFeeWallet's old confirmTransaction call could
   *  throw a false "expired: block height exceeded" on a transfer that had actually landed, and
   *  purchaseTicketsForUser only persisted the freshly-generated burner's key *after* that call
   *  returned — so every retry against a row stuck in this false-negative state re-spent real
   *  treasury USDC into a brand-new burner whose key was then lost the same way, unrecoverably,
   *  on the next false negative. Fixed the same day (see purchaseTicketsForUser /
   *  topUpFromFeeWallet) by persisting the burner before spending and polling signature status
   *  properly instead of racing block height — re-enabled once that fix was live and verified
   *  (used successfully for the incident refunds). */
  @Cron('*/2 * * * *')
  async retryFailedPackPurchases(): Promise<void> {
    if (!this.isProd) return;
    await this.pack.retryFailedPackPurchases().catch(e =>
      this.logger.error(`retryFailedPackPurchases: ${e.message}`),
    );
  }

  /** Every 10 minutes: buy the next due batch for every active Megapot ticket subscription whose
   *  next batch is due — a due-check cadence, not tight timing (unlike the withdrawal pipeline
   *  steps above, a subscription batch being a few minutes late is harmless). */
  @Cron('*/10 * * * *')
  async processSubscriptionBatches(): Promise<void> {
    if (!this.isProd) return;
    await this.subscriptions.processDueBatches().catch(e =>
      this.logger.error(`processSubscriptionBatches: ${e.message}`),
    );
  }

  /** Every 2 minutes: retry a subscription batch whose treasury-funded purchase failed on the
   *  first attempt — same cadence/shape as retryFailedPackPurchases. */
  @Cron('*/2 * * * *')
  async retryFailedSubscriptionBatches(): Promise<void> {
    if (!this.isProd) return;
    await this.subscriptions.retryFailedBatches().catch(e =>
      this.logger.error(`retryFailedSubscriptionBatches: ${e.message}`),
    );
  }

  /** Once a day: the 30-month safety-net check for subscriptions stuck past their expiry with
   *  tickets still undelivered. This should essentially never find anything — see
   *  MegapotSubscriptionService.expireStaleSubscriptions. */
  @Cron('0 3 * * *')
  async expireStaleSubscriptions(): Promise<void> {
    if (!this.isProd) return;
    await this.subscriptions.expireStaleSubscriptions().catch(e =>
      this.logger.error(`expireStaleSubscriptions: ${e.message}`),
    );
  }
}
