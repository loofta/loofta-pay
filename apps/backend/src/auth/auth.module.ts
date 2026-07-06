import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrivyVerificationService } from './privy-verification.service';
import { AuthGuard } from '@/common/guards/auth.guard';
import { OptionalAuthGuard } from '@/common/guards/optional-auth.guard';
import { PrivyAuthGuard } from './privy-auth.guard';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';

/**
 * Global auth module — provides PrivyVerificationService, AuthGuard, OptionalAuthGuard,
 * PrivyAuthGuard, and RateLimitGuard to every module in the app without explicit imports.
 * RedisModule is already global so no need to import it here.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrivyVerificationService, AuthGuard, OptionalAuthGuard, PrivyAuthGuard, RateLimitGuard],
  exports: [PrivyVerificationService, AuthGuard, OptionalAuthGuard, PrivyAuthGuard, RateLimitGuard],
})
export class AuthModule {}
