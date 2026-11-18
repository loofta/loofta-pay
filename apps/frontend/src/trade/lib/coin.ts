import { displayName, type MemecoinItem } from "@/trade/lib/memecoin";

/** One shape for every coin the user can open, whether it came from Spot search, Memepad or Home. */
export type CoinRef = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  usd: number | null;
  mcap: number | null;
  change: number | null;
  /** What kind of asset the market list said this is, so Info can explain it. */
  kind?: "Stock" | "Pre-IPO" | "Meme" | "Coin";
  /** Present when the coin came from the Memepad feed, so the page can show checks and stage. */
  item?: MemecoinItem;
};

export type JupToken = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  usd: number | null;
  mcap: number | null;
  change24h: number | null;
};

export const fromToken = (t: JupToken): CoinRef => ({
  mint: t.mint,
  symbol: t.symbol,
  name: t.name,
  icon: t.icon,
  decimals: t.decimals,
  usd: t.usd,
  mcap: t.mcap,
  change: t.change24h,
});

export const fromMemecoin = (m: MemecoinItem): CoinRef => ({
  mint: m.mint,
  symbol: m.symbol || displayName(m),
  name: displayName(m),
  icon: m.imageUrl,
  // Pump coins are 6 decimals. Only used to trim the amount box, the backend reads decimals from the mint.
  decimals: 6,
  usd: null,
  mcap: m.mcapUsd,
  change: m.priceChange1h,
  item: m,
});
