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

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      // Resolve from backend app root so env is found regardless of process cwd (e.g. when started from monorepo root)
      envFilePath: [
        join(__dirname, '..', '.env.local'),
        join(__dirname, '..', '.env'),
        '.env.local',
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
