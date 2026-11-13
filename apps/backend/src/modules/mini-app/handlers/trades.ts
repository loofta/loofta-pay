/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { tracker } from "../lib/tracker";
import { cached } from "../lib/sharedCache";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
type Trade = { tx: string; type: "buy" | "sell"; volume: number; amount: number; wallet: string; time: number; priceUsd: number };

async function gt<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${GT}${path}`, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(6_000), cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Free fallback when Solana Tracker is off, paused or out of plan: the coin's main pool and its latest trades from
 * GeckoTerminal. The pool address is kept 10 minutes and the trades 5 seconds, so a handful of viewers stay inside the
 * free rate limit. Empty answers are not kept, so a coin GeckoTerminal has not indexed yet is retried on the next poll.
 */
async function geckoTrades(mint: string): Promise<Trade[]> {
  const pool = await cached(`gt-pool:${mint}`, 600, async () => {
    const j = await gt<{ data?: Array<{ attributes?: { address?: string }; relationships?: { base_token?: { data?: { id?: string } } } }> }>(`/tokens/${mint}/pools?page=1`);
    const p = (j?.data ?? []).find((d) => d.relationships?.base_token?.data?.id === `solana_${mint}`) ?? j?.data?.[0];
    return p?.attributes?.address ?? null;
  }, (v) => !!v);
  if (!pool) return [];
  return cached(`gt-trades:${mint}`, 5, async () => {
    const j = await gt<{ data?: Array<{ attributes: any }> }>(`/pools/${pool}/trades`);
    return (j?.data ?? []).slice(0, 40).map((d): Trade => {
      const a = d.attributes;
      const buy = a.kind === "buy";
      return {
        tx: a.tx_hash,
        type: buy ? "buy" : "sell",
        volume: Number(a.volume_in_usd) || 0,
        // The coin side of the trade: what was received on a buy, what was sent on a sell.
        amount: Number(buy ? a.to_token_amount : a.from_token_amount) || 0,
        wallet: String(a.tx_from_address ?? "unknown"),
        time: Date.parse(a.block_timestamp) || Date.now(),
        priceUsd: Number(buy ? a.price_to_in_usd : a.price_from_in_usd) || 0,
      };
    });
  }, (v) => v.length > 0);
}

/** Latest buys and sells for one coin. Cached under a second, so every viewer of a coin shares one upstream call. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const j = await tracker<{ trades?: Trade[] }>(`/trades/${mint}`, 900, { priority: true });
  let rows: Trade[] = j?.trades ?? [];
  if (rows.length === 0) rows = await geckoTrades(mint);
  const trades = rows.slice(0, 40).map((t) => ({
    id: t.tx,
    side: t.type,
    usd: t.volume,
    amount: t.amount,
    price: t.priceUsd,
    wallet: `${t.wallet.slice(0, 4)}...${t.wallet.slice(-4)}`,
    time: t.time,
  }));
  return NextResponse.json({ trades });
}
