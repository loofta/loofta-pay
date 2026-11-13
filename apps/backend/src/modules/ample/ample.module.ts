import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { ClaimsModule } from '@/modules/claims/claims.module';
import { LotteryModule } from '@/modules/lottery/lottery.module';
import { AmpleController } from './ample.controller';
import { AmpleAdminController } from './ample-admin.controller';
import { AmpleEvmController } from './ample-evm.controller';
import { AmpleEvmService } from './ample-evm.service';
import { AmpleFundService } from './ample-fund.service';
import { AmpleCompanionService } from './ample-companion.service';
import { IntentsModule } from '@/modules/intents/intents.module';
import { SendPaymentModule } from '@/modules/send-payment/send-payment.module';
import { AmpleService } from './ample.service';

@Module({
  imports: [UsersModule, ClaimsModule, LotteryModule, SendPaymentModule, IntentsModule],
  controllers: [AmpleController, AmpleAdminController, AmpleEvmController],
  providers: [AmpleService, AmpleEvmService, AmpleFundService, AmpleCompanionService],
})
export class AmpleModule {}
