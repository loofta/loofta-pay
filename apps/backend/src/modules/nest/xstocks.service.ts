import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';

/**
 * Backed Finance's public catalog (`api.backed.fi/api/v2/public/assets`, paginated, no API key)
 * covers ~800+ tokenized assets across every chain they support — most of it illiquid stuff we
 * never want in a user's basket. This allowlist is the actual investable universe: tickers that
 * are part of the widely-traded "xStocks" set (Kraken/Bybit distribution, live on Jupiter/Raydium
 * on Solana), hand-picked because Backed's API has no "is this the liquid one" flag to filter on.
 * Tag each with the interest categories a nest_profiles row can select against.
 */
export interface NestUniverseEntry {
  symbol: string; // xStock symbol, e.g. "AAPLx"
  underlyingSymbol: string; // e.g. "AAPL"
  name: string;
  tags: string[];
}

export const NEST_UNIVERSE_ALLOWLIST: NestUniverseEntry[] = [
  { symbol: 'AAPLx', underlyingSymbol: 'AAPL', name: 'Apple', tags: ['big-tech', 'ai'] },
  { symbol: 'MSFTx', underlyingSymbol: 'MSFT', name: 'Microsoft', tags: ['big-tech', 'ai'] },
  { symbol: 'GOOGLx', underlyingSymbol: 'GOOGL', name: 'Alphabet', tags: ['big-tech', 'ai'] },
  { symbol: 'AMZNx', underlyingSymbol: 'AMZN', name: 'Amazon', tags: ['big-tech', 'ai'] },
  { symbol: 'METAx', underlyingSymbol: 'META', name: 'Meta', tags: ['big-tech', 'ai'] },
  { symbol: 'NVDAx', underlyingSymbol: 'NVDA', name: 'Nvidia', tags: ['big-tech', 'ai', 'semis'] },
  { symbol: 'AVGOx', underlyingSymbol: 'AVGO', name: 'Broadcom', tags: ['semis', 'ai'] },
  { symbol: 'ORCLx', underlyingSymbol: 'ORCL', name: 'Oracle', tags: ['big-tech', 'ai'] },
  { symbol: 'NFLXx', underlyingSymbol: 'NFLX', name: 'Netflix', tags: ['big-tech', 'consumer'] },
  { symbol: 'AMDx', underlyingSymbol: 'AMD', name: 'AMD', tags: ['semis', 'ai'] },
  { symbol: 'PLTRx', underlyingSymbol: 'PLTR', name: 'Palantir', tags: ['ai', 'crypto-adjacent'] },
  { symbol: 'CRMx', underlyingSymbol: 'CRM', name: 'Salesforce', tags: ['big-tech', 'ai'] },
  { symbol: 'ADBEx', underlyingSymbol: 'ADBE', name: 'Adobe', tags: ['big-tech', 'ai'] },
  { symbol: 'CSCOx', underlyingSymbol: 'CSCO', name: 'Cisco', tags: ['big-tech'] },
  { symbol: 'INTCx', underlyingSymbol: 'INTC', name: 'Intel', tags: ['semis'] },
  { symbol: 'IBMx', underlyingSymbol: 'IBM', name: 'IBM', tags: ['big-tech', 'ai'] },
  { symbol: 'HPEx', underlyingSymbol: 'HPE', name: 'Hewlett Packard Enterprise', tags: ['big-tech', 'ai'] },
  { symbol: 'UNHx', underlyingSymbol: 'UNH', name: 'UnitedHealth', tags: ['healthcare', 'defensive'] },
  { symbol: 'MRNAx', underlyingSymbol: 'MRNA', name: 'Moderna', tags: ['healthcare'] },
  { symbol: 'UBERx', underlyingSymbol: 'UBER', name: 'Uber', tags: ['consumer'] },
  { symbol: 'ABNBx', underlyingSymbol: 'ABNB', name: 'Airbnb', tags: ['consumer'] },
  { symbol: 'SNAPx', underlyingSymbol: 'SNAP', name: 'Snap', tags: ['consumer'] },
  { symbol: 'SPOTx', underlyingSymbol: 'SPOT', name: 'Spotify', tags: ['consumer'] },
  { symbol: 'SHOPx', underlyingSymbol: 'SHOP', name: 'Shopify', tags: ['consumer', 'creator-economy'] },
  { symbol: 'RBLXx', underlyingSymbol: 'RBLX', name: 'Roblox', tags: ['consumer', 'gaming'] },
  { symbol: 'COINx', underlyingSymbol: 'COIN', name: 'Coinbase', tags: ['crypto-adjacent'] },
  { symbol: 'HOODx', underlyingSymbol: 'HOOD', name: 'Robinhood', tags: ['crypto-adjacent'] },
  { symbol: 'MSTRx', underlyingSymbol: 'MSTR', name: 'MicroStrategy', tags: ['crypto-adjacent'] },
  { symbol: 'CRCLx', underlyingSymbol: 'CRCL', name: 'Circle', tags: ['crypto-adjacent'] },
  { symbol: 'SPYx', underlyingSymbol: 'SPY', name: 'S&P 500 ETF', tags: ['index'] },
  { symbol: 'QQQx', underlyingSymbol: 'QQQ', name: 'Nasdaq 100 ETF', tags: ['index', 'big-tech'] },
  { symbol: 'JPMx', underlyingSymbol: 'JPM', name: 'JPMorgan Chase', tags: ['finance'] },
  { symbol: 'Vx', underlyingSymbol: 'V', name: 'Visa', tags: ['finance'] },
  { symbol: 'MAx', underlyingSymbol: 'MA', name: 'Mastercard', tags: ['finance'] },
  { symbol: 'WMTx', underlyingSymbol: 'WMT', name: 'Walmart', tags: ['consumer'] },
  { symbol: 'KOx', underlyingSymbol: 'KO', name: 'Coca-Cola', tags: ['consumer', 'defensive'] },
  { symbol: 'PEPx', underlyingSymbol: 'PEP', name: 'PepsiCo', tags: ['consumer', 'defensive'] },
  { symbol: 'DISx', underlyingSymbol: 'DIS', name: 'Disney', tags: ['consumer'] },
  { symbol: 'BAx', underlyingSymbol: 'BA', name: 'Boeing', tags: ['industrial'] },
  { symbol: 'XOMx', underlyingSymbol: 'XOM', name: 'Exxon Mobil', tags: ['energy', 'defensive'] },
  { symbol: 'JNJx', underlyingSymbol: 'JNJ', name: 'Johnson & Johnson', tags: ['healthcare', 'defensive'] },
  { symbol: 'ABBVx', underlyingSymbol: 'ABBV', name: 'AbbVie', tags: ['healthcare', 'defensive'] },
  { symbol: 'TSLAx', underlyingSymbol: 'TSLA', name: 'Tesla', tags: ['ev', 'ai'] },
  // Expanded 2026-09-15 for broader category coverage — all verified live against Backed's
  // catalog (Solana-deployed, not trading-halted) the same day, same as everything above.
  { symbol: 'HDx', underlyingSymbol: 'HD', name: 'Home Depot', tags: ['consumer'] },
  { symbol: 'LOWx', underlyingSymbol: 'LOW', name: "Lowe's", tags: ['consumer'] },
  { symbol: 'MCDx', underlyingSymbol: 'MCD', name: "McDonald's", tags: ['consumer', 'defensive'] },
  { symbol: 'SBUXx', underlyingSymbol: 'SBUX', name: 'Starbucks', tags: ['consumer'] },
  { symbol: 'VZx', underlyingSymbol: 'VZ', name: 'Verizon', tags: ['telecom', 'defensive'] },
  { symbol: 'TMUSx', underlyingSymbol: 'TMUS', name: 'T-Mobile', tags: ['telecom'] },
  { symbol: 'PFEx', underlyingSymbol: 'PFE', name: 'Pfizer', tags: ['healthcare', 'defensive'] },
  { symbol: 'MRKx', underlyingSymbol: 'MRK', name: 'Merck', tags: ['healthcare', 'defensive'] },
  { symbol: 'LLYx', underlyingSymbol: 'LLY', name: 'Eli Lilly', tags: ['healthcare'] },
  { symbol: 'GILDx', underlyingSymbol: 'GILD', name: 'Gilead Sciences', tags: ['healthcare'] },
  { symbol: 'REGNx', underlyingSymbol: 'REGN', name: 'Regeneron', tags: ['healthcare'] },
  { symbol: 'BMYx', underlyingSymbol: 'BMY', name: 'Bristol-Myers Squibb', tags: ['healthcare', 'defensive'] },
  { symbol: 'Fx', underlyingSymbol: 'F', name: 'Ford', tags: ['ev', 'industrial'] },
  { symbol: 'GMx', underlyingSymbol: 'GM', name: 'General Motors', tags: ['ev', 'industrial'] },
  { symbol: 'RIVNx', underlyingSymbol: 'RIVN', name: 'Rivian', tags: ['ev'] },
  { symbol: 'DALx', underlyingSymbol: 'DAL', name: 'Delta Air Lines', tags: ['industrial'] },
  { symbol: 'UALx', underlyingSymbol: 'UAL', name: 'United Airlines', tags: ['industrial'] },
  { symbol: 'LUVx', underlyingSymbol: 'LUV', name: 'Southwest Airlines', tags: ['industrial'] },
  { symbol: 'UPSx', underlyingSymbol: 'UPS', name: 'UPS', tags: ['industrial'] },
  { symbol: 'FDXx', underlyingSymbol: 'FDX', name: 'FedEx', tags: ['industrial'] },
  { symbol: 'CATx', underlyingSymbol: 'CAT', name: 'Caterpillar', tags: ['industrial'] },
  { symbol: 'DEx', underlyingSymbol: 'DE', name: 'Deere', tags: ['industrial'] },
  { symbol: 'GEx', underlyingSymbol: 'GE', name: 'GE Aerospace', tags: ['industrial', 'ai'] },
  { symbol: 'HONx', underlyingSymbol: 'HON', name: 'Honeywell', tags: ['industrial'] },
  { symbol: 'LMTx', underlyingSymbol: 'LMT', name: 'Lockheed Martin', tags: ['industrial'] },
  { symbol: 'RTXx', underlyingSymbol: 'RTX', name: 'RTX', tags: ['industrial'] },
  { symbol: 'GSx', underlyingSymbol: 'GS', name: 'Goldman Sachs', tags: ['finance'] },
  { symbol: 'MSx', underlyingSymbol: 'MS', name: 'Morgan Stanley', tags: ['finance'] },
  { symbol: 'WFCx', underlyingSymbol: 'WFC', name: 'Wells Fargo', tags: ['finance'] },
  { symbol: 'Cx', underlyingSymbol: 'C', name: 'Citigroup', tags: ['finance'] },
  { symbol: 'NEEx', underlyingSymbol: 'NEE', name: 'NextEra Energy', tags: ['energy', 'defensive'] },
  { symbol: 'DUKx', underlyingSymbol: 'DUK', name: 'Duke Energy', tags: ['energy', 'defensive'] },
  { symbol: 'CMCSAx', underlyingSymbol: 'CMCSA', name: 'Comcast', tags: ['consumer', 'telecom'] },
  { symbol: 'WBDx', underlyingSymbol: 'WBD', name: 'Warner Bros. Discovery', tags: ['consumer'] },
  { symbol: 'TXNx', underlyingSymbol: 'TXN', name: 'Texas Instruments', tags: ['semis'] },
  { symbol: 'QCOMx', underlyingSymbol: 'QCOM', name: 'Qualcomm', tags: ['semis', 'ai'] },
  { symbol: 'LRCXx', underlyingSymbol: 'LRCX', name: 'Lam Research', tags: ['semis'] },
  { symbol: 'KLACx', underlyingSymbol: 'KLAC', name: 'KLA', tags: ['semis'] },
  { symbol: 'Ox', underlyingSymbol: 'O', name: 'Realty Income', tags: ['real-estate', 'defensive'] },
  { symbol: 'PLDx', underlyingSymbol: 'PLD', name: 'Prologis', tags: ['real-estate'] },
  { symbol: 'AMTx', underlyingSymbol: 'AMT', name: 'American Tower', tags: ['real-estate', 'telecom'] },
  { symbol: 'MARx', underlyingSymbol: 'MAR', name: 'Marriott', tags: ['consumer'] },
];

