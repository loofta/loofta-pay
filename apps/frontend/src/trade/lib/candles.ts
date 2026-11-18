export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Range = "1H" | "1D" | "1W" | "1M";
export const RANGES: Range[] = ["1H", "1D", "1W", "1M"];
/** Candle sizes to try for each range, best first. Some coins have no history at one size, so the next one is used. */
const RANGE: Record<Range, Array<{ tf: string; n: number }>> = {
  "1H": [{ tf: "1m", n: 60 }],
  "1D": [{ tf: "15m", n: 96 }, { tf: "5m", n: 288 }, { tf: "1h", n: 24 }],
  "1W": [{ tf: "1h", n: 168 }, { tf: "1d", n: 7 }],
  "1M": [{ tf: "1d", n: 30 }, { tf: "1h", n: 720 }],
};

const cache = new Map<string, { at: number; data: Candle[] }>();
const inflight = new Map<string, Promise<Candle[]>>();

/** Real candles from the backend (the same source as the phone app's chart). Shared and kept 60 seconds, so a list of sparklines does not repeat itself. */
export async function fetchCandles(mint: string, range: Range): Promise<Candle[]> {
  let best: Candle[] = [];
  for (const { tf, n } of RANGE[range]) {
    const data = (await fetchOne(mint, tf)).slice(-n);
    if (data.length > best.length) best = data;
    // A single candle is not a chart: try the next size.
    if (data.length >= 12) return data;
  }
  return best;
}

function fetchOne(mint: string, tf: string): Promise<Candle[]> {
  const key = `${mint}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return Promise.resolve(hit.data);
  const running = inflight.get(key);
  if (running) return running;
  const p = fetch(`/api/backend/mini/chart?mint=${encodeURIComponent(mint)}&tf=${tf}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((d: { candles?: Candle[] }) => {
      const data = (d.candles ?? []).filter((c) => Number.isFinite(c.close));
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch(() => cache.get(key)?.data ?? [])
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Sparklines load a couple at a time, so a long list never floods the chart service. */
const queue: Array<() => Promise<void>> = [];
let active = 0;
export function queueSpark(mint: string): Promise<number[]> {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        resolve((await fetchCandles(mint, "1W")).map((c) => c.close));
      } catch {
        resolve([]);
      }
    });
    pump();
  });
}
function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    active++;
    void job().finally(() => {
      active--;
      pump();
    });
  }
}
