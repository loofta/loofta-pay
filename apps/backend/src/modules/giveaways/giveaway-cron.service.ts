import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { GiveawaysService } from './giveaways.service';
import { GiveawayFundingService } from './giveaway-funding.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { XVerificationService } from './x-verification.service';
import { GiveawayDrawService } from './giveaway-draw.service';
import { GiveawayPayoutService } from './giveaway-payout.service';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawayStatus } from './entities/giveaway.entity';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';

/**
 * Giveaways cron jobs — same shape as lottery-cron.service.ts: every job is gated on
 * NODE_ENV=production (see feedback memory `feedback_cron_production_gating`) so a local/staging
 * instance never races the real production backend for the same burner/DB rows, and every job
 * wraps its call in try/catch so one failing tick never crashes the process or blocks the others.
 */
@Injectable()
export class GiveawayCronService {
  private readonly logger = new Logger(GiveawayCronService.name);

  constructor(
    private readonly giveaways: GiveawaysService,
    private readonly funding: GiveawayFundingService,
    private readonly entries: GiveawayEntriesService,
    private readonly xVerification: XVerificationService,
    private readonly draw: GiveawayDrawService,
    private readonly payout: GiveawayPayoutService,
    private readonly burnerSweep: GiveawayBurnerSweepService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('GiveawayCronService: NODE_ENV != production — all giveaway cron jobs are disabled on this instance');
    }
  }

  private get isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Every 30s: poll PENDING_FUNDING burners for an on-chain deposit. */
  @Cron('*/30 * * * * *')
  async pollFunding(): Promise<void> {
    if (!this.isProd) return;
    try {
      const pending = await this.funding.findAwaitingFunding();
      for (const giveaway of pending) {
        await this.funding.checkAndUpdateFundingStatus(giveaway).catch((e) =>
          this.logger.error(`pollFunding ${giveaway.id}: ${e?.message ?? e}`),
        );
      }
    } catch (e: any) {
      this.logger.error(`pollFunding: ${e?.message ?? e}`);
    }
  }

  /** Once a day (was every 2 minutes until 2026-08-06 — Lisa: "we don't have budget to
   *  automatically do it, they need to click verify"): batch X-API verification, one fetch per
   *  task (not per entrant), as a backstop for entrants who completed the task on X directly and
   *  never clicked "Verify" in-app. Day-to-day verification is now click-only via
   *  GiveawayEntriesService.submitTaskCompletion's inline path (cache-shared, see
   *  XVerificationService.FETCH_CACHE_TTL_MS) — this is just the daily sweep so nobody who did the
   *  task but skipped the button stays `pending` forever. Bump the schedule back up (or restore
   *  '0 */2 * * * *') once there's budget for tighter background verification again. */
  @Cron('0 0 4 * * *')
  async verifyXTasks(): Promise<void> {
    if (!this.isProd || !this.xVerification.isAvailable()) return;
    try {
      const active = await this.giveaways.findAdvanceable();
      for (const giveaway of active) {
        if (giveaway.status !== GiveawayStatus.OPEN && giveaway.status !== GiveawayStatus.ENTRIES_CLOSED) continue;
        try {
          const pendingByTask = await this.entries.listPendingByTask(giveaway.id);
          if (!pendingByTask.size) continue;
          const tasks = await this.giveaways.getTasks(giveaway.id);
          const tasksById = new Map(tasks.map((t) => [t.id, t]));
          for (const [taskId, pending] of pendingByTask) {
            const task = tasksById.get(taskId);
            if (!task) continue;
            await this.xVerification.verifyPendingCompletions(giveaway, task, pending);
          }
        } catch (e: any) {
          this.logger.error(`verifyXTasks ${giveaway.id}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      this.logger.error(`verifyXTasks: ${e?.message ?? e}`);
    }
  }

  /** Every minute: advance every giveaway that can still move on its own (close entries once
   *  past the deadline, freeze the snapshot, run the random/first-come draw). Manual-selection
   *  giveaways stop advancing at DRAWING until the creator calls select-winners. */
  @Cron('0 * * * * *')
  async advanceDraws(): Promise<void> {
    if (!this.isProd) return;
    try {
      const active = await this.giveaways.findAdvanceable();
      for (const giveaway of active) {
        await this.draw.advance(giveaway.id).catch((e) => this.logger.error(`advanceDraws ${giveaway.id}: ${e?.message ?? e}`));
      }
    } catch (e: any) {
      this.logger.error(`advanceDraws: ${e?.message ?? e}`);
    }
  }

  /** Every 30s: process winner payouts (and retry failures) + refund the leftover buffer once a
   *  giveaway's every winner is paid. */
  @Cron('*/30 * * * * *')
  async processPayouts(): Promise<void> {
    if (!this.isProd) return;
    try {
      const awaiting = await this.payout.findGiveawaysAwaitingPayout();
      for (const giveaway of awaiting) {
        await this.payout.processGiveaway(giveaway).catch((e) => this.logger.error(`processPayouts ${giveaway.id}: ${e?.message ?? e}`));
      }
    } catch (e: any) {
      this.logger.error(`processPayouts: ${e?.message ?? e}`);
    }
  }

  /** Every 5 minutes: GC backstop reclaiming rent/dust from terminal giveaway burners that
   *  somehow missed their inline close (e.g. the private-sweep follow-up reclaim failed). Mirrors
   *  claims.service.ts's cronReclaimFinishedClaimBurners. */
  @Cron('0 */5 * * * *')
  async reclaimTerminalBurners(): Promise<void> {
    if (!this.isProd) return;
    try {
      const rows = await this.giveaways.findTerminalUnreclaimedBurners();
      for (const giveaway of rows) {
        if (!giveaway.burner_address || !giveaway.burner_encrypted_secret) continue;
        try {
          const conn = this.solanaSponsor.getConnectionForCluster(giveaway.is_devnet ? 'devnet' : 'mainnet');
          const burnerKeypair = this.burnerSweep.decryptBurner(giveaway.burner_address, giveaway.burner_encrypted_secret);
          await this.burnerSweep.reclaimTerminalBurner(conn, burnerKeypair);
          await this.giveaways.markBurnerReclaimed(giveaway.id);
        } catch (e: any) {
          this.logger.warn(`reclaimTerminalBurners ${giveaway.id}: ${e?.message ?? e} (will retry next tick)`);
        }
      }
    } catch (e: any) {
      this.logger.error(`reclaimTerminalBurners: ${e?.message ?? e}`);
    }
  }
}
