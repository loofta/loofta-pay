import { PublicKey } from "@solana/web3.js";
import { getSolanaCluster } from "@/lib/solanaCluster";

/** MagicBlock TEE / ephemeral HTTP(S) endpoint (no query string). */
export const EPHEMERAL_RPC_URL =
  process.env.NEXT_PUBLIC_MAGICBLOCK_URL?.replace(/\?.*$/, "") || "https://tee.magicblock.app";

/** Devnet TEE validator per MagicBlock docs. */
export const VALIDATOR_PUBKEY = new PublicKey(
  process.env.NEXT_PUBLIC_MAGICBLOCK_VALIDATOR ||
    "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
);

export const LOOFTA_PER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PER_PROGRAM_ID || "EQMRkmeCbzZaXyEDwgqiTqgg8kUjxBXPe616odmPjSwL",
);

export const DEPOSIT_PDA_SEED = "deposit";
export const VAULT_PDA_SEED = "vault";

/** USDC mint for current cluster (override with NEXT_PUBLIC_SOLANA_USDC_MINT). */
export function getUsdcMint(): PublicKey {
  const override = process.env.NEXT_PUBLIC_SOLANA_USDC_MINT?.trim();
  if (override) return new PublicKey(override);
  const cluster = getSolanaCluster();
  if (cluster === "devnet") {
    return new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  }
  return new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
}
