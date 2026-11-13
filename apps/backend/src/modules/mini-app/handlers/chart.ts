/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { tracker } from "../lib/tracker";
import { cached, sharedGet, sharedSet } from "../lib/sharedCache";
import { dexInfo } from "../lib/dex";
import { recordTick, ticksToCandles } from "../lib/priceTicks";

export const dynamic = "force-dynamic";

/**
 * Candles for a coin from GeckoTerminal (free, no key, ~30 calls a minute). It indexes both open
 * market pools and Pump bonding curves. We find the coin's biggest pool once, remember it, then
 * read OHLCV for it. Responses are cached briefly so many users on one coin cost one upstream call.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Solana Tracker candle sizes, with how many seconds of history to ask for. It indexes coins from their first second. */
const TRACKER_TF: Record<string, { type: string; span: number }> = {
  "15s": { type: "15s", span: 3_600 },
  "1m": { type: "1m", span: 4 * 3_600 },
  "5m": { type: "5m", span: 24 * 3_600 },
  "15m": { type: "15m", span: 3 * 86_400 },
  "1h": { type: "1h", span: 10 * 86_400 },
  "1d": { type: "1d", span: 120 * 86_400 },
};
const TF: Record<string, { unit: "minute" | "hour" | "day"; agg: number }> = {
  "1m": { unit: "minute", agg: 1 },
  "5m": { unit: "minute", agg: 5 },
  "15m": { unit: "minute", agg: 15 },
  "1h": { unit: "hour", agg: 1 },
  "1d": { unit: "day", agg: 1 },
};
// GeckoTerminal is CoinGecko's free on-chain API. Without a key it shares one small rate limit with everyone on the same address,
// which runs out quickly. With COINGECKO_API_KEY (a free Demo key) the same calls get their own limit.
const CG_KEY = process.env.COINGECKO_API_KEY;
const API = CG_KEY ? "https://api.coingecko.com/api/v3/onchain/networks/solana" : "https://api.geckoterminal.com/api/v2/networks/solana";
const SIZE_SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
/** How long a set of candles is shared between everyone looking at the coin. Longer for the slower timeframes. */
const TTL_SEC: Record<string, number> = { "1m": 15, "5m": 30, "15m": 60, "1h": 120, "1d": 300 };

// After a rate limit answer, stop asking for a while. Asking again every second only keeps the limit closed.
let blockedUntil = 0;

async function gecko(path: string) {
  if (Date.now() < blockedUntil) throw new Error("gecko backoff");
  const res = await fetch(`${API}${path}`, { headers: { accept: "application/json;version=20230302", ...(CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {}) }, signal: AbortSignal.timeout(7_000), cache: "no-store" });
  if (res.status === 429) blockedUntil = Date.now() + 30_000;
  if (!res.ok) throw new Error(`gecko ${res.status}`);
  return res.json();
}

/** The coin's biggest pool. Kept 10 minutes, and shared. */
function findPool(mint: string): Promise<string | null> {
  return cached(`chartpool:${mint}`, 600, async () => {
    const j = await gecko(`/tokens/${mint}/pools?page=1`);
    return (j?.data?.[0]?.attributes?.address as string | undefined) ?? null;
  }, (v) => !!v);
}

type Candle = { time: number; open: number; high: number; low: number; close: number };

async function geckoCandles(mint: string, tfKey: string, tf: { unit: string; agg: number }): Promise<Candle[]> {
  const pool = await findPool(mint);
  if (!pool) return [];
  const j = await gecko(`/pools/${pool}/ohlcv/${tf.unit}?aggregate=${tf.agg}&limit=120&currency=usd&token=base`);
  const list = (j?.data?.attributes?.ohlcv_list ?? []) as number[][];
  // Newest first from the provider. The chart needs oldest first with unique, increasing times.
  return list
    .map(([time, open, high, low, close]) => ({ time, open, high, low, close }))
    .filter((c) => [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n)))
    .sort((a, b) => a.time - b.time);
}

/**
 * The big coins trade on Binance with real volume, so their candles there are clean. A Solana pool for the same coin is
 * thin and noisy: SOL's minute closes jumped by 0.25% up and straight back down. Binance's public market-data host needs
 * no key and is not region blocked like api.binance.com.
 */
const BINANCE_SYMBOL: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOLUSDT",
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: "BTCUSDT",
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": "BTCUSDT",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "ETHUSDT",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUPUSDT",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONKUSDT",
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIFUSDT",
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: "JTOUSDT",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "PYTHUSDT",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAYUSDT",
};
async function binanceCandles(mint: string, tfKey: string): Promise<Candle[]> {
  const symbol = BINANCE_SYMBOL[mint];
  if (!symbol) return [];
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${tfKey}&limit=120`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return [];
    const rows = (await r.json()) as Array<[number, string, string, string, string]>;
    return rows
      .map((k) => ({ time: Math.floor(k[0] / 1000), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }))
      .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const mint = sp.get("mint") ?? "";
  const tfKey = sp.get("tf") ?? "15m";
  const tf = TF[tfKey];
  const live = TRACKER_TF[tfKey];
  if (!MINT.test(mint) || (!tf && !live)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // First choice: Solana Tracker, which has candles from a coin's first seconds. Skipped when it is switched off or paused.
  if (live) {
    const to = Math.floor(Date.now() / 1000);
    const j = await tracker<{ oclhv?: Array<{ open: number; close: number; low: number; high: number; time: number }> }>(
      `/chart/${mint}?type=${live.type}&time_from=${to - live.span}&time_to=${to}&removeOutliers=true`,
      tfKey === "15s" ? 1_500 : 4_000,
      { priority: true },
    );
    const candles = (j?.oclhv ?? []).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })).filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite)).sort((a, b) => a.time - b.time);
    if (candles.length > 0) return NextResponse.json({ candles });
    if (!tf) return NextResponse.json({ candles: [] });
  }

  // Everyone looking at this coin and timeframe shares one answer. If the provider says no (rate limit), the last good
  // candles are served, and if there are none, candles are built from the prices we have been noting ourselves.
  const data = await cached(
    `chart:${mint}:${tfKey}`,
    TTL_SEC[tfKey] ?? 60,
    async () => {
      const major = await binanceCandles(mint, tfKey);
      if (major.length > 1) return { candles: major };
      try {
        const candles = await geckoCandles(mint, tfKey, tf);
        if (candles.length > 0) {
          void sharedSet(`chartlast:${mint}:${tfKey}`, { candles }, 6 * 3600);
          return { candles };
        }
      } catch {
        /* rate limited or down: fall through to the fallbacks */
      }
      const last = await sharedGet<{ candles: Candle[] }>(`chartlast:${mint}:${tfKey}`);
      const price = (await dexInfo([mint]).catch(() => new Map())).get(mint)?.priceUsd ?? null;
      if (price) recordTick(mint, price);
      const own = ticksToCandles(mint, SIZE_SEC[tfKey] ?? 900, price);
      // Old provider candles are worth more than a line we only just started drawing, so prefer them when there are more.
      if (last?.candles?.length && last.candles.length >= own.length) return { candles: last.candles, stale: true };
      return { candles: own, own: true };
    },
    (v) => v.candles.length > 1,
  );
  return NextResponse.json(data);
}
