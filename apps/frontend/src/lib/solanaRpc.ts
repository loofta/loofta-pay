import { PublicKey } from "@solana/web3.js";

export type NetworkMode = "mainnet" | "devnet";

export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/**
 * Alchemy HTTP RPC for the given runtime networkMode, if configured.
 * `NEXT_PUBLIC_SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL` hold the Alchemy URL —
 * see memory/project_alchemy_rpc_fallback.md for why Alchemy is primary and Helius is the fallback.
 */
function getAlchemyRpcForMode(mode: NetworkMode): string | null {
  const url = (mode === "mainnet"
    ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    : process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL
  )?.trim();
  return url || null;
}

function getHeliusRpcForMode(mode: NetworkMode): string | null {
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (!key) return null;
  return mode === "mainnet"
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : `https://devnet.helius-rpc.com/?api-key=${key}`;
}

/** Primary HTTP RPC for the given runtime networkMode: Alchemy first, then Helius, then public. */
export function getRpcForMode(mode: NetworkMode): string {
  return (
    getAlchemyRpcForMode(mode) ||
    getHeliusRpcForMode(mode) ||
    (mode === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com")
  );
}

/**
 * Secondary provider for the given networkMode — whichever of Alchemy/Helius isn't primary.
 * Pass as `fallbackConnection` to `waitForSignatureConfirmation` so a signature that one
 * provider hasn't indexed yet gets a second, independent lookup instead of just timing out.
 * Returns null if only one provider is configured (nothing to fall back to).
 */
export function getRpcFallbackForMode(mode: NetworkMode): string | null {
  const primary = getAlchemyRpcForMode(mode);
  if (primary) return getHeliusRpcForMode(mode);
  return null;
}

export function getUsdcMintForMode(mode: NetworkMode): PublicKey {
  return new PublicKey(mode === "mainnet" ? MAINNET_USDC_MINT : DEVNET_USDC_MINT);
}

export function getPrivySolanaChainForMode(mode: NetworkMode): "solana:mainnet" | "solana:devnet" {
  return mode === "mainnet" ? "solana:mainnet" : "solana:devnet";
}
