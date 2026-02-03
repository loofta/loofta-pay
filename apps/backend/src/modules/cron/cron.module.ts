import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronController } from './cron.controller';
import { ClaimProcessorService } from './claim-processor.service';
import { LotteryProcessorService } from './lottery-processor.service';
import { ClaimCompanionProcessorService } from './claim-companion-processor.service';
import { SwapProcessorService } from './swap-processor.service';
import { ClaimsModule } from '../claims/claims.module';
import { IntentsModule } from '../intents/intents.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => ClaimsModule),
    IntentsModule,
    DatabaseModule,
  ],
  controllers: [CronController],
  providers: [
    ClaimProcessorService,
    LotteryProcessorService,
    ClaimCompanionProcessorService,
    SwapProcessorService,
  ],
  exports: [
    ClaimProcessorService,
    LotteryProcessorService,
    ClaimCompanionProcessorService,
    SwapProcessorService,
  ],
})
export class CronModule {}
