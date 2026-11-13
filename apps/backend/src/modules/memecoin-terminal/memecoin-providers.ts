/**
 * Thin clients + parsers for the two data sources behind the feed. Parsers are pure and exported
 * so they can be tested against captured responses.
 *
 *  - DexScreener (no key): price/volume/liquidity/market cap, social links, "dex paid" orders.
 *    Response shapes verified against the live API on 2026-10-21.
 *  - Solana Tracker (x-api-key): holders and the risk object (bundlers, dev, rugged, authorities).
 *    Field names taken from its published docs and OpenAPI spec; not yet exercised with a live key.
 */

const DEXSCREENER = 'https://api.dexscreener.com';
const SOLANA_TRACKER = 'https://data.solanatracker.io';
const TIMEOUT_MS = 10_000;

export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface MarketPatch {
  pair_address: string | null;
  dex_id: string | null;
  mcap_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  price_change_1h: number | null;
  price_change_24h: number | null;
  image_url: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  socials: unknown;
  name: string | null;
  symbol: string | null;
}

export interface RiskPatch {
  holders: number | null;
  bundler_pct: number | null;
  dev_pct: number | null;
  sniper_pct: number | null;
  top10_pct: number | null;
  lp_burn_pct: number | null;
  mint_authority_active: boolean | null;
  freeze_authority_active: boolean | null;
  rugged: boolean | null;
  risk_score: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Picks the deepest pool; a coin's real market is the one with the most liquidity. */
export function parseDexScreenerPairs(body: unknown): MarketPatch | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const pairs = body.filter((p): p is Record<string, any> => !!p && typeof p === 'object');
  if (pairs.length === 0) return null;
  const best = pairs.reduce((a, b) => ((num(b.liquidity?.usd) ?? 0) > (num(a.liquidity?.usd) ?? 0) ? b : a));
  const socials: Array<{ type?: string; url?: string }> = Array.isArray(best.info?.socials) ? best.info.socials : [];
  const social = (type: string) => socials.find(s => s?.type === type)?.url ?? null;
  const website = Array.isArray(best.info?.websites) ? best.info.websites[0]?.url ?? null : null;
  return {
    pair_address: best.pairAddress ?? null,
    dex_id: best.dexId ?? null,
    mcap_usd: num(best.marketCap) ?? num(best.fdv),
    liquidity_usd: num(best.liquidity?.usd),
    volume_24h_usd: num(best.volume?.h24),
    price_change_1h: num(best.priceChange?.h1),
    price_change_24h: num(best.priceChange?.h24),
    image_url: best.info?.imageUrl ?? null,
    website,
    twitter: social('twitter'),
    telegram: social('telegram'),
    socials: socials.length ? socials : null,
    name: best.baseToken?.name ?? null,
    symbol: best.baseToken?.symbol ?? null,
  };
}

/** "Dex paid" = an approved paid token profile (or ad) on DexScreener. */
export function parseDexPaid(body: unknown): boolean {
  const orders = (body as { orders?: unknown })?.orders;
  if (!Array.isArray(orders)) return false;
  return orders.some(o => o && typeof o === 'object' && (o as any).status === 'approved' && ['tokenProfile', 'tokenAd'].includes((o as any).type));
}

/**
 * Solana Tracker token response -> risk numbers. When the provider returned a `risk` object but
 * left `bundlers` out (the spec says it may be omitted), that means it found none, so 0. When
 * there is no `risk` object at all we know nothing and leave every field null.
 */
export function parseSolanaTracker(body: unknown): RiskPatch | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, any>;
  const risk = b.risk && typeof b.risk === 'object' ? b.risk : null;
  const pools: Array<Record<string, any>> = Array.isArray(b.pools) ? b.pools : [];
  const pool = pools.length ? pools.reduce((x, y) => ((num(y.liquidity?.usd) ?? 0) > (num(x.liquidity?.usd) ?? 0) ? y : x)) : null;
  const authority = (k: 'mintAuthority' | 'freezeAuthority'): boolean | null => {
    if (!pool?.security || !(k in pool.security)) return null;
    return pool.security[k] != null;
  };
  return {
    holders: num(b.holders),
    bundler_pct: risk ? num(risk.bundlers?.totalPercentage) ?? 0 : null,
    dev_pct: risk ? num(risk.dev?.percentage) : null,
    sniper_pct: risk ? num(risk.snipers?.totalPercentage) : null,
    top10_pct: risk ? num(risk.top10) : null,
    lp_burn_pct: num(pool?.lpBurn),
    mint_authority_active: authority('mintAuthority'),
    freeze_authority_active: authority('freezeAuthority'),
    rugged: risk && typeof risk.rugged === 'boolean' ? risk.rugged : null,
    risk_score: risk ? num(risk.score) : null,
  };
}

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

export const fetchMarket = async (mint: string): Promise<MarketPatch | null> =>
  parseDexScreenerPairs(await getJson(`${DEXSCREENER}/tokens/v1/solana/${mint}`));

export const fetchDexPaid = async (mint: string): Promise<boolean> =>
  parseDexPaid(await getJson(`${DEXSCREENER}/orders/v1/solana/${mint}`));

export const fetchRisk = async (mint: string, apiKey: string): Promise<RiskPatch | null> =>
  parseSolanaTracker(await getJson(`${SOLANA_TRACKER}/tokens/${mint}`, { 'x-api-key': apiKey }));

/**
 * Ingest only reads public market data and writes memecoin rows (no money moves), so a developer
 * may turn it on locally with MEMECOIN_DEV_INGEST=true without making the whole instance
 * NODE_ENV=production (which would start every money-moving cron).
 */
export function memecoinIngestOn(config: { get<T = string>(k: string): T | undefined }, cronEnabled: boolean): boolean {
  if (config.get<string>('MEMECOIN_INGEST_ENABLED') !== 'true') return false;
  return cronEnabled || config.get<string>('MEMECOIN_DEV_INGEST') === 'true';
}
