import { Module } from '@nestjs/common';
import { AdminIntegratorsController } from './admin-integrators.controller';
import { IntegratorsService } from './integrators.service';
import { IntegratorGuard } from '@/common/guards/integrator.guard';

@Module({
  controllers: [AdminIntegratorsController],
  providers: [IntegratorsService, IntegratorGuard],
  exports: [IntegratorsService, IntegratorGuard],
})
export class IntegratorsModule {}
