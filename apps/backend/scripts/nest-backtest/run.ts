/**
 * Loofta Nest attention-tilt backtest.
 *
 * Self-contained: plain Node fetch, no new npm deps, never imports app code, never touches the DB.
 * Run from apps/backend:
 *
 *   npx ts-node --transpile-only scripts/nest-backtest/run.ts            # real run (Elfa + Yahoo)
 *   npx ts-node --transpile-only scripts/nest-backtest/run.ts --offline  # caches only, no network
 *   npx ts-node --transpile-only scripts/nest-backtest/run.ts --synthetic # SMOKE TEST: fake scores
 *   npx ts-node --transpile-only scripts/nest-backtest/run.ts --turnover-cap # also apply the live
 *                                                                          # engine's 10%/tick cap
 *
 * Every Elfa window count and every price series is cached under ./cache so re-runs never refetch.
 * Results land in ./results/results.json (or results-synthetic.json for the smoke test).
 *
 * The allocator below (computeTargetWeights, RISK_CONFIG, SENTIMENT_TILT_STRENGTH, MIN_USER_TRADE_USD)
 * is a line-for-line replica of src/modules/nest/nest-rebalance.service.ts, and the attention z-score
 * replicates src/modules/nest/elfa.service.ts. If those change, change this too.
 */
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
const argv = new Set(process.argv.slice(2));
const OFFLINE = argv.has('--offline');
const SYNTHETIC = argv.has('--synthetic');
const APPLY_TURNOVER_CAP = argv.has('--turnover-cap');
const WEEKS = Number([...argv].find(a => a.startsWith('--weeks='))?.split('=')[1] ?? 26);
const SHUFFLES = Number([...argv].find(a => a.startsWith('--shuffles='))?.split('=')[1] ?? 200);

const HERE = __dirname;
const CACHE_DIR = path.join(HERE, 'cache');
const RESULTS_DIR = path.join(HERE, 'results');
const ELFA_CACHE = path.join(CACHE_DIR, 'elfa-counts.json');
const PRICE_CACHE = path.join(CACHE_DIR, 'prices.json');
for (const d of [CACHE_DIR, RESULTS_DIR]) fs.mkdirSync(d, { recursive: true });

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// ---------------------------------------------------------------------------------------------
// Replicated engine constants + allocator (nest-rebalance.service.ts)
// ---------------------------------------------------------------------------------------------
type RiskTolerance = 'conservative' | 'balanced' | 'aggressive';
interface RiskConfig {
  maxPositions: number;
  maxWeightPerPosition: number;
  maxDailyTurnoverPct: number;
  cashFloorPct: number;
}
const RISK_CONFIG: Record<RiskTolerance, RiskConfig> = {
  conservative: { maxPositions: 8, maxWeightPerPosition: 0.15, maxDailyTurnoverPct: 0.05, cashFloorPct: 0.1 },
  balanced: { maxPositions: 15, maxWeightPerPosition: 0.2, maxDailyTurnoverPct: 0.1, cashFloorPct: 0.05 },
  aggressive: { maxPositions: 25, maxWeightPerPosition: 0.3, maxDailyTurnoverPct: 0.2, cashFloorPct: 0 },
};
const SENTIMENT_TILT_STRENGTH = 0.6;
const MIN_USER_TRADE_USD = 2;
const TIER: RiskTolerance = 'balanced';

interface UniverseAsset {
  symbol: string;
  underlyingSymbol: string;
  name: string;
  tags: string[];
}

