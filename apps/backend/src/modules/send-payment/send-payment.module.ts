import { Module } from '@nestjs/common';
import { SendPaymentController } from './send-payment.controller';
import { SendPaymentService } from './send-payment.service';
import { SendPaymentCronService } from './send-payment-cron.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { MagicblockQuestModule } from '../magicblock-quest/magicblock-quest.module';

@Module({
  imports: [UsersModule, EmailModule, MagicblockQuestModule],
  controllers: [SendPaymentController],
  providers: [SendPaymentService, SendPaymentEncryptionService, SendPaymentCronService],
  exports: [SendPaymentService, SendPaymentEncryptionService],
})
export class SendPaymentModule {}
