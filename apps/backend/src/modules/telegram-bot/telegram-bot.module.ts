import { Module } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { IntentLlmService } from './intent-llm';
import { TelegramWalletService } from './telegram-wallet.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { UsersModule } from '../users/users.module';
import { PrivateBalanceModule } from '../private-balance/private-balance.module';
import { IntentsModule } from '../intents/intents.module';
import { ClaimsModule } from '../claims/claims.module';
import { TwitterAutopayModule } from '../twitter-autopay/twitter-autopay.module';

@Module({
  imports: [UsersModule, ClaimsModule, TwitterAutopayModule, PrivateBalanceModule, IntentsModule],
  controllers: [TelegramBotController],
  providers: [TelegramBotService, IntentLlmService, TelegramWalletService, TelegramNotifierService],
  exports: [TelegramNotifierService, TelegramWalletService],
})
export class TelegramBotModule {}
