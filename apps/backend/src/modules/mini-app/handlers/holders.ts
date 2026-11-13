/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { tracker } from "../lib/tracker";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The biggest holders of a coin and their share of the supply. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const j = await tracker<Array<{ address: string; percentage: number; value?: { usd?: number } }>>(`/tokens/${mint}/holders/top`, 30_000, { priority: true });
  const holders = (Array.isArray(j) ? j : []).slice(0, 20).map((h) => ({
    wallet: `${h.address.slice(0, 4)}...${h.address.slice(-4)}`,
    pct: h.percentage,
    usd: h.value?.usd ?? null,
  }));
  return NextResponse.json({ holders });
}
