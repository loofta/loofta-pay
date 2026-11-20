import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { ensureAppUserRow } from '@/common/guards/ensure-app-user';
import { SupabaseService } from '@/database/supabase.service';
import { ALLOW_WALLET_ONLY_KEY } from '@/common/guards/allow-wallet-only';
import { assertVerifiedIdentity } from '@/common/guards/verified-identity.guard';
import { PrivyVerificationService } from './privy-verification.service';

/**
 * PrivyAuthGuard — identical behaviour to AuthGuard; used by UsersController.
 * Both guards share the same PrivyVerificationService logic.
 */
@Injectable()
export class PrivyAuthGuard implements CanActivate {
  constructor(
    private readonly privy: PrivyVerificationService,
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly supabase?: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const userId = await this.privy.verifyAccessToken(token);
      if (!userId) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      // UsersController (sign-in, profile, linking an email) is exempt; every other route behind this
      // guard (mini-app pay, on-ramp, rewards) gets the same suspension + verified-identity rules as AuthGuard.
      const allowWalletOnly = this.reflector.getAllAndOverride<boolean>(ALLOW_WALLET_ONLY_KEY, [context.getHandler(), context.getClass()]);
      if (!allowWalletOnly) {
        await ensureAppUserRow(this.moduleRef, userId, request);
        if (this.supabase) {
          const { data } = await this.supabase.appUsers.select('suspended_at').eq('privy_user_id', userId).maybeSingle();
          if (data?.suspended_at) throw new ForbiddenException('Your account has been suspended. Contact hello@loofta.xyz.');
        }
        await assertVerifiedIdentity(this.privy, this.supabase, userId);
      }
      request.user = { id: userId };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
