import { Injectable, Logger } from '@nestjs/common';
import { PredictionMarket, PredictionMarketProvider, PredictionVenue } from './prediction-market.types';

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
// Corporate-event market series (CEO changes, KPI/earnings, product launches, M&A) don't come
// and go fast — refresh the ~1,000-series Financials catalog at most a few times a day. Market
// pricing/status within a matched series moves faster, so that's cached separately and shorter.
const SERIES_CACHE_TTL_MS = 12 * 60 * 60_000;
const MARKETS_CACHE_TTL_MS = 30 * 60_000;
const MAX_SERIES_PER_COMPANY = 5;
const MAX_MARKETS_RETURNED = 4;

export interface KalshiMarketView {
  ticker: string;
  title: string;
  yesPrice: number | null; // 0-1, current "Yes" bid — an implied probability, not a Loofta view
  closeTime: string | null;
  url: string;
}

interface RawKalshiSeries {
  ticker: string;
  title: string;
}

/**
 * "Event-shaped" prediction markets, not price-direction ones (there's no Kalshi equivalent of
 * Polymarket's per-stock up/down contracts — checked live, 2026-09-21). What Kalshi actually has,
 * confirmed against its live public API, is real CEO-change / KPI-earnings / product-launch /
 * M&A markets on most of our universe's companies — genuinely useful as "here's a real market on
 * this" context next to a suggestion, without us predicting anything ourselves. Read-only, public,
 * no API key needed (Kalshi's market/series data is unauthenticated).
 */
@Injectable()
export class KalshiService implements PredictionMarketProvider {
  readonly venue: PredictionVenue = 'kalshi';
  // Kalshi is a CFTC-regulated exchange: an order needs the user's own KYC'd, funded account
  // signed with their own credentials, so all we can honestly offer is a link out. DFlow's
  // tokenized version of these same markets is what would flip this to true.
  readonly tradeable = false;

  private readonly logger = new Logger(KalshiService.name);
  private seriesCache: { fetchedAt: number; series: RawKalshiSeries[] } | null = null;
  private readonly marketsCache = new Map<string, { fetchedAt: number; markets: KalshiMarketView[] }>();

  private async loadFinancialsSeries(): Promise<RawKalshiSeries[]> {
    if (this.seriesCache && Date.now() - this.seriesCache.fetchedAt < SERIES_CACHE_TTL_MS) return this.seriesCache.series;
    const all: RawKalshiSeries[] = [];
    let cursor = '';
    try {
      for (let page = 0; page < 10; page++) {
        const url = `${KALSHI_API_BASE}/series?category=Financials&limit=200${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) break;
        const body: any = await res.json();
        const batch: RawKalshiSeries[] = Array.isArray(body?.series) ? body.series.map((s: any) => ({ ticker: s.ticker, title: s.title })) : [];
        all.push(...batch);
        cursor = body?.cursor ?? '';
        if (!cursor || batch.length === 0) break;
      }
    } catch (e: any) {
      this.logger.warn(`loadFinancialsSeries failed: ${e.message} — using whatever was fetched (${all.length} series)`);
    }
    this.seriesCache = { fetchedAt: Date.now(), series: all };
    return all;
  }

  /** Series whose title plausibly refers to this company — first significant word of its display
   *  name (e.g. "apple", "tesla"), matched as a whole word. A soft, best-effort link, not a hard
   *  guarantee of relevance — good enough for "here's a related market," reviewed by the user
   *  themselves before they act on it.
   *
   *  The closing \b matters: a prefix match on "intel" also hits "Intellia Therapeutics", which
   *  surfaced an FDA drug-approval market under Intel (observed live, 2026-09-22). Whole-word
   *  matching keeps "Intel Corporation" and drops "Intellia". */
  private matchSeries(allSeries: RawKalshiSeries[], companyName: string): RawKalshiSeries[] {
    const key = companyName.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '');
    if (key.length < 3) return [];
    const re = new RegExp(`\\b${key}\\b`, 'i');
    return allSeries.filter(s => re.test(s.title) || re.test(s.ticker)).slice(0, MAX_SERIES_PER_COMPANY);
  }

  /** Live, open Kalshi markets for a company, most-liquid first. Never throws — an empty array
   *  means "nothing relevant found," not an error, so callers can render nothing rather than a
   *  broken widget. */
  async getMarketsForCompany(companyName: string, underlyingSymbol: string): Promise<KalshiMarketView[]> {
    const cached = this.marketsCache.get(underlyingSymbol);
    if (cached && Date.now() - cached.fetchedAt < MARKETS_CACHE_TTL_MS) return cached.markets;

    const out: KalshiMarketView[] = [];
    try {
      const allSeries = await this.loadFinancialsSeries();
      const matched = this.matchSeries(allSeries, companyName);
      for (const series of matched) {
        const res = await fetch(`${KALSHI_API_BASE}/markets?series_ticker=${series.ticker}&status=open&limit=20`);
        if (!res.ok) continue;
        const body: any = await res.json();
        const markets: KalshiMarketView[] = (body?.markets ?? []).map((m: any) => {
          const yesPrice = Number(m.yes_bid_dollars);
          return {
            ticker: m.ticker,
            title: m.title || series.title,
            yesPrice: Number.isFinite(yesPrice) ? yesPrice : null,
            closeTime: m.close_time ?? null,
            url: `https://kalshi.com/markets/${series.ticker.toLowerCase()}`,
          };
        });
        if (markets.length === 0) continue;
        // One market per series, not the whole threshold ladder. A series like "Meta ad
        // impressions growth" lists the same question at 8%/18%/20%/22%, and showing all four is
        // noise — worse, the extremes (95% yes, 2% yes) are effectively settled and carry no
        // information. Pick the one the crowd is least sure about, which is the only genuinely
        // interesting cut of that question.
        const best = markets.reduce((a, b) => (Math.abs((a.yesPrice ?? 0.5) - 0.5) <= Math.abs((b.yesPrice ?? 0.5) - 0.5) ? a : b));
        out.push(best);
      }
    } catch (e: any) {
      this.logger.warn(`getMarketsForCompany(${underlyingSymbol}) failed: ${e.message}`);
    }
    // Most-uncertain first across series, same reasoning as the per-series pick above.
    out.sort((a, b) => Math.abs((a.yesPrice ?? 0.5) - 0.5) - Math.abs((b.yesPrice ?? 0.5) - 0.5));
    const trimmed = out.slice(0, MAX_MARKETS_RETURNED);
    this.marketsCache.set(underlyingSymbol, { fetchedAt: Date.now(), markets: trimmed });
    return trimmed;
  }

  /** PredictionMarketProvider surface — the venue-agnostic shape the UI actually renders. */
  async listForCompany(companyName: string, underlyingSymbol: string): Promise<PredictionMarket[]> {
    const markets = await this.getMarketsForCompany(companyName, underlyingSymbol);
    return markets.map(m => ({
      id: `${this.venue}:${m.ticker}`,
      venue: this.venue,
      symbol: null, // filled in by the aggregator, which knows which holding this came from
      question: m.title,
      yesPrice: m.yesPrice,
      closeTime: m.closeTime,
      tradeable: this.tradeable,
      url: m.url,
    }));
  }
}
