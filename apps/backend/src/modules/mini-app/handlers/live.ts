/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { peek, queueDepth, tracker } from "../lib/tracker";

export const dynamic = "force-dynamic";

/**
 * Live numbers for the coins on screen. The app sends the mints it is showing (at most 20) once a
 * second and gets back:
 *  - price, market cap, price change and volume from DexScreener (no key, 30 coins per call, cached
 *    one second per coin, so 100 people looking at the same coins cost the same one call)
 *  - holders and trade counts from Solana Tracker. That key allows about one call a second for
 *    everything, so each request refreshes the two stalest coins and the rest come from the last
 *    answer. With 15 coins on screen every holder count is refreshed about every 8 seconds.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEX = "https://api.dexscreener.com/tokens/v1/solana";
const DEX_TTL = 1_000;
const HOLDERS_TTL = 4_000;
const MAX = 20;

interface Dex {
  at: number;
  mcapUsd: number | null;
  price: number | null;
  change5m: number | null;
  change1h: number | null;
  volume24hUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
}

const dexCache = new Map<string, Dex>();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function refreshDex(mints: string[]) {
  const stale = mints.filter((m) => Date.now() - (dexCache.get(m)?.at ?? 0) > DEX_TTL);
  if (stale.length === 0) return;
  try {
    const res = await fetch(`${DEX}/${stale.join(",")}`, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!res.ok) return;
    const pairs = (await res.json()) as Array<Record<string, any>>;
    // Several pools can exist for one coin. The deepest one is its real market.
    const best = new Map<string, Record<string, any>>();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const m = p?.baseToken?.address as string | undefined;
      if (!m) continue;
      if (!best.has(m) || (num(p.liquidity?.usd) ?? 0) > (num(best.get(m)!.liquidity?.usd) ?? 0)) best.set(m, p);
    }
    for (const [m, p] of best) {
      dexCache.set(m, {
        at: Date.now(),
        mcapUsd: num(p.marketCap) ?? num(p.fdv),
        price: p.priceUsd != null ? Number(p.priceUsd) : null,
        change5m: num(p.priceChange?.m5),
        change1h: num(p.priceChange?.h1),
        volume24hUsd: num(p.volume?.h24),
        buys24h: num(p.txns?.h24?.buys),
        sells24h: num(p.txns?.h24?.sells),
      });
    }
    // Remember that these were asked about, so a coin DexScreener does not know yet is not asked every second.
    for (const m of stale) if (!best.has(m) && !dexCache.has(m)) dexCache.set(m, { at: Date.now(), mcapUsd: null, price: null, change5m: null, change1h: null, volume24hUsd: null, buys24h: null, sells24h: null });
    if (dexCache.size > 2000) dexCache.clear();
  } catch {
    /* keep the last numbers */
  }
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("mints") ?? "";
  const mints = [...new Set(raw.split(",").filter((m) => MINT.test(m)))].slice(0, MAX);
  if (mints.length === 0) return NextResponse.json({ live: {} });

  // Holders: refresh the two stalest, only when the shared queue is quiet.
  if (queueDepth() < 8) {
    const stalest = mints
      .map((m) => ({ m, age: peek(`/tokens/${m}`)?.ageMs ?? Infinity }))
      .filter((x) => x.age > HOLDERS_TTL)
      .sort((a, b) => b.age - a.age)
      .slice(0, 2);
    for (const x of stalest) void tracker(`/tokens/${x.m}`, HOLDERS_TTL);
  }
  await refreshDex(mints);

  const live: Record<string, Record<string, number | null>> = {};
  for (const m of mints) {
    const d = dexCache.get(m);
    const t = peek<Record<string, any>>(`/tokens/${m}`)?.data;
    live[m] = {
      mcapUsd: d?.mcapUsd ?? null,
      price: d?.price ?? null,
      change5m: d?.change5m ?? null,
      change1h: d?.change1h ?? null,
      volume24hUsd: d?.volume24hUsd ?? null,
      holders: num(t?.holders),
      buys: num(t?.buys) ?? d?.buys24h ?? null,
      sells: num(t?.sells) ?? d?.sells24h ?? null,
    };
  }
  return NextResponse.json({ live });
}
