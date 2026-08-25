import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isCronEnabled } from '@/common/cron-gate';
import { Cron } from '@nestjs/schedule';
import { SendPaymentService } from './send-payment.service';

@Injectable()
export class SendPaymentCronService {
  private readonly logger = new Logger(SendPaymentCronService.name);

  constructor(
    private readonly sendPayment: SendPaymentService,
    private readonly config: ConfigService,
  ) {}

  private get isProd(): boolean {
    return isCronEnabled(this.config);
  }

  /** Every 5 minutes: resume any private multi-send batch whose fan-out died mid-flight (funded
   *  15+ min ago, still not COMPLETED) — this is the actual fix for rows getting stuck OPEN/
   *  IN_FLIGHT forever; the old hub design had nothing retrying at all. */
  @Cron('*/5 * * * *')
  async retryStuckMultiSendBatches(): Promise<void> {
    if (!this.isProd) return;
    await this.sendPayment.retryStuckMultiSendBatches().catch((e) =>
      this.logger.error(`retryStuckMultiSendBatches: ${e.message}`),
    );
  }
}
