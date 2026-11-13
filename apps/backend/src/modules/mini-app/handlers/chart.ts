/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { tracker } from "../lib/tracker";

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
const API = "https://api.geckoterminal.com/api/v2/networks/solana";

const poolCache = new Map<string, { pool: string; at: number }>();
const candleCache = new Map<string, { data: unknown; at: number }>();
const POOL_TTL = 10 * 60_000;
const CANDLE_TTL = 15_000;

async function gecko(path: string) {
  const res = await fetch(`${API}${path}`, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(7_000), cache: "no-store" });
  if (!res.ok) throw new Error(`gecko ${res.status}`);
  return res.json();
}

async function findPool(mint: string): Promise<string | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.at < POOL_TTL) return hit.pool;
  const j = await gecko(`/tokens/${mint}/pools?page=1`);
  const pool = j?.data?.[0]?.attributes?.address as string | undefined;
  if (!pool) return null;
  poolCache.set(mint, { pool, at: Date.now() });
  return pool;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const mint = sp.get("mint") ?? "";
  const tfKey = sp.get("tf") ?? "15m";
  const tf = TF[tfKey];
  const live = TRACKER_TF[tfKey];
  if (!MINT.test(mint) || (!tf && !live)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // First choice: Solana Tracker, which has candles from a coin's first seconds. Gecko is the fallback.
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

  const key = `${mint}:${tfKey}`;
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.at < CANDLE_TTL) return NextResponse.json(cached.data);

  try {
    const pool = await findPool(mint);
    if (!pool) return NextResponse.json({ candles: [] });
    const j = await gecko(`/pools/${pool}/ohlcv/${tf.unit}?aggregate=${tf.agg}&limit=120&currency=usd&token=base`);
    const list = (j?.data?.attributes?.ohlcv_list ?? []) as number[][];
    // Gecko returns newest first. The chart needs oldest first with unique, increasing times.
    const candles = list
      .map(([time, open, high, low, close]) => ({ time, open, high, low, close }))
      .filter((c) => [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n)))
      .sort((a, b) => a.time - b.time);
    const data = { candles };
    candleCache.set(key, { data, at: Date.now() });
    return NextResponse.json(data);
  } catch {
    // Rate limited or upstream down: serve stale candles if we have any, else an empty chart.
    return NextResponse.json(cached?.data ?? { candles: [] });
  }
}