/** Exact copy of NestRebalanceService.computeTargetWeights (profile = balanced, no interest tags). */
function computeTargetWeights(riskTolerance: RiskTolerance, interestTags: string[], universe: UniverseAsset[], sentiment: Map<string, { score: number }>): Map<string, number> {
  const cfg = RISK_CONFIG[riskTolerance];
  const candidates = interestTags.length > 0 ? universe.filter(a => a.tags.some(t => interestTags.includes(t))) : universe;
  if (candidates.length === 0) return new Map();

  const scored = candidates
    .map(a => ({ symbol: a.symbol, score: sentiment.get(a.symbol)?.score ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.maxPositions);

  const raw = scored.map(s => ({ symbol: s.symbol, w: 1 + Math.max(s.score, 0) * SENTIMENT_TILT_STRENGTH }));
  const rawSum = raw.reduce((sum, r) => sum + r.w, 0);
  const investableFraction = 1 - cfg.cashFloorPct;

  const weights = new Map<string, number>();
  for (const r of raw) {
    weights.set(r.symbol, Math.min((r.w / rawSum) * investableFraction, cfg.maxWeightPerPosition));
  }
  return weights;
}

// ---------------------------------------------------------------------------------------------
// Replicated attention z-score (elfa.service.ts)
// ---------------------------------------------------------------------------------------------
const DAY_S = 86400;
const BASELINE_DAYS = 6;
function attentionScore(recentTotal: number, baselineTotal: number): number {
  const baselineRatePerDay = baselineTotal / BASELINE_DAYS;
  const z = (recentTotal - baselineRatePerDay) / Math.sqrt(Math.max(baselineRatePerDay, 0.5));
  return Math.tanh(z / 10);
}

// ---------------------------------------------------------------------------------------------
// Universe subset: 30 liquid names spanning every tag family in NEST_UNIVERSE_ALLOWLIST.
// Index ETFs (SPYx/QQQx) are deliberately excluded: an "attention" count for "S&P 500 ETF,SPY" is
// not comparable to a company's mention count. Names/tags are cross-checked against the live
// allowlist source at startup so this list can't silently drift from the engine.
// ---------------------------------------------------------------------------------------------
const SUBSET_UNDERLYINGS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ORCL', 'NFLX', // big-tech / ai
  'AVGO', 'AMD', 'QCOM', // semis
  'PLTR', 'COIN', 'HOOD', 'MSTR', 'CRCL', // ai / crypto-adjacent
  'UBER', 'SHOP', 'RBLX', 'WMT', 'DIS', // consumer
  'JPM', 'V', 'GS', // finance
  'UNH', 'LLY', // healthcare
  'TSLA', // ev
  'BA', 'CAT', // industrial
  'XOM', // energy
];

function loadUniverseFromSource(): UniverseAsset[] {
  const src = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'modules', 'nest', 'xstocks.service.ts'), 'utf8');
  const re = /\{\s*symbol:\s*'([^']+)',\s*underlyingSymbol:\s*'([^']+)',\s*name:\s*(?:'([^']*)'|"([^"]*)"),\s*tags:\s*\[([^\]]*)\]/g;
  const all = new Map<string, UniverseAsset>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tags = m[5].split(',').map(t => t.trim().replace(/^'|'$/g, '')).filter(Boolean);
    all.set(m[2], { symbol: m[1], underlyingSymbol: m[2], name: m[3] ?? m[4], tags });
  }
  const out: UniverseAsset[] = [];
  for (const u of SUBSET_UNDERLYINGS) {
    const a = all.get(u);
    if (!a) throw new Error(`Subset ticker ${u} is not in NEST_UNIVERSE_ALLOWLIST any more`);
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Prices: Yahoo Finance chart API (keyless) primary, Stooq CSV secondary. Cached per ticker.
// ---------------------------------------------------------------------------------------------
type Series = Record<string, number>; // 'YYYY-MM-DD' -> adjusted close
interface PriceCache {
  fetchedAt: string;
  source: Record<string, string>;
  series: Record<string, Series>;
}
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchYahoo(ticker: string): Promise<Series | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const body: any = await res.json();
  const r = body?.chart?.result?.[0];
  if (!r?.timestamp) return null;
  const closes: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? r.indicators?.quote?.[0]?.close ?? [];
  const out: Series = {};
  r.timestamp.forEach((ts: number, i: number) => {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) out[new Date(ts * 1000).toISOString().slice(0, 10)] = c;
  });
  return Object.keys(out).length > 100 ? out : null;
}