/**
 * Backpack Securities/Sunrise tokenized equities (docs.backpack.exchange) — a second, separate
 * issuer from Backed Finance. Only added for tickers Backed DOESN'T already cover (no MSTR/MRNA
 * duplicates here even though Backpack lists them too — trading the same underlying stock through
 * two different mints would mean picking a winner arbitrarily and reconciling two price sources
 * for one position, not worth it for a hackathon scope). Every mint below was verified live via
 * Jupiter's token search (real liquidity, Token-2022, 6 decimals) on 2026-09-15 — see chat history
 * for the exact curl checks — not copied from Backpack's marketing docs.
 */
interface BackpackUniverseEntry extends NestUniverseEntry {
  solanaMint: string;
  decimals: number;
}

const BACKPACK_UNIVERSE: BackpackUniverseEntry[] = [
  { symbol: 'SPCX', underlyingSymbol: 'SPCX', name: 'SpaceX', tags: ['ai'], solanaMint: 'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb', decimals: 6 },
  { symbol: 'MU', underlyingSymbol: 'MU', name: 'Micron Technology', tags: ['semis', 'ai'], solanaMint: 'MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1', decimals: 6 },
  { symbol: 'SNDK', underlyingSymbol: 'SNDK', name: 'Sandisk', tags: ['semis'], solanaMint: 'SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH', decimals: 6 },
  { symbol: 'NKE', underlyingSymbol: 'NKE', name: 'Nike', tags: ['consumer'], solanaMint: 'NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg', decimals: 6 },
  { symbol: 'SKHY', underlyingSymbol: 'SKHY', name: 'SK Hynix', tags: ['semis', 'ai'], solanaMint: 'SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3', decimals: 6 },
  { symbol: 'DRAM', underlyingSymbol: 'DRAM', name: 'Roundhill Memory ETF', tags: ['semis', 'index'], solanaMint: 'DRAMjSWR7HRfJKjRkvQWYL2bcaejaVhuxEcjf4pAY4Cw', decimals: 6 },
];
const BACKPACK_SYMBOLS = new Set(BACKPACK_UNIVERSE.map(a => a.symbol));

