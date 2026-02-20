import { Module, forwardRef } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { AdminClaimsController } from './admin-claims.controller';
import { ClaimsService } from './claims.service';
import { DepositService } from './deposit.service';
import { SolanaSponsorService } from './solana-sponsor.service';
import { IntentsModule } from '../intents/intents.module';
import { UsersModule } from '../users/users.module';
import { CronModule } from '../cron/cron.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';

@Module({
  imports: [IntentsModule, UsersModule, forwardRef(() => CronModule), forwardRef(() => SendPaymentModule)],
  controllers: [ClaimsController, AdminClaimsController],
  providers: [ClaimsService, DepositService, SolanaSponsorService],
  exports: [ClaimsService, DepositService],
})
export class ClaimsModule {}
