import { Module } from '@nestjs/common';
import { TwitterPaymentsController } from './twitter-payments.controller';
import { TwitterPaymentsService } from './twitter-payments.service';
import { BotGuard } from './bot.guard';

@Module({
  controllers: [TwitterPaymentsController],
  providers: [TwitterPaymentsService, BotGuard],
})
export class TwitterPaymentsModule {}