async function fetchStooq(ticker: string): Promise<Series | null> {
  const res = await fetch(`https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&i=d`);
  if (!res.ok) return null;
  const text = await res.text();
  if (text.trimStart().startsWith('<')) return null; // JS anti-bot wall, not CSV
  const lines = text.trim().split('\n');
  if (!lines[0]?.startsWith('Date,')) return null;
  const out: Series = {};
  for (const line of lines.slice(1)) {
    const [date, , , , close] = line.split(',');
    const c = Number(close);
    if (date && Number.isFinite(c) && c > 0) out[date] = c;
  }
  return Object.keys(out).length > 100 ? out : null;
}

async function loadPrices(universe: UniverseAsset[]): Promise<{ series: Record<string, Series>; dropped: string[]; source: Record<string, string> }> {
  const cache = readJson<PriceCache>(PRICE_CACHE, { fetchedAt: '', source: {}, series: {} });
  const dropped: string[] = [];
  let dirty = false;
  for (const a of universe) {
    const u = a.underlyingSymbol;
    if (cache.series[u]) continue;
    if (OFFLINE) {
      dropped.push(u);
      continue;
    }
    let s = await fetchYahoo(u).catch(() => null);
    let src = 'yahoo';
    if (!s) {
      s = await fetchStooq(u).catch(() => null);
      src = 'stooq';
    }
    if (!s) {
      log(`price: ${u} unavailable from Yahoo and Stooq; dropping`);
      dropped.push(u);
      continue;
    }
    cache.series[u] = s;
    cache.source[u] = src;
    dirty = true;
    log(`price: ${u} ${Object.keys(s).length} rows via ${src}`);
    await sleep(250);
  }
  if (dirty) {
    cache.fetchedAt = new Date().toISOString();
    fs.writeFileSync(PRICE_CACHE, JSON.stringify(cache));
  }
  return { series: cache.series, dropped, source: cache.source };
}

// ---------------------------------------------------------------------------------------------
// Elfa: exact mention count per (name+ticker, window). Cached. Concurrency 2, backoff on 429.
// ---------------------------------------------------------------------------------------------
const ELFA_API_BASE = 'https://api.elfa.ai';
type ElfaCache = Record<string, number>; // `${TICKER}|${from}|${to}` -> metadata.total

interface ElfaStatus {
  attempted: number;
  fetched: number;
  fromCache: number;
  failed: number;
  monthlyQuotaExhausted: boolean;
  horizonErrors: Array<{ ticker: string; from: number; to: number; status: number; message: string }>;
  earliestSuccessfulWindowFrom: number | null;
  latestFailedWindowFrom: number | null;
  keyStatus: any;
}

function readElfaKey(): string | null {
  const envFile = path.join(HERE, '..', '..', '.env.production.local');
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*ELFA_API_KEY\s*=\s*(.*)\s*$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '') || null;
    }
  } catch {
    /* missing file */
  }
  return null;
}

async function elfaKeyStatus(apiKey: string): Promise<any> {
  try {
    const res = await fetch(`${ELFA_API_BASE}/v2/key-status`, { headers: { 'x-elfa-api-key': apiKey } });
    const body: any = await res.json();
    const d = body?.data ?? {};
    // Only quota-shaped fields; never the key itself.
    return {
      status: d.status,
      dailyRequestLimit: d.dailyRequestLimit,
      monthlyRequestLimit: d.monthlyRequestLimit,
      requestsPerMinute: d.requestsPerMinute,
      allowOverage: d.allowOverage,
      createdAt: d.createdAt,
    };
  } catch {
    return null;
  }
}

class ElfaClient {
  private cache: ElfaCache = readJson<ElfaCache>(ELFA_CACHE, {});
  private dirty = 0;
  readonly status: ElfaStatus = {
    attempted: 0,
    fetched: 0,
    fromCache: 0,
    failed: 0,
    monthlyQuotaExhausted: false,
    horizonErrors: [],
    earliestSuccessfulWindowFrom: null,
    latestFailedWindowFrom: null,
    keyStatus: null,
  };
  constructor(private readonly apiKey: string | null) {}

