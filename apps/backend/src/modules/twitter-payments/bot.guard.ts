import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BotGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = this.config.get<string>('TWITTER_BOT_SECRET');
    if (!secret) throw new UnauthorizedException('TWITTER_BOT_SECRET is not configured');
    if (request.headers['authorization'] !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Invalid bot authorization');
    }
    return true;
  }
}
