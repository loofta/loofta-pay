import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly privy: PrivyVerificationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = (request.headers['authorization'] as string | undefined)?.trim();
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required');

    const token = authHeader.slice(7).trim();
    const userId = await this.privy.verifyAccessToken(token);
    if (!userId) throw new UnauthorizedException('Invalid or expired token');

    const isAdmin = await this.checkAdminStatus(userId);
    if (!isAdmin) {
      this.logger.warn(`Unauthorized admin access attempt by user: ${userId?.slice(0, 30)}...`);
      throw new UnauthorizedException('Admin access required');
    }

    request.user = { id: userId, isAdmin: true };
    return true;
  }

  private async checkAdminStatus(userId: string): Promise<boolean> {
    try {
      // First check environment variable (fastest, no DB query)
      const adminIds = this.configService.get<string>('ADMIN_PRIVY_USER_IDS', '');
      const adminList = adminIds.split(',').map((id) => id.trim()).filter(Boolean);

      if (adminList.includes(userId)) {
        return true;
      }

      // Fallback to database check
      const { data, error } = await this.supabaseService.users
        .select('role')
        .eq('privy_user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

      return !error && !!data;
    } catch (error) {
      this.logger.error('Error checking admin status:', error);
      return false;
    }
  }
}
