import { Module, forwardRef } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { AdminClaimsController } from './admin-claims.controller';
import { ClaimsService } from './claims.service';
import { DepositService } from './deposit.service';
import { IntentsModule } from '../intents/intents.module';
import { UsersModule } from '../users/users.module';
import { CronModule } from '../cron/cron.module';

@Module({
  imports: [IntentsModule, UsersModule, forwardRef(() => CronModule)],
  controllers: [ClaimsController, AdminClaimsController],
  providers: [ClaimsService, DepositService],
  exports: [ClaimsService, DepositService],
})
export class ClaimsModule {}
