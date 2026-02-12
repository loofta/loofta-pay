import { Module } from '@nestjs/common';
import { PayrollOrganizationsController } from './payroll-organizations.controller';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { PayrollContributorsController } from './payroll-contributors.controller';
import { PayrollContributorsService } from './payroll-contributors.service';
import { PayrollInviteController } from './payroll-invite.controller';

@Module({
  controllers: [
    PayrollOrganizationsController,
    PayrollContributorsController,
    PayrollInviteController,
  ],
  providers: [PayrollOrganizationsService, PayrollContributorsService],
  exports: [PayrollOrganizationsService, PayrollContributorsService],
})
export class PayrollModule {}