interface BackedAssetNode {
  symbol: string;
  underlyingSymbol: string;
  name: string;
  isTradingHalted: boolean;
  deployments: Array<{ address: string; network: string }>;
}

const BACKED_API_BASE = 'https://api.backed.fi/api/v2/public';
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v3';
// The catalog is paginated (100/page) and only changes when Backed lists/delists an asset —
// refetching all pages on every call would mean ~9 HTTP round trips per rebalance tick.
const CATALOG_CACHE_MS = 6 * 60 * 60_000;
const PRICE_CACHE_MS = 60_000;

export interface NestUniverseAsset extends NestUniverseEntry {
  solanaMint: string;
  decimals: number;
  source: 'backed' | 'backpack';
}

@Injectable()
export class XStocksService {
  private readonly logger = new Logger(XStocksService.name);
  private catalogCache: { assets: NestUniverseAsset[]; loadedAt: number } | null = null;
  private priceCache = new Map<string, { price: number; loadedAt: number }>();
  // xStocks are SPL Token-2022 with the Scaled UI extension and use 8 decimals (verified against
  // AAPLx's live mint) — but decimals are read from each mint directly rather than hardcoded,
  // since a wrong assumption here means every trade is sized off by whatever power-of-10 is wrong.
  private readonly connection: Connection;

