import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PajCashOrdersService } from './paj-cash-orders.service';

/**
 * Backup/primary status reconciliation for PAJ Cash orders. This project runs no webhook
 * receiver for PAJ (see plan §5 — PAJ has no documented webhook signing scheme, so a public
 * receiver would be an unauthenticated attack surface for zero real benefit, since we'd have to
 * re-verify server-side before trusting it anyway). Polling is therefore the *only* status
 * reconciliation path, not just a fallback.
 */
@Injectable()
export class PajCashProcessorService {
  private readonly logger = new Logger(PajCashProcessorService.name);
  private isProcessing = false;

  constructor(private readonly orders: PajCashOrdersService) {}

  // Every 20s — active orders should feel close to real-time without hammering PAJ's API.
  @Cron('*/20 * * * * *')
  async handleCron() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const active = await this.orders.listNonTerminal(25);
      for (const row of active) {
        try {
          await this.orders.reconcileOrder(row);
        } catch (err) {
          this.logger.warn(`[PajCashProcessor] reconcile failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await this.orders.expireStaleOrders();
    } catch (err) {
      this.logger.error(`[PajCashProcessor] cron error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
