/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
/**
 * One shared door to Solana Tracker for every server route. The key allows roughly one request a
 * second, so calls wait in a single queue with a gap between them. Answers are cached per path and
 * identical in-flight requests are merged, so many people watching the same thing cost one call.
 *
 * Priority: what a person is looking at right now (the coin page: trades, chart) goes first, and
 * background work (feed lists, refreshing coins in the list) waits behind it. When the provider
 * says no, the last good answer is served instead of an error.
 *
 * The gap is SOLANA_TRACKER_GAP_MS (default 900). A higher plan allows a smaller gap, which makes
 * everything refresh faster with no other change.
 */
const BASE = "https://data.solanatracker.io";
const GAP_MS = Math.max(50, Number(process.env.SOLANA_TRACKER_GAP_MS) || 900);
const MAX_QUEUE = 30;
const MAX_CACHE = 600;

interface Job {
  path: string;
  hi: boolean;
  stale: unknown;
  resolve: (v: unknown) => void;
}

const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, { promise: Promise<unknown>; job: Job }>();
const jobs: Job[] = [];
let draining = false;
let last = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The last answer for a path, if we have one, with its age. Never makes a request. */
export function peek<T>(path: string): { data: T; ageMs: number } | null {
  const hit = cache.get(path);
  return hit ? { data: hit.data as T, ageMs: Date.now() - hit.at } : null;
}

/** How many requests are waiting. Optional work should skip itself when this is high. */
export function queueDepth(): number {
  return jobs.length;
}

async function drain(key: string) {
  if (draining) return;
  draining = true;
  try {
    while (jobs.length > 0) {
      const at = jobs.findIndex((j) => j.hi);
      const job = jobs.splice(at >= 0 ? at : 0, 1)[0];
      // What a person is waiting on (the coin page) only waits a third of a second. Background work waits the full gap.
      const gap = job.hi ? Math.min(GAP_MS, 350) : GAP_MS;
      const wait = gap - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await fetch(`${BASE}${job.path}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
        if (!res.ok) {
          job.resolve(job.stale);
          continue;
        }
        const data = await res.json();
        // Rate limit and other errors come back as {"error": ...}.
        if (data && typeof data === "object" && !Array.isArray(data) && "error" in data && Object.keys(data).length === 1) {
          job.resolve(job.stale);
          continue;
        }
        if (cache.size > MAX_CACHE) cache.clear();
        cache.set(job.path, { at: Date.now(), data });
        job.resolve(data);
      } catch {
        job.resolve(job.stale);
      }
    }
  } finally {
    draining = false;
  }
}

export function tracker<T>(path: string, ttlMs: number, opts: { priority?: boolean } = {}): Promise<T | null> {
  const key = process.env.SOLANA_TRACKER_API_KEY;
  if (!key) return Promise.resolve(null);
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data as T);
  const running = inflight.get(path);
  if (running) {
    // Someone is already waiting for this. If this caller matters more, move it up the queue.
    if (opts.priority) running.job.hi = true;
    return running.promise as Promise<T | null>;
  }
  // A deep queue means we are already at the limit. Serve what we have rather than pile on.
  if (jobs.length >= MAX_QUEUE && !opts.priority) return Promise.resolve((hit?.data as T) ?? null);

  let job!: Job;
  const promise = new Promise<unknown>((resolve) => {
    job = { path, hi: !!opts.priority, stale: hit?.data ?? null, resolve };
  });
  jobs.push(job);
  inflight.set(path, { promise, job });
  void promise.finally(() => inflight.delete(path));
  void drain(key);
  return promise as Promise<T | null>;
}
