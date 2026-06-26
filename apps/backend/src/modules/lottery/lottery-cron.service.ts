import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LotteryService } from './lottery.service';

@Injectable()
export class LotteryCronService {
  private readonly logger = new Logger(LotteryCronService.name);

  constructor(private readonly lottery: LotteryService) {}

  /** Every 30 seconds: check sent tickets for USDC + start bridge */
  @Cron('*/15 * * * * *')
  async processSent(): Promise<void> {
    this.logger.log('Cron: processing sent tickets');
    await this.lottery.processSentTickets().catch(e =>
      this.logger.error(`processSentTickets: ${e.message}`),
    );
  }

  /** Every 30 seconds: check bridging tickets + buy on Megapot */
  @Cron('*/15 * * * * *')
  async processBridging(): Promise<void> {
    this.logger.log('Cron: processing bridging tickets');
    await this.lottery.processBridgingTickets().catch(e =>
      this.logger.error(`processBridgingTickets: ${e.message}`),
    );
  }

  /** Every 2 minutes: check pending private withdrawals (bridge → MagicBlock) */
  @Cron('*/2 * * * *')
  async processWithdrawals(): Promise<void> {
    await this.lottery.processPendingWithdrawals().catch(e =>
      this.logger.error(`processPendingWithdrawals: ${e.message}`),
    );
  }

  /** Daily at 00:30 UTC: check draw results (draw happens at midnight UTC) */
  @Cron('30 0 * * *')
  async checkDailyResults(): Promise<void> {
    this.logger.log('Cron: checking daily Megapot draw results');
    await this.lottery.checkDailyResults().catch(e =>
      this.logger.error(`checkDailyResults: ${e.message}`),
    );
  }

  /** Every 5 minutes: backfill NFT ball numbers for active tickets that don't have them yet */
  @Cron('0 */5 * * * *')
  async backfillNumbers(): Promise<void> {
    await this.lottery.backfillTicketNumbers().catch(e =>
      this.logger.error(`backfillTicketNumbers: ${e.message}`),
    );
  }
}
