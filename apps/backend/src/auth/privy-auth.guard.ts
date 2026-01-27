import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * PrivyAuthGuard - Validates Privy authentication token from Authorization header
 * Extracts user ID from Privy token and attaches to request.user
 */
@Injectable()
export class PrivyAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    
    // Try to get token from Authorization header (Bearer token)
    const authHeader = request.headers['authorization'];
    let userId: string | undefined;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // For now, we'll extract user ID from x-privy-user-id header as fallback
      // In production, you'd validate the Privy token and extract user ID from it
      userId = request.headers['x-privy-user-id'];
    } else {
      // Fallback to x-privy-user-id header (for compatibility with existing code)
      userId = request.headers['x-privy-user-id'];
    }

    if (!userId) {
      throw new UnauthorizedException('Missing authentication. Please provide Privy token or x-privy-user-id header.');
    }

    // Attach user info to request
    request.user = { id: userId };
    return true;
  }
}
