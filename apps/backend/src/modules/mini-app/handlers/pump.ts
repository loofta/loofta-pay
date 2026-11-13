/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
const NextResponse = Response;
import { peek, queueDepth, tracker } from "../lib/tracker";
import { migratedMints, streamCoins, streamLive } from "../lib/pumpStream";

export const dynamic = "force-dynamic";

/**
 * Live Pump coins for Memepad, no database needed. Solana Tracker (SOLANA_TRACKER_API_KEY, server
 * only) has three lists that already carry holders, buys, sells, bundle size, dev holding and
 * socials, so one call per list fills the feed:
 *   latest      -> brand new coins, seconds old
 *   graduating  -> coins whose first batch is almost full
 *   graduated   -> coins that have moved to the open market
 * Lists are cached a few seconds so every user shares the same upstream calls. Pro trader counts
 * are an extra call per coin, so they are only fetched on request and for a bounded number of coins.
 *
 * Unknown numbers stay null. The client treats null as "not proven", never as healthy.
 */

const PRO_TTL = 5 * 60_000;
/** Per-coin refresh of the newest coins: how often, how many per request, and how old an answer may be and still be used. */
const FRESH_TTL = 6_000;
/** The newest-coins list is the one people watch, so it refreshes about every 1.5 seconds. */
const LATEST_TTL = Number(process.env.MEMEPAD_LATEST_TTL_MS) || 1_500;
const REFRESH_PER_REQUEST = 4;
const FRESH_MAX_AGE = 90_000;
const PRO_PER_REQUEST = 6;
const PRO_MIN_REALIZED_USD = 1_000;
/** Every Pump coin starts on its curve at about 28 SOL of market cap (30 SOL virtual reserve, 1.073B tokens of 1B supply). */
const PUMP_START_SOL = 27.96;
/** Pump's first batch is full at roughly this market cap. */
const GRADUATION_MCAP = 69_000;

type Raw = Record<string, any>;
type StageKey = "new" | "final" | "grad";
const MAX_PER_STAGE = 200;
/** Fields the app never reads. Left out of the response. */
const UNUSED = new Set(["dexPaid", "liquidityLocked", "hiddenReason", "passes", "goalMcapUsd", "fresh"]);
type Source = "latest" | "latest2" | "graduating" | "graduating2" | "graduated" | "graduated2";

const SOURCES: Array<{ key: Source; path: string; ttl: number }> = [
  { key: "latest", path: "/tokens/latest?limit=100", ttl: LATEST_TTL },
  { key: "latest2", path: "/tokens/latest?limit=100&page=2", ttl: 30_000 },
  { key: "graduating", path: "/tokens/multi/graduating?limit=100", ttl: 15_000 },
  { key: "graduating2", path: "/tokens/multi/graduating?limit=100&page=2", ttl: 45_000 },
  { key: "graduated", path: "/tokens/multi/graduated?limit=100", ttl: 20_000 },
  { key: "graduated2", path: "/tokens/multi/graduated?limit=100&page=2", ttl: 60_000 }
];

const proCache = new Map<string, { at: number; value: number | null }>();

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The newest-coins list is awaited, with priority, so each poll sees fresh launches. Every other list
 * is served from its last answer straight away and refreshed in the background, so one slow upstream
 * call never holds up the response.
 */
async function list(s: (typeof SOURCES)[number]): Promise<Raw[]> {
  if (s.key === "latest") {
    const rows = await tracker<Raw[]>(s.path, s.ttl, { priority: true });
    return Array.isArray(rows) ? rows : [];
  }
  const cached = peek<Raw[]>(s.path);
  if (cached) {
    if (cached.ageMs >= s.ttl) void tracker<Raw[]>(s.path, s.ttl);
    return Array.isArray(cached.data) ? cached.data : [];
  }
  const rows = await tracker<Raw[]>(s.path, s.ttl);
  return Array.isArray(rows) ? rows : [];
}

async function proFor(mint: string): Promise<void> {
  const hit = proCache.get(mint);
  if (hit && Date.now() - hit.at < PRO_TTL) return;
  const j = await tracker<Array<{ realized?: number }>>(`/top-traders/${mint}`, PRO_TTL);
  proCache.set(mint, { at: Date.now(), value: Array.isArray(j) ? j.filter((w) => (w.realized ?? 0) >= PRO_MIN_REALIZED_USD).length : null });
}

