import { Module } from '@nestjs/common';
import { PrivateBalanceController } from './private-balance.controller';
import { PrivateBalanceService } from './private-balance.service';
import { PrivateBalanceProcessorService } from './private-balance-processor.service';
import { PrivateTokenWithdrawalService } from './private-token-withdrawal.service';
import { UsersModule } from '../users/users.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { ClaimsModule } from '../claims/claims.module';
import { IntentsModule } from '../intents/intents.module';
import { DatabaseModule } from '@/database/database.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [UsersModule, SendPaymentModule, ClaimsModule, IntentsModule, DatabaseModule, EmailModule],
  controllers: [PrivateBalanceController],
  providers: [PrivateBalanceService, PrivateBalanceProcessorService, PrivateTokenWithdrawalService],
  exports: [PrivateBalanceService],
})
export class PrivateBalanceModule {}
