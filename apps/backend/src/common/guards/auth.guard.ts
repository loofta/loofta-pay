import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  SetMetadata,
  Optional,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { SupabaseService } from '@/database/supabase.service';
import { ALLOW_WALLET_ONLY_KEY } from './allow-wallet-only';
import { assertVerifiedIdentity } from './verified-identity.guard';

// Short in-memory cache so the suspension check is not a DB round trip on every request.
// A suspension takes effect within SUSPENSION_CACHE_MS on each backend instance.
const SUSPENSION_CACHE_MS = 30_000;
const suspensionCache = new Map<string, { suspended: boolean; at: number }>();
// Only positive results are cached, so a user who has just signed up is never blocked by a stale "no row".
const existsCache = new Set<string>();

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * AuthGuard — requires a valid Privy Bearer JWT.
 * Routes decorated with @Public() are exempt.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly privy: PrivyVerificationService,
    private readonly reflector: Reflector,
    @Optional() private readonly supabase?: SupabaseService,
  ) {}

  /** Reads the account's app_users row once: does it exist, and is it suspended. Fails open on DB errors. */
  private async accountState(userId: string): Promise<{ exists: boolean; suspended: boolean }> {
    if (!this.supabase) return { exists: true, suspended: false };
    const hit = suspensionCache.get(userId);
    if (hit && Date.now() - hit.at < SUSPENSION_CACHE_MS && existsCache.has(userId)) return { exists: true, suspended: hit.suspended };
    try {
      const { data, error } = await this.supabase.appUsers
        .select('suspended_at')
        .eq('privy_user_id', userId)
        .maybeSingle();
      // Column missing (migration not applied) or DB error: fail open, never lock everyone out.
      if (error) return { exists: true, suspended: false };
      if (!data) return { exists: false, suspended: false };
      const suspended = !!data.suspended_at;
      suspensionCache.set(userId, { suspended, at: Date.now() });
      if (existsCache.size > 50000) existsCache.clear();
      existsCache.add(userId);
      return { exists: true, suspended };
    } catch {
      return { exists: true, suspended: false };
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const userId = await this.privy.verifyAccessToken(token);
      if (!userId) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      const allowWalletOnly = this.reflector.getAllAndOverride<boolean>(ALLOW_WALLET_ONLY_KEY, [context.getHandler(), context.getClass()]);
      const state = await this.accountState(userId);
      // No app_users row means this account never signed in through the Loofta app (sign-in creates it):
      // that is how scripted accounts look. Sign-in itself (UsersController) is exempt so a real login can create it.
      if (!state.exists && !allowWalletOnly) {
        throw new ForbiddenException('Please sign in from the Loofta app to continue.');
      }
      if (state.suspended) {
        throw new ForbiddenException('Your account has been suspended. Contact hello@loofta.xyz.');
      }
      if (!allowWalletOnly) await assertVerifiedIdentity(this.privy, this.supabase, userId);
      request.user = { id: userId };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
