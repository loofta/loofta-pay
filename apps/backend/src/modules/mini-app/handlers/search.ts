/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { STOCK_NAME, getStocks, knownStockMints } from "../lib/stocks";

export const dynamic = "force-dynamic";

type JupToken = {
  id?: string;
  symbol?: string;
  name?: string;
  icon?: string;
  decimals?: number;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  isVerified?: boolean;
  tokenProgram?: string;
  stats24h?: { priceChange?: number };
};

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);

/** The trending list is ranked by trading in the last 24 hours and kept for two minutes, so it does not reshuffle on every visit. */
const TRENDING_TTL = 120_000;
let trending: { at: number; tokens: unknown[] } | null = null;

function shape(data: JupToken[], dropStocks: boolean) {
  const stocks = dropStocks ? knownStockMints() : null;
  return (Array.isArray(data) ? data : [])
    .filter((t) => t.id && TOKEN_PROGRAMS.has(t.tokenProgram ?? "") && typeof t.decimals === "number")
    // Tokenized stocks live in the Stocks tab, not in the coin lists.
    .filter((t) => !stocks || (!stocks.has(t.id as string) && !STOCK_NAME.test(t.name ?? "")))
    .slice(0, 30)
    .map((t) => ({
      mint: t.id as string,
      symbol: t.symbol ?? "",
      name: t.name ?? "",
      icon: t.icon ?? null,
      decimals: t.decimals as number,
      usd: t.usdPrice ?? null,
      mcap: t.mcap ?? null,
      change24h: t.stats24h?.priceChange ?? null,
    }));
}

/**
 * Jupiter token search. `q` is a name, symbol or full mint address. Without `q` it returns trending
 * coins (stocks left out). Classic and Token-2022 tokens both work. The key stays server side.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length > 64 || !/^[\w .\-$]*$/.test(q)) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  if (!q && trending && Date.now() - trending.at < TRENDING_TTL) return NextResponse.json({ tokens: trending.tokens });
  // Start building the stock list in the background so trending can leave stocks out. Never wait for it.
  if (!q) void getStocks({ wait: false });
  const url = q ? `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}` : "https://api.jup.ag/tokens/v2/toptrending/24h?limit=60";
  try {
    const res = await fetch(url, { headers: key ? { "x-api-key": key } : {}, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!res.ok) return NextResponse.json({ tokens: trending?.tokens ?? [] });
    const tokens = shape((await res.json()) as JupToken[], !q);
    if (!q && tokens.length > 0) trending = { at: Date.now(), tokens };
    return NextResponse.json({ tokens });
  } catch {
    return NextResponse.json({ tokens: !q ? trending?.tokens ?? [] : [] });
  }
}
