import { Module } from '@nestjs/common';
import { IntentsModule } from '../intents/intents.module';
import { PayrollOrganizationsController } from './payroll-organizations.controller';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { PayrollContributorsController } from './payroll-contributors.controller';
import { PayrollContributorsService } from './payroll-contributors.service';
import { PayrollInviteController } from './payroll-invite.controller';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollReceiptLoggerService } from './payroll-receipt-logger.service';

@Module({
  imports: [IntentsModule],
  controllers: [
    PayrollOrganizationsController,
    PayrollContributorsController,
    PayrollInviteController,
    PayrollRunsController,
  ],
  providers: [PayrollOrganizationsService, PayrollContributorsService, PayrollRunsService, PayrollReceiptLoggerService],
  exports: [PayrollOrganizationsService, PayrollContributorsService, PayrollRunsService, PayrollReceiptLoggerService],
})
export class PayrollModule {}
