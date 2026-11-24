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
import { PartnerCompressionService } from './partner-compression.service';
import { PartnerTreasuryService } from './partner-treasury.service';
import { PartnerTreasuryController } from './partner-treasury.controller';
import { PartnerKeysService } from './partner-keys.service';
import { PortalTokenService } from './portal-token.service';
import { PartnerGroupsService } from './partner-groups.service';
import { PartnerGroupsController } from './partner-groups.controller';
import { PayoutVaultService } from './payout-vault.service';
import { PayoutVaultController } from './payout-vault.controller';
import { ZkmeService } from './zkme.service';
import { PartnerKycService } from './partner-kyc.service';
import { PartnerKycController } from './partner-kyc.controller';
import { PartnerAdminService } from './partner-admin.service';
import { PartnerFeeSettingsService } from './partner-fee-settings.service';
import { PartnerAdminController } from './partner-admin.controller';
import { PartnerApiController } from './partner-api.controller';
import { PartnerPortalTokenController, PortalController, PortalGuard } from './partner-portal.controller';

@Module({
  imports: [UsersModule, ClaimsModule, IntegratorsModule, EmailModule, PayoutsModule],
  controllers: [PartnersController, PartnerGroupsController, PartnerKycController, PartnerBatchesController, PartnerTreasuryController, PartnerWithdrawController, PayoutVaultController, PartnerPortalTokenController, PortalController, PartnerApiController, PartnerAdminController],
  providers: [ZkmeService, PartnerKycService, PartnerFeeSettingsService, PartnerAdminService, PartnersService, PartnerGroupsService, PartnerWithdrawService, PartnerPayoutsService, PartnerTreasuryService, PartnerCompressionService, PayoutVaultService, PartnerKeysService, PortalTokenService, PortalGuard],
  exports: [PartnersService],
})
export class PartnersModule {}
