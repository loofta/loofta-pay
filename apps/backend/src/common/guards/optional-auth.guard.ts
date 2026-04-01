import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

/**
 * OptionalAuthGuard — attaches user when credentials are present but never blocks unauthenticated requests.
 * Follows same priority order as AuthGuard (Bearer JWT > x-privy-user-id).
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly privy: PrivyVerificationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request.user = undefined;

    // 1. JWT Bearer token
    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const userId = await this.privy.verifyAccessToken(token);
      if (userId) request.user = { id: userId };
      return true;
    }

    // 2. Legacy x-privy-user-id — verify existence before trusting
    const legacyId = (request.headers['x-privy-user-id'] as string | undefined)?.trim();
    if (legacyId) {
      const valid = await this.privy.verifyUserId(legacyId);
      if (valid) request.user = { id: legacyId };
    }

    return true;
  }
}
