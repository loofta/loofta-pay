import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { DepositService } from './deposit.service';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, DepositService],
  exports: [ClaimsService, DepositService],
})
export class ClaimsModule {}
