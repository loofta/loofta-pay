import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-privy-user-id'];

    if (!userId) {
      throw new UnauthorizedException('Missing x-privy-user-id header');
    }

    const isAdmin = await this.checkAdminStatus(userId);
    if (!isAdmin) {
      this.logger.warn(`Unauthorized admin access attempt by user: ${userId}`);
      throw new UnauthorizedException('Admin access required');
    }

    // Attach user info to request for use in controllers
    request.user = { id: userId, isAdmin: true };
    return true;
  }

  private async checkAdminStatus(userId: string): Promise<boolean> {
    try {
      // Check database first
      const { data, error } = await this.supabaseService.users
        .select('role')
        .eq('privy_user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();

      if (!error && data) {
        return true;
      }

      // Fallback to environment variable
      const adminIds = this.configService.get<string>('ADMIN_PRIVY_USER_IDS', '');
      const adminList = adminIds.split(',').map((id) => id.trim()).filter(Boolean);
      return adminList.includes(userId);
    } catch (error) {
      this.logger.error('Error checking admin status:', error);
      return false;
    }
  }
}
