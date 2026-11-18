import { BadRequestException } from '@nestjs/common';

/**
 * For any URL the backend will fetch or POST to on a user's behalf (webhooks, import feeds): refuse
 * anything that could reach our own network (SSRF). https only, a real domain name, no IP literals,
 * no localhost or internal-looking hostnames.
 */
export function assertSafePublicUrl(raw: string, label = 'url'): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException(`${label} is not a valid URL`);
  }
  const host = u.hostname.toLowerCase();
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[');
  if (
    u.protocol !== 'https:' || isIpLiteral || u.username || u.password ||
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')
  ) {
    throw new BadRequestException(`${label} must be a public https URL with a domain name`);
  }
  return u;
}
