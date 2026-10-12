import type { NearToken } from "@/services/nearIntents";

/** Popular top-up rails. Symbols and chains match the 1Click token list. */
export type DepositRail = {
  id: string;
  label: string;
  symbol: string;
  chains: string[];
  symbolFallbacks?: string[];
  /** Short line under the chain name on the address screen. */
  sendHint: string;
};

export const DEPOSIT_RAILS: DepositRail[] = [
  { id: "solana", label: "Solana", symbol: "SOL", chains: ["sol", "solana"], symbolFallbacks: ["USDC"], sendHint: "SOL" },
  { id: "base", label: "Base", symbol: "USDC", chains: ["base"], sendHint: "USDC" },
  { id: "ethereum", label: "Ethereum", symbol: "ETH", chains: ["eth", "ethereum"], sendHint: "ETH" },
  { id: "arbitrum", label: "Arbitrum", symbol: "ETH", chains: ["arb", "arbitrum"], symbolFallbacks: ["USDC"], sendHint: "ETH" },
  { id: "bitcoin", label: "Bitcoin", symbol: "BTC", chains: ["btc", "bitcoin"], sendHint: "BTC" },
  { id: "zcash", label: "Zcash", symbol: "ZEC", chains: ["zec", "zcash"], sendHint: "ZEC" },
  { id: "ton", label: "TON", symbol: "TON", chains: ["ton"], symbolFallbacks: ["USDT"], sendHint: "TON" },
  { id: "polygon", label: "Polygon", symbol: "USDT", chains: ["pol", "polygon", "matic"], sendHint: "USDT" },
  { id: "tron", label: "Tron", symbol: "USDT", chains: ["tron", "trx"], sendHint: "USDT" },
  { id: "monad", label: "Monad", symbol: "MON", chains: ["monad"], symbolFallbacks: ["USDC", "ETH"], sendHint: "MON" },
];

const RAIL_STYLE: Record<string, { bg: string; src?: string }> = {
  solana: { bg: "#14F195", src: "/images/sol.png" },
  base: { bg: "#0052FF", src: "/images/usdc.svg" },
  ethereum: { bg: "#627EEA", src: "/images/eth.svg" },
  arbitrum: { bg: "#12AAFF" },
  bitcoin: { bg: "#F7931A", src: "/images/btc.svg" },
  zcash: { bg: "#F4B728" },
  ton: { bg: "#0098EA" },
  polygon: { bg: "#8247E5", src: "/images/usdt.svg" },
  tron: { bg: "#FF060A", src: "/images/usdt.svg" },
  monad: { bg: "#836EF9" },
};

export function railStyle(id: string): { bg: string; src?: string } {
  return RAIL_STYLE[id] ?? { bg: "#3A3A44" };
}

export function findUsdcOnSolana(tokens: NearToken[]): NearToken | undefined {
  return tokens.find((t) => t.symbol.toUpperCase() === "USDC" && (t.chain === "sol" || t.chain === "solana"));
}

export function findUsdcOnBase(tokens: NearToken[]): NearToken | undefined {
  return tokens.find((t) => t.symbol.toUpperCase() === "USDC" && t.chain.toLowerCase() === "base");
}

export function resolveRailToken(tokens: NearToken[], rail: DepositRail): NearToken | undefined {
  const chains = new Set(rail.chains.map((c) => c.toLowerCase()));
  for (const symbol of [rail.symbol, ...(rail.symbolFallbacks ?? [])]) {
    const hit = tokens.find(
      (t) => t.symbol.toUpperCase() === symbol.toUpperCase() && chains.has(t.chain.toLowerCase()),
    );
    if (hit) return hit;
  }
  return undefined;
}

export function railKey(token: { symbol: string; chain: string }): string {
  return `${token.symbol.toUpperCase()}:${token.chain.toLowerCase()}`;
}

const PREF_KEY = "loofta_deposit_privately";

export function readDepositPrivately(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PREF_KEY) !== "0";
}

export function writeDepositPrivately(on: boolean) {
  window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
}
