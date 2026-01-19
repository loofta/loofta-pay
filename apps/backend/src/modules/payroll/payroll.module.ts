import { Module } from '@nestjs/common';
import { PayrollOrganizationsController } from './payroll-organizations.controller';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { PayrollContributorsController } from './payroll-contributors.controller';
import { PayrollContributorsService } from './payroll-contributors.service';

@Module({
  controllers: [PayrollOrganizationsController, PayrollContributorsController],
  providers: [PayrollOrganizationsService, PayrollContributorsService],
  exports: [PayrollOrganizationsService, PayrollContributorsService],
})
export class PayrollModule {}
