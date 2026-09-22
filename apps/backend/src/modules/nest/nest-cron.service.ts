import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { isCronEnabled } from '@/common/cron-gate';
import { NestRebalanceService } from './nest-rebalance.service';
import { NestSuggestionsService } from './nest-suggestions.service';

@Injectable()
export class NestCronService {
  private readonly logger = new Logger(NestCronService.name);

  constructor(
    private readonly rebalance: NestRebalanceService,
    private readonly suggestions: NestSuggestionsService,
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

  /** Hourly, not daily: catching a big move promptly is the point of "suggest what to do about
   *  real news" — cheap most hours (just a price check) since the slow Elfa event-summary call
   *  only fires for symbols that actually crossed the move threshold, see nest-suggestions.service.ts. */
  @Cron(CronExpression.EVERY_HOUR)
  async scanForSuggestions(): Promise<void> {
    if (!this.isProd) return;
    await this.suggestions.scanForEvents().catch(e => this.logger.error(`scanForEvents: ${e.message}`));
  }
}
