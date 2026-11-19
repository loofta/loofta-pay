/* eslint-disable */
import { cached } from "./sharedCache";

export type ScaleCandle = { time: number; open: number; high: number; low: number; close: number };

/** The price the app shows for a coin (Jupiter's), shared for 30 seconds. */
export function referencePrice(mint: string): Promise<number | null> {
  return cached(
    `refprice:${mint}`,
    30,
    async () => {
      try {
        const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, { signal: AbortSignal.timeout(4_000), cache: "no-store" });
        if (!r.ok) return null;
        const j = (await r.json()) as Record<string, { usdPrice?: number }>;
        const p = j?.[mint]?.usdPrice;
        return typeof p === "number" && p > 0 ? p : null;
      } catch {
        return null;
      }
    },
    (v) => v != null,
  );
}

/**
 * Some pools report a coin's price off by a power of ten (a pre-IPO token charted at $885 while it trades at $88.5).
 * When the chart's latest close is a clean power of ten away from the real price, the whole series is rescaled.
 * A real move is never a clean 10x, so normal charts are left alone.
 */
export function fixScale<T extends ScaleCandle>(candles: T[], ref: number | null): T[] {
  if (!ref || candles.length === 0) return candles;
  const last = candles[candles.length - 1].close;
  if (!(last > 0)) return candles;
  const ratio = ref / last;
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const f = Math.pow(10, k);
    if (Math.abs(ratio / f - 1) < 0.15) return candles.map((c) => ({ ...c, open: c.open * f, high: c.high * f, low: c.low * f, close: c.close * f }));
  }
  return candles;
}
