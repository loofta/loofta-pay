import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PartnerWebhooksService } from './partner-webhooks.service';
import { PortalTokenService } from './portal-token.service';
import { PortalController, PortalGuard } from './portal.controller';
import { IntegratorsModule } from '@/modules/integrators/integrators.module';
import { ClaimsModule } from '@/modules/claims/claims.module';
import { IntentsModule } from '@/modules/intents/intents.module';

@Module({
  imports: [IntegratorsModule, ClaimsModule, IntentsModule],
  controllers: [PayoutsController, PortalController],
  providers: [PayoutsService, PartnerWebhooksService, PortalTokenService, PortalGuard],
  exports: [PartnerWebhooksService],
})
export class PayoutsModule {}
