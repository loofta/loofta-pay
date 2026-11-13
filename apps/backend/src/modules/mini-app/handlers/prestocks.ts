/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { getStocks } from "../lib/stocks";

export const dynamic = "force-dynamic";

/** Pre-IPO tokens (Anthropic, OpenAI, SpaceX and others), most traded first. They give exposure to private companies. They are not listed shares. */
export async function GET() {
  const { items, building } = await getStocks({ wait: false });
  return NextResponse.json({
    building,
    tokens: items.filter((s) => s.kind === "prestock").map((s) => ({ mint: s.mint, symbol: s.symbol, name: s.name, icon: s.icon, decimals: s.decimals, usd: s.usd, mcap: s.mcap, change24h: s.change24h })),
  });
}
