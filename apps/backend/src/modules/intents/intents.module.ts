import { Module } from '@nestjs/common';
import { IntentsController } from './intents.controller';
import { NearIntentsService } from './near-intents.service';
import { StatusService } from './status.service';

@Module({
  controllers: [IntentsController],
  providers: [
    NearIntentsService,
    StatusService,
  ],
  exports: [
    NearIntentsService,
    StatusService,
  ],
})
export class IntentsModule {}
