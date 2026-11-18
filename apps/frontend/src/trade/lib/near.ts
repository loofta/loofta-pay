import tokenIcons from "@/trade/lib/tokenIcons.json";

/** Client helpers for moving money between chains with NEAR Intents, through our own /api/near routes. */

/** The picture for a token symbol, from the token list shared with the main app. undefined when there is none. */
export function iconFor(symbol: string): string | undefined {
  return (tokenIcons as Record<string, string>)[symbol.toUpperCase()];
}

export interface NearToken {
  assetId: string;
  symbol: string;
  chain: string;
  decimals: number;
  price: number | null;
}

export interface NearQuote {
  depositAddress: string;
  memo: string | null;
  amountOutFormatted: string | null;
  minAmountInFormatted: string | null;
  deadline: string | null;
}

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", pol: "Polygon", bsc: "BNB Chain", op: "Optimism", avax: "Avalanche",
  btc: "Bitcoin", sol: "Solana", near: "NEAR", ton: "TON", tron: "Tron", sui: "Sui", xrp: "XRP", doge: "Dogecoin",
  gnosis: "Gnosis", zec: "Zcash", ltc: "Litecoin", bch: "Bitcoin Cash", aptos: "Aptos", cardano: "Cardano", stellar: "Stellar",
  berachain: "Berachain", starknet: "Starknet", adi: "ADI",
};
export const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();

const EVM = new Set(["eth", "base", "arb", "pol", "bsc", "op", "avax", "gnosis", "berachain"]);
export const isEvmChain = (c: string) => EVM.has(c);

/** Light address check per chain family. The quote service rejects anything it cannot use. */
export function addressLooksValid(chain: string, a: string): boolean {
  const v = a.trim();
  if (!v) return false;
  if (isEvmChain(chain)) return /^0x[0-9a-fA-F]{40}$/.test(v);
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
  return v.length >= 10 && /^[\w.:\-]+$/.test(v);
}

export async function fetchNearTokens(): Promise<NearToken[]> {
  const res = await fetch("/api/trade/near/tokens");
  const j = (await res.json()) as { tokens?: NearToken[] };
  return j.tokens ?? [];
}

export const findUsdcOnSolana = (tokens: NearToken[]) => tokens.find((t) => t.symbol === "USDC" && t.chain === "sol") ?? null;

export function toAtomic(amount: string, decimals: number): string {
  const [i, f = ""] = amount.split(".");
  const digits = ((i.replace(/\D/g, "") || "0") + f.replace(/\D/g, "").slice(0, decimals).padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return digits;
}

export async function getNearQuote(p: { originAsset: string; destinationAsset: string; amountAtomic: string; recipient: string; refundTo: string }): Promise<NearQuote> {
  const res = await fetch("/api/trade/near/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ originAsset: p.originAsset, destinationAsset: p.destinationAsset, amount: p.amountAtomic, recipient: p.recipient, refundTo: p.refundTo }),
  });
  const j = (await res.json().catch(() => ({}))) as { message?: string; quote?: Record<string, any> };
  if (!res.ok) throw new Error(j.message || "Could not get a quote");
  const q = j.quote ?? {};
  if (!q.depositAddress) throw new Error("No deposit address returned");
  return {
    depositAddress: q.depositAddress,
    memo: q.depositMemo ?? q.memo ?? null,
    amountOutFormatted: q.amountOutFormatted ?? null,
    minAmountInFormatted: q.minAmountInFormatted ?? null,
    deadline: q.deadline ?? null,
  };
}

export async function getNearStatus(depositAddress: string): Promise<string> {
  const res = await fetch(`/api/trade/near/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  const j = (await res.json().catch(() => ({}))) as { status?: string };
  return String(j.status ?? "PENDING_DEPOSIT").toUpperCase();
}
