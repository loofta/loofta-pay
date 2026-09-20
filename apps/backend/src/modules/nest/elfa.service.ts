import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

const ELFA_API_BASE = 'https://api.elfa.ai';
const DAY_S = 86400;
const BASELINE_DAYS = 6;
// Below this many stored days of history for a symbol, the baseline comes from a one-off
// 6-day-window fetch stored in baseline_total instead of an average of thin history.
const MIN_HISTORY_DAYS = 3;
const POST_CACHE_MS = 24 * 60 * 60_000;
// Soft monthly budget (calls). Elfa bills per call once overage is on, so this is a spend guard:
// past 90% of it the engine keeps using yesterday's scores instead of fetching. Override with
// ELFA_MONTHLY_CALL_BUDGET.
const DEFAULT_MONTHLY_BUDGET = 1380;
const BUDGET_GUARD_FRACTION = 0.9;

export interface SentimentResult {
  symbol: string;
  score: number; // tanh-compressed z-score, bounded roughly [-1, 1]
  rawMentions: number;
}

export interface ElfaPost {
  link: string;
  username: string;
  likeCount: number;
  mentionedAt: string;
}

interface UniverseAssetLike {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  tags: string[];
}

/**
 * A real anomaly z-score of mention velocity, not a guessed sentiment field. Elfa's flagship
 * endpoint (`/v2/aggregations/trending-tokens`) is scoped to crypto assets — it won't recognize a
 * stock ticker. `/v2/data/keyword-mentions` takes arbitrary keyword strings instead, so it works
 * for a company name/ticker too, and its `metadata.total` field (verified live, 2026-09-15) gives
 * an exact mention count for any `from`/`to` window without needing to page through tweets —
 * `from`/`to` must be Unix seconds, `limit` capped at 30 (both discovered from the API's own
 * validation errors, not docs).
 *
 * Method: compare the last 24h's mention count to the daily average over the prior 6 days
 * (Poisson-style z: (recent - baselineRate) / sqrt(max(baselineRate, 0.5))), then compress
 * through tanh so an extreme spike still produces a bounded tilt rather than blowing out position
 * sizing. This is an ATTENTION signal — how anomalous today's volume is — not sentiment direction;
 * Elfa exposes no positive/negative field for stocks (checked live, 2026-09-20).
 *
 * Cost model (rework of 2026-09-20): one keyword-mentions call per symbol per day, stored in
 * nest_mention_counts; the 6-day baseline is averaged from stored history rather than refetched.
 * Only symbols someone can actually hold (in a profile's tag candidates, or currently held) are
 * scored. A second call within the same UTC day costs nothing — it just recomputes from stored
 * counts — so deposit-triggered rebalances no longer re-bill the whole universe.
 */
