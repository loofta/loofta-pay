import { Module } from '@nestjs/common';
import { TwitterPaymentsController } from './twitter-payments.controller';
import { TwitterPaymentsService } from './twitter-payments.service';
import { ClaimsModule } from '../claims/claims.module';
import { IntegratorsModule } from '../integrators/integrators.module';
import { TwitterAutopayModule } from '../twitter-autopay/twitter-autopay.module';

@Module({
  imports: [ClaimsModule, IntegratorsModule, TwitterAutopayModule],
  controllers: [TwitterPaymentsController],
  providers: [TwitterPaymentsService],
})
export class TwitterPaymentsModule {}
