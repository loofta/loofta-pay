import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentAuthService } from './agent-auth.service';
import { AgentPaymentsService } from './agent-payments.service';
import { AgentGuard } from './agent.guard';
import { AgentOauthService } from './agent-oauth.service';
import { AgentOauthController } from './agent-oauth.controller';
import { AgentMcpService } from './agent-mcp.service';
import { AgentMcpController } from './agent-mcp.controller';
import { UsersModule } from '../users/users.module';
import { TwitterAutopayModule } from '../twitter-autopay/twitter-autopay.module';
import { IntentsModule } from '../intents/intents.module';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';
import { OfframpModule } from '../offramp/offramp.module';
import { LotteryModule } from '../lottery/lottery.module';
import { SendPaymentModule } from '../send-payment/send-payment.module';
import { AgentSolSwapService } from './agent-sol-swap.service';
import { AgentCashoutService } from './agent-cashout.service';
import { AgentFundingService } from './agent-funding.service';

@Module({
  imports: [UsersModule, TwitterAutopayModule, IntentsModule, TelegramBotModule, OfframpModule, LotteryModule, SendPaymentModule],
  controllers: [AgentController, AgentOauthController, AgentMcpController],
  providers: [AgentAuthService, AgentPaymentsService, AgentGuard, AgentOauthService, AgentMcpService, AgentFundingService, AgentCashoutService, AgentSolSwapService],
})
export class AgentModule {}