@Injectable()
export class ElfaService {
  private readonly logger = new Logger(ElfaService.name);
  private warnedMissingKey = false;
  private warnedBudget = false;
  private usage: { month: string; calls: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  private getApiKey(): string | null {
    const key = this.config.get<string>('ELFA_API_KEY');
    if (!key && !this.warnedMissingKey) {
      this.warnedMissingKey = true;
      this.logger.warn('ELFA_API_KEY not set — Nest rebalancing will use flat (non-tilted) weights across the selected universe until this is configured.');
    }
    return key ?? null;
  }

  // ---- budget metering ------------------------------------------------------------------------

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private monthlyBudget(): number {
    const raw = Number(this.config.get<string>('ELFA_MONTHLY_CALL_BUDGET'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_BUDGET;
  }

  private async loadUsage(): Promise<{ month: string; calls: number }> {
    const month = this.monthKey();
    if (this.usage && this.usage.month === month) return this.usage;
    const { data } = await this.supabase.getClient().from('nest_elfa_usage').select('calls').eq('month', month).maybeSingle();
    this.usage = { month, calls: Number(data?.calls ?? 0) };
    return this.usage;
  }

  private async recordCall(): Promise<void> {
    const u = await this.loadUsage();
    u.calls += 1;
    // Fire-and-forget; a lost increment under-counts by one, which the 90% guard absorbs.
    this.supabase
      .getClient()
      .from('nest_elfa_usage')
      .upsert({ month: u.month, calls: u.calls, updated_at: new Date().toISOString() }, { onConflict: 'month' })
      .then(({ error }) => {
        if (error) this.logger.warn(`nest_elfa_usage upsert: ${error.message}`);
      });
  }

  private async withinBudget(): Promise<boolean> {
    const u = await this.loadUsage();
    const ok = u.calls < this.monthlyBudget() * BUDGET_GUARD_FRACTION;
    if (!ok && !this.warnedBudget) {
      this.warnedBudget = true;
      this.logger.warn(`Elfa monthly call budget ${Math.round(this.monthlyBudget() * BUDGET_GUARD_FRACTION)} reached (${u.calls} used in ${u.month}) — holding at last-known scores until next month or a higher ELFA_MONTHLY_CALL_BUDGET.`);
    }
    return ok;
  }

  /** Current month's metered usage vs budget — for ops visibility. */
  async getUsage(): Promise<{ month: string; calls: number; budget: number }> {
    const u = await this.loadUsage();
    return { month: u.month, calls: u.calls, budget: this.monthlyBudget() };
  }

  // ---- HTTP -----------------------------------------------------------------------------------

  /** Budget-checked, retrying fetch. Returns null when over budget. Every attempt is metered —
   *  retries bill too. */
  private async callElfa(url: string, apiKey: string, attempts = 3): Promise<Response | null> {
    if (!(await this.withinBudget())) return null;
    let res = await fetch(url, { headers: { 'x-elfa-api-key': apiKey } });
    await this.recordCall();
    for (let i = 1; i < attempts && (res.status === 429 || res.status >= 500); i++) {
      // A monthly-limit 429 is not a burst — retrying just bills more. Elfa's body says which.
      const body = await res
        .clone()
        .text()
        .catch(() => '');
      if (res.status === 429 && /monthly/i.test(body)) break;
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * i;
      await new Promise(r => setTimeout(r, waitMs));
      res = await fetch(url, { headers: { 'x-elfa-api-key': apiKey } });
      await this.recordCall();
    }
    return res;
  }

  /** Exact mention count for one [from, to) window — never throws, returns null on any failure
   *  so one bad call doesn't poison the z-score (treated as "no data for this window"). */
  private async fetchWindowTotal(apiKey: string, name: string, ticker: string, fromUnix: number, toUnix: number): Promise<number | null> {
    try {
      const params = new URLSearchParams({ keywords: `${name},${ticker}`, from: String(fromUnix), to: String(toUnix), limit: '1' });
      const res = await this.callElfa(`${ELFA_API_BASE}/v2/data/keyword-mentions?${params.toString()}`, apiKey);
      if (!res) return null;
      if (!res.ok) {
        this.logger.warn(`keyword-mentions(${ticker}) -> HTTP ${res.status}; no count this cycle`);
        return null;
      }
      const body = await res.json();
      const total = Number(body?.metadata?.total);
      return Number.isFinite(total) ? total : null;
    } catch (e: any) {
      this.logger.warn(`fetchWindowTotal(${ticker}) failed: ${e.message}`);
      return null;
    }
  }

  // ---- posts ----------------------------------------------------------------------------------

  /** Most-engaged real X post Elfa indexed for this company in the last 3 days — link, author,
   *  engagement. keyword-mentions on the company name + ticker, not token-news?coinTicker: the
   *  latter is keyed on crypto tickers and it's unverified that "BMY" there means Bristol-Myers.
   *  Cached per symbol for 24h in nest_elfa_posts so dashboard loads don't bill. Never throws —
   *  null means "nothing to show," not an error. */
  async getRecentPost(symbol: string, name: string, ticker: string): Promise<ElfaPost | null> {
    const db = this.supabase.getClient();
    const { data: cached } = await db.from('nest_elfa_posts').select('link, username, like_count, mentioned_at, fetched_at').eq('symbol', symbol).maybeSingle();
    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < POST_CACHE_MS) {
      return { link: cached.link, username: cached.username, likeCount: Number(cached.like_count) || 0, mentionedAt: cached.mentioned_at };
    }
    const apiKey = this.getApiKey();
    if (!apiKey) return null;
    try {
      const now = Math.floor(Date.now() / 1000);
      const params = new URLSearchParams({ keywords: `${name},${ticker}`, from: String(now - 3 * DAY_S), to: String(now), limit: '30' });
      const res = await this.callElfa(`${ELFA_API_BASE}/v2/data/keyword-mentions?${params.toString()}`, apiKey);
      if (!res || !res.ok) {
        // Over budget or upstream error: a stale cached post beats nothing.
        return cached ? { link: cached.link, username: cached.username, likeCount: Number(cached.like_count) || 0, mentionedAt: cached.mentioned_at } : null;
      }
      const body = await res.json();
      const posts: any[] = Array.isArray(body?.data) ? body.data.filter((p: any) => p?.link) : [];
      if (posts.length === 0) return null;
      const engagement = (p: any) => (Number(p.likeCount) || 0) + 2 * (Number(p.repostCount) || 0);
      const post = posts.reduce((best, p) => (engagement(p) > engagement(best) ? p : best), posts[0]);
      const out: ElfaPost = { link: post.link, username: post.account?.username ?? 'unknown', likeCount: Number(post.likeCount) || 0, mentionedAt: post.mentionedAt };
      await db
        .from('nest_elfa_posts')
        .upsert({ symbol, link: out.link, username: out.username, like_count: out.likeCount, mentioned_at: out.mentionedAt, fetched_at: new Date().toISOString() }, { onConflict: 'symbol' })
        .then(({ error }) => {
          if (error) this.logger.warn(`nest_elfa_posts upsert(${symbol}): ${error.message}`);
        });
      return out;
    } catch (e: any) {
      this.logger.warn(`getRecentPost(${ticker}) failed: ${e.message}`);
      return null;
    }
  }

  // ---- daily scoring --------------------------------------------------------------------------

  /** Symbols worth paying to score: everything in some profile's candidate set (its interest
   *  tags, or the whole universe for an untagged profile) plus everything anyone currently holds.
   *  With no profiles at all there's nothing to score. */
  private async symbolsWorthScoring(universe: UniverseAssetLike[]): Promise<Set<string>> {
    const db = this.supabase.getClient();
    const [{ data: profiles }, { data: held }] = await Promise.all([
      db.from('nest_profiles').select('interest_tags'),
      db.from('nest_holdings').select('symbol').gt('units', 0).neq('symbol', 'USD'),
    ]);
    const out = new Set<string>();
    for (const h of held ?? []) out.add(h.symbol);
    const tagSets = (profiles ?? []).map(p => (p.interest_tags ?? []) as string[]);
    if (tagSets.length === 0) return out;
    if (tagSets.some(t => t.length === 0)) {
      for (const a of universe) out.add(a.symbol);
      return out;
    }
    const wanted = new Set(tagSets.flat());
    for (const a of universe) if (a.tags.some(t => wanted.has(t))) out.add(a.symbol);
    return out;
  }

  /** Refreshes nest_sentiment_scores for the symbols worth scoring. Costs one Elfa call per
   *  symbol per UTC day (plus one extra on a symbol's first days, for the baseline window); a
   *  second run the same day recomputes from stored counts for free. No-ops without an API key. */
  async refreshCache(universe: UniverseAssetLike[]): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) return;
    const db = this.supabase.getClient();
    const wanted = await this.symbolsWorthScoring(universe);
    const assets = universe.filter(a => wanted.has(a.symbol));
    if (assets.length === 0) return;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const historyStart = new Date(now.getTime() - BASELINE_DAYS * DAY_S * 1000).toISOString().slice(0, 10);
    const symbols = assets.map(a => a.symbol);
    const [{ data: todayRows }, { data: historyRows }] = await Promise.all([
      db.from('nest_mention_counts').select('symbol, count, baseline_total').eq('day', today).in('symbol', symbols),
      db.from('nest_mention_counts').select('symbol, day, count').gte('day', historyStart).lt('day', today).in('symbol', symbols),
    ]);
    const todayBySymbol = new Map((todayRows ?? []).map(r => [r.symbol, { count: Number(r.count), baselineTotal: r.baseline_total === null ? null : Number(r.baseline_total) }]));
    const historyBySymbol = new Map<string, number[]>();
    for (const r of historyRows ?? []) {
      if (!historyBySymbol.has(r.symbol)) historyBySymbol.set(r.symbol, []);
      historyBySymbol.get(r.symbol)!.push(Number(r.count));
    }

    const nowS = Math.floor(now.getTime() / 1000);
    let fetched = 0;
    for (const asset of assets) {
      const history = historyBySymbol.get(asset.symbol) ?? [];
      let todayRow = todayBySymbol.get(asset.symbol);
      if (!todayRow) {
        const count = await this.fetchWindowTotal(apiKey, asset.name, asset.underlyingSymbol, nowS - DAY_S, nowS);
        if (count === null) continue;
        fetched++;
        let baselineTotal: number | null = null;
        if (history.length < MIN_HISTORY_DAYS) {
          baselineTotal = await this.fetchWindowTotal(apiKey, asset.name, asset.underlyingSymbol, nowS - (BASELINE_DAYS + 1) * DAY_S, nowS - DAY_S);
          if (baselineTotal !== null) fetched++;
        }
        todayRow = { count, baselineTotal };
        await db
          .from('nest_mention_counts')
          .upsert({ symbol: asset.symbol, day: today, count, baseline_total: baselineTotal }, { onConflict: 'symbol,day' })
          .then(({ error }) => {
            if (error) this.logger.error(`upsert nest_mention_counts(${asset.symbol}): ${error.message}`);
          });
      }

      let baselineRatePerDay: number | null = null;
      if (history.length >= MIN_HISTORY_DAYS) baselineRatePerDay = history.reduce((s, c) => s + c, 0) / history.length;
      else if (todayRow.baselineTotal !== null) baselineRatePerDay = todayRow.baselineTotal / BASELINE_DAYS;
      if (baselineRatePerDay === null) continue;

      const z = (todayRow.count - baselineRatePerDay) / Math.sqrt(Math.max(baselineRatePerDay, 0.5));
      const score = Math.tanh(z / 10);
      await db
        .from('nest_sentiment_scores')
        .upsert({ symbol: asset.symbol, score, raw_mentions: todayRow.count, computed_at: now.toISOString() }, { onConflict: 'symbol' })
        .then(({ error }) => {
          if (error) this.logger.error(`upsert nest_sentiment_scores(${asset.symbol}): ${error.message}`);
        });
    }
    const u = await this.loadUsage();
    this.logger.log(`Elfa refresh: ${assets.length} symbols scored, ${fetched} API calls this run, ${u.calls}/${this.monthlyBudget()} used in ${u.month}`);
  }

  /** Cached scores keyed by symbol. A symbol with no row (never fetched, or stale beyond
   *  `maxAgeMs`) is simply absent from the map — treat missing as neutral (0), never as a
   *  reason to skip the whole rebalance. */
  async getCachedScores(symbols: string[], maxAgeMs = 48 * 60 * 60_000): Promise<Map<string, SentimentResult>> {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('nest_sentiment_scores').select('symbol, score, raw_mentions, computed_at').in('symbol', symbols);
    const out = new Map<string, SentimentResult>();
    if (error) {
      this.logger.error(`getCachedScores: ${error.message}`);
      return out;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const row of data ?? []) {
      if (new Date(row.computed_at).getTime() < cutoff) continue;
      out.set(row.symbol, { symbol: row.symbol, score: Number(row.score), rawMentions: row.raw_mentions });
    }
    return out;
  }
}
