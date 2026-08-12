import { Module } from '@nestjs/common';
import { TwitterAutopayController } from './twitter-autopay.controller';
import { TwitterAutopayService } from './twitter-autopay.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [TwitterAutopayController],
  providers: [TwitterAutopayService],
  exports: [TwitterAutopayService],
})
export class TwitterAutopayModule {}
