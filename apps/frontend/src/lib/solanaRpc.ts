import { PublicKey } from "@solana/web3.js";

export type NetworkMode = "mainnet" | "devnet";

export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Helius HTTP RPC for the given runtime networkMode. Helius key takes priority over explicit URL. */
export function getRpcForMode(mode: NetworkMode): string {
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (mode === "mainnet") {
    if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
    return (
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      "https://api.mainnet-beta.solana.com"
    );
  }
  if (key) return `https://devnet.helius-rpc.com/?api-key=${key}`;
  return (
    process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim() ||
    "https://api.devnet.solana.com"
  );
}

export function getUsdcMintForMode(mode: NetworkMode): PublicKey {
  return new PublicKey(mode === "mainnet" ? MAINNET_USDC_MINT : DEVNET_USDC_MINT);
}

export function getPrivySolanaChainForMode(mode: NetworkMode): "solana:mainnet" | "solana:devnet" {
  return mode === "mainnet" ? "solana:mainnet" : "solana:devnet";
}
