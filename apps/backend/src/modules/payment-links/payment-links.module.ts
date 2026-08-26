import { Module } from '@nestjs/common';
import { PaymentLinksController } from './payment-links.controller';
import { PaymentLinksService } from './payment-links.service';
import { IntegratorsModule } from '@/modules/integrators/integrators.module';
import { UsersModule } from '@/modules/users/users.module';
import { ClaimsModule } from '@/modules/claims/claims.module';

@Module({
  imports: [IntegratorsModule, UsersModule, ClaimsModule],
  controllers: [PaymentLinksController],
  providers: [PaymentLinksService],
})
export class PaymentLinksModule {}
