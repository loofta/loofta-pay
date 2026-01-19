import { Module } from '@nestjs/common';
import { IntentsController } from './intents.controller';
import { NearIntentsService } from './near-intents.service';
import { RhinestoneService } from './rhinestone.service';
import { StatusService } from './status.service';

@Module({
  controllers: [IntentsController],
  providers: [
    NearIntentsService,
    RhinestoneService,
    StatusService,
  ],
  exports: [
    NearIntentsService,
    RhinestoneService,
    StatusService,
  ],
})
export class IntentsModule {}
