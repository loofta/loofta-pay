import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

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
  ) {}

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
      request.user = { id: userId };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
