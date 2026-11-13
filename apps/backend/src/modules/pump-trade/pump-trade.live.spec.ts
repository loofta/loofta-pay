/**
 * Live check against mainnet. Off by default: it only runs with RUN_PUMP_LIVE=1 (and SOLANA_TRACKER_API_KEY to find
 * coins). It signs and sends nothing. Every transaction is only simulated, using a funded public address as the payer.
 *
 *   RUN_PUMP_LIVE=1 SOLANA_TRACKER_API_KEY=... npx jest pump-trade.live
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { PumpTradeService } from './pump-trade.service';

const live = process.env.RUN_PUMP_LIVE === '1' ? describe : describe.skip;
// Any address that holds SOL. Used only as the payer in a simulation, nothing is ever signed.
const FUNDED = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

live('PumpTradeService (live, simulation only)', () => {
  jest.setTimeout(120_000);
  let wallet = FUNDED;
  const service = new PumpTradeService(
    { get: () => undefined } as never,
    { getSolanaWalletAddress: async () => wallet } as never,
    // The fee goes to the payer itself here, so the transfer is part of what gets simulated.
    { platformFeeWallet: new PublicKey(FUNDED) } as never,
    { feeBpsFor: async () => 30 } as never,
  );

  it('sells part of a real holder position, fee included', async () => {
    const key = process.env.SOLANA_TRACKER_API_KEY as string;
    const hdr = { headers: { 'x-api-key': key } };
    const rows = (await fetch('https://data.solanatracker.io/tokens/multi/graduating?limit=40', hdr).then((r) => r.json())) as Array<{ token: { mint: string } }>;
    const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    let sold = 0;
    for (const mint of rows.map((r) => r.token.mint).filter((m) => m.endsWith('pump')).slice(0, 8)) {
      const holders = (await fetch(`https://data.solanatracker.io/tokens/${mint}/holders/top`, hdr).then((r) => r.json()).catch(() => [])) as Array<{ address: string }>;
      for (const h of (Array.isArray(holders) ? holders : []).slice(0, 3)) {
        const bal = (await conn.getParsedTokenAccountsByOwner(new PublicKey(h.address), { mint: new PublicKey(mint) }, 'confirmed').catch(() => ({ value: [] }))).value[0]?.account.data.parsed.info.tokenAmount;
        if (!bal || Number(bal.uiAmount) <= 0) continue;
        wallet = h.address;
        try {
          const amount = (Number(bal.uiAmount) / 100).toFixed(6);
          const q = await service.quote('u', { mint, side: 'sell', amount });
          const b = await service.build('u', { mint, side: 'sell', amount });
          sold++;
          console.log(mint.slice(0, 8), 'SELL OK', amount, 'tokens ->', q.outAmount, 'lamports after fee', q.feeAmount, 'tx', b.swapTransaction.length);
        } catch (e) {
          console.log(mint.slice(0, 8), 'sell refused:', (e as Error).message.slice(0, 90));
        }
        break;
      }
      if (sold >= 2) break;
    }
    wallet = FUNDED;
    expect(sold).toBeGreaterThan(0);
  });

  it('quotes and builds buys for coins on the curve, and refuses the rest', async () => {
    const key = process.env.SOLANA_TRACKER_API_KEY as string;
    const rows = (await fetch('https://data.solanatracker.io/tokens/multi/graduating?limit=40', { headers: { 'x-api-key': key } }).then((r) => r.json())) as Array<{ token: { mint: string } }>;
    const mints = rows.map((r) => r.token.mint).filter((m) => m.endsWith('pump')).slice(0, 6);
    let built = 0;
    for (const mint of mints) {
      try {
        const q = await service.quote('u', { mint, side: 'buy', amount: '0.01' });
        const b = await service.build('u', { mint, side: 'buy', amount: '0.01' });
        built++;
        console.log(mint.slice(0, 8), 'OK', 'out', q.outAmount, 'impact%', q.priceImpactPct.toFixed(2), 'tx bytes', b.swapTransaction.length);
      } catch (e) {
        console.log(mint.slice(0, 8), 'refused:', (e as Error).message.slice(0, 90));
      }
    }
    expect(built).toBeGreaterThan(0);
  });
});
