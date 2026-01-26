import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

// Core modules
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';

// Feature modules
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { IntentsModule } from './modules/intents/intents.module';
import { TokensModule } from './modules/tokens/tokens.module';
import { LotteryModule } from './modules/lottery/lottery.module';
import { CronModule } from './modules/cron/cron.module';
import { HealthModule } from './modules/health/health.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
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

    // Features
    HealthModule,
    OrganizationsModule,
    ClaimsModule,
    IntentsModule,
    TokensModule,
    LotteryModule,
    CronModule,
    PayrollModule,
    UsersModule,
  ],
})
export class AppModule {}
