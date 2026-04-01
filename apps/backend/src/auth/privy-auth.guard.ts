import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrivyVerificationService } from './privy-verification.service';

/**
 * PrivyAuthGuard — identical behaviour to AuthGuard; used by UsersController.
 * Both guards share the same PrivyVerificationService logic.
 */
@Injectable()
export class PrivyAuthGuard implements CanActivate {
  private readonly logger = new Logger(PrivyAuthGuard.name);

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

    const legacyId = (request.headers['x-privy-user-id'] as string | undefined)?.trim();
    if (legacyId) {
      const valid = await this.privy.verifyUserId(legacyId);
      if (!valid) {
        throw new UnauthorizedException('Invalid user ID');
      }
      this.logger.warn(
        `[PrivyAuthGuard] Legacy x-privy-user-id — migrate to Bearer token`,
      );
      request.user = { id: legacyId };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
