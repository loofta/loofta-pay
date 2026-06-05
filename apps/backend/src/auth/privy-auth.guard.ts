import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrivyVerificationService } from './privy-verification.service';

/**
 * PrivyAuthGuard — identical behaviour to AuthGuard; used by UsersController.
 * Both guards share the same PrivyVerificationService logic.
 */
@Injectable()
export class PrivyAuthGuard implements CanActivate {
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
