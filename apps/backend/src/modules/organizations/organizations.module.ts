import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { ClaimsModule } from '../claims/claims.module';
import { IntegratorsModule } from '../integrators/integrators.module';

@Module({
  imports: [ClaimsModule, IntegratorsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
