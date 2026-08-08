import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { GachaService } from './gacha.service';

/**
 * Same NODE_ENV=production gate as LotteryCronService (modules/lottery/lottery-cron.service.ts)
 * and the same reasoning: settlement touches shared, money-moving state (bid grace windows,
 * treasury buyback/NFT-transfer transactions) keyed only by DB row with no per-instance
 * ownership — running this locally against the same Supabase project as Railway would mean two
 * independent instances racing to settle the same room.
 */
@Injectable()
export class GachaCronService {
  private readonly logger = new Logger(GachaCronService.name);

  constructor(
    private readonly gacha: GachaService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('GachaCronService: NODE_ENV != production — settlement sweep disabled on this instance');
    }
  }

  private get isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Every 15s: advance any room mid-exclusion-draw (VRF request/poll), plus any room whose
   *  bidding window or bid-payment grace window has closed (dead in the current flow — no room
   *  ever reaches 'bidding' anymore — but left running rather than removed, same as the bid code
   *  itself). */
  @Cron('*/15 * * * * *')
  async sweep(): Promise<void> {
    if (!this.isProd) return;
    await this.gacha.advanceExcludingRooms().catch((e) => this.logger.error(`advanceExcludingRooms: ${e.message}`));
    await this.gacha.settleDueRooms().catch((e) => this.logger.error(`settleDueRooms: ${e.message}`));
  }
}
