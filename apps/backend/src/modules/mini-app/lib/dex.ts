/* eslint-disable */
/**
 * Market numbers for coins that have left the bonding curve, from DexScreener's free public API. Up to 30 coins per call,
 * kept 15 seconds and shared by every request. If DexScreener is slow or down the last answer is served.
 */
export interface DexInfo {
  mcapUsd: number | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
  change1h: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  name: string | null;
  symbol: string | null;
  image: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

const TTL_MS = 15_000;
const BATCH = 30;
const cache = new Map<string, { at: number; info: DexInfo | null }>();
let inflight: Promise<void> | null = null;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function refresh(mints: string[]) {
  for (let i = 0; i < mints.length; i += BATCH) {
    const chunk = mints.slice(i, i + BATCH);
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const pairs = (await res.json()) as Array<any>;
      const best = new Map<string, any>();
      // The pool with the most liquidity is the real market for each coin.
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const m = p?.baseToken?.address;
        if (!m) continue;
        if (!best.has(m) || (n(p.liquidity?.usd) ?? 0) > (n(best.get(m).liquidity?.usd) ?? 0)) best.set(m, p);
      }
      const at = Date.now();
      for (const m of chunk) {
        const p = best.get(m);
        cache.set(
          m,
          p
            ? {
                at,
                info: {
                  mcapUsd: n(p.marketCap) ?? n(p.fdv),
                  priceUsd: p.priceUsd != null ? Number(p.priceUsd) : null,
                  volume24hUsd: n(p.volume?.h24),
                  change1h: n(p.priceChange?.h1),
                  change24h: n(p.priceChange?.h24),
                  liquidityUsd: n(p.liquidity?.usd),
                  buys24h: n(p.txns?.h24?.buys),
                  sells24h: n(p.txns?.h24?.sells),
                  name: p.baseToken?.name ?? null,
                  symbol: p.baseToken?.symbol ?? null,
                  image: p.info?.imageUrl ?? null,
                  website: p.info?.websites?.[0]?.url ?? null,
                  twitter: p.info?.socials?.find((x: any) => x.type === "twitter")?.url ?? null,
                  telegram: p.info?.socials?.find((x: any) => x.type === "telegram")?.url ?? null,
                },
              }
            : { at, info: null },
        );
      }
    } catch {
      /* keep whatever we had */
    }
  }
  if (cache.size > 800) cache.clear();
}

export async function dexInfo(mints: string[]): Promise<Map<string, DexInfo>> {
  const now = Date.now();
  const stale = mints.filter((m) => now - (cache.get(m)?.at ?? 0) > TTL_MS);
  if (stale.length > 0) {
    if (!inflight) inflight = refresh(stale).finally(() => (inflight = null));
    await inflight;
  }
  const out = new Map<string, DexInfo>();
  for (const m of mints) {
    const i = cache.get(m)?.info;
    if (i) out.set(m, i);
  }
  return out;
}
