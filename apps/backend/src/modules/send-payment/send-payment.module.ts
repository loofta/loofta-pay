import { Module } from '@nestjs/common';
import { SendPaymentController } from './send-payment.controller';
import { SendPaymentService } from './send-payment.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [SendPaymentController],
  providers: [SendPaymentService, SendPaymentEncryptionService],
  exports: [SendPaymentService, SendPaymentEncryptionService],
})
export class SendPaymentModule {}
