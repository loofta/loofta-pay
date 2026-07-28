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
import { EmailModule } from '../email/email.module';
import { MagicblockQuestModule } from '../magicblock-quest/magicblock-quest.module';
import { PajCashModule } from '../paj-cash/paj-cash.module';

@Module({
  imports: [IntentsModule, UsersModule, forwardRef(() => CronModule), forwardRef(() => SendPaymentModule), EmailModule, MagicblockQuestModule, PajCashModule],
  controllers: [ClaimsController, AdminClaimsController],
  providers: [ClaimsService, DepositService, SolanaSponsorService],
  exports: [ClaimsService, DepositService, SolanaSponsorService],
})
export class ClaimsModule {}
