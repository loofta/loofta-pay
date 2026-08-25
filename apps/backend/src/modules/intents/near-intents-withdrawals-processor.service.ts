import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { isCronEnabled } from '@/common/cron-gate';
import { SupabaseService } from '@/database/supabase.service';
import { StatusService } from './status.service';

const BATCH_LIMIT = 25;

/**
 * withdrawals rows for near-intents-bridged withdrawals only ever get near_intents_status/
 * near_intents_complete updated by a client-side poll in BalanceModal.tsx, keyed on
 * non-persisted React state — same gap user-deposits-processor.service.ts fixes for deposits.
 * Closing the tab mid-bridge leaves a row unresolved forever even after the withdrawal actually
 * settles on Near Intents' side, and the frontend's own "older than 1hr -> show Cancelled"
 * fallback is a display-only label with no real status check behind it, so it can mislabel a
 * withdrawal that's simply slow (or already succeeded) as failed. This cron reconciles those
 * rows server-side against the real Near Intents execution status.
 */
@Injectable()
export class NearIntentsWithdrawalsProcessorService {
  private readonly logger = new Logger(NearIntentsWithdrawalsProcessorService.name);
  private isProcessing = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly statusService: StatusService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('NearIntentsWithdrawalsProcessorService: NODE_ENV != production — cron disabled on this instance');
    }
  }

  private get isProd(): boolean {
    return isCronEnabled(this.config);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (!this.isProd) return;
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.reconcilePendingWithdrawals();
    } catch (e) {
      this.logger.error(`cron error: ${String(e)}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async reconcilePendingWithdrawals() {
    const { data, error } = await this.supabaseService.withdrawals
      .select('id, deposit_address')
      .eq('is_near_intents', true)
      .eq('near_intents_complete', false)
      .not('deposit_address', 'is', null)
      .limit(BATCH_LIMIT);
    if (error) { this.logger.warn(`query failed: ${error.message}`); return; }
    if (!data?.length) return;

    for (const row of data) {
      try {
        await this.reconcileOne(row.id as string, row.deposit_address as string);
      } catch (e) {
        this.logger.warn(`${row.id}: reconcile failed (will retry next tick): ${String(e)}`);
      }
    }
  }

  private async reconcileOne(id: string, depositAddress: string) {
    const result = await this.statusService.getNearIntentsStatus(depositAddress);
    if (!result.isComplete && !result.isFailed) return; // still bridging — checked again next tick

    // near_intents_complete only ever means "settled" here, not "succeeded" — a failed/refunded
    // bridge still needs to stop being polled, same distinction the deposits cron makes with
    // status='complete'|'failed'.
    const { error } = await this.supabaseService.withdrawals
      .update({ near_intents_status: result.status, near_intents_complete: true })
      .eq('id', id);
    if (error) { this.logger.warn(`${id}: update failed: ${error.message}`); return; }
    this.logger.log(`${id}: reconciled -> ${result.status} (complete=${result.isComplete}, failed=${result.isFailed})`);
  }
}
