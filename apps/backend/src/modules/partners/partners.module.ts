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
import { EmailModule } from '@/modules/email/email.module';
import { PayoutsModule } from '@/modules/payouts/payouts.module';
import { PartnerTreasuryService } from './partner-treasury.service';
import { PartnerTreasuryController } from './partner-treasury.controller';
import { PartnerKeysService } from './partner-keys.service';
import { PortalTokenService } from './portal-token.service';
import { PartnerGroupsService } from './partner-groups.service';
import { PartnerGroupsController } from './partner-groups.controller';
import { PartnerApiController } from './partner-api.controller';
import { PartnerPortalTokenController, PortalController, PortalGuard } from './partner-portal.controller';

@Module({
  imports: [UsersModule, ClaimsModule, IntegratorsModule, EmailModule, PayoutsModule],
  controllers: [PartnersController, PartnerGroupsController, PartnerBatchesController, PartnerTreasuryController, PartnerWithdrawController, PartnerPortalTokenController, PortalController, PartnerApiController],
  providers: [PartnersService, PartnerGroupsService, PartnerWithdrawService, PartnerPayoutsService, PartnerTreasuryService, PartnerKeysService, PortalTokenService, PortalGuard],
  exports: [PartnersService],
})
export class PartnersModule {}
