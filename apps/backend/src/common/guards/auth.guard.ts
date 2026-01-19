import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-privy-user-id'];

    if (!userId) {
      throw new UnauthorizedException('Missing x-privy-user-id header');
    }

    // Attach user info to request
    request.user = { id: userId };
    return true;
  }
}
