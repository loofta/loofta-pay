import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { XStocksService } from './xstocks.service';
import { ElfaService, ElfaPost } from './elfa.service';

export type NestRiskTolerance = 'conservative' | 'balanced' | 'aggressive';

export interface NestProfile {
  displayName: string | null;
  riskTolerance: NestRiskTolerance;
  interestTags: string[];
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
    const { data, error } = await db.from('nest_profiles').select('display_name, risk_tolerance, interest_tags').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(`getProfile: ${error.message}`);
    if (!data) return null;
    return { displayName: data.display_name, riskTolerance: data.risk_tolerance, interestTags: data.interest_tags ?? [] };
  }

  async upsertProfile(userId: string, riskTolerance: string, interestTags: string[], displayName?: string | null): Promise<NestProfile> {
    if (!VALID_RISK.includes(riskTolerance as NestRiskTolerance)) {
      throw new BadRequestException(`riskTolerance must be one of ${VALID_RISK.join(', ')}`);
    }
    // Trim + cap length — this is free text a user types once and everyone else's UI (avatar
    // initial, header) renders forever; treat an empty/whitespace-only value as "not set" rather
    // than persisting a blank string.
    const cleanedName = displayName?.trim().slice(0, 40) || null;
    const db = this.supabase.getClient();
    const { error } = await db
      .from('nest_profiles')
      .upsert(
        { user_id: userId, display_name: cleanedName, risk_tolerance: riskTolerance, interest_tags: interestTags, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) throw new Error(`upsertProfile: ${error.message}`);
    return { displayName: cleanedName, riskTolerance: riskTolerance as NestRiskTolerance, interestTags };
  }

  async getPortfolio(userId: string): Promise<NestPortfolio> {
    const db = this.supabase.getClient();
    const [{ data: holdingsRows, error: holdingsErr }, { data: navRows, error: navErr }] = await Promise.all([
      db.from('nest_holdings').select('symbol, units, avg_cost_usd').eq('user_id', userId).gt('units', 0),
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
    const prices = await this.xstocks.getPrices(symbols);

    let totalValueUsd = 0;
    let totalCostUsd = 0;
    const holdings: NestHoldingView[] = (holdingsRows ?? []).map(row => {
      const units = Number(row.units);
      const avgCostUsd = Number(row.avg_cost_usd);
      const currentPrice = row.symbol === 'USD' ? 1 : prices.get(row.symbol) ?? null;
      const valueUsd = currentPrice !== null ? units * currentPrice : null;
      const costUsd = units * avgCostUsd;
      if (valueUsd !== null) totalValueUsd += valueUsd;
      totalCostUsd += costUsd;
      return {
        symbol: row.symbol,
        name: row.symbol === 'USD' ? 'Cash' : nameBySymbol.get(row.symbol) ?? row.symbol,
        units,
        avgCostUsd,
        currentPrice,
        valueUsd,
        pnlUsd: valueUsd !== null ? valueUsd - costUsd : null,
        pnlPct: valueUsd !== null && costUsd > 0 ? (valueUsd - costUsd) / costUsd : null,
      };
    });

    return {
      holdings,
      totalValueUsd,
      totalCostUsd,
      pnlUsd: totalValueUsd - totalCostUsd,
      pnlPct: totalCostUsd > 0 ? (totalValueUsd - totalCostUsd) / totalCostUsd : 0,
      navHistory: (navRows ?? []).map(r => ({ date: r.snapshot_date, totalValueUsd: Number(r.total_value_usd), totalCostUsd: Number(r.total_cost_usd) })),
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
        return asset ? this.elfa.getRecentPost(asset.underlyingSymbol) : Promise.resolve(null);
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
