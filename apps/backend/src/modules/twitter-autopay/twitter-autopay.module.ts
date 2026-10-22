import { Module } from '@nestjs/common';
import { TwitterAutopayController } from './twitter-autopay.controller';
import { TwitterAutopayService } from './twitter-autopay.service';
import { AutopaySignerService } from './autopay-signer.service';
import { UsersModule } from '../users/users.module';
import { ClaimsModule } from '../claims/claims.module';
import { IntegratorsModule } from '../integrators/integrators.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [UsersModule, ClaimsModule, IntegratorsModule, EmailModule],
  controllers: [TwitterAutopayController],
  providers: [TwitterAutopayService, AutopaySignerService],
  exports: [TwitterAutopayService, AutopaySignerService],
})
export class TwitterAutopayModule {}
