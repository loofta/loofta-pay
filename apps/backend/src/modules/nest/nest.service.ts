import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { XStocksService } from './xstocks.service';
import { ElfaService, ElfaPost } from './elfa.service';

export type NestRiskTolerance = 'conservative' | 'balanced' | 'aggressive';

export interface NestProfile {
  displayName: string | null;
  riskTolerance: NestRiskTolerance;
  interestTags: string[];
  goalUsd: number | null;
}

export interface NestDepositView {
  amountUsdc: number;
  network: 'mainnet' | 'devnet';
  txHash: string;
  createdAt: string;
}

/** Weekly deposit streak. `alive` means the current week hasn't been missed yet (a week with
 *  no deposit only breaks the streak once it's over). One skipped week per rolling 4 is
 *  forgiven ("warm egg") — the forgiveness, not the counter, is what keeps people from quitting
 *  after one miss. */
export interface NestStreak {
  weeks: number;
  alive: boolean;
  freezeUsed: boolean;
  depositedThisWeek: boolean;
}

export interface NestHoldingView {
  symbol: string;
  name: string;
  units: number;
  avgCostUsd: number;
  currentPrice: number | null;
  valueUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
}

export interface NestPortfolio {
  holdings: NestHoldingView[];
  totalValueUsd: number;
  totalCostUsd: number;
  pnlUsd: number;
  pnlPct: number;
  navHistory: Array<{ date: string; totalValueUsd: number; totalCostUsd: number }>;
  /** False when every price is a last-known quote (markets closed / issuer feed down). */
  quotesLive: boolean;
}

export interface NestTradeView {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  units: number;
  priceUsd: number;
  usdValue: number;
  reason: string | null;
  txSignature: string | null;
  createdAt: string;
}

/** Written by scripts/nest-backtest/run.ts into backtest-summary.json (committed next to this
 *  file); served read-only by GET /nest/backtest. Returns are decimals, drawdown negative. */
export interface NestBacktestStats {
  grossReturn: number;
  netReturn: number;
  annualizedVol: number;
  maxDrawdown: number;
  avgWeeklyTurnover: number;
}

export interface NestBacktestSummary {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  weeks: number;
  universeSize: number;
  startingUsd: number;
  /** What the live engine actually runs: equal-weight across the tag-filtered universe. */
  liveStrategy: NestBacktestStats;
  /** Attention-tilt + turnover hysteresis — tested, lost to liveStrategy, not shipped. */
  rejectedTilt: NestBacktestStats;
  /** Attention-tilt with no hysteresis — the pre-fix allocator, kept for context only. */
  rejectedTiltNoHysteresis: NestBacktestStats;
  /** Percentile refers to rejectedTilt vs. 200 shuffles of the same signal, not liveStrategy. */
  placebo: { shuffles: number; netReturnP05: number; netReturnP50: number; netReturnP95: number; realPercentile: number };
  verdict: string;
  caveats: string[];
}

export interface NestLedgerEvent {
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  usdValue: number;
  reason: string | null;
  createdAt: string;
  post: ElfaPost | null;
}

const VALID_RISK: NestRiskTolerance[] = ['conservative', 'balanced', 'aggressive'];

@Injectable()
export class NestService {
  private readonly logger = new Logger(NestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly xstocks: XStocksService,
    private readonly elfa: ElfaService,
  ) {}

  async getProfile(userId: string): Promise<NestProfile | null> {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('nest_profiles').select('display_name, risk_tolerance, interest_tags, goal_usd').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(`getProfile: ${error.message}`);
    if (!data) return null;
    return { displayName: data.display_name, riskTolerance: data.risk_tolerance, interestTags: data.interest_tags ?? [], goalUsd: data.goal_usd === null ? null : Number(data.goal_usd) };
  }

