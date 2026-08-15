import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { GachaService } from './gacha.service';

/**
 * VRF exclusion and voting are lifecycle progress, not production settlement. They must run in
 * development too: requesting randomness is only the first half of MagicBlock VRF; the result is
 * delivered asynchronously and has to be polled before the room can leave `excluding`. Keeping
 * those sweeps behind NODE_ENV=production made every real local-devnet game depend on the manual
 * force endpoints.
 *
 * The legacy bidding/settlement sweep remains production-only. It touches shared money-moving
 * state (bid grace windows and treasury transfers), so a local process must not race Railway for
 * ownership of that work.
 */
@Injectable()
export class GachaCronService {
  private readonly logger = new Logger(GachaCronService.name);

  constructor(
    private readonly gacha: GachaService,
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('GachaCronService: NODE_ENV != production — VRF/voting lifecycle enabled; legacy settlement sweep disabled');
    }
  }

  private get isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Every 15s: advance any room mid-exclusion-draw (VRF request/poll), any room mid-voting
   *  (vote-round timeout, or a passed round's VRF cut draw), plus any room whose bidding window or
   *  bid-payment grace window has closed (dead in the current flow — no room ever reaches
   *  'bidding' anymore — but left running rather than removed, same as the bid code itself). */
  @Cron('*/15 * * * * *')
  async sweep(): Promise<void> {
    await this.gacha.advanceExcludingRooms().catch((e) => this.logger.error(`advanceExcludingRooms: ${e.message}`));
    await this.gacha.advanceVotingRooms().catch((e) => this.logger.error(`advanceVotingRooms: ${e.message}`));
    if (this.isProd) {
      await this.gacha.settleDueRooms().catch((e) => this.logger.error(`settleDueRooms: ${e.message}`));
    }
  }
}
