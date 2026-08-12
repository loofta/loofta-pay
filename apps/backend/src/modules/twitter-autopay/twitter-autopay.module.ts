import { Module } from '@nestjs/common';
import { TwitterAutopayController } from './twitter-autopay.controller';
import { TwitterAutopayService } from './twitter-autopay.service';
import { AutopaySignerService } from './autopay-signer.service';
import { UsersModule } from '../users/users.module';
import { ClaimsModule } from '../claims/claims.module';

@Module({
  imports: [UsersModule, ClaimsModule],
  controllers: [TwitterAutopayController],
  providers: [TwitterAutopayService, AutopaySignerService],
  exports: [TwitterAutopayService],
})
export class TwitterAutopayModule {}
