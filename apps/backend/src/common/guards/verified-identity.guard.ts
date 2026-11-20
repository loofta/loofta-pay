import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Optional } from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { SupabaseService } from '@/database/supabase.service';

/**
 * Run AFTER AuthGuard. Rejects accounts whose only login is a bare wallet: they are free to mint
 * in bulk and were used to drain the fee payer and forge payments. Seeker mobile-wallet logins are
 * wallet-only by design and carry the reserved loo-skr- username, so they pass.
 */
@Injectable()
export class VerifiedIdentityGuard implements CanActivate {
  constructor(
    private readonly privy: PrivyVerificationService,
    @Optional() private readonly supabase?: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId: string | undefined = context.switchToHttp().getRequest().user?.id;
    if (!userId) return true; // AuthGuard decides unauthenticated access
    if (await this.privy.hasVerifiedIdentity(userId)) return true;
    if (this.supabase) {
      const { data } = await this.supabase.appUsers.select('username').eq('privy_user_id', userId).maybeSingle();
      if (typeof data?.username === 'string' && data.username.startsWith('loo-skr-')) return true;
    }
    throw new ForbiddenException('Add an email or a social account to your profile to use this feature.');
  }
}
