import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CronGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const cronSecret = this.configService.get<string>('CRON_SECRET');

    if (!cronSecret) {
      throw new UnauthorizedException('CRON_SECRET is not configured');
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new UnauthorizedException('Invalid cron authorization');
    }

    return true;
  }
}
