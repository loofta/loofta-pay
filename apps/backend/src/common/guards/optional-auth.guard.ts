import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

/**
 * Optional auth: attach user when x-privy-user-id is present, do not throw when missing.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-privy-user-id'];
    request.user = userId ? { id: userId } : undefined;
    return true;
  }
}
