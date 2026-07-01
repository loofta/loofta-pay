import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** Max requests allowed within windowSecs */
  limit: number;
  /** Sliding window duration in seconds */
  windowSecs: number;
  /** Redis key namespace (defaults to handler method name) */
  keyPrefix?: string;
}

export const RateLimit = (
  limit: number,
  windowSecs: number,
  keyPrefix?: string,
): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSecs, keyPrefix } satisfies RateLimitOptions);
