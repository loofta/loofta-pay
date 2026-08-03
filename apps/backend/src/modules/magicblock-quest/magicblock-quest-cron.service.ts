import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '@/database/supabase.service';
import { MagicblockQuestService } from './magicblock-quest.service';

/**
 * Safety net for maybePush*Quest call sites: those are fire-and-forget hooks scattered across
 * lottery.service.ts, claims.service.ts and send-payment.service.ts, and a new code path
 * (or a bug in an existing one — see the 2026-08-03 confirmMultiSend gap, which never called the
 * push at all for PRIVATE_TRANSFER_PENDING rows) can silently produce a qualifying purchase/payment
 * with no magicblock_quest_pushes row and nothing for retryFailedPushes to retry. This scans for
 * that condition directly and re-runs the same push, so a gap like that self-heals within a few
 * minutes instead of requiring another manual backend patch.
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
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Every 5 minutes: re-attempt the quest push for any qualifying purchase/payment with no push row at all. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileMissingPushes(): Promise<void> {
    if (!this.isProd || this.reconciling) return;
    this.reconciling = true;
    try {
      await this.reconcileLotteryTickets();
      await this.reconcilePrivatePayments();
    } catch (e) {
      this.logger.error(`reconcileMissingPushes: ${(e as Error)?.message ?? e}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileLotteryTickets(): Promise<void> {
    const db = this.supabase.getClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // bound the scan window
    const { data: tickets } = await db
      .from('lottery_tickets')
      .select('id, user_id')
      .eq('funded_privately', true)
      .gte('created_at', cutoff);
    if (!tickets?.length) return;

    const { data: pushed } = await db
      .from('magicblock_quest_pushes')
      .select('source_id')
      .eq('quest_type', 'lottery_ticket')
      .in('source_id', tickets.map((t) => t.id as string));
    const pushedIds = new Set((pushed ?? []).map((p) => p.source_id as string));

    for (const t of tickets) {
      if (pushedIds.has(t.id as string)) continue;
      await this.quest.maybePushLotteryTicketQuest(t.id as string).catch((e) =>
        this.logger.warn(`reconcile lottery_ticket ${t.id} failed: ${(e as Error)?.message ?? e}`),
      );
    }
  }

  private async reconcilePrivatePayments(): Promise<void> {
    const db = this.supabase.getClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // bound the scan window
    const { data: payments } = await db
      .from('payments')
      .select('id')
      .in('status', ['SUCCESS', 'PRIVATE_TRANSFER_PENDING'])
      .eq('is_private', true)
      .eq('is_devnet', false)
      .neq('direction', 'from_recipient')
      .gte('created_at', cutoff);
    if (!payments?.length) return;

    const { data: pushed } = await db
      .from('magicblock_quest_pushes')
      .select('source_id')
      .eq('quest_type', 'private_payment')
      .in('source_id', payments.map((p) => p.id as string));
    const pushedIds = new Set((pushed ?? []).map((p) => p.source_id as string));

    for (const p of payments) {
      if (pushedIds.has(p.id as string)) continue;
      await this.quest.maybePushPrivatePaymentQuest(p.id as string).catch((e) =>
        this.logger.warn(`reconcile private_payment ${p.id} failed: ${(e as Error)?.message ?? e}`),
      );
    }
  }
}
