import { Module } from '@nestjs/common';
import { SendPaymentController } from './send-payment.controller';
import { SendPaymentService } from './send-payment.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [UsersModule, EmailModule],
  controllers: [SendPaymentController],
  providers: [SendPaymentService, SendPaymentEncryptionService],
  exports: [SendPaymentService, SendPaymentEncryptionService],
})
export class SendPaymentModule {}
