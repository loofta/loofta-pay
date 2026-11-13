import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import {
  Check,
  RiskLevel,
  StageKey,
  TokenMetrics,
  buildChecks,
  failReason,
  liquidityLocked,
  passesFilters,
  riskLevel,
  riskSummary,
  stageOf,
} from './memecoin-filters';
import { MINT_RE } from './memecoin-providers';
import { clusterNarratives, Story } from './memecoin-narratives';

const FEED_WINDOW_DAYS = 7;
const CANDIDATE_LIMIT = 500;
const FRESH_MS = 10 * 60_000;
const CACHE_MS = 15_000;

export interface FeedQuery {
  safe: boolean;
  stage?: StageKey;
  lowRiskOnly: boolean;
  story?: string;
  limit: number;
}

const STORY_WINDOW_MS = 48 * 3_600_000;
const STORY_LIMIT = 8;

export interface StoryCard extends Omit<Story, 'coins'> {
  explain: string;
  passingCount: number;
  topCoins: Array<{ mint: string; name: string | null; imageUrl: string | null }>;
}

export interface MemecoinItem {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  status: 'launchpad' | 'migrated';
  stage: { key: StageKey; percent: number };
  ageMinutes: number | null;
  fresh: boolean;
  mcapUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  priceChange1h: number | null;
  dexPaid: boolean;
  liquidityLocked: boolean;
  risk: RiskLevel;
  passes: boolean;
  hiddenReason: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

export interface MemecoinDetail extends MemecoinItem {
  checks: Check[];
  riskSummary: string;
  bundlerPct: number | null;
  devPct: number | null;
}

type Row = Record<string, any>;

@Injectable()
export class MemecoinTerminalService {
  private feedCache = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly supabase: SupabaseService) {}

  private metrics(r: Row): TokenMetrics {
    return {
      status: r.status,
      curveProgress: r.curve_progress ?? null,
      volume24hUsd: r.volume_24h_usd ?? null,
      holders: r.holders ?? null,
      bundlerPct: r.bundler_pct ?? null,
      devPct: r.dev_pct ?? null,
      lpBurnPct: r.lp_burn_pct ?? null,
      dexPaid: !!r.dex_paid,
      mintAuthorityActive: r.mint_authority_active ?? null,
      freezeAuthorityActive: r.freeze_authority_active ?? null,
      rugged: r.rugged ?? null,
    };
  }

  private toItem(r: Row): MemecoinItem {
    const m = this.metrics(r);
    const since = r.migrated_at ?? r.created_at;
    const ageMs = since ? Date.now() - new Date(since).getTime() : null;
    return {
      mint: r.mint,
      name: r.name,
      symbol: r.symbol,
      imageUrl: r.image_url,
      status: r.status,
      stage: stageOf(m),
      ageMinutes: ageMs == null ? null : Math.max(0, Math.round(ageMs / 60_000)),
      fresh: ageMs != null && ageMs < FRESH_MS,
      mcapUsd: r.mcap_usd ?? null,
      volume24hUsd: m.volume24hUsd,
      holders: m.holders,
      priceChange1h: r.price_change_1h ?? null,
      dexPaid: m.dexPaid,
      liquidityLocked: liquidityLocked(m),
      risk: riskLevel(m),
      passes: passesFilters(m),
      hiddenReason: failReason(m),
      website: r.website,
      twitter: r.twitter,
      telegram: r.telegram,
    };
  }

