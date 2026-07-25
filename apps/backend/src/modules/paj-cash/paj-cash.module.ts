import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { PajCashController } from './paj-cash.controller';
import { PajCashService } from './paj-cash.service';
import { PajCashSessionService } from './paj-cash-session.service';
import { PajCashBankService } from './paj-cash-bank.service';
import { PajCashOrdersService } from './paj-cash-orders.service';
import { PajCashProcessorService } from './paj-cash-processor.service';

@Module({
  imports: [UsersModule, SendPaymentModule],
  controllers: [PajCashController],
  providers: [
    PajCashService,
    PajCashSessionService,
    PajCashBankService,
    PajCashOrdersService,
    PajCashProcessorService,
  ],
  exports: [PajCashService],
})
export class PajCashModule {}
