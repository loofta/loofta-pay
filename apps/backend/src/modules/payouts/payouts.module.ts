import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { IntegratorsModule } from '@/modules/integrators/integrators.module';
import { ClaimsModule } from '@/modules/claims/claims.module';
import { IntentsModule } from '@/modules/intents/intents.module';

@Module({
  imports: [IntegratorsModule, ClaimsModule, IntentsModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
})
export class PayoutsModule {}
