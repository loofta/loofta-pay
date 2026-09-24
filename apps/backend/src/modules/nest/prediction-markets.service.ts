import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { XStocksService } from './xstocks.service';
import { KalshiService } from './kalshi.service';
import { PreStocksService } from './prestocks.service';
import { PredictionMarket, PredictionMarketProvider } from './prediction-market.types';

// Fan-out caps: one dashboard load shouldn't turn into dozens of upstream calls.
const MAX_COMPANIES = 8;
const MAX_PER_COMPANY = 2;

// Was TRADEABLE_ONLY (2026-09-22), hiding every venue that could only be linked out to. Dropped
// 2026-09-23 now that betting happens in-app as a practice bet (PredictionBetsService): the
// market data is real and the position is simulated, so "can this venue take a real order from
// us" no longer decides whether a question is worth showing. `tradeable` is still carried on
// each market — it's what a real-money path (DFlow's tokenized Kalshi markets) would switch on.

/**
 * The single place the rest of the app asks "what can my user bet on?", across every venue.
 * Callers get PredictionMarket objects and never learn which venue answered — that's what lets
 * the UI show one Yes/No affordance whether the position ends up on Kalshi (link out today) or
 * as an SPL token via DFlow (in-app, once built).
 *
 * Providers are registered in `providers` below. A venue that's slow or down contributes nothing
 * rather than failing the request, so the section degrades to fewer cards instead of an error.
 */
@Injectable()
export class PredictionMarketsService {
  private readonly logger = new Logger(PredictionMarketsService.name);
  private readonly providers: PredictionMarketProvider[];

  constructor(
    private readonly supabase: SupabaseService,
    private readonly xstocks: XStocksService,
    kalshi: KalshiService,
    private readonly prestocks: PreStocksService,
  ) {
    // Order matters only for presentation: tradeable venues should lead once one exists, since
    // "you can act on this here" beats "open this elsewhere".
    this.providers = [kalshi];
  }

  /** Markets across the companies this user actually holds. */
  async listForUser(ledgerUserId: string): Promise<PredictionMarket[]> {
    const { data: holdings, error } = await this.supabase
      .getClient()
      .from('nest_holdings')
      .select('symbol, units')
      .eq('user_id', ledgerUserId)
      .gt('units', 0)
      .neq('symbol', 'USD');
    if (error) {
      this.logger.error(`listForUser holdings: ${error.message}`);
      return [];
    }

    const held = new Set((holdings ?? []).map(h => h.symbol));
    const universe = await this.xstocks.getUniverse();
    const assets = universe.filter(a => held.has(a.symbol)).slice(0, MAX_COMPANIES);

    const out: PredictionMarket[] = [];
    for (const asset of assets) {
      for (const provider of this.providers) {
        const markets = await provider.listForCompany(asset.name, asset.underlyingSymbol).catch(e => {
          this.logger.warn(`${provider.venue}.listForCompany(${asset.symbol}): ${e.message}`);
          return [] as PredictionMarket[];
        });
        // The provider doesn't know which holding prompted the lookup; stamp it here so the UI
        // can show the company's logo next to its market.
        for (const m of markets.slice(0, MAX_PER_COMPANY)) out.push({ ...m, symbol: asset.symbol });
      }
    }
    // Tradeable first, then least-certain — a market someone can actually act on, where the
    // outcome is genuinely open, is the most useful thing to lead with.
    out.sort((a, b) => Number(b.tradeable) - Number(a.tradeable) || Math.abs((a.yesPrice ?? 0.5) - 0.5) - Math.abs((b.yesPrice ?? 0.5) - 0.5));
    return out;
  }

  /**
   * One market by its venue-qualified id. This is how a bet gets its price: the stake comes from
   * the client but the odds never do, so a stale card or a tampered request can't lock in a price
   * that was never on offer.
   *
   * Ids look like "kalshi:KXMETA-26OCTHEAD-69000", and the venue prefix picks the provider. No
   * venue offers a per-id lookup yet, so this searches a company's market list — which is why
   * `symbolHint` matters: with it, one company is checked, without it every name in the universe
   * is, which on a cold cache is ~88 upstream round trips. The hint only narrows the search; it
   * can't influence the price, which always comes from the provider.
   */
  async findById(marketId: string, symbolHint?: string | null): Promise<PredictionMarket | null> {
    const venue = marketId.split(':')[0];
    const provider = this.providers.find(p => p.venue === venue);
    if (!provider) return null;

    // Pre-IPO companies aren't in the xStocks universe; their markets are looked up by the fixed
    // Kalshi series they belong to. The hint only picks which lookup runs, never the price.
    if (symbolHint && this.prestocks.hasMarketSeries(symbolHint)) {
      const hit = await this.prestocks.findMarket(symbolHint, marketId);
      if (hit) return hit;
    }

    const universe = await this.xstocks.getUniverse();
    const hinted = symbolHint ? universe.filter(a => a.symbol === symbolHint) : [];
    // Hinted company first, then everything else as a fallback for a stale or missing hint.
    const search = [...hinted, ...universe.filter(a => a.symbol !== symbolHint)];

    for (const asset of search) {
      const markets = await provider.listForCompany(asset.name, asset.underlyingSymbol).catch(() => [] as PredictionMarket[]);
      const hit = markets.find(m => m.id === marketId);
      if (hit) return { ...hit, symbol: asset.symbol };
    }
    return null;
  }

  /** Markets for one company, by xStock symbol. */
  async listForSymbol(symbol: string): Promise<PredictionMarket[]> {
    const universe = await this.xstocks.getUniverse();
    const asset = universe.find(a => a.symbol === symbol);
    if (!asset) return [];
    const out: PredictionMarket[] = [];
    for (const provider of this.providers) {
      const markets = await provider.listForCompany(asset.name, asset.underlyingSymbol).catch(() => [] as PredictionMarket[]);
      for (const m of markets) out.push({ ...m, symbol: asset.symbol });
    }
    return out;
  }
}

