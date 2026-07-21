import { Module } from '@nestjs/common';
import { TwitterPaymentsController } from './twitter-payments.controller';
import { TwitterPaymentsService } from './twitter-payments.service';
import { ClaimsModule } from '../claims/claims.module';
import { IntegratorsModule } from '../integrators/integrators.module';

@Module({
  imports: [ClaimsModule, IntegratorsModule],
  controllers: [TwitterPaymentsController],
  providers: [TwitterPaymentsService],
})
export class TwitterPaymentsModule {}
