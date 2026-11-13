/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { tracker } from "../lib/tracker";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
type Trade = { tx: string; type: "buy" | "sell"; volume: number; amount: number; wallet: string; time: number; priceUsd: number };

/** Latest buys and sells for one coin. Cached under a second, so every viewer of a coin shares one upstream call. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const j = await tracker<{ trades?: Trade[] }>(`/trades/${mint}`, 900, { priority: true });
  const trades = (j?.trades ?? []).slice(0, 40).map((t) => ({
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
