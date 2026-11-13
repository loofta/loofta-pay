/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { tracker } from "../lib/tracker";
import { cached } from "../lib/sharedCache";
import { holderStats } from "../lib/holderStats";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The biggest holders of a coin and their share of the supply. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // Shared across instances and restarts. The tracker call is rate limited, so a minute-old list is fine.
  const body = await cached(
    `holders:${mint}`,
    60,
    async () => {
      // Free first: read the holders from Solana itself. Tracker is only asked if that comes back empty.
      const own = await holderStats(mint);
      if (own && own.count > 0) {
        return {
          count: own.count,
          top10Pct: own.top10Pct,
          holders: own.top.map((h) => ({ wallet: `${h.owner.slice(0, 4)}...${h.owner.slice(-4)}`, pct: h.pct, usd: null as number | null })),
        };
      }
      const j = await tracker<Array<{ address: string; percentage: number; value?: { usd?: number } }>>(`/tokens/${mint}/holders/top`, 30_000, { priority: true });
      const holders = (Array.isArray(j) ? j : []).slice(0, 20).map((h) => ({
        wallet: `${h.address.slice(0, 4)}...${h.address.slice(-4)}`,
        pct: h.percentage,
        usd: h.value?.usd ?? null,
      }));
      // Shares of one supply cannot add up to more than 100%. When they do (Token-2022 and wrapped tokens come back with
      // percentages against the wrong supply), the whole list is wrong, so show nothing instead of made-up numbers.
      const total = holders.reduce((a, h) => a + (Number.isFinite(h.pct) ? h.pct : 0), 0);
      if (holders.some((h) => !(h.pct >= 0) || h.pct > 100) || total > 100.5) {
        return { count: null as number | null, top10Pct: null as number | null, holders: [] as typeof holders, unreliable: true };
      }
      return { count: null as number | null, top10Pct: null as number | null, holders };
    },
    (v: any) => v.holders.length > 0 || v.unreliable === true,
  );
  return NextResponse.json(body);
}