  async feed(q: FeedQuery) {
    const key = JSON.stringify(q);
    const hit = this.feedCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

    const db = this.supabase.getClient();
    const since = new Date(Date.now() - FEED_WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await db
      .from('memecoin_tokens')
      .select('*')
      .eq('status', 'migrated')
      .gt('migrated_at', since)
      .order('migrated_at', { ascending: false })
      .limit(CANDIDATE_LIMIT);
    if (error) throw new Error(`memecoin feed: ${error.message}`);

    const all = (data ?? []).map(r => this.toItem(r));
    const storyMints = q.story ? new Set(this.storyOf(data ?? [], q.story)) : null;
    const items = all
      .filter(i => (!storyMints || storyMints.has(i.mint)))
      .filter(i => (!q.safe || i.passes) && (!q.stage || i.stage.key === q.stage) && (!q.lowRiskOnly || i.risk === 'low'))
      .sort((a, b) => Number(b.fresh) - Number(a.fresh) || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
      .slice(0, q.limit);

    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const stats = await db.from('memecoin_launch_stats').select('launches').gt('hour', dayAgo);
    const launches24h = (stats.data ?? []).reduce((a, r: Row) => a + (r.launches ?? 0), 0);
    const passed24h = all.filter(i => i.passes && (i.ageMinutes ?? Infinity) < 1440).length;

    const value = {
      items,
      meta: {
        shown: items.length,
        passedTotal: all.filter(i => i.passes).length,
        launches24h,
        hiddenToday: Math.max(0, launches24h - passed24h),
        generatedAt: new Date().toISOString(),
      },
    };
    this.feedCache.set(key, { at: Date.now(), value });
    if (this.feedCache.size > 50) this.feedCache.delete(this.feedCache.keys().next().value as string);
    return value;
  }

  private storyOf(rows: Row[], key: string): string[] {
    return this.cluster(rows).find(s => s.key === key)?.coins ?? [];
  }

  private cluster(rows: Row[]): Story[] {
    const now = Date.now();
    const coins = rows
      .filter(r => r.migrated_at && now - new Date(r.migrated_at).getTime() <= STORY_WINDOW_MS)
      .map(r => ({ mint: r.mint, name: r.name, symbol: r.symbol, migratedAt: new Date(r.migrated_at).getTime(), volume24hUsd: r.volume_24h_usd ?? null }));
    return clusterNarratives(coins, { now, limit: STORY_LIMIT });
  }

  /** The hottest stories right now, with plain-words reasons written by rule (no model involved). */
  async stories(): Promise<{ stories: StoryCard[]; generatedAt: string }> {
    const hit = this.feedCache.get('stories');
    if (hit && Date.now() - hit.at < CACHE_MS * 4) return hit.value as { stories: StoryCard[]; generatedAt: string };

    const since = new Date(Date.now() - STORY_WINDOW_MS).toISOString();
    const { data, error } = await this.supabase.getClient()
      .from('memecoin_tokens').select('*').eq('status', 'migrated').gt('migrated_at', since)
      .order('migrated_at', { ascending: false }).limit(CANDIDATE_LIMIT);
    if (error) throw new Error(`memecoin stories: ${error.message}`);
    const rows = data ?? [];
    const byMint = new Map(rows.map(r => [r.mint, this.toItem(r)]));

    const stories = this.cluster(rows).map((s): StoryCard => {
      const items = s.coins.map(m => byMint.get(m)).filter((i): i is MemecoinItem => !!i);
      const passing = items.filter(i => i.passes);
      const { coins: _coins, ...rest } = s;
      return {
        ...rest,
        explain: storyExplain(s),
        passingCount: passing.length,
        topCoins: (passing.length ? passing : items)
          .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)).slice(0, 3)
          .map(i => ({ mint: i.mint, name: i.name, imageUrl: i.imageUrl })),
      };
    });
    const value = { stories, generatedAt: new Date().toISOString() };
    this.feedCache.set('stories', { at: Date.now(), value });
    return value;
  }

  async detail(mint: string): Promise<MemecoinDetail> {
    if (!MINT_RE.test(mint)) throw new NotFoundException('Coin not found');
    const { data, error } = await this.supabase.getClient().from('memecoin_tokens').select('*').eq('mint', mint).maybeSingle();
    if (error) throw new Error(`memecoin detail: ${error.message}`);
    if (!data) throw new NotFoundException('Coin not found');
    const m = this.metrics(data);
    return {
      ...this.toItem(data),
      checks: buildChecks(m),
      riskSummary: riskSummary(m),
      bundlerPct: m.bundlerPct,
      devPct: m.devPct,
    };
  }
}

export function storyExplain(s: Pick<Story, 'kind' | 'label' | 'coinCount' | 'recentCount' | 'momentum'>): string {
  const topic = s.kind === 'theme' ? `about ${s.label.toLowerCase()}` : `with "${s.label}" in the name`;
  const base = `${s.coinCount} coins ${topic} graduated in the last two days`;
  if (s.recentCount === 0) return `${base}, but none in the last day, so it is cooling off.`;
  const trend = s.momentum >= 1.5 ? 'and it is speeding up' : s.momentum <= 0.67 ? 'but it is slowing down' : 'at a steady pace';
  return `${base}, ${s.recentCount} of them in the last day, ${trend}.`;
}
