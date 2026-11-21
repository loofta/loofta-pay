import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';

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

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.includes(':')) {
    const mapped = v.startsWith('::ffff:') ? v.slice(7) : null;
    if (mapped) return isPrivateIp(mapped);
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * Delivery-time check: the stored URL must still be public AND its hostname must resolve only to
 * public addresses (blocks a domain pointed at 127.0.0.1 / 169.254.169.254 / internal IPs).
 * Callers must also fetch with redirect: 'manual' so a 302 can't bounce to an internal host.
 */
export async function assertSafePublicUrlResolved(raw: string, label = 'url'): Promise<URL> {
  const u = assertSafePublicUrl(raw, label);
  let addrs: { address: string }[];
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    throw new BadRequestException(`${label} host could not be resolved`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new BadRequestException(`${label} resolves to a non-public address`);
  }
  return u;
}
