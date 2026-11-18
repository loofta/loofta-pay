export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Public RPCs rate limit hard. Set NEXT_PUBLIC_SOLANA_RPC_URL (Lisa's Alchemy URL) in every real deploy. */
export const SOLANA_HTTP_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
export const SOLANA_WS_RPC = SOLANA_HTTP_RPC.replace(/^http/, "ws");

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function baseToHuman(base: string | number, decimals: number): number {
  return Number(base) / 10 ** decimals;
}

/** Compact number for prices, market caps and amounts. */
export function fmt(n: number | null | undefined, max = 4): string {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}