  constructor(private readonly config: ConfigService) {
    this.connection = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
  }

  /** Full Backed catalog, paginated until `hasNextPage` is false. */
  private async fetchAllPages(): Promise<BackedAssetNode[]> {
    const nodes: BackedAssetNode[] = [];
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`${BACKED_API_BASE}/assets?page=${page}`);
      if (!res.ok) throw new Error(`Backed assets fetch failed (${res.status})`);
      const body = await res.json();
      nodes.push(...(body.nodes ?? []));
      if (!body.page?.hasNextPage) break;
    }
    return nodes;
  }

  /** Our curated allowlist (Backed + Backpack) enriched with each symbol's live Solana mint
   *  address. Falls back to the last-known-good cache (even if stale) on a fetch error rather
   *  than returning an empty universe — a rebalance tick that can't see the universe should
   *  skip, not treat "everything delisted" as real signal. */
  async getUniverse(): Promise<NestUniverseAsset[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.loadedAt < CATALOG_CACHE_MS) {
      return this.catalogCache.assets;
    }
    try {
      const nodes = await this.fetchAllPages();
      const bySymbol = new Map(nodes.map(n => [n.symbol, n]));
      const assets: NestUniverseAsset[] = [];
      for (const entry of NEST_UNIVERSE_ALLOWLIST) {
        const node = bySymbol.get(entry.symbol);
        const solDeployment = node?.deployments.find(d => d.network === 'Solana');
        if (!node || node.isTradingHalted || !solDeployment) {
          this.logger.warn(`Nest universe entry ${entry.symbol} unavailable on Solana or trading-halted; excluding this cycle`);
          continue;
        }
        let decimals: number;
        try {
          decimals = (await getMint(this.connection, new PublicKey(solDeployment.address), 'confirmed', TOKEN_2022_PROGRAM_ID)).decimals;
        } catch (e: any) {
          this.logger.warn(`Could not read decimals for ${entry.symbol} (${solDeployment.address}); excluding this cycle: ${e.message}`);
          continue;
        }
        assets.push({ ...entry, solanaMint: solDeployment.address, decimals, source: 'backed' });
      }
      // Backpack entries are hardcoded with pre-verified mint/decimals (no live catalog to page
      // through) — just carry them straight into the merged universe.
      for (const entry of BACKPACK_UNIVERSE) {
        assets.push({ ...entry, source: 'backpack' });
      }
      this.catalogCache = { assets, loadedAt: Date.now() };
      return assets;
    } catch (e: any) {
      this.logger.error(`getUniverse fetch failed: ${e.message}`);
      if (this.catalogCache) return this.catalogCache.assets;
      return [];
    }
  }

  private async getBackedPrice(symbol: string): Promise<number | null> {
    const res = await fetch(`${BACKED_API_BASE}/assets/${symbol}/price-data`);
    if (!res.ok) return null;
    const body = await res.json();
    const price = Number(body.quote);
    return Number.isFinite(price) ? price : null;
  }

  /** Batches every Backpack-sourced symbol into one Jupiter price/v3 call. Prefers `stockData`'s
   *  off-chain reference price (analogous to Backed's issuer price-data) over the raw on-chain
   *  `usdPrice`, since a DEX-derived price can carry slippage/thin-liquidity noise the reference
   *  price doesn't. */
  private async fetchBackpackPrices(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const entries = BACKPACK_UNIVERSE.filter(a => symbols.includes(a.symbol));
    if (entries.length === 0) return out;
    try {
      const ids = entries.map(e => e.solanaMint).join(',');
      const res = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);
      if (!res.ok) return out;
      const body = await res.json();
      for (const entry of entries) {
        const data = body[entry.solanaMint];
        const price = Number(data?.stockData?.price ?? data?.usdPrice);
        if (Number.isFinite(price)) out.set(entry.symbol, price);
      }
    } catch (e: any) {
      this.logger.warn(`fetchBackpackPrices failed: ${e.message}`);
    }
    return out;
  }

  /** Live quote in USD for one symbol, e.g. "TSLAx" -> 358.625, or "SPCX" -> 148.63. */
  async getPrice(symbol: string): Promise<number | null> {
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.loadedAt < PRICE_CACHE_MS) return cached.price;
    try {
      const price = BACKPACK_SYMBOLS.has(symbol) ? (await this.fetchBackpackPrices([symbol])).get(symbol) ?? null : await this.getBackedPrice(symbol);
      if (price === null) return cached?.price ?? null;
      this.priceCache.set(symbol, { price, loadedAt: Date.now() });
      return price;
    } catch (e: any) {
      this.logger.warn(`getPrice(${symbol}) failed: ${e.message}`);
      return cached?.price ?? null;
    }
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const backpackSymbols = symbols.filter(s => BACKPACK_SYMBOLS.has(s));
    const backedSymbols = symbols.filter(s => !BACKPACK_SYMBOLS.has(s));

    const [backpackPrices] = await Promise.all([
      this.fetchBackpackPrices(backpackSymbols),
      ...backedSymbols.map(async sym => {
        const p = await this.getPrice(sym);
        if (p !== null) out.set(sym, p);
      }),
    ]);
    for (const [sym, price] of backpackPrices) {
      out.set(sym, price);
      this.priceCache.set(sym, { price, loadedAt: Date.now() });
    }
    return out;
  }
}
