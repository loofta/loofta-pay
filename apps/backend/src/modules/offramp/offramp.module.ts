import { Module } from '@nestjs/common';
import { OfframpController } from './offramp.controller';
import { OfframpService } from './offramp.service';
import { OfframpProcessorService } from './offramp-processor.service';
import { IntentsModule } from '../intents/intents.module';
import { UsersModule } from '@/modules/users/users.module';
import { LotteryModule } from '../lottery/lottery.module';
import { ClaimsModule } from '@/modules/claims/claims.module';
import { EmailModule } from '@/modules/email/email.module';

@Module({
  imports: [IntentsModule, UsersModule, LotteryModule, ClaimsModule, EmailModule],
  controllers: [OfframpController],
  providers: [OfframpService, OfframpProcessorService],
  exports: [OfframpService],
})
export class OfframpModule {}
