import { NextResponse } from "next/server";

// Short-lived in-memory cache — avoids hammering CoinGecko on every page load while
// keeping the rate fresh enough for a payment flow (FX doesn't move meaningfully in 5 min).
let cached: { rate: number; ts: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function GET() {
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return NextResponse.json({ rate: cached.rate });
  }
  try {
    // USDC priced in EUR is an effective USD->EUR rate (USDC is USD-pegged).
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=eur", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    const data = await res.json();
    const rate = data?.["usd-coin"]?.eur;
    if (typeof rate !== "number" || !(rate > 0)) throw new Error("Unexpected response shape");
    cached = { rate, ts: Date.now() };
    return NextResponse.json({ rate });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Could not fetch exchange rate";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
