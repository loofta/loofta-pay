import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

/**
 * AuthGuard — requires valid Privy authentication.
 *
 * Priority order:
 *  1. Authorization: Bearer <privy_access_token>  ← preferred, full JWT verification
 *  2. x-privy-user-id header                      ← legacy, verified via Privy API (cached)
 *
 * Migrate all callers to send the Bearer token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly privy: PrivyVerificationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. JWT Bearer token (preferred)
    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const userId = await this.privy.verifyAccessToken(token);
      if (!userId) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      request.user = { id: userId };
      return true;
    }

    // 2. Legacy x-privy-user-id header — verify user actually exists in Privy
    const legacyId = (request.headers['x-privy-user-id'] as string | undefined)?.trim();
    if (legacyId) {
      const valid = await this.privy.verifyUserId(legacyId);
      if (!valid) {
        throw new UnauthorizedException('Invalid user ID');
      }
      this.logger.warn(
        `[AuthGuard] Legacy x-privy-user-id used by ${legacyId.slice(0, 20)}... — ` +
        'please migrate to Authorization: Bearer <token>',
      );
      request.user = { id: legacyId };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
