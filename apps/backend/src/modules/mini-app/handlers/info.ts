/* eslint-disable */
// Details for any coin that is not in the memecoin terminal (majors, stocks, older tokens), from free public sources:
// DexScreener for market numbers, links and age, CoinGecko for the description, supply and all-time high.
// Both are cached because CoinGecko's free tier is rate limited and this data barely changes.
const NextResponse = Response;
import { cached } from "../lib/sharedCache";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(6_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type Pair = {
  dexId?: string;
  priceUsd?: string;
  priceChange?: { h1?: number; h6?: number; h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  txns?: { h24?: { buys?: number; sells?: number } };
  info?: { imageUrl?: string; websites?: Array<{ url: string; label?: string }>; socials?: Array<{ type: string; url: string }> };
};

export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // A coin's basics barely move, so a hit is kept for 30 minutes. A miss is kept for 5 so a coin the sources do not
  // know is not looked up on every open, but is retried soon.
  const body = await cached(`info:${mint}`, (v: { found: boolean }) => (v.found ? 1800 : 300), () => build(mint));
  return NextResponse.json(body);
}

async function build(mint: string) {
  const cgKey = process.env.COINGECKO_API_KEY;
  const [dex, cg] = await Promise.all([
    getJson<{ pairs?: Pair[] }>(`https://api.dexscreener.com/latest/dex/tokens/${mint}`),
    getJson<any>(
      `https://api.coingecko.com/api/v3/coins/solana/contract/${mint}?localization=false&tickers=false&community_data=false&developer_data=false&sidebar=false`,
      cgKey ? { "x-cg-demo-api-key": cgKey } : undefined,
    ),
  ]);

  // The pool with the most liquidity is the real market.
  const pair = (dex?.pairs ?? []).filter((p) => p.priceUsd).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const md = cg?.market_data;
  const description = typeof cg?.description?.en === "string" ? cg.description.en.replace(/<[^>]+>/g, "").trim().slice(0, 600) : null;
  const social = (type: string) => pair?.info?.socials?.find((s) => s.type === type)?.url ?? null;

  const body = {
    found: !!(pair || md),
    price: pair?.priceUsd ? Number(pair.priceUsd) : md?.current_price?.usd ?? null,
    marketCap: md?.market_cap?.usd || pair?.marketCap || null,
    fdv: md?.fully_diluted_valuation?.usd || pair?.fdv || null,
    liquidityUsd: pair?.liquidity?.usd ?? null,
    volume24hUsd: pair?.volume?.h24 ?? md?.total_volume?.usd ?? null,
    change24h: pair?.priceChange?.h24 ?? md?.price_change_percentage_24h ?? null,
    buys24h: pair?.txns?.h24?.buys ?? null,
    sells24h: pair?.txns?.h24?.sells ?? null,
    circulatingSupply: md?.circulating_supply ?? null,
    totalSupply: md?.total_supply ?? null,
    athUsd: md?.ath?.usd ?? null,
    athChangePct: md?.ath_change_percentage?.usd ?? null,
    rank: cg?.market_cap_rank ?? null,
    createdAt: pair?.pairCreatedAt ?? null,
    dex: pair?.dexId ?? null,
    description: description || null,
    website: pair?.info?.websites?.[0]?.url ?? cg?.links?.homepage?.find((h: string) => h) ?? null,
    twitter: social("twitter") ?? (cg?.links?.twitter_screen_name ? `https://x.com/${cg.links.twitter_screen_name}` : null),
    telegram: social("telegram") ?? (cg?.links?.telegram_channel_identifier ? `https://t.me/${cg.links.telegram_channel_identifier}` : null),
  };
  return body;
}
