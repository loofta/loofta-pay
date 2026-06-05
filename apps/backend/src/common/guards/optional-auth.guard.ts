import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

/**
 * OptionalAuthGuard — attaches user when a valid Bearer JWT is present but never
 * blocks unauthenticated requests.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly privy: PrivyVerificationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request.user = undefined;

    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const userId = await this.privy.verifyAccessToken(token);
      if (userId) request.user = { id: userId };
    }

    return true;
  }
}