  flush() {
    if (this.dirty > 0) {
      fs.writeFileSync(ELFA_CACHE, JSON.stringify(this.cache));
      this.dirty = 0;
    }
  }

  private noteSuccess(from: number) {
    const s = this.status;
    s.earliestSuccessfulWindowFrom = s.earliestSuccessfulWindowFrom === null ? from : Math.min(s.earliestSuccessfulWindowFrom, from);
  }
  private noteFailure(from: number) {
    const s = this.status;
    s.latestFailedWindowFrom = s.latestFailedWindowFrom === null ? from : Math.max(s.latestFailedWindowFrom, from);
  }

  async windowTotal(name: string, ticker: string, from: number, to: number): Promise<number | null> {
    const key = `${ticker}|${from}|${to}`;
    if (key in this.cache) {
      this.status.fromCache++;
      this.noteSuccess(from);
      return this.cache[key];
    }
    if (OFFLINE || !this.apiKey || this.status.monthlyQuotaExhausted) return null;
    this.status.attempted++;
    const params = new URLSearchParams({ keywords: `${name},${ticker}`, from: String(from), to: String(to), limit: '1' });
    const url = `${ELFA_API_BASE}/v2/data/keyword-mentions?${params.toString()}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { headers: { 'x-elfa-api-key': this.apiKey } });
      } catch (e: any) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        if (/monthly request limit/i.test(text)) {
          this.status.monthlyQuotaExhausted = true;
          this.status.failed++;
          this.noteFailure(from);
          log(`elfa: MONTHLY QUOTA EXHAUSTED (overages disabled) — stopping all further Elfa calls`);
          return null;
        }
        const retryAfter = Number(res.headers.get('retry-after')) || Number(res.headers.get('ratelimit-reset')) || 0;
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1);
        await sleep(Math.min(waitMs, 60_000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        this.status.failed++;
        this.noteFailure(from);
        this.status.horizonErrors.push({ ticker, from, to, status: res.status, message: text.slice(0, 200) });
        return null;
      }
      const body: any = await res.json();
      const total = Number(body?.metadata?.total);
      if (!Number.isFinite(total)) {
        this.status.failed++;
        this.noteFailure(from);
        return null;
      }
      this.cache[key] = total;
      this.status.fetched++;
      this.noteSuccess(from);
      if (++this.dirty >= 10) this.flush();
      return total;
    }
    this.status.failed++;
    this.noteFailure(from);
    return null;
  }
}

/** Tiny concurrency pool — keeps at most `n` Elfa requests in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------------------------
// Synthetic scores (SMOKE TEST ONLY): seeded, same tanh(z/10) shape. Never mistaken for real data —
// results go to results-synthetic.json.
// ---------------------------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------------------------
const START_USD = 10_000;
const ROUND_TRIP_COST = 0.005; // 0.5% of one-way traded notional (sell A -> buy B costs 0.5% of the notional moved)

interface SimResult {
  navDaily: number[]; // marked daily, gross of costs
  navDailyNet: number[]; // marked daily, net of costs
  weeklyTurnover: number[]; // one-way turnover / NAV at each rebalance after the first
  totalCostUsd: number;
}

interface Frame {
  dates: string[]; // all trading dates (intersection) in the sim window
  rebalanceIdx: number[]; // indexes into dates where a rebalance happens
  px: Record<string, number[]>; // ticker -> close per date index
}

function simulate(frame: Frame, universe: UniverseAsset[], weightsAt: (rebalanceNo: number) => Map<string, number>, opts: { turnoverCap?: number } = {}): SimResult {
  const { dates, rebalanceIdx, px } = frame;
  const bySymbol = new Map(universe.map(a => [a.symbol, a.underlyingSymbol]));
  const units = new Map<string, number>();
  let cash = START_USD;
  let costAccrued = 0;
  const navDaily: number[] = [];
  const navDailyNet: number[] = [];
  const weeklyTurnover: number[] = [];
  const rebalanceSet = new Map(rebalanceIdx.map((idx, k) => [idx, k]));

  for (let d = 0; d < dates.length; d++) {
    const price = (symbol: string) => px[bySymbol.get(symbol)!][d];
    const k = rebalanceSet.get(d);
    if (k !== undefined) {
      const nav = cash + [...units].reduce((s, [sym, u]) => s + u * price(sym), 0);
      const target = weightsAt(k);
      const current = new Map([...units].map(([sym, u]) => [sym, u * price(sym)]));
      const symbols = new Set([...target.keys(), ...current.keys()]);
      const deltas: Array<{ symbol: string; deltaUsd: number }> = [];
      for (const symbol of symbols) {
        const deltaUsd = (target.get(symbol) ?? 0) * nav - (current.get(symbol) ?? 0);
        if (Math.abs(deltaUsd) >= MIN_USER_TRADE_USD) deltas.push({ symbol, deltaUsd });
      }
      deltas.sort((a, b) => a.deltaUsd - b.deltaUsd); // sells before buys, like the engine
      let remainingTurnover = opts.turnoverCap ? nav * opts.turnoverCap : Infinity;
      let sold = 0;
      let bought = 0;
      for (const { symbol, deltaUsd: rawDelta } of deltas) {
        let cappedAbs = Math.min(Math.abs(rawDelta), Math.max(remainingTurnover, 0));
        if (rawDelta > 0) cappedAbs = Math.min(cappedAbs, Math.max(cash, 0));
        if (cappedAbs < MIN_USER_TRADE_USD) continue;
        const deltaUsd = Math.sign(rawDelta) * cappedAbs;
        remainingTurnover -= cappedAbs;
        cash -= deltaUsd;
        units.set(symbol, (units.get(symbol) ?? 0) + deltaUsd / price(symbol));
        if (deltaUsd > 0) bought += deltaUsd;
        else sold += -deltaUsd;
      }
      for (const [sym, u] of [...units]) if (Math.abs(u) < 1e-12) units.delete(sym);
      // One-way turnover = max(bought, sold): a pure swap counts once (round trip = 0.5%).
      const oneWay = Math.max(bought, sold);
      costAccrued += oneWay * ROUND_TRIP_COST;
      if (k > 0) weeklyTurnover.push(oneWay / nav);
    }
    const nav = cash + [...units].reduce((s, [sym, u]) => s + u * price(sym), 0);
    navDaily.push(nav);
    navDailyNet.push(nav - costAccrued);
  }
  return { navDaily, navDailyNet, weeklyTurnover, totalCostUsd: costAccrued };
}

interface Metrics {
  totalReturn: number;
  annualizedVol: number;
  maxDrawdown: number;
  finalNav: number;
}
function metrics(nav: number[]): Metrics {
  const rets: number[] = [];
  for (let i = 1; i < nav.length; i++) rets.push(nav[i] / nav[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(rets.length, 1);
  const var_ = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
  let peak = -Infinity;
  let mdd = 0;
  for (const v of nav) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return { totalReturn: nav[nav.length - 1] / nav[0] - 1, annualizedVol: Math.sqrt(var_) * Math.sqrt(252), maxDrawdown: mdd, finalNav: nav[nav.length - 1] };
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
async function main() {
  log(`Nest backtest — tier=${TIER}, weeks=${WEEKS}, shuffles=${SHUFFLES}${SYNTHETIC ? ' [SYNTHETIC SMOKE TEST]' : ''}${OFFLINE ? ' [OFFLINE]' : ''}${APPLY_TURNOVER_CAP ? ' [turnover cap]' : ''}`);

  // 1. Universe subset, verified against the live allowlist source.
  const universeAll = loadUniverseFromSource();
  log(`universe subset: ${universeAll.length} names, tags: ${[...new Set(universeAll.flatMap(a => a.tags))].sort().join(', ')}`);

  // 2. Prices.
  const { series, dropped, source } = await loadPrices(universeAll);
  const universe = universeAll.filter(a => !dropped.includes(a.underlyingSymbol));
  if (universe.length < 10) throw new Error(`Only ${universe.length} tickers have price data — too thin to run`);

  // Common trading calendar = dates present for every ticker.
  let common: Set<string> | null = null;
  for (const a of universe) {
    const ds = new Set(Object.keys(series[a.underlyingSymbol]));
    common = common ? new Set([...common].filter(d => ds.has(d))) : ds;
  }
  const allDates = [...common!].sort();

  // Weekly rebalance on the last trading day of each ISO week; WEEKS holding weeks => WEEKS+1 rebalances.
  const weekKey = (d: string) => {
    const dt = new Date(d + 'T00:00:00Z');
    const day = (dt.getUTCDay() + 6) % 7; // Mon=0
    const thu = new Date(dt);
    thu.setUTCDate(dt.getUTCDate() - day + 3);
    const y = thu.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const wk = 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return `${y}-W${String(wk).padStart(2, '0')}`;
  };
  const lastOfWeek = new Map<string, string>();
  for (const d of allDates) lastOfWeek.set(weekKey(d), d);
  const weekEnds = [...lastOfWeek.values()].sort().slice(-(WEEKS + 1));
  const firstDate = weekEnds[0];
  const dates = allDates.filter(d => d >= firstDate);
  const rebalanceIdx = weekEnds.map(d => dates.indexOf(d));
  const px: Record<string, number[]> = {};
  for (const a of universe) px[a.underlyingSymbol] = dates.map(d => series[a.underlyingSymbol][d]);
  const frame: Frame = { dates, rebalanceIdx, px };
  log(`calendar: ${dates[0]} -> ${dates[dates.length - 1]} (${dates.length} trading days, ${rebalanceIdx.length} rebalance points)`);

  // 3. Attention scores at each rebalance date (signal at 20:00 UTC = US close, executed at that close).
  const signalUnix = (d: string) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 20) / 1000);
  const scores: Array<Map<string, { score: number }>> = weekEnds.map(() => new Map());
  const coverage: number[] = weekEnds.map(() => 0);
  const apiKey = SYNTHETIC ? null : readElfaKey();
  const elfa = new ElfaClient(apiKey);

  if (SYNTHETIC) {
    const rng = mulberry32(20260920);
    weekEnds.forEach((_, k) => {
      for (const a of universe) {
        const z = gaussian(rng) * 3;
        scores[k].set(a.symbol, { score: Math.tanh(z / 10) });
      }
      coverage[k] = 1;
    });
    log('synthetic: generated seeded fake scores for every (symbol, week)');
  } else {
    if (!apiKey) log('elfa: ELFA_API_KEY not found in .env.production.local — scores will be missing');
    else if (!OFFLINE) {
      elfa.status.keyStatus = await elfaKeyStatus(apiKey);
      log(`elfa: key status ${JSON.stringify(elfa.status.keyStatus)}`);
    }
    const jobs: Array<{ k: number; a: UniverseAsset }> = [];
    weekEnds.forEach((_, k) => universe.forEach(a => jobs.push({ k, a })));
    // Newest week first: if Elfa has a history horizon, we learn where it is from the failures.
    jobs.sort((x, y) => y.k - x.k);
    let done = 0;
    await pool(jobs, 2, async ({ k, a }) => {
      const now = signalUnix(weekEnds[k]);
      const recent = await elfa.windowTotal(a.name, a.underlyingSymbol, now - DAY_S, now);
      const baseline = recent === null ? null : await elfa.windowTotal(a.name, a.underlyingSymbol, now - (BASELINE_DAYS + 1) * DAY_S, now - DAY_S);
      if (recent !== null && baseline !== null) {
        scores[k].set(a.symbol, { score: attentionScore(recent, baseline) });
        coverage[k] += 1 / universe.length;
      }
      if (++done % 30 === 0 || done === jobs.length) {
        log(`elfa: ${done}/${jobs.length} (fetched ${elfa.status.fetched}, cached ${elfa.status.fromCache}, failed ${elfa.status.failed})`);
        elfa.flush();
      }
    });
    elfa.flush();
  }

  // Effective horizon: the earliest week where we have full coverage. Weeks before that are dropped.
  const covered = coverage.map((c, k) => (c >= 0.999 ? k : -1)).filter(k => k >= 0);
  const scoredWeeks = covered.length;
  const partialWeeks = coverage.filter(c => c > 0 && c < 0.999).length;
  log(`coverage: ${scoredWeeks}/${weekEnds.length} weeks fully scored, ${partialWeeks} partial, ${weekEnds.length - scoredWeeks - partialWeeks} empty`);

  // 4. Strategies.
  const ewWeights = new Map(universe.map(a => [a.symbol, (1 - RISK_CONFIG[TIER].cashFloorPct) / universe.length]));
  const simOpts = APPLY_TURNOVER_CAP ? { turnoverCap: RISK_CONFIG[TIER].maxDailyTurnoverPct } : {};
  const ew = simulate(frame, universe, () => ewWeights, simOpts);

  const canRunTilt = scoredWeeks === weekEnds.length; // require full data for an honest comparison
  let tilt: SimResult | null = null;
  let selectionOnly: SimResult | null = null;
  let placebo: number[] = [];
  let placeboGross: number[] = [];
  if (canRunTilt) {
    tilt = simulate(frame, universe, k => computeTargetWeights(TIER, [], universe, scores[k]), simOpts);
    // Decomposition: top-15-by-attention but equal-weighted (isolates selection from sizing).
    selectionOnly = simulate(
      frame,
      universe,
      k => {
        const flat = new Map([...scores[k]].map(([sym, s]) => [sym, { score: s.score > 0 ? 1e-9 : s.score }])); // keep ranking, kill tilt
        const w = computeTargetWeights(TIER, [], universe, flat);
        return w;
      },
      simOpts,
    );
    // Placebo: shuffle the score vector across symbols independently at each rebalance.
    const rng = mulberry32(42);
    for (let s = 0; s < SHUFFLES; s++) {
      const shuffled = scores.map(m => {
        const vals = [...m.values()];
        for (let i = vals.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [vals[i], vals[j]] = [vals[j], vals[i]];
        }
        const keys = [...m.keys()];
        return new Map(keys.map((key, i) => [key, vals[i]]));
      });
      const r = simulate(frame, universe, k => computeTargetWeights(TIER, [], universe, shuffled[k]), simOpts);
      placebo.push(r.navDailyNet[r.navDailyNet.length - 1] / START_USD - 1);
      placeboGross.push(r.navDaily[r.navDaily.length - 1] / START_USD - 1);
      if ((s + 1) % 50 === 0) log(`placebo: ${s + 1}/${SHUFFLES}`);
    }
  } else {
    log('tilt: NOT RUN — attention scores are incomplete; only the equal-weight baseline is reported');
  }

  // 5. Report.
  const summarize = (r: SimResult) => ({
    gross: metrics(r.navDaily),
    net: metrics(r.navDailyNet),
    avgWeeklyTurnover: mean(r.weeklyTurnover),
    totalCostUsd: r.totalCostUsd,
  });
  const percentile = (x: number, dist: number[]) => (dist.length ? dist.filter(v => v < x).length / dist.length : null);
  const sorted = [...placebo].sort((a, b) => a - b);
  const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

  const out = {
    generatedAt: new Date().toISOString(),
    mode: SYNTHETIC ? 'SYNTHETIC_SMOKE_TEST' : 'REAL',
    config: { tier: TIER, interestTags: [], startUsd: START_USD, roundTripCost: ROUND_TRIP_COST, weeks: WEEKS, shuffles: SHUFFLES, turnoverCapApplied: APPLY_TURNOVER_CAP, riskConfig: RISK_CONFIG[TIER], tiltStrength: SENTIMENT_TILT_STRENGTH },
    universe: universe.map(a => ({ symbol: a.symbol, underlying: a.underlyingSymbol, tags: a.tags, priceSource: source[a.underlyingSymbol] })),
    droppedForMissingPrices: dropped,
    calendar: { start: dates[0], end: dates[dates.length - 1], tradingDays: dates.length, rebalanceDates: weekEnds },
    elfa: {
      ...elfa.status,
      coveragePerWeek: weekEnds.map((d, k) => ({ date: d, coverage: +coverage[k].toFixed(3) })),
      fullyScoredWeeks: scoredWeeks,
      earliestSuccessfulWindow: elfa.status.earliestSuccessfulWindowFrom ? new Date(elfa.status.earliestSuccessfulWindowFrom * 1000).toISOString() : null,
    },
    equalWeight: summarize(ew),
    attentionTilt: tilt ? summarize(tilt) : null,
    selectionOnlyEqualWeighted: selectionOnly ? summarize(selectionOnly) : null,
    placebo: tilt
      ? {
          shuffles: SHUFFLES,
          realNetReturn: metrics(tilt.navDailyNet).totalReturn,
          realGrossReturn: metrics(tilt.navDaily).totalReturn,
          percentileOfRealNet: percentile(metrics(tilt.navDailyNet).totalReturn, placebo),
          percentileOfRealGross: percentile(metrics(tilt.navDaily).totalReturn, placeboGross),
          netDistribution: { p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), mean: mean(placebo) },
          equalWeightNetReturn: metrics(ew.navDailyNet).totalReturn,
          percentileOfEqualWeightNet: percentile(metrics(ew.navDailyNet).totalReturn, placebo),
        }
      : null,
    navSeries: {
      dates,
      equalWeightNet: ew.navDailyNet.map(v => +v.toFixed(2)),
      attentionTiltNet: tilt?.navDailyNet.map(v => +v.toFixed(2)) ?? null,
    },
  };
  const file = path.join(RESULTS_DIR, SYNTHETIC ? 'results-synthetic.json' : 'results.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  const line = (label: string, s: ReturnType<typeof summarize>) =>
    `${label.padEnd(34)} gross ${pct(s.gross.totalReturn).padStart(8)}  net ${pct(s.net.totalReturn).padStart(8)}  vol ${pct(s.net.annualizedVol).padStart(7)}  maxDD ${pct(s.net.maxDrawdown).padStart(8)}  turnover/wk ${pct(s.avgWeeklyTurnover).padStart(7)}  costs $${s.totalCostUsd.toFixed(0)}`;
  console.log('');
  console.log(`=== ${out.mode} — ${dates[0]} to ${dates[dates.length - 1]}, ${universe.length} names, ${WEEKS} weeks, $${START_USD} start ===`);
  console.log(line('Equal-weight (95% invested)', out.equalWeight));
  if (out.attentionTilt) console.log(line('Attention tilt (live allocator)', out.attentionTilt));
  if (out.selectionOnlyEqualWeighted) console.log(line('Top-15 by attention, equal-wt', out.selectionOnlyEqualWeighted));
  if (out.placebo) {
    console.log(`Placebo (${SHUFFLES} shuffles, net): real tilt at percentile ${(out.placebo.percentileOfRealNet! * 100).toFixed(0)}; shuffled net p05/p50/p95 = ${pct(out.placebo.netDistribution.p05!)} / ${pct(out.placebo.netDistribution.p50!)} / ${pct(out.placebo.netDistribution.p95!)}`);
  } else {
    console.log(`Attention tilt: NOT COMPUTED. Elfa coverage ${scoredWeeks}/${weekEnds.length} weeks; quotaExhausted=${elfa.status.monthlyQuotaExhausted}, fetched=${elfa.status.fetched}, cached=${elfa.status.fromCache}, failed=${elfa.status.failed}`);
  }
  console.log(`Results: ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
