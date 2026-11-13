/**
 * Live check of the free market-data readers. Off by default:
 *   RUN_PUMP_LIVE=1 SOLANA_TRACKER_API_KEY=... npx jest freeData.live
 * The Tracker key is only used here to pick sample coins. The readers under test use no paid API.
 */
import { curveSnapshots } from './curve';
import { dexInfo } from './dex';

const live = process.env.RUN_PUMP_LIVE === '1' ? describe : describe.skip;
live('free market data (live)', () => {
  jest.setTimeout(60_000);
  it('reads curve market caps and DexScreener numbers with no paid API', async () => {
    const hdr = { headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY as string } };
    const young = (await fetch('https://data.solanatracker.io/tokens/multi/graduating?limit=30', hdr).then((r) => r.json())) as Array<{ token: { mint: string } }>;
    const old = (await fetch('https://data.solanatracker.io/tokens/multi/graduated?limit=30', hdr).then((r) => r.json())) as Array<{ token: { mint: string } }>;
    const a = young.map((r) => r.token.mint).filter((m) => m.endsWith('pump')).slice(0, 12);
    const b = old.map((r) => r.token.mint).filter((m) => m.endsWith('pump')).slice(0, 12);
    const curves = await curveSnapshots([...a, ...b]);
    const dex = await dexInfo(b);
    const sample = [...curves.entries()].slice(0, 3).map(([m, s]) => `${m.slice(0, 6)} mcap ${s.mcapSol.toFixed(1)} SOL complete=${s.complete}`);
    console.log('curves read:', curves.size, 'of', a.length + b.length, '|', sample.join(' | '));
    console.log('dex read:', dex.size, 'of', b.length, '|', [...dex.entries()].slice(0, 3).map(([m, d]) => `${m.slice(0, 6)} mcap $${Math.round(d.mcapUsd ?? 0)} vol24h $${Math.round(d.volume24hUsd ?? 0)}`).join(' | '));
    expect(curves.size).toBeGreaterThan(0);
    expect(dex.size).toBeGreaterThan(0);
  });
});
