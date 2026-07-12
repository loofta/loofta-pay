import { Module } from '@nestjs/common';
import { LotteryController } from './lottery.controller';
import { AdminLotteryController } from './admin-lottery.controller';
import { LotteryService } from './lottery.service';
import { LotteryCronService } from './lottery-cron.service';
import { MegapotService } from './megapot.service';
import { RhinestoneService } from './rhinestone.service';
import { LifiService } from './lifi.service';
import { RelayService } from './relay.service';
import { IntentsModule } from '../intents/intents.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [IntentsModule, SendPaymentModule, UsersModule, EmailModule, DatabaseModule],
  controllers: [LotteryController, AdminLotteryController],
  providers: [LotteryService, LotteryCronService, MegapotService, RhinestoneService, LifiService, RelayService],
  exports: [LotteryService],
})
export class LotteryModule {}
