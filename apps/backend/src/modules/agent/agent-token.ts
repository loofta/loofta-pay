import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Session tokens look like lft_ag_<43 url-safe chars> (256 bits). Only the hash is ever stored. */
export const TOKEN_PREFIX = 'lft_ag_';

export function generateSessionToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) };
}

/** A high-entropy random token, so a plain sha256 is enough (nothing to brute-force or rainbow-table). */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const looksLikeSessionToken = (raw: string) => /^lft_ag_[A-Za-z0-9_-]{43}$/.test(raw);

/** The secret the agent polls with while it waits for the person to approve. */
export function generateDeviceCode(): { deviceCode: string; hash: string } {
  const deviceCode = 'lft_dc_' + randomBytes(32).toString('base64url');
  return { deviceCode, hash: hashToken(deviceCode) };
}

// No 0/O, 1/I/L, or U: nothing that can be misread aloud or typed wrong.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** XXXX-XXXX, what the person types in the app. Rejection sampling keeps every letter equally likely. */
export function generateUserCode(): string {
  let out = '';
  const max = Math.floor(256 / USER_CODE_ALPHABET.length) * USER_CODE_ALPHABET.length;
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < max && out.length < 8) out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** "abcd efgh", "ABCD-EFGH", "abcdefgh" all mean the same code. */
export function normalizeUserCode(input: string): string | null {
  const raw = (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 8 || [...raw].some((c) => !USER_CODE_ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export const SCOPES = ['read', 'pay', 'withdraw'] as const;
export type AgentScope = (typeof SCOPES)[number];
/** Only known scopes, read always included, withdraw only when asked for explicitly. */
export function sanitizeScopes(requested: unknown): AgentScope[] {
  const asked = Array.isArray(requested) ? requested : [];
  const set = new Set<AgentScope>(['read']);
  for (const s of asked) if ((SCOPES as readonly string[]).includes(s)) set.add(s as AgentScope);
  return [...set];
}
