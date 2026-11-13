/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { STOCK_NAME, knownStockMints } from "../lib/stocks";
import { sharedGet, sharedSet } from "../lib/sharedCache";

export const dynamic = "force-dynamic";

/**
 * The biggest tokens on Solana by market cap, from Jupiter. Jupiter has no "sort by market cap" call,
 * so candidates come from its top organic, top traded and top trending lists plus a fixed set of
 * names that must always be there (SOL, Bitcoin, Ethereum), and the final list is sorted here.
 * Kept: verified tokens with real liquidity. Dropped: stablecoins (nobody trades into those) and
 * tokenized stocks (they have their own chip).
 *
 * The ranking is rebuilt every 15 minutes. Prices for the chosen tokens refresh every 20 seconds
 * with one batch call.
 */

const ALWAYS = [
  "So11111111111111111111111111111111111111112", // SOL
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", // Bitcoin (Coinbase)
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", // Bitcoin (Wormhole)
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // Ethereum
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
];
const LISTS = ["toporganicscore", "toptraded", "toptrending"];
const COUNT = 40;
const MIN_LIQUIDITY_USD = 100_000;
const RANK_TTL = 15 * 60_000;
const PRICE_TTL = 20_000;

type JupToken = { id: string; symbol: string; name: string; icon?: string; decimals: number; usdPrice?: number; liquidity?: number; mcap?: number; isVerified?: boolean; stats24h?: { priceChange?: number } };

const g = globalThis as unknown as { __majors?: { rank: { at: number; mints: string[] } | null; out: { at: number; tokens: unknown[] } | null; building: Promise<void> | null } };
const store = (g.__majors ??= { rank: null, out: null, building: null });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const headers = (): Record<string, string> => {
  const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  return key ? { "x-api-key": key } : {};
};

/** A token priced near one dollar whose name says it is a dollar. */
function isStable(t: JupToken): boolean {
  const p = t.usdPrice ?? 0;
  return p > 0.93 && p < 1.2 && /(USD|DAI|dollar|\bcash\b|EURC)/i.test(`${t.symbol} ${t.name}`);
}

async function jup(url: string): Promise<JupToken[]> {
  try {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return res.ok ? ((await res.json()) as JupToken[]) : [];
  } catch {
    return [];
  }
}

async function rebuildRank() {
  const pool = new Map<string, JupToken>();
  // Spaced out, because Jupiter's gateway rate limits bursts.
  for (const l of LISTS) {
    for (const t of await jup(`https://api.jup.ag/tokens/v2/${l}/24h?limit=100`)) pool.set(t.id, t);
    await sleep(800);
  }
  for (const t of await jup(`https://api.jup.ag/tokens/v2/search?query=${ALWAYS.join(",")}`)) pool.set(t.id, t);

  const stocks = knownStockMints();
  const mints = [...pool.values()]
    .filter((t) => t.isVerified && (t.liquidity ?? 0) >= MIN_LIQUIDITY_USD && (t.mcap ?? 0) > 0 && !isStable(t) && !stocks.has(t.id) && !STOCK_NAME.test(t.name))
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))
    .slice(0, COUNT)
    .map((t) => t.id);
  // The always-there names stay even if a list was thin, at the top in the order given above.
  const final = [...new Set([...mints])];
  if (final.length > 0) {
    store.rank = { at: Date.now(), mints: final };
    void sharedSet("majors:rank", store.rank, 24 * 3600);
  }
}

const shape = (t: JupToken) => ({ mint: t.id, symbol: t.symbol, name: t.name, icon: t.icon ?? null, decimals: t.decimals, usd: t.usdPrice ?? null, mcap: t.mcap ?? null, change24h: t.stats24h?.priceChange ?? null });

export async function GET() {
  // After a restart, start from the last saved ranking instead of rebuilding it before answering.
  if (!store.rank && !store.building) {
    const saved = await sharedGet<{ at: number; mints: string[] }>("majors:rank");
    if (saved?.mints?.length) store.rank = saved;
  }
  const rankFresh = store.rank && Date.now() - store.rank.at < RANK_TTL;
  if (!rankFresh && !store.building) {
    store.building = rebuildRank().finally(() => {
      store.building = null;
    });
  }
  if (!store.rank) {
    await store.building;
    if (!store.rank) return NextResponse.json({ tokens: store.out?.tokens ?? [] });
  }
  const rank = store.rank;
  if (store.out && Date.now() - store.out.at < PRICE_TTL) return NextResponse.json({ tokens: store.out.tokens });

  const list = await jup(`https://api.jup.ag/tokens/v2/search?query=${rank.mints.join(",")}`);
  const byId = new Map(list.map((t) => [t.id, t]));
  // Sort by market cap again, because it moves with price.
  const tokens = rank.mints
    .map((m) => byId.get(m))
    .filter((t): t is JupToken => !!t)
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))
    .map(shape);
  if (tokens.length > 0) store.out = { at: Date.now(), tokens };
  return NextResponse.json({ tokens: store.out?.tokens ?? tokens });
}