  async upsertProfile(userId: string, riskTolerance: string, interestTags: string[], displayName?: string | null, goalUsd?: number | null): Promise<NestProfile> {
    if (!VALID_RISK.includes(riskTolerance as NestRiskTolerance)) {
      throw new BadRequestException(`riskTolerance must be one of ${VALID_RISK.join(', ')}`);
    }
    // Trim + cap length — this is free text a user types once and everyone else's UI (avatar
    // initial, header) renders forever; treat an empty/whitespace-only value as "not set" rather
    // than persisting a blank string.
    const cleanedName = displayName?.trim().slice(0, 40) || null;
    const cleanedGoal = goalUsd !== undefined && goalUsd !== null && Number.isFinite(goalUsd) && goalUsd > 0 ? Math.round(goalUsd * 100) / 100 : null;
    const db = this.supabase.getClient();
    // goal_usd is only written when the caller sent one — an onboarding/settings save that
    // doesn't mention the goal must not wipe an existing one.
    const row: Record<string, unknown> = { user_id: userId, display_name: cleanedName, risk_tolerance: riskTolerance, interest_tags: interestTags, updated_at: new Date().toISOString() };
    if (goalUsd !== undefined) row.goal_usd = cleanedGoal;
    const { data, error } = await db.from('nest_profiles').upsert(row, { onConflict: 'user_id' }).select('goal_usd').single();
    if (error) throw new Error(`upsertProfile: ${error.message}`);
    return { displayName: cleanedName, riskTolerance: riskTolerance as NestRiskTolerance, interestTags, goalUsd: data?.goal_usd === null || data?.goal_usd === undefined ? null : Number(data.goal_usd) };
  }

  async getDeposits(userId: string): Promise<NestDepositView[]> {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('nest_deposits').select('amount_usdc, network, tx_hash, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(`getDeposits: ${error.message}`);
    return (data ?? []).map(r => ({ amountUsdc: Number(r.amount_usdc), network: r.network, txHash: r.tx_hash, createdAt: r.created_at }));
  }

  async getStreak(userId: string): Promise<NestStreak> {
    const deposits = await this.getDeposits(userId);
    const WEEK_MS = 7 * 24 * 60 * 60_000;
    // Week index relative to a fixed Monday epoch (1970-01-05 was a Monday), UTC.
    const weekOf = (t: number) => Math.floor((t - 4 * 24 * 60 * 60_000) / WEEK_MS);
    const thisWeek = weekOf(Date.now());
    const weeks = new Set(deposits.map(d => weekOf(new Date(d.createdAt).getTime())));
    const depositedThisWeek = weeks.has(thisWeek);

    // Walk back from the most recent completed-or-current week with a deposit, allowing one
    // skipped week per rolling 4 (the "warm egg" freeze).
    let cursor = depositedThisWeek ? thisWeek : thisWeek - 1;
    let count = 0;
    let freezeUsed = false;
    let lastFreezeAt: number | null = null;
    while (true) {
      if (weeks.has(cursor)) {
        count++;
        cursor--;
        continue;
      }
      const canFreeze = count > 0 && (lastFreezeAt === null || lastFreezeAt - cursor >= 4);
      if (canFreeze && weeks.has(cursor - 1)) {
        freezeUsed = true;
        lastFreezeAt = cursor;
        cursor--;
        continue;
      }
      break;
    }
    const alive = count > 0;
    return { weeks: count, alive, freezeUsed, depositedThisWeek };
  }

  async getPortfolio(userId: string): Promise<NestPortfolio> {
    const db = this.supabase.getClient();
    const [{ data: holdingsRows, error: holdingsErr }, { data: navRows, error: navErr }] = await Promise.all([
      // neq, not gt: a negative USD row (cash overdrawn by a past rebalance bug) must still count
      // against total value rather than silently disappearing from the dashboard.
      db.from('nest_holdings').select('symbol, units, avg_cost_usd').eq('user_id', userId).neq('units', 0),
      db.from('nest_nav_snapshots').select('snapshot_date, total_value_usd, total_cost_usd').eq('user_id', userId).order('snapshot_date', { ascending: true }).limit(365),
    ]);
    if (holdingsErr) throw new Error(`getPortfolio holdings: ${holdingsErr.message}`);
    if (navErr) throw new Error(`getPortfolio nav: ${navErr.message}`);

    const universe = await this.xstocks.getUniverse();
    const nameBySymbol = new Map(universe.map(a => [a.symbol, a.name]));
    // 'USD' is the cash holding a deposit credits before the next rebalance buys anything with
    // it (see nest-deposit.service.ts's verifyAndCredit) — not a real xStock ticker, so it has
    // no price to look up and is always worth exactly its own unit count.
    const symbols = (holdingsRows ?? []).map(r => r.symbol).filter(s => s !== 'USD');
    const { prices, live: quotesLive } = await this.xstocks.getPricesWithMeta(symbols);

    let totalValueUsd = 0;
    let totalCostUsd = 0;
    const holdings: NestHoldingView[] = (holdingsRows ?? []).map(row => {
      const units = Number(row.units);
      const avgCostUsd = Number(row.avg_cost_usd);
      const livePrice = prices.get(row.symbol);
      const currentPrice = row.symbol === 'USD' ? 1 : livePrice && livePrice > 0 ? livePrice : null;
      // A position whose live quote failed on this call is still worth roughly what it cost —
      // valuing it at $0 while still counting its cost manufactured a phantom -30% on the
      // dashboard whenever a few Backed price calls were rate-limited. currentPrice stays null so
      // the UI can flag "quote unavailable" without the total collapsing.
      const valueUsd = units * (currentPrice ?? avgCostUsd);
      const costUsd = units * avgCostUsd;
      totalValueUsd += valueUsd;
      totalCostUsd += costUsd;
      return {
        symbol: row.symbol,
        name: row.symbol === 'USD' ? 'Cash' : nameBySymbol.get(row.symbol) ?? row.symbol,
        units,
        avgCostUsd,
        currentPrice,
        valueUsd,
        pnlUsd: valueUsd - costUsd,
        pnlPct: costUsd > 0 ? (valueUsd - costUsd) / costUsd : null,
      };
    });

    return {
      holdings,
      totalValueUsd,
      totalCostUsd,
      pnlUsd: totalValueUsd - totalCostUsd,
      pnlPct: totalCostUsd > 0 ? (totalValueUsd - totalCostUsd) / totalCostUsd : 0,
      navHistory: (navRows ?? []).map(r => ({ date: r.snapshot_date, totalValueUsd: Number(r.total_value_usd), totalCostUsd: Number(r.total_cost_usd) })),
      quotesLive: symbols.length === 0 ? true : quotesLive,
    };
  }

  async getHistory(userId: string, limit = 100): Promise<NestTradeView[]> {
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('nest_trades')
      .select('id, symbol, side, units, price_usd, usd_value, reason, tx_signature, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`getHistory: ${error.message}`);
    return (data ?? []).map(r => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      units: Number(r.units),
      priceUsd: Number(r.price_usd),
      usdValue: Number(r.usd_value),
      reason: r.reason,
      txSignature: r.tx_signature,
      createdAt: r.created_at,
    }));
  }

