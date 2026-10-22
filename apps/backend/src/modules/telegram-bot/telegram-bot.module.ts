import { Module } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { IntentLlmService } from './intent-llm';
import { TelegramWalletService } from './telegram-wallet.service';
import { UsersModule } from '../users/users.module';
import { PrivateBalanceModule } from '../private-balance/private-balance.module';
import { IntentsModule } from '../intents/intents.module';
import { TwitterAutopayModule } from '../twitter-autopay/twitter-autopay.module';

@Module({
  imports: [UsersModule, TwitterAutopayModule, PrivateBalanceModule, IntentsModule],
  controllers: [TelegramBotController],
  providers: [TelegramBotService, IntentLlmService, TelegramWalletService],
})
export class TelegramBotModule {}
