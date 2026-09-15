import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

const ELFA_API_BASE = 'https://api.elfa.ai';
const DAY_S = 86400;
const BASELINE_DAYS = 6;

export interface SentimentResult {
  symbol: string;
  score: number; // tanh-compressed z-score, bounded roughly [-1, 1]
  rawMentions: number;
}

/**
 * A real anomaly z-score of mention velocity, not a guessed sentiment field. elfa's flagship
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
 * sizing. This is the same "how anomalous is right now vs normal" idea as the 5-minute/1-hour
 * sigma spikes in elfa's own real-time product — but computed on OUR actual cadence (once daily,
 * since that's how often nest-rebalance.service.ts runs), not theirs. Don't oversell this as
 * matching their intraday (5min/1h) detection — a daily cron structurally can't.
 */
@Injectable()
export class ElfaService {
  private readonly logger = new Logger(ElfaService.name);
  private warnedMissingKey = false;

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

  /** Exact mention count for one [from, to) window — never throws, returns null on any failure
   *  so one bad call doesn't poison the z-score (treated as "no data for this window"). */
  private async fetchWindowTotal(apiKey: string, name: string, ticker: string, fromUnix: number, toUnix: number): Promise<number | null> {
    try {
      const params = new URLSearchParams({ keywords: `${name},${ticker}`, from: String(fromUnix), to: String(toUnix), limit: '1' });
      const res = await fetch(`${ELFA_API_BASE}/v2/data/keyword-mentions?${params.toString()}`, { headers: { 'x-elfa-api-key': apiKey } });
      if (!res.ok) return null;
      const body = await res.json();
      const total = Number(body?.metadata?.total);
      return Number.isFinite(total) ? total : null;
    } catch (e: any) {
      this.logger.warn(`fetchWindowTotal(${ticker}) failed: ${e.message}`);
      return null;
    }
  }

  private async fetchZScore(apiKey: string, name: string, ticker: string): Promise<{ score: number; rawMentions: number } | null> {
    const now = Math.floor(Date.now() / 1000);
    const [recentTotal, baselineTotal] = await Promise.all([
      this.fetchWindowTotal(apiKey, name, ticker, now - DAY_S, now),
      this.fetchWindowTotal(apiKey, name, ticker, now - (BASELINE_DAYS + 1) * DAY_S, now - DAY_S),
    ]);
    if (recentTotal === null || baselineTotal === null) return null;
    const baselineRatePerDay = baselineTotal / BASELINE_DAYS;
    const z = (recentTotal - baselineRatePerDay) / Math.sqrt(Math.max(baselineRatePerDay, 0.5));
    return { score: Math.tanh(z / 10), rawMentions: recentTotal };
  }

  /** Refreshes the shared nest_sentiment_scores cache for the given universe. No-ops (leaves the
   *  existing cache as-is) if ELFA_API_KEY isn't configured — callers read stale/absent scores as
   *  neutral, never as a reason to trade. Sequential, not parallel, to stay gentle on rate limits
   *  now that this is 2 calls/symbol instead of 1. */
  async refreshCache(universe: Array<{ symbol: string; name: string; underlyingSymbol: string }>): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) return;
    const db = this.supabase.getClient();
    for (const asset of universe) {
      const result = await this.fetchZScore(apiKey, asset.name, asset.underlyingSymbol);
      if (!result) continue;
      await db
        .from('nest_sentiment_scores')
        .upsert({ symbol: asset.symbol, score: result.score, raw_mentions: result.rawMentions, computed_at: new Date().toISOString() }, { onConflict: 'symbol' })
        .then(({ error }) => {
          if (error) this.logger.error(`upsert nest_sentiment_scores(${asset.symbol}): ${error.message}`);
        });
    }
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
