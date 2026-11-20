import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Optional } from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { SupabaseService } from '@/database/supabase.service';

export { ALLOW_WALLET_ONLY_KEY, AllowWalletOnly } from './allow-wallet-only';

/** Shared by AuthGuard and PrivyAuthGuard: throws unless the account has an email/phone/social login (or is a Seeker login). */
export async function assertVerifiedIdentity(privy: PrivyVerificationService, supabase: SupabaseService | undefined, userId: string): Promise<void> {
  if (await privy.hasVerifiedIdentity(userId)) return;
  if (supabase) {
    const { data } = await supabase.appUsers.select('username').eq('privy_user_id', userId).maybeSingle();
    if (typeof data?.username === 'string' && data.username.startsWith('loo-skr-')) return;
  }
  throw new ForbiddenException('Add an email or a social account to your profile to use this feature.');
}

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
    await assertVerifiedIdentity(this.privy, this.supabase, userId);
    return true;
  }
}
