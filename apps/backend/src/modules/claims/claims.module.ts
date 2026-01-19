import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { AdminClaimsController } from './admin-claims.controller';
import { ClaimsService } from './claims.service';
import { DepositService } from './deposit.service';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [ClaimsController, AdminClaimsController],
  providers: [ClaimsService, DepositService],
  exports: [ClaimsService, DepositService],
})
export class ClaimsModule {}
