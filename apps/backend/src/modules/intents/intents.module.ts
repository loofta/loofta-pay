import { Module } from '@nestjs/common';
import { IntentsController } from './intents.controller';
import { NearIntentsService } from './near-intents.service';
import { StatusService } from './status.service';
import { NearIntentsWithdrawalsProcessorService } from './near-intents-withdrawals-processor.service';

@Module({
  controllers: [IntentsController],
  providers: [
    NearIntentsService,
    StatusService,
    NearIntentsWithdrawalsProcessorService,
  ],
  exports: [
    NearIntentsService,
    StatusService,
  ],
})
export class IntentsModule {}
