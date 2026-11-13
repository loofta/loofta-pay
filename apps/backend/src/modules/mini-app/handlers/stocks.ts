/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { getStocks } from "../lib/stocks";

export const dynamic = "force-dynamic";

/** Every tokenized stock and ETF with real liquidity on Jupiter, most traded first. `building` is true while the list is first put together. */
export async function GET() {
  const { items, building } = await getStocks({ wait: false });
  return NextResponse.json({
    building,
    // Pre-IPO tokens have their own list, they are not listed shares.
    tokens: items.filter((s) => s.kind !== "prestock").map((s) => ({ mint: s.mint, symbol: s.symbol, name: s.name, icon: s.icon, decimals: s.decimals, usd: s.usd, mcap: s.mcap, change24h: s.change24h })),
  });
}
