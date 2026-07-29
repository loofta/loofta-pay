import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { StatusService } from '../intents/status.service';

const BATCH_LIMIT = 25;

/**
 * user_deposits (Near Intents top-up) rows only ever get their status/bridge_status
 * updated by a client-side poll in BalanceModal.tsx, keyed on non-persisted React state.
 * Closing the tab mid-bridge leaves the row at status='pending' forever even after the
 * swap actually settles on Near Intents' side. This cron reconciles those rows server-side,
 * mirroring PrivateBalanceProcessorService's cross-chain deposit polling.
 */
@Injectable()
export class UserDepositsProcessorService {
  private readonly logger = new Logger(UserDepositsProcessorService.name);
  private isProcessing = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly statusService: StatusService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('UserDepositsProcessorService: NODE_ENV != production — cron disabled on this instance (avoids racing production for the same deposit rows and doubling RPC/bridge-status load)');
    }
  }

  private get isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (!this.isProd) return;
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.reconcilePendingDeposits();
    } catch (e) {
      this.logger.error(`cron error: ${String(e)}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async reconcilePendingDeposits() {
    const { data, error } = await this.supabaseService.userDeposits
      .select('id, deposit_address, status')
      .eq('type', 'near-intents')
      .eq('status', 'pending')
      .not('deposit_address', 'is', null)
      .limit(BATCH_LIMIT);
    if (error) { this.logger.warn(`query failed: ${error.message}`); return; }
    if (!data?.length) return;

    for (const row of data) {
      try {
        await this.reconcileOne(row.id, row.deposit_address as string);
      } catch (e) {
        this.logger.warn(`${row.id}: reconcile failed (will retry next tick): ${String(e)}`);
      }
    }
  }

  private async reconcileOne(id: string, depositAddress: string) {
    const result = await this.statusService.getNearIntentsStatus(depositAddress);
    if (!result.isComplete && !result.isFailed) return; // still bridging — checked again next tick

    const updates: Record<string, unknown> = {
      status: result.isComplete ? 'complete' : 'failed',
      bridge_status: result.status,
      updated_at: new Date().toISOString(),
    };
    const amountOut = result.raw?.swapDetails?.amountOutFormatted;
    if (result.isComplete && amountOut) updates.amount_usdc = parseFloat(amountOut);

    const { error } = await this.supabaseService.userDeposits.update(updates).eq('id', id);
    if (error) { this.logger.warn(`${id}: update failed: ${error.message}`); return; }
    this.logger.log(`${id}: reconciled -> ${updates.status} (${result.status})`);
  }
}
