import { Module } from '@nestjs/common';
import { FomoController } from './fomo.controller';
import { FomoService } from './fomo.service';

@Module({
  controllers: [FomoController],
  providers: [FomoService],
  exports: [FomoService],
})
export class FomoModule {}
