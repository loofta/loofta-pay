import { Module } from '@nestjs/common';
import { IntentsModule } from '../intents/intents.module';
import { PayrollModule } from '../payroll/payroll.module';
import { DealsController } from './deals.controller';
import { DealInvitesController } from './deal-invites.controller';
import { DealPaymentsController } from './deal-payments.controller';
import { DealsInvoicesController } from './deals-invoices.controller';
import { DealsMyInvoicesController } from './deals-my-invoices.controller';
import { FreelancerProfilesController } from './freelancer-profiles.controller';
import { DealsService } from './deals.service';
import { FreelancerProfilesService } from './freelancer-profiles.service';
import { DealPaymentsService } from './deal-payments.service';

@Module({
  imports: [IntentsModule, PayrollModule],
  controllers: [DealsController, DealInvitesController, DealPaymentsController, DealsInvoicesController, DealsMyInvoicesController, FreelancerProfilesController],
  providers: [DealsService, FreelancerProfilesService, DealPaymentsService],
  exports: [DealsService, FreelancerProfilesService, DealPaymentsService],
})
export class DealsModule {}
