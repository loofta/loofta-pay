import { Module } from '@nestjs/common';
import { LotteryController } from './lottery.controller';
import { LotteryService } from './lottery.service';
import { LotteryCronService } from './lottery-cron.service';
import { MegapotService } from './megapot.service';
import { RhinestoneService } from './rhinestone.service';
import { IntentsModule } from '../intents/intents.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [IntentsModule, SendPaymentModule, DatabaseModule],
  controllers: [LotteryController],
  providers: [LotteryService, LotteryCronService, MegapotService, RhinestoneService],
  exports: [LotteryService],
})
export class LotteryModule {}
