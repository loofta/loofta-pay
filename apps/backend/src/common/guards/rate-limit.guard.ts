import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from '@/common/decorators/rate-limit.decorator';
import { RedisService } from '@/redis/redis.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Prefer authenticated user ID; fall back to IP for public endpoints
    const userId: string | undefined = request.user?.id;
    const ip: string =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      'unknown';
    const identifier = userId ?? ip;

    const keyPrefix = options.keyPrefix ?? context.getHandler().name;
    const key = `rl:${keyPrefix}:${identifier}`;

    const { allowed, remaining, retryAfterMs } = await this.redis.slideWindow(
      key,
      options.limit,
      options.windowSecs,
    );

    response.setHeader('X-RateLimit-Limit', options.limit);
    response.setHeader('X-RateLimit-Remaining', remaining);
    response.setHeader('X-RateLimit-Window', options.windowSecs);

    if (!allowed) {
      this.logger.warn(
        `Rate limit hit — key=${key} limit=${options.limit}/${options.windowSecs}s`,
      );
      response.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      response.status(429).json({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
      });
      return false;
    }

    return true;
  }
}
