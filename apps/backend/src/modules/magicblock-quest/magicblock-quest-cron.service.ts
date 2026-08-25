import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isCronEnabled } from '@/common/cron-gate';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '@/database/supabase.service';
import { MagicblockQuestService } from './magicblock-quest.service';

/**
 * Safety net for maybePush*Quest call sites: those are fire-and-forget hooks scattered across
 * lottery.service.ts, claims.service.ts and send-payment.service.ts, and a new code path (or a bug
 * in an existing one — see the 2026-08-03 confirmMultiSend gap and is_private-downgrade races) can
 * silently produce a qualifying purchase/payment with no magicblock_quest_pushes row and nothing
 * for retryFailedPushes to retry. Rather than re-deriving "which recent rows look unpushed" (which
 * only catches gaps we already know the shape of, and only within whatever time window we picked),
 * this walks every wallet a user has ever connected and re-runs backfillQuestsForWallet — the same,
 * already-proven full-history reconciliation setWallet() runs on first connect — so it also self-
 * heals gaps from bugs we haven't found yet. Every real push already fires immediately at the
 * point of action (lottery/claims/send-payment call sites) — this is purely a backstop for gaps in
 * that, so there's no user-facing reason to run it as tight as the money-moving lottery crons.
 * The page itself also triggers an on-demand, single-wallet version of this same reconciliation on
 * every load (see MagicblockQuestController.getMe → backfillQuestsForWallet), so a user who
 * actually opens rewards/magicblock self-heals immediately regardless of this cron's cadence. This
 * sweep exists only for wallets that never revisit the page after the gap occurs, so it doesn't
 * need to be tight — every 8 hours is plenty.
 */
@Injectable()
export class MagicblockQuestCronService {
  private readonly logger = new Logger(MagicblockQuestCronService.name);
  private reconciling = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly quest: MagicblockQuestService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('MagicblockQuestCronService: NODE_ENV != production — reconciliation cron disabled on this instance');
    }
  }

  private get isProd(): boolean {
    return isCronEnabled(this.config);
  }

  /** Every 8 hours: re-run the full backfill reconciliation for every connected MagicBlock wallet. */
  @Cron('0 */8 * * *')
  async reconcileAllWallets(): Promise<void> {
    if (!this.isProd || this.reconciling) return;
    this.reconciling = true;
    try {
      const db = this.supabase.getClient();
      const { data: wallets, error } = await db.from('magicblock_wallets').select('user_id');
      if (error) {
        this.logger.warn(`reconcileAllWallets: failed to list wallets: ${error.message}`);
        return;
      }
      for (const w of (wallets ?? []) as { user_id: string }[]) {
        await this.quest.backfillQuestsForWallet(w.user_id).catch((e) =>
          this.logger.warn(`reconcileAllWallets: backfill failed for ${w.user_id}: ${(e as Error)?.message ?? e}`),
        );
      }
    } catch (e) {
      this.logger.error(`reconcileAllWallets: ${(e as Error)?.message ?? e}`);
    } finally {
      this.reconciling = false;
    }
  }
}
