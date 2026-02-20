import { Module } from '@nestjs/common';
import { SendPaymentController } from './send-payment.controller';
import { SendPaymentService } from './send-payment.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { VaultService } from './vault/vault.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [SendPaymentController],
  providers: [SendPaymentService, SendPaymentEncryptionService, VaultService],
  exports: [SendPaymentService, SendPaymentEncryptionService],
})
export class SendPaymentModule {}
