/* eslint-disable */
/**
 * Candles built from a coin's own swaps, read through Helius parsed transaction history. This is the fallback for when the
 * free candle provider is rate limited. Helius has no candle API, so each swap's price is worked out from the two token
 * transfers the trader made (the coin and the quote token), then the prices are bucketed into candles.
 *
 * Covers coins that trade on a DEX pool (DexScreener knows the pool). Coins still on a pump.fun bonding curve have no pool.
 * Needs HELIUS_API_KEY. Costs a few Helius calls per coin, shared and cached by the caller.
 */
import { cached } from "./sharedCache";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Pair = { pair: string; quoteMint: string; quoteUsd: number };

const PAGES = 3; // 100 swaps a page
const MIN_SWAPS = 4;

/** The coin's deepest pool, its quote token, and what one unit of the quote token is worth in USD. Kept 10 minutes. */
function findPair(mint: string): Promise<Pair | null> {
  return cached(
    `hcpair:${mint}`,
    600,
    async () => {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
      if (!res.ok) return null;
      const pairs = ((await res.json()) as any[]).filter((p) => p?.baseToken?.address === mint && p?.pairAddress);
      pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const p = pairs[0];
      const usd = Number(p?.priceUsd);
      const native = Number(p?.priceNative);
      if (!p || !(usd > 0) || !(native > 0)) return null;
      return { pair: p.pairAddress as string, quoteMint: p.quoteToken.address as string, quoteUsd: usd / native };
    },
    (v) => !!v,
  );
}

/** Newest swaps first, a few pages deep. */
async function fetchSwaps(pair: string, key: string): Promise<any[]> {
  const out: any[] = [];
  let before = "";
  for (let i = 0; i < PAGES; i++) {
    const url = `https://api.helius.xyz/v0/addresses/${pair}/transactions?api-key=${key}&type=SWAP&limit=100${before ? `&before=${before}` : ""}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) break;
    const page = (await res.json()) as any[];
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    before = page[page.length - 1]?.signature ?? "";
    if (page.length < 100 || !before) break;
  }
  return out;
}

/** What the trader paid or got, per swap: the coin and the quote token moving in and out of the fee payer's accounts. */
function swapPrices(txs: any[], mint: string, quoteMint: string, quoteUsd: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const t of txs) {
    if (t?.transactionError || !t?.timestamp) continue;
    const who = t.feePayer as string;
    let coin = 0;
    let quote = 0;
    for (const x of (t.tokenTransfers ?? []) as any[]) {
      const sign = x.toUserAccount === who ? 1 : x.fromUserAccount === who ? -1 : 0;
      if (!sign) continue;
      if (x.mint === mint) coin += sign * Number(x.tokenAmount);
      else if (x.mint === quoteMint) quote += sign * Number(x.tokenAmount);
    }
    // A real swap moves the two in opposite directions.
    if (!(Math.abs(coin) > 0) || !(Math.abs(quote) > 0) || coin * quote > 0) continue;
    const price = (Math.abs(quote) / Math.abs(coin)) * quoteUsd;
    if (Number.isFinite(price) && price > 0) pts.push([t.timestamp as number, price]);
  }
  return pts.sort((a, b) => a[0] - b[0]);
}

export function pointsToCandles(pts: Array<[number, number]>, sizeSec: number): Candle[] {
  if (pts.length === 0) return [];
  // Drop wild prints (a failed route or a mispriced hop) before they stretch the chart.
  const sorted = pts.map((p) => p[1]).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const clean = pts.filter(([, p]) => p < median * 5 && p > median / 5);
  const byBucket = new Map<number, Candle>();
  for (const [t, p] of clean) {
    const time = Math.floor(t / sizeSec) * sizeSec;
    const c = byBucket.get(time);
    if (!c) byBucket.set(time, { time, open: p, high: p, low: p, close: p });
    else {
      c.high = Math.max(c.high, p);
      c.low = Math.min(c.low, p);
      c.close = p;
    }
  }
  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

export async function heliusCandles(mint: string, sizeSec: number): Promise<Candle[]> {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  try {
    const pair = await findPair(mint);
    if (!pair) return [];
    // The swaps are shared across timeframes; only the bucketing differs.
    const pts = await cached(
      `hcswaps:${mint}`,
      30,
      async () => swapPrices(await fetchSwaps(pair.pair, key), mint, pair.quoteMint, pair.quoteUsd),
      (v) => v.length >= MIN_SWAPS,
    );
    return pts.length >= MIN_SWAPS ? pointsToCandles(pts, sizeSec) : [];
  } catch (e) {
    console.warn(`[helius-candles] ${mint}: ${(e as Error)?.message ?? e}`);
    return [];
  }
}
