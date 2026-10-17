import { Module } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { IntentLlmService } from './intent-llm';
import { UsersModule } from '../users/users.module';
import { TwitterAutopayModule } from '../twitter-autopay/twitter-autopay.module';

@Module({
  imports: [UsersModule, TwitterAutopayModule],
  controllers: [TelegramBotController],
  providers: [TelegramBotService, IntentLlmService],
})
export class TelegramBotModule {}
