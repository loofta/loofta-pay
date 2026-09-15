import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { isCronEnabled } from '@/common/cron-gate';
import { NestRebalanceService } from './nest-rebalance.service';

@Injectable()
export class NestCronService {
  private readonly logger = new Logger(NestCronService.name);

  constructor(
    private readonly rebalance: NestRebalanceService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('NestCronService: NODE_ENV != production — Nest rebalance cron disabled on this instance (see cron-gate.ts).');
    }
  }

  private get isProd(): boolean {
    return isCronEnabled(this.config);
  }

  /** Once daily — a robo-advisor doesn't need higher-frequency rebalancing, and higher frequency
   *  would multiply real swap fees / Jupiter API usage for negligible benefit. Overlap-guarded
   *  in the service itself (`running` flag), same pattern as lottery's cron methods. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async dailyRebalance(): Promise<void> {
    if (!this.isProd) return;
    await this.rebalance.runDailyRebalance().catch(e => this.logger.error(`runDailyRebalance: ${e.message}`));
  }
}
