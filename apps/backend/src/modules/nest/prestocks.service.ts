import { Injectable, Logger } from '@nestjs/common';
import { KalshiService } from './kalshi.service';
import { PredictionMarket } from './prediction-market.types';

const PRESTOCKS_API = 'https://prestocks.com/api/prestocks';
const CACHE_MS = 60_000;

/**
 * PreStocks symbol -> the Kalshi series that asks when that company IPOs. Only companies with a
 * real series are listed; the rest simply show no market rather than a fuzzy guess. Checked against
 * Kalshi's live series list 2026-09-24. KXIPOSPACEX exists but had no open markets that day, which
 * is fine: it resolves to "no market" until Kalshi lists strikes again.
 */
const IPO_SERIES: Record<string, string> = {
  ANTHROPIC: 'KXIPOANTHROPIC',
  OPENAI: 'KXIPOOPENAI',
  ANDURIL: 'KXIPOANDURIL',
  SPACEX: 'KXIPOSPACEX',
};

interface RawPreStock {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  contract_address: string;
  markPrice: number;
  markValuation: number;
  tokenPrice: number;
  impliedValuation: number;
  supply: number;
}

export interface PreIpoAsset {
  symbol: string;
  name: string;
  blurb: string;
  logoUrl: string;
  url: string;
  mint: string;
  /** PreStocks' own reference price for the company's share. */
  markPriceUsd: number;
  /** What the token is actually trading at. */
  tokenPriceUsd: number;
  /** Token vs mark, in percent: positive means the token trades above the reference price. */
  premiumPct: number;
  valuationUsd: number;
  impliedValuationUsd: number;
  /** Kalshi's IPO-timing market for this company, the least-settled strike, or null. */
  market: PredictionMarket | null;
}

export interface PreIpoResponse {
  assets: PreIpoAsset[];
  fetchedAt: string;
}

/**
 * PreStocks (tokenized pre-IPO exposure, SPL tokens issued 1:1 against SPV exposure) as a Nest
 * basket. Read-only: this only shows the tokens, how far each trades from its reference price, and
 * the live IPO-timing odds beside it. Nothing here buys or holds a token, and it deliberately
 * mixes in no non-PreStocks pre-IPO token, since that would disqualify the project from the
 * PreStocks track.
 */
@Injectable()
export class PreStocksService {
  private readonly logger = new Logger(PreStocksService.name);
  private cache: { loadedAt: number; raw: RawPreStock[] } | null = null;

  constructor(private readonly kalshi: KalshiService) {}

  hasMarketSeries(symbol: string): boolean {
    return symbol in IPO_SERIES;
  }

  /** Last-known-good on a failed fetch, even if stale: an empty basket would read as "PreStocks
   *  delisted everything", which is never the truth of a transient upstream error. */
  private async load(): Promise<RawPreStock[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_MS) return this.cache.raw;
    try {
      const res = await fetch(PRESTOCKS_API);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body: unknown = await res.json();
      if (!Array.isArray(body)) throw new Error('unexpected response shape');
      const raw = (body as RawPreStock[]).filter(t => t?.symbol && Number(t.tokenPrice) > 0 && Number(t.markPrice) > 0);
      this.cache = { loadedAt: Date.now(), raw };
      return raw;
    } catch (e: any) {
      this.logger.warn(`PreStocks fetch failed: ${e.message}`);
      return this.cache?.raw ?? [];
    }
  }

  private displayName(raw: RawPreStock): string {
    return raw.name.replace(/\s*PreStocks$/i, '').trim();
  }

  /** The market a user would actually be asked about: of the ladder of "before <date>" strikes,
   *  the one the crowd is least sure of. The extremes are effectively settled and say nothing. */
  private async bestMarket(raw: RawPreStock): Promise<PredictionMarket | null> {
    const series = IPO_SERIES[raw.symbol];
    if (!series) return null;
    const markets = (await this.kalshi.getSeriesMarkets(series, this.displayName(raw))).filter(m => m.yesPrice !== null && m.yesPrice >= 0.03 && m.yesPrice <= 0.97);
    if (markets.length === 0) return null;
    const best = markets.reduce((a, b) => (Math.abs(a.yesPrice! - 0.5) <= Math.abs(b.yesPrice! - 0.5) ? a : b));
    return { ...best, symbol: raw.symbol };
  }

  /** One market by id, searched across the whole strike ladder (not just the one on display) so a
   *  bet on a card that has since been superseded still prices off a live market. */
  async findMarket(symbol: string, marketId: string): Promise<PredictionMarket | null> {
    const series = IPO_SERIES[symbol];
    if (!series) return null;
    const raw = (await this.load()).find(t => t.symbol === symbol);
    const markets = await this.kalshi.getSeriesMarkets(series, raw ? this.displayName(raw) : symbol);
    const hit = markets.find(m => m.id === marketId);
    return hit ? { ...hit, symbol } : null;
  }

  async getBasket(): Promise<PreIpoResponse> {
    const raw = await this.load();
    const assets = await Promise.all(
      raw.map(async (t): Promise<PreIpoAsset> => ({
        symbol: t.symbol,
        name: this.displayName(t),
        blurb: (t.description ?? '').split('\n')[0].trim(),
        // prestocks.com 301s its www host to the apex; hand the browser the final URL so the CSP
        // allowlist and the image request agree.
        logoUrl: (t.image ?? '').replace('https://www.prestocks.com/', 'https://prestocks.com/'),
        url: t.external_url,
        mint: t.contract_address,
        markPriceUsd: Number(t.markPrice),
        tokenPriceUsd: Number(t.tokenPrice),
        premiumPct: (Number(t.tokenPrice) / Number(t.markPrice) - 1) * 100,
        valuationUsd: Number(t.markValuation),
        impliedValuationUsd: Number(t.impliedValuation),
        market: await this.bestMarket(t),
      })),
    );
    assets.sort((a, b) => b.valuationUsd - a.valuationUsd);
    return { assets, fetchedAt: new Date().toISOString() };
  }
}
