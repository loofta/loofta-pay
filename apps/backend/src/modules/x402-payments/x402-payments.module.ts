import { Module } from '@nestjs/common';
import { IntegratorPaymentsController } from './integrator-payments.controller';
import { X402PaymentsController } from './x402-payments.controller';
import { BurnerPaymentService } from './burner-payment.service';
import { ClaimsModule } from '../claims/claims.module';
import { UsersModule } from '../users/users.module';
import { IntegratorsModule } from '../integrators/integrators.module';

@Module({
  imports: [ClaimsModule, UsersModule, IntegratorsModule],
  controllers: [IntegratorPaymentsController, X402PaymentsController],
  providers: [BurnerPaymentService],
  exports: [BurnerPaymentService],
})
export class X402PaymentsModule {}
