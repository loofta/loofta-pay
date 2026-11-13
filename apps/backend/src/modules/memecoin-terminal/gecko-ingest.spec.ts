import { parseGraduations } from './gecko-ingest.service';

const mintA = 'JqJpcmuivS9Gj5cJGxijTwf5prKXU4YSWEYEAf9pump';
const mintB = 'Hm7pXDd2tL6kbmHfDFQh7cHE8iCGhoY9cL9hxxJSpump';
const pool = (dex: string, mint: string) => ({
  attributes: {
    address: 'PoolAddr1111111111111111111111111111111111111',
    pool_created_at: '2026-10-21T13:29:04Z',
    market_cap_usd: '58000.5',
    reserve_in_usd: '12000',
    volume_usd: { h24: '9000' },
    price_change_percentage: { h1: '-3.2', h24: '120' },
  },
  relationships: { dex: { data: { id: dex } }, base_token: { data: { id: `solana_${mint}` } } },
});

describe('parseGraduations', () => {
  const json = {
    data: [pool('pumpswap', mintA), pool('pump-fun', mintB), pool('meteora-damm-v2', mintB), pool('pumpswap', 'So11111111111111111111111111111111111111112')],
    included: [{ id: `solana_${mintA}`, type: 'token', attributes: { name: 'RIP DONALD TRUMP', symbol: 'RIPTRUMP', image_url: 'https://x.test/a.png' } }],
  };

  it('keeps only PumpSwap pools of Pump.fun mints', () => {
    const out = parseGraduations(json);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ mint: mintA, name: 'RIP DONALD TRUMP', symbol: 'RIPTRUMP', mcapUsd: 58000.5, liquidityUsd: 12000, volume24hUsd: 9000, priceChange1h: -3.2 });
  });

  it('drops non-https image urls and survives junk input', () => {
    const bad = { ...json, included: [{ id: `solana_${mintA}`, type: 'token', attributes: { name: 'x', image_url: 'javascript:alert(1)' } }] };
    expect(parseGraduations(bad)[0].imageUrl).toBeNull();
    expect(parseGraduations(null)).toEqual([]);
    expect(parseGraduations({ data: [{}] })).toEqual([]);
  });
});
