import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { XStocksService, NestUniverseAsset } from './xstocks.service';
import { ElfaService } from './elfa.service';
import { NestRebalanceService } from './nest-rebalance.service';
import { NestRiskTolerance } from './nest.service';

// A single-day move at least this large on an xStock is not normal noise for a liquid large-cap
// — it's the kind of thing a hack/lawsuit/major announcement produces, which is exactly the
// "big news" case this feature targets (see the 2026-09-21 pivot away from using attention/
// sentiment volume as a trading signal — RESULTS.md). Detection is price-based and objective;
// Elfa is only used afterward, to explain a move that has already happened.
const BIG_MOVE_THRESHOLD = 0.07;
// How far back to look for the news behind a detected move — a move can lag the triggering
// event by up to a couple of days once it works through order flow.
const EVENT_LOOKBACK_DAYS = 3;
const SUGGESTION_TTL_HOURS = 48;

export interface NestSuggestionView {
  id: string;
  symbol: string;
  action: 'trim' | 'buy_dip';
  deltaUsd: number;
  movePct: number;
  reason: string;
  sourceLinks: string[];
  createdAt: string;
  expiresAt: string;
}

interface CandidateUser {
  ledgerUserId: string;
  riskTolerance: NestRiskTolerance;
  interestTags: string[];
  navUsd: number;
  symbolValueUsd: number;
}

/**
 * "Suggest, don't auto-trade": when a symbol a user actually holds makes a real, large one-day
 * move, this surfaces a suggested rebalance action (trim the winner back to target, or buy the
 * dip back to target) with the real news context behind it — the user explicitly accepts or
 * dismisses it via NestController; nothing here executes anything on its own. Detection is
 * price-move-based (objective, free, already-fetched data); Elfa's event-summary is only called
 * to explain a move that already happened, once per moving symbol, never per user.
 */
@Injectable()
export class NestSuggestionsService {
  private readonly logger = new Logger(NestSuggestionsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly xstocks: XStocksService,
    private readonly elfa: ElfaService,
    private readonly rebalance: NestRebalanceService,
  ) {}

  /**
   * Cron entry point. For every symbol that moved >= BIG_MOVE_THRESHOLD since its last stored
   * close, find every user actually holding it, work out whether they're now overweight
   * (trim) or underweight (buy the dip) versus their own target, and insert one suggestion per
   * (user, event) — deduped so a re-scan before expiry never spams a second row for the same move.
   */
  async scanForEvents(): Promise<void> {
    const universe = await this.xstocks.getUniverse();
    if (universe.length === 0) return;

    const symbols = universe.map(a => a.symbol);
    const [{ prices: currentPrices }, priorPrices] = await Promise.all([this.xstocks.getPricesWithMeta(symbols), this.xstocks.getPriorPrices(symbols)]);
    // Persist today's close regardless of whether anything moved — this is also the seed of the
    // historical dataset future strategy R&D will use, independent of this feature.
    await this.xstocks.recordPriceHistory(currentPrices);

    const movers: Array<{ asset: NestUniverseAsset; price: number; movePct: number }> = [];
    for (const asset of universe) {
      const price = currentPrices.get(asset.symbol);
      const prior = priorPrices.get(asset.symbol);
      if (!price || !prior) continue;
      const movePct = (price - prior) / prior;
      if (Math.abs(movePct) >= BIG_MOVE_THRESHOLD) movers.push({ asset, price, movePct });
    }
    if (movers.length === 0) return;
    this.logger.log(`scanForEvents: ${movers.length} big move(s) — ${movers.map(m => `${m.asset.symbol} ${(m.movePct * 100).toFixed(1)}%`).join(', ')}`);

    const db = this.supabase.getClient();
    const today = new Date().toISOString().slice(0, 10);

    for (const { asset, price, movePct } of movers) {
      const holders = await this.holdersOf(asset.symbol, price);
      if (holders.length === 0) continue;

      // One event-summary call per moving symbol, not per holder.
      const sinceUnix = Math.floor(Date.now() / 1000) - EVENT_LOOKBACK_DAYS * 86400;
      const event = await this.elfa.getRecentEventSummary(asset.name, asset.underlyingSymbol, sinceUnix).catch(e => {
        this.logger.warn(`getRecentEventSummary(${asset.symbol}) failed: ${e.message}`);
        return null;
      });
      const direction = movePct >= 0 ? 'up' : 'down';
      const reason = event?.summary ?? `${asset.name} moved ${direction} ${(Math.abs(movePct) * 100).toFixed(1)}% today — no news summary available yet.`;
      const sourceLinks = event?.sourceLinks ?? [];

      const rows = holders
        .map(h => {
          const targetWeights = this.rebalance.computeTargetWeights({ userId: h.ledgerUserId, riskTolerance: h.riskTolerance, interestTags: h.interestTags }, universe);
          const targetUsd = (targetWeights.get(asset.symbol) ?? 0) * h.navUsd;
          return { h, deltaUsd: targetUsd - h.symbolValueUsd };
        })
        .filter(({ deltaUsd }) => Math.abs(deltaUsd) >= 2)
        .map(({ h, deltaUsd }) => ({
          user_id: h.ledgerUserId,
          symbol: asset.symbol,
          event_key: `${asset.symbol}:${today}`,
          action: deltaUsd < 0 ? 'trim' : 'buy_dip',
          delta_usd: Math.round(deltaUsd * 100) / 100,
          move_pct: Math.round(movePct * 10000) / 10000,
          reason,
          source_links: sourceLinks,
          expires_at: new Date(Date.now() + SUGGESTION_TTL_HOURS * 60 * 60_000).toISOString(),
        }));
      if (rows.length === 0) continue;

      const { error } = await db.from('nest_suggestions').upsert(rows, { onConflict: 'user_id,event_key', ignoreDuplicates: true });
      if (error) this.logger.error(`insert suggestions(${asset.symbol}): ${error.message}`);
    }
  }