  /** Powers the "Rebalanced on real headlines" ledger with real data end to end: the caller's
   *  own actual trades (most recent per symbol, real $ amounts and real elfa-score reasons —
   *  see nest-rebalance.service.ts), each paired with the most recent real X post elfa has
   *  indexed for that ticker (link + author + engagement — a real post to click through to, not
   *  a fabricated headline; see ElfaService.getRecentPost for why). */
  async getLedger(userId: string, limit = 4): Promise<NestLedgerEvent[]> {
    const trades = await this.getHistory(userId, 30);
    const seenSymbols = new Set<string>();
    const distinct: NestTradeView[] = [];
    for (const t of trades) {
      if (seenSymbols.has(t.symbol)) continue;
      seenSymbols.add(t.symbol);
      distinct.push(t);
      if (distinct.length >= limit) break;
    }
    if (distinct.length === 0) return [];

    const universe = await this.xstocks.getUniverse();
    const bySymbol = new Map(universe.map(a => [a.symbol, a]));
    const posts = await Promise.all(
      distinct.map(t => {
        const asset = bySymbol.get(t.symbol);
        return asset ? this.elfa.getRecentPost(asset.symbol, asset.name, asset.underlyingSymbol) : Promise.resolve(null);
      }),
    );

    return distinct.map((t, i) => ({
      symbol: t.symbol,
      name: bySymbol.get(t.symbol)?.name ?? t.symbol,
      side: t.side,
      usdValue: t.usdValue,
      reason: t.reason,
      createdAt: t.createdAt,
      post: posts[i],
    }));
  }
}
