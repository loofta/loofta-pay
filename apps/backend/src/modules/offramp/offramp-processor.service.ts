import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { isCronEnabled } from '@/common/cron-gate';
import { OfframpService } from './offramp.service';

/**
 * offramp_requests in DEPOSITED status only ever got their fulfilment checked reactively, when
 * the frontend polled GET /api/offramp/:id — closing the tab mid-fill left the row stuck at
 * DEPOSITED forever even after the Peer cash-out actually delivered on-chain. This cron reconciles
 * those rows server-side, mirroring UserDepositsProcessorService's pattern for Near Intents deposits.
 */
@Injectable()
export class OfframpProcessorService {
  private readonly logger = new Logger(OfframpProcessorService.name);
  private isProcessing = false;

  constructor(
    private readonly offramp: OfframpService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('OfframpProcessorService: NODE_ENV != production — cron disabled on this instance (avoids racing production for the same offramp rows and doubling Peer/indexer load)');
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
      await this.offramp.processActiveOfframps();
    } catch (e) {
      this.logger.error(`cron error: ${String(e)}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
