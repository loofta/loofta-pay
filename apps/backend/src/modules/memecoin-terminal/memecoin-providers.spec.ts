import { MINT_RE, parseDexPaid, parseDexScreenerPairs, parseSolanaTracker } from './memecoin-providers';

describe('memecoin providers', () => {
  it('parses DexScreener pairs and picks the deepest pool', () => {
    const patch = parseDexScreenerPairs([
      { pairAddress: 'thin', dexId: 'raydium', liquidity: { usd: 10 }, volume: { h24: 1 }, marketCap: 5 },
      {
        pairAddress: 'deep',
        dexId: 'pumpswap',
        liquidity: { usd: 5000 },
        volume: { h24: 186000 },
        marketCap: 412000,
        priceChange: { h1: 4.5, h24: 30 },
        baseToken: { name: 'Baguette Riot', symbol: 'BRIOT' },
        info: {
          imageUrl: 'https://img',
          websites: [{ url: 'https://briot.xyz' }],
          socials: [{ type: 'twitter', url: 'https://x.com/briot' }, { type: 'telegram', url: 'https://t.me/briot' }],
        },
      },
    ]);
    expect(patch).toMatchObject({
      pair_address: 'deep',
      volume_24h_usd: 186000,
      mcap_usd: 412000,
      price_change_1h: 4.5,
      website: 'https://briot.xyz',
      twitter: 'https://x.com/briot',
      telegram: 'https://t.me/briot',
      symbol: 'BRIOT',
    });
  });

  it('returns null for an empty or malformed DexScreener body', () => {
    expect(parseDexScreenerPairs([])).toBeNull();
    expect(parseDexScreenerPairs(null)).toBeNull();
  });

  it('detects a paid DexScreener profile only when approved', () => {
    expect(parseDexPaid({ orders: [{ type: 'tokenProfile', status: 'cancelled' }] })).toBe(false);
    expect(parseDexPaid({ orders: [{ type: 'tokenProfile', status: 'cancelled' }, { type: 'tokenProfile', status: 'approved' }] })).toBe(true);
    expect(parseDexPaid({ orders: [{ type: 'tokenAd', status: 'on-hold' }] })).toBe(false);
    expect(parseDexPaid({})).toBe(false);
  });

  it('parses Solana Tracker risk fields', () => {
    const patch = parseSolanaTracker({
      holders: 1240,
      pools: [{ liquidity: { usd: 100 }, lpBurn: 100, security: { freezeAuthority: null, mintAuthority: null } }],
      risk: { bundlers: { totalPercentage: 6 }, dev: { percentage: 2 }, snipers: { totalPercentage: 3 }, top10: 22, rugged: false, score: 1 },
    });
    expect(patch).toMatchObject({
      holders: 1240,
      bundler_pct: 6,
      dev_pct: 2,
      lp_burn_pct: 100,
      mint_authority_active: false,
      freeze_authority_active: false,
      rugged: false,
    });
  });

  it('flags an active authority', () => {
    const patch = parseSolanaTracker({ pools: [{ security: { freezeAuthority: 'Abc', mintAuthority: null } }], risk: { dev: { percentage: 1 } } });
    expect(patch?.freeze_authority_active).toBe(true);
    expect(patch?.mint_authority_active).toBe(false);
  });

  it('treats omitted bundlers as 0 only when a risk object exists', () => {
    expect(parseSolanaTracker({ risk: { dev: { percentage: 1 } } })?.bundler_pct).toBe(0);
    expect(parseSolanaTracker({ holders: 5 })?.bundler_pct).toBeNull();
    expect(parseSolanaTracker({ holders: 5 })?.dev_pct).toBeNull();
  });

  it('validates mint addresses', () => {
    expect(MINT_RE.test('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN')).toBe(true);
    expect(MINT_RE.test('not a mint')).toBe(false);
    expect(MINT_RE.test('../../etc/passwd')).toBe(false);
  });
});
