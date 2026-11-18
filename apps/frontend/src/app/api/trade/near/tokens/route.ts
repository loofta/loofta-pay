import { NextResponse } from "next/server";
import { ONECLICK_BASE, oneClickHeaders } from "../_base";

export const dynamic = "force-dynamic";

type Raw = { assetId: string; decimals: number; blockchain: string; symbol: string; price?: number };
let cache: { at: number; tokens: unknown[] } | null = null;

/** Every asset NEAR Intents can move, cached 10 minutes. */
export async function GET() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return NextResponse.json({ tokens: cache.tokens });
  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/tokens`, { headers: oneClickHeaders(), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const raw = (await res.json()) as Raw[];
    const tokens = raw.map((t) => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, decimals: t.decimals, price: t.price ?? null }));
    cache = { at: Date.now(), tokens };
    return NextResponse.json({ tokens });
  } catch {
    return NextResponse.json({ tokens: cache?.tokens ?? [] });
  }
}
