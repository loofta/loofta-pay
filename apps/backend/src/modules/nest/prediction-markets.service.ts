import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { XStocksService } from './xstocks.service';
import { KalshiService } from './kalshi.service';
import { PredictionMarket, PredictionMarketProvider } from './prediction-market.types';

// Fan-out caps: one dashboard load shouldn't turn into dozens of upstream calls.
const MAX_COMPANIES = 8;
const MAX_PER_COMPANY = 2;

// Product call (2026-09-22): only surface markets a user can actually take a position on from
// inside the app. A card that just bounces someone to an exchange they have no account on isn't
// a feature, it's an ad — so a venue that can't be traded here contributes nothing and the
// section simply doesn't render.
//
// This currently hides everything, because the only registered venue is Kalshi and a CFTC
// exchange can't be traded through a third party. It's a filter rather than deleting the Kalshi
// provider because DFlow serves the *same Kalshi markets* tokenized as SPL tokens on Solana —
// tradeable from the wallet users already have. When that key lands, this filter stops hiding
// anything and Kalshi stays as the reference implementation of the interface.
const TRADEABLE_ONLY = true;

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
        if (TRADEABLE_ONLY && !provider.tradeable) continue;
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

  /** Markets for one company, by xStock symbol. */
  async listForSymbol(symbol: string): Promise<PredictionMarket[]> {
    const universe = await this.xstocks.getUniverse();
    const asset = universe.find(a => a.symbol === symbol);
    if (!asset) return [];
    const out: PredictionMarket[] = [];
    for (const provider of this.providers) {
      if (TRADEABLE_ONLY && !provider.tradeable) continue;
      const markets = await provider.listForCompany(asset.name, asset.underlyingSymbol).catch(() => [] as PredictionMarket[]);
      for (const m of markets) out.push({ ...m, symbol: asset.symbol });
    }
    return out;
  }
}
