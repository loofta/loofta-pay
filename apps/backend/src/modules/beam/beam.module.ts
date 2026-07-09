import { Module } from '@nestjs/common';
import { BeamController } from './beam.controller';
import { BeamService } from './beam.service';

@Module({
  controllers: [BeamController],
  providers: [BeamService],
  exports: [BeamService],
})
export class BeamModule {}
