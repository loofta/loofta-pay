import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from '@/common/decorators/rate-limit.decorator';
import { RedisService } from '@/redis/redis.service';
import { getClientIp } from '@/common/get-client-ip';

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

    const ip: string = getClientIp(request);

    // 'integrator': keyed on the integrator IntegratorGuard attached to the request (which must
    // run first), using that integrator's own DB-configured limit rather than the decorator's
    // static one — each integrator gets an independently enforced cap. Falls back to IP if
    // keyFrom is 'integrator' but no integrator is present (misconfigured guard order), rather
    // than silently keying on nothing.
    let identifier: string;
    let limit: number;
    if (options.keyFrom === 'integrator' && request.integrator?.id) {
      identifier = `integrator:${request.integrator.id}`;
      limit = request.integrator.rateLimitPerMin ?? options.limit;
    } else if (options.keyFrom === 'ip') {
      identifier = ip;
      limit = options.limit;
    } else {
      // Default ('user' or unset): prefer authenticated user ID; fall back to IP.
      // An AI agent's requests are limited per session, not per IP (many agents share one address).
      identifier = request.user?.id ?? (request.agentSession?.id ? `agent:${request.agentSession.id}` : ip);
      limit = options.limit;
    }

    const keyPrefix = options.keyPrefix ?? context.getHandler().name;
    const key = `rl:${keyPrefix}:${identifier}`;

    const { allowed, remaining, retryAfterMs } = await this.redis.slideWindow(
      key,
      limit,
      options.windowSecs,
    );

    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', remaining);
    response.setHeader('X-RateLimit-Window', options.windowSecs);

    if (!allowed) {
      this.logger.warn(
        `Rate limit hit — key=${key} limit=${limit}/${options.windowSecs}s`,
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
