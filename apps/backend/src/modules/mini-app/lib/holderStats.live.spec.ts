/**
 * Live check that holder numbers can be read from Solana RPC with no data provider. Off by default:
 *   RUN_PUMP_LIVE=1 SOLANA_TRACKER_API_KEY=... npx jest holderStats.live
 * The Tracker key is only used to pick sample coins.
 */
import { holderStats } from './holderStats';

const live = process.env.RUN_PUMP_LIVE === '1' ? describe : describe.skip;
live('holder stats from RPC (live)', () => {
  jest.setTimeout(90_000);
  it('counts holders, top-10 share and dev share', async () => {
    const hdr = { headers: { 'x-api-key': process.env.SOLANA_TRACKER_API_KEY as string } };
    const rows = (await fetch('https://data.solanatracker.io/tokens/latest?limit=40', hdr).then((r) => r.json())) as Array<{ token: { mint: string; creator?: string }; holders?: number }>;
    let ok = 0;
    for (const r of rows.filter((x) => x.token.mint.endsWith('pump')).slice(0, 6)) {
      const t0 = Date.now();
      const s = await holderStats(r.token.mint, r.token.creator ?? null);
      console.log(r.token.mint.slice(0, 6), 'rpc holders', s?.count, '| tracker says', r.holders, '| top10', s?.top10Pct.toFixed(1), '% dev', s?.devPct?.toFixed(1), '%', Date.now() - t0, 'ms');
      if (s) ok++;
    }
    expect(ok).toBeGreaterThan(0);
  });
});
