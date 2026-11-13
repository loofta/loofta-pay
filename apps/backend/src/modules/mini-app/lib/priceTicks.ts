/* eslint-disable */
/**
 * A last-resort chart source. When the free candle provider is rate limited, the chart endpoint notes the coin's price every
 * few seconds as people look at it and builds candles from those notes. The line starts short and grows while the coin is being
 * watched, which is far better than the flat empty chart you get with no data at all.
 */
const MIN_GAP_MS = 4_000;
const MAX_PER_COIN = 6_000;
const MAX_COINS = 300;

const series = new Map<string, Array<[number, number]>>();

export function recordTick(mint: string, price: number, now = Date.now()) {
  if (!(price > 0)) return;
  let s = series.get(mint);
  if (!s) {
    if (series.size >= MAX_COINS) series.delete(series.keys().next().value as string);
    s = [];
    series.set(mint, s);
  }
  const last = s[s.length - 1];
  if (last && now - last[0] < MIN_GAP_MS) return;
  s.push([now, price]);
  if (s.length > MAX_PER_COIN) s.splice(0, s.length - MAX_PER_COIN);
}

export function ticksToCandles(mint: string, sizeSec: number, latest?: number | null) {
  const s = series.get(mint) ?? [];
  const byBucket = new Map<number, { time: number; open: number; high: number; low: number; close: number }>();
  for (const [t, p] of s) {
    const time = Math.floor(t / 1000 / sizeSec) * sizeSec;
    const c = byBucket.get(time);
    if (!c) byBucket.set(time, { time, open: p, high: p, low: p, close: p });
    else {
      c.high = Math.max(c.high, p);
      c.low = Math.min(c.low, p);
      c.close = p;
    }
  }
  if (byBucket.size === 0 && latest && latest > 0) {
    const time = Math.floor(Date.now() / 1000 / sizeSec) * sizeSec;
    byBucket.set(time, { time, open: latest, high: latest, low: latest, close: latest });
  }
  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}
