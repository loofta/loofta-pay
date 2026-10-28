import { generateSessionToken, hashToken, looksLikeSessionToken, generateUserCode, normalizeUserCode, generateDeviceCode, sanitizeScopes, TOKEN_PREFIX } from './agent-token';

describe('agent tokens', () => {
  it('makes a long random token, stores only its hash, and keeps a short prefix to recognise it', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a.token).toMatch(/^lft_ag_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeSessionToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(a.prefix.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.prefix.length).toBeLessThan(a.token.length);
  });
  it('does not mistake other strings for a session token', () => {
    expect(looksLikeSessionToken('lft_live_abc')).toBe(false);
    expect(looksLikeSessionToken('lft_ag_short')).toBe(false);
    expect(looksLikeSessionToken('')).toBe(false);
  });
  it('makes unambiguous user codes, and reads them forgivingly', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateUserCode();
      expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OIL U]/);
      expect(normalizeUserCode(c.toLowerCase())).toBe(c);
    }
    expect(normalizeUserCode('abcd efgh')).toBe('ABCD-EFGH');
    expect(normalizeUserCode('ABCD-EFG0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeUserCode('short')).toBeNull();
  });
  it('device codes are secrets distinct from the user code', () => {
    const d = generateDeviceCode();
    expect(d.deviceCode).toMatch(/^lft_dc_/);
    expect(d.hash).toBe(hashToken(d.deviceCode));
  });
  it('only ever grants known scopes, always read, and withdraw only when asked', () => {
    expect(sanitizeScopes(undefined)).toEqual(['read']);
    expect(sanitizeScopes(['pay', 'admin', 'root'])).toEqual(['read', 'pay']);
    expect(sanitizeScopes(['pay', 'withdraw'])).toEqual(['read', 'pay', 'withdraw']);
    expect(sanitizeScopes('pay')).toEqual(['read']);
  });
});