  /** Every user who currently holds `symbol` (a real position, not the USD cash row), with each
   *  holder's real NAV (every position, not just this symbol) so the target-weight delta below
   *  is computed against their actual portfolio, not just this one position's own value.
   *  `price` is the symbol's already-fetched current quote — reused here for that symbol rather
   *  than re-fetched. */
  private async holdersOf(symbol: string, price: number): Promise<CandidateUser[]> {
    const db = this.supabase.getClient();
    const { data: symbolRows, error } = await db.from('nest_holdings').select('user_id').eq('symbol', symbol).gt('units', 0);
    if (error) {
      this.logger.error(`holdersOf(${symbol}): ${error.message}`);
      return [];
    }
    if (!symbolRows?.length) return [];
    const userIds = [...new Set(symbolRows.map(r => r.user_id))];

    const [{ data: profiles }, { data: allHoldings }] = await Promise.all([
      db.from('nest_profiles').select('user_id, risk_tolerance, interest_tags').in('user_id', userIds),
      db.from('nest_holdings').select('user_id, symbol, units, avg_cost_usd').in('user_id', userIds),
    ]);
    const profileByUser = new Map((profiles ?? []).map(p => [p.user_id, p]));
    const holdingsByUser = new Map<string, Array<{ symbol: string; units: number; avgCostUsd: number }>>();
    for (const r of allHoldings ?? []) {
      if (!holdingsByUser.has(r.user_id)) holdingsByUser.set(r.user_id, []);
      holdingsByUser.get(r.user_id)!.push({ symbol: r.symbol, units: Number(r.units), avgCostUsd: Number(r.avg_cost_usd) });
    }

    // Every other symbol these holders own also needs a price to value NAV correctly.
    const otherSymbols = [...new Set((allHoldings ?? []).map(r => r.symbol).filter(s => s !== 'USD' && s !== symbol))];
    const priceMap = otherSymbols.length ? await this.xstocks.getPrices(otherSymbols) : new Map<string, number>();
    priceMap.set(symbol, price);

    const out: CandidateUser[] = [];
    for (const userId of userIds) {
      const profile = profileByUser.get(userId);
      if (!profile) continue;
      const holdings = holdingsByUser.get(userId) ?? [];
      const navUsd = holdings.reduce((sum, h) => sum + h.units * (h.symbol === 'USD' ? 1 : priceMap.get(h.symbol) ?? h.avgCostUsd), 0);
      if (!(navUsd > 0)) continue;
      const symbolValueUsd = holdings.filter(h => h.symbol === symbol).reduce((sum, h) => sum + h.units * price, 0);
      out.push({ ledgerUserId: userId, riskTolerance: profile.risk_tolerance, interestTags: profile.interest_tags ?? [], navUsd, symbolValueUsd });
    }
    return out;
  }