/** SOL price in dollars, read off a coin that reports its market cap in both. */
function solUsdFrom(lists: Raw[][]): number | null {
  for (const rows of lists) {
    for (const r of rows.slice(0, 20)) {
      const mc = r.pools?.[0]?.marketCap;
      if (num(mc?.usd) && num(mc?.quote)) return (mc.usd as number) / (mc.quote as number);
    }
  }
  return null;
}

/**
 * Only coins born on pump.fun. Other launchpads show up in the same lists, and any old token can
 * have a pump AMM pool, so pools prove nothing. Pump coins say so in createdOn and their mint
 * addresses end in "pump".
 */
function isPump(r: Raw): boolean {
  return String(r.token?.createdOn ?? "").includes("pump.fun") || String(r.token?.mint ?? "").endsWith("pump");
}

async function buildFeed(wantPro: boolean, stage: StageKey | null): Promise<string> {
  const lists = await Promise.all(SOURCES.map(list));

  const seen = new Set<string>();
  const picked: Array<{ r: Raw; source: Source }> = [];
  // Graduated first so a coin that moved up is not shown twice at its old stage.
  const order: Source[] = ["graduated", "graduated2", "graduating", "graduating2", "latest", "latest2"];
  for (const source of order) {
    const rows = lists[SOURCES.findIndex((s) => s.key === source)];
    for (const r of rows) {
      const mint = r.token?.mint;
      if (!mint || seen.has(mint) || !isPump(r)) continue;
      seen.add(mint);
      picked.push({ r, source });
    }
  }

  // Coins from the live PumpPortal stream. They are seconds old, so the Tracker lists often do not have
  // them yet. They go first, which also puts them first in line for the per-coin refresh below.
  const migrated = migratedMints();
  const solUsd = solUsdFrom(lists);
  const streamRows: Array<{ r: Raw; source: Source }> = [];
  // Where each coin started, as the stream saw it, so "change since launch" is exact when we have it.
  const startSol = new Map<string, number>();
  for (const c of streamCoins()) {
    if (c.mcapSol > 0) startSol.set(c.mint, c.mcapSol);
    if (seen.has(c.mint)) continue;
    seen.add(c.mint);
    const usd = solUsd != null ? c.mcapSol * solUsd : null;
    streamRows.push({
      source: c.migrated ? "graduated" : "latest",
      r: {
        token: { mint: c.mint, name: c.name, symbol: c.symbol, image: c.image, website: c.website, twitter: c.twitter, telegram: c.telegram, createdOn: "https://pump.fun" },
        pools: [{ market: "pumpfun", marketCap: { usd }, liquidity: { usd: 0 }, createdAt: c.createdAt, txns: {} }],
      },
    });
  }
  picked.unshift(...streamRows);

  if (wantPro) {
    // Bounded so one request cannot spend the whole plan.
    const need = picked.filter((p) => !proCache.has(p.r.token.mint) || Date.now() - (proCache.get(p.r.token.mint)?.at ?? 0) >= PRO_TTL).slice(0, PRO_PER_REQUEST);
    // Not awaited: each lookup waits its turn in the shared queue, and the counts appear on the next refresh.
    void Promise.all(need.map((p) => proFor(p.r.token.mint)));
  }

  // The lists are snapshots taken when a coin was indexed, so a coin a minute old can still say 0 holders.
  // Refresh the newest coins one by one (bounded, and only when the queue is quiet) and prefer that answer.
  if (queueDepth() < 6) {
    const stale = picked
      .filter((p) => p.source === "latest" || p.source === "latest2" || p.source.startsWith("graduating"))
      .map((p) => p.r.token.mint as string)
      .filter((m) => (peek(`/tokens/${m}`)?.ageMs ?? Infinity) > FRESH_TTL)
      .slice(0, REFRESH_PER_REQUEST);
    for (const m of stale) void tracker(`/tokens/${m}`, FRESH_TTL);
  }

  const now = Date.now();
  const items = picked.map(({ r: row, source }) => {
    const fresh = peek<Raw>(`/tokens/${row.token.mint}`);
    const r: Raw = fresh && fresh.ageMs < FRESH_MAX_AGE && fresh.data?.token ? fresh.data : row;
    const t = r.token ?? {};
    const pool: Raw = [...(r.pools ?? [])].sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0))[0] ?? {};
    const strict = (t.strictSocials ?? {}) as Record<string, string>;
    const mcap = num(pool.marketCap?.usd);
    const curve = num(pool.curvePercentage);
    const createdMs = num(pool.createdAt) ?? (num(t.creation?.created_time) != null ? (t.creation.created_time as number) * 1000 : null);
    const ageMinutes = createdMs != null ? Math.max(0, Math.round((now - createdMs) / 60_000)) : null;
    const graduated = source === "graduated" || source === "graduated2" || migrated.has(t.mint) || (mcap ?? 0) > 100_000;
    const percent = graduated ? 100 : Math.min(99, Math.round(curve ?? ((mcap ?? 0) / GRADUATION_MCAP) * 100));
    const stageKey = graduated ? "grad" : source.startsWith("graduating") || percent >= 60 ? "final" : "new";
    const risk = r.risk ?? null;
    const bundlerPct = risk ? num(risk.bundlers?.totalPercentage) ?? 0 : null;
    const devPct = risk ? num(risk.dev?.percentage) : null;
    const rugged = risk?.rugged === true;
    const known = bundlerPct != null && devPct != null && num(r.holders) != null;
    const bad = rugged || (bundlerPct ?? 0) > 20 || (devPct ?? 0) > 15;
    const tx = pool.txns ?? {};
    return {
      mint: t.mint as string,
      name: t.name ?? null,
      symbol: t.symbol ?? null,
      imageUrl: t.image ?? null,
      status: graduated ? "migrated" : "launchpad",
      stage: { key: stageKey, percent },
      ageMinutes,
      createdAt: createdMs,
      // The market cap it started at, in dollars. The app turns this into "change since launch" for coins too new to have an hourly change.
      startMcapUsd: graduated || solUsd == null ? null : (startSol.get(t.mint) ?? PUMP_START_SOL) * solUsd,
      fresh: ageMinutes != null && ageMinutes < 60,
      mcapUsd: mcap,
      volume24hUsd: num(tx.volume24h) ?? num(tx.volume),
      holders: num(r.holders),
      priceChange1h: num(r.events?.["1h"]?.priceChangePercentage),
      dexPaid: false,
      liquidityLocked: false,
      risk: bad ? "high" : known && bundlerPct! < 10 && devPct! < 5 ? "low" : "med",
      passes: !bad,
      hiddenReason: null,
      website: t.website ?? strict.website ?? null,
      twitter: t.twitter ?? strict.twitter ?? null,
      telegram: t.telegram ?? strict.telegram ?? null,
      bundlerPct,
      devPct,
      proTraders: proCache.get(t.mint)?.value ?? null,
      buys: num(r.buys) ?? num(tx.buys),
      sells: num(r.sells) ?? num(tx.sells),
      goalMcapUsd: GRADUATION_MCAP,
    };
  });

  // Only the stage the person is looking at, and only fields the app reads and that have a value.
  // This took the response from about 250 KB to a fraction of that.
  // Each stage is capped at its 200 newest coins. The live stream remembers every coin since the server
  // started, and nobody scrolls through hours-old launches.
  const kept = new Map<string, number>();
  const slim = [...items]
    .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
    .filter((i) => {
      if (stage !== null && i.stage.key !== stage) return false;
      const n = (kept.get(i.stage.key) ?? 0) + 1;
      kept.set(i.stage.key, n);
      return n <= MAX_PER_STAGE;
    })
    .map((i) => Object.fromEntries(Object.entries(i).filter(([k, v]) => v !== null && v !== undefined && !UNUSED.has(k))));
  return JSON.stringify({
    items: slim,
    meta: { stream: streamLive(), shown: slim.length, passedTotal: slim.length, launches24h: slim.length, hiddenToday: 0, generatedAt: new Date().toISOString() },
  });
}

/**
 * Many people polling at once share one build. A finished response is reused for 700 ms, and a build
 * already in progress is joined instead of started again. With 100 people polling every second the
 * server builds the feed about once a second, not 100 times.
 */
const MEMO_MS = 700;
const memo = new Map<string, { at: number; body?: string; pending?: Promise<string> }>();
const json = (body: string) => new NextResponse(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const pro = sp.get("pro") === "1";
  const st = sp.get("stage");
  const stage: StageKey | null = st === "new" || st === "final" || st === "grad" ? st : null;
  const key = `${pro}|${stage}`;
  const hit = memo.get(key);
  if (hit?.body && Date.now() - hit.at < MEMO_MS) return json(hit.body);
  if (hit?.pending) return json(await hit.pending);
  const pending = buildFeed(pro, stage);
  memo.set(key, { at: hit?.at ?? 0, body: hit?.body, pending });
  try {
    const body = await pending;
    memo.set(key, { at: Date.now(), body });
    return json(body);
  } catch (e) {
    memo.delete(key);
    throw e;
  }
}
