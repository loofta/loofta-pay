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

// Short in-memory cache so the suspension check is not a DB round trip on every request.
// A suspension takes effect within SUSPENSION_CACHE_MS on each backend instance.
const SUSPENSION_CACHE_MS = 30_000;
const suspensionCache = new Map<string, { suspended: boolean; at: number }>();

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

  private async isSuspended(userId: string): Promise<boolean> {
    if (!this.supabase) return false;
    const hit = suspensionCache.get(userId);
    if (hit && Date.now() - hit.at < SUSPENSION_CACHE_MS) return hit.suspended;
    try {
      const { data, error } = await this.supabase.appUsers
        .select('suspended_at')
        .eq('privy_user_id', userId)
        .maybeSingle();
      // Column missing (migration not applied) or DB error: fail open, never lock everyone out.
      if (error) return false;
      const suspended = !!data?.suspended_at;
      suspensionCache.set(userId, { suspended, at: Date.now() });
      return suspended;
    } catch {
      return false;
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
      if (await this.isSuspended(userId)) {
        throw new ForbiddenException('Your account has been suspended. Contact hello@loofta.xyz.');
      }
      request.user = { id: userId };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