  async listForUser(ledgerUserId: string): Promise<NestSuggestionView[]> {
    const db = this.supabase.getClient();
    await db.from('nest_suggestions').update({ status: 'expired' }).eq('user_id', ledgerUserId).eq('status', 'pending').lt('expires_at', new Date().toISOString());
    const { data, error } = await db
      .from('nest_suggestions')
      .select('id, symbol, action, delta_usd, move_pct, reason, source_links, created_at, expires_at')
      .eq('user_id', ledgerUserId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listForUser: ${error.message}`);
    return (data ?? []).map(r => ({
      id: r.id,
      symbol: r.symbol,
      action: r.action,
      deltaUsd: Number(r.delta_usd),
      movePct: Number(r.move_pct),
      reason: r.reason,
      sourceLinks: r.source_links ?? [],
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }

  /** Recomputes the delta fresh at accept-time (price/holdings may have drifted since the
   *  suggestion was created) rather than trusting the stored delta_usd, then executes it. */
  async accept(ledgerUserId: string, id: string): Promise<{ executed: boolean }> {
    const db = this.supabase.getClient();
    const { data: suggestion, error } = await db.from('nest_suggestions').select('*').eq('id', id).eq('user_id', ledgerUserId).eq('status', 'pending').maybeSingle();
    if (error) throw new Error(`accept: ${error.message}`);
    if (!suggestion) throw new NotFoundException('Suggestion not found or already resolved');

    const [universe, profileRow, holdingRow] = await Promise.all([
      this.xstocks.getUniverse(),
      db.from('nest_profiles').select('risk_tolerance, interest_tags').eq('user_id', ledgerUserId).maybeSingle().then(r => r.data),
      db.from('nest_holdings').select('symbol, units, avg_cost_usd').eq('user_id', ledgerUserId),
    ]);
    if (!profileRow) throw new NotFoundException('Set up your nest first');

    const holdings = holdingRow.data ?? [];
    const prices = await this.xstocks.getPrices(holdings.map((h: any) => h.symbol));
    const navUsd = holdings.reduce((sum: number, h: any) => sum + Number(h.units) * (h.symbol === 'USD' ? 1 : prices.get(h.symbol) ?? Number(h.avg_cost_usd)), 0);
    const targetWeights = this.rebalance.computeTargetWeights({ userId: ledgerUserId, riskTolerance: profileRow.risk_tolerance, interestTags: profileRow.interest_tags ?? [] }, universe);
    const symbolHolding = holdings.find((h: any) => h.symbol === suggestion.symbol);
    const currentUsd = symbolHolding ? Number(symbolHolding.units) * (prices.get(suggestion.symbol) ?? Number(symbolHolding.avg_cost_usd)) : 0;
    const freshDeltaUsd = (targetWeights.get(suggestion.symbol) ?? 0) * navUsd - currentUsd;

    let executed = false;
    if (Math.abs(freshDeltaUsd) >= 2) {
      await this.rebalance.executeSingleTrade(ledgerUserId, suggestion.symbol, freshDeltaUsd);
      executed = true;
    }
    const { error: resolveErr } = await db.from('nest_suggestions').update({ status: 'accepted', resolved_at: new Date().toISOString() }).eq('id', id);
    if (resolveErr) this.logger.error(`accept resolve(${id}): ${resolveErr.message}`);
    return { executed };
  }

  async dismiss(ledgerUserId: string, id: string): Promise<void> {
    const { error, data } = await this.supabase
      .getClient()
      .from('nest_suggestions')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', ledgerUserId)
      .eq('status', 'pending')
      .select('id');
    if (error) throw new Error(`dismiss: ${error.message}`);
    if (!data?.length) throw new NotFoundException('Suggestion not found or already resolved');
  }
}
