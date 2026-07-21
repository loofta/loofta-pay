import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** Max requests allowed within windowSecs. Ignored when keyFrom is 'integrator' and the
   *  integrator has its own DB-configured rate_limit_per_min — see RateLimitGuard. */
  limit: number;
  /** Sliding window duration in seconds */
  windowSecs: number;
  /** Redis key namespace (defaults to handler method name) */
  keyPrefix?: string;
  /**
   * What identity to key the limit on. Defaults to 'user' (falls back to IP if unauthenticated —
   * the existing behavior). 'integrator' keys on request.integrator.id (set by IntegratorGuard,
   * which must run first in @UseGuards) and uses that integrator's own configured
   * rate_limit_per_min instead of `limit` above, so each integrator gets an independently
   * enforced, per-integrator cap rather than sharing one IP/user-keyed bucket.
   */
  keyFrom?: 'user' | 'ip' | 'integrator';
}

export const RateLimit = (
  limit: number,
  windowSecs: number,
  keyPrefix?: string,
  keyFrom?: RateLimitOptions['keyFrom'],
): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSecs, keyPrefix, keyFrom } satisfies RateLimitOptions);
