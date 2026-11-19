import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { PartnersController } from './partners.controller';
import { ClaimsModule } from '@/modules/claims/claims.module';
import { PartnersService } from './partners.service';
import { PartnerWithdrawService } from './partner-withdraw.service';
import { PartnerWithdrawController } from './partner-withdraw.controller';
import { PartnerPayoutsService } from './partner-payouts.service';
import { PartnerBatchesController } from './partner-batches.controller';
import { IntegratorsModule } from '@/modules/integrators/integrators.module';
import { PartnerTreasuryService } from './partner-treasury.service';
import { PartnerTreasuryController } from './partner-treasury.controller';
import { PartnerKeysService } from './partner-keys.service';
import { PortalTokenService } from './portal-token.service';
import { PartnerApiController } from './partner-api.controller';
import { PartnerPortalTokenController, PortalController, PortalGuard } from './partner-portal.controller';

@Module({
  imports: [UsersModule, ClaimsModule, IntegratorsModule],
  controllers: [PartnersController, PartnerBatchesController, PartnerTreasuryController, PartnerWithdrawController, PartnerPortalTokenController, PortalController, PartnerApiController],
  providers: [PartnersService, PartnerWithdrawService, PartnerPayoutsService, PartnerTreasuryService, PartnerKeysService, PortalTokenService, PortalGuard],
  exports: [PartnersService],
})
export class PartnersModule {}
