import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';

// Core modules
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';

// Feature modules
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { IntentsModule } from './modules/intents/intents.module';
import { TokensModule } from './modules/tokens/tokens.module';
import { CronModule } from './modules/cron/cron.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { SendPaymentModule } from './modules/send-payment/send-payment.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { TwitterPaymentsModule } from './modules/twitter-payments/twitter-payments.module';
import { TwitterAutopayModule } from './modules/twitter-autopay/twitter-autopay.module';
import { TelegramBotModule } from './modules/telegram-bot/telegram-bot.module';
import { TwitterTicketGiftsModule } from './modules/twitter-ticket-gifts/twitter-ticket-gifts.module';
import { OfframpModule } from './modules/offramp/offramp.module';
import { JupiterModule } from './modules/jupiter/jupiter.module';
import { LotteryModule } from './modules/lottery/lottery.module';
import { MagicblockQuestModule } from './modules/magicblock-quest/magicblock-quest.module';
import { IntegratorsModule } from './modules/integrators/integrators.module';
import { PrivateBalanceModule } from './modules/private-balance/private-balance.module';
import { PajCashModule } from './modules/paj-cash/paj-cash.module';
import { UserDepositsModule } from './modules/user-deposits/user-deposits.module';
import { GiveawaysModule } from './modules/giveaways/giveaways.module';
import { NestModule as NestFeatureModule } from './modules/nest/nest.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { PaymentLinksModule } from './modules/payment-links/payment-links.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { FomoModule } from './modules/fomo/fomo.module';

@Module({
  imports: [
    // Configuration
    //
    // Which local env file loads is picked by LOOFTA_ENV_FILE (set by the npm script that starts
    // the process — see package.json's start:dev vs start:dev:prod-data), NOT by NODE_ENV. Reusing
    // NODE_ENV for this would be a real footgun: NODE_ENV=production also gates every money-moving
    // @Cron job and the KMS-secrets requirement (see kms-secrets.ts REQUIRED_IN_PRODUCTION) — so
    // picking "the prod-data file" via NODE_ENV would silently turn on production cron jobs on a
    // laptop just because someone wanted to point at prod data locally. NODE_ENV stays
    // "development" in both local env files; only the Solana cluster / Supabase project / secrets
    // actually differ between them. Defaults to .env.development.local — that's the file both this
    // repo's contributors use day to day, and the only one anyone but the account owner should ever
    // have a copy of. There is deliberately no fallback to a bare ".env.local" here anymore — a
    // missing var should fail loudly (undefined) rather than silently resolving from a stale mixed
    // file. See ENVIRONMENTS.md.
    ConfigModule.forRoot({
      isGlobal: true,
      // Resolve from backend app root so env is found regardless of process cwd (e.g. when started from monorepo root)
      envFilePath: [
        join(__dirname, '..', process.env.LOOFTA_ENV_FILE || '.env.development.local'),
        join(__dirname, '..', '.env'),
        process.env.LOOFTA_ENV_FILE || '.env.development.local',
        '.env',
      ],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 50,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 200,
      },
    ]),

    // Scheduling for cron jobs
    ScheduleModule.forRoot(),

    // Core
    DatabaseModule,
    RedisModule,
    AuthModule,

    // Features
    HealthModule,
    OrganizationsModule,
    ClaimsModule,
    IntentsModule,
    TokensModule,
    CronModule,
    UsersModule,
    SendPaymentModule,
    RewardsModule,
    WaitlistModule,
    TwitterPaymentsModule,
    TwitterAutopayModule,
    TelegramBotModule,
    TwitterTicketGiftsModule,
    OfframpModule,
    JupiterModule,
    LotteryModule,
    MagicblockQuestModule,
    IntegratorsModule,
    PrivateBalanceModule,
    PajCashModule,
    UserDepositsModule,
    NestFeatureModule,
    GiveawaysModule,
    MarketingModule,
    PaymentLinksModule,
    PayoutsModule,
    FomoModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
