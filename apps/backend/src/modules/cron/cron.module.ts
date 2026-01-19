import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { ClaimProcessorService } from './claim-processor.service';
import { ClaimsModule } from '../claims/claims.module';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [ClaimsModule, IntentsModule],
  controllers: [CronController],
  providers: [ClaimProcessorService],
  exports: [ClaimProcessorService],
})
export class CronModule {}
