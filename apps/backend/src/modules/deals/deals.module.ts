import { Module } from '@nestjs/common';
import { IntentsModule } from '../intents/intents.module';
import { DealsController } from './deals.controller';
import { DealInvitesController } from './deal-invites.controller';
import { DealPaymentsController } from './deal-payments.controller';
import { FreelancerProfilesController } from './freelancer-profiles.controller';
import { DealsService } from './deals.service';
import { FreelancerProfilesService } from './freelancer-profiles.service';
import { DealPaymentsService } from './deal-payments.service';

@Module({
  imports: [IntentsModule],
  controllers: [DealsController, DealInvitesController, DealPaymentsController, FreelancerProfilesController],
  providers: [DealsService, FreelancerProfilesService, DealPaymentsService],
  exports: [DealsService, FreelancerProfilesService, DealPaymentsService],
})
export class DealsModule {}
