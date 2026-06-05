import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

/**
 * AuthGuard — requires a valid Privy Bearer JWT.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly privy: PrivyVerificationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

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

    throw new UnauthorizedException('Authentication required');
  }
}
