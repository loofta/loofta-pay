import { Module } from '@nestjs/common';
import { IntentsController } from './intents.controller';
import { NearIntentsService } from './near-intents.service';
import { StatusService } from './status.service';
import { RelayWithdrawalService } from './relay-withdrawal.service';
import { NearIntentsWithdrawalsProcessorService } from './near-intents-withdrawals-processor.service';

@Module({
  controllers: [IntentsController],
  providers: [
    NearIntentsService,
    StatusService,
    RelayWithdrawalService,
    NearIntentsWithdrawalsProcessorService,
  ],
  exports: [
    NearIntentsService,
    StatusService,
    RelayWithdrawalService,
  ],
})
export class IntentsModule {}
