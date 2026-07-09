import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronController } from './cron.controller';
import { ClaimProcessorService } from './claim-processor.service';
import { SwapProcessorService } from './swap-processor.service';
import { SolanaTxVerifierService } from './solana-tx-verifier.service';
import { BeamProcessorService } from './beam-processor.service';
import { ClaimsModule } from '../claims/claims.module';
import { IntentsModule } from '../intents/intents.module';
import { BeamModule } from '../beam/beam.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => ClaimsModule),
    IntentsModule,
    BeamModule,
    DatabaseModule,
  ],
  controllers: [CronController],
  providers: [
    ClaimProcessorService,
    SwapProcessorService,
    SolanaTxVerifierService,
    BeamProcessorService,
  ],
  exports: [
    ClaimProcessorService,
    SwapProcessorService,
    SolanaTxVerifierService,
    BeamProcessorService,
  ],
})
export class CronModule {}
