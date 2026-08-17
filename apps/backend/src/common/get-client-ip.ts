/** Real client IP behind Railway's single-hop proxy (see main.ts's `trust proxy` setting) —
 *  same extraction RateLimitGuard uses, shared here so security logging keys on the same IP. */
export function getClientIp(request: { headers: Record<string, unknown>; ip?: string }): string {
  return (
    (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    request.ip ||
    'unknown'
  );
}
