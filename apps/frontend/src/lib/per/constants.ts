import { PublicKey } from "@solana/web3.js";
import { getSolanaCluster, type SolanaClusterName } from "@/lib/solanaCluster";

/**
 * MagicBlock PER / TEE — see:
 * https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development
 *
 * Override with NEXT_PUBLIC_MAGICBLOCK_URL (no query string; stripped if present).
 * Defaults are cluster-aware when unset:
 * - devnet / testnet: Devnet TEE `https://tee.magicblock.app`
 * - mainnet-beta: Mainnet TEE `https://mainnet-tee.magicblock.app`
 * Local ephemeral-validator: set NEXT_PUBLIC_MAGICBLOCK_URL=http://localhost:7799
 */
function defaultMagicblockTeeBase(): string {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_URL?.replace(/\?.*$/, "").trim();
  if (explicit) return explicit;
  const cluster: SolanaClusterName = getSolanaCluster();
  if (cluster === "mainnet-beta") return "https://mainnet-tee.magicblock.app";
  return "https://tee.magicblock.app";
}

/** MagicBlock TEE / ephemeral HTTP(S) endpoint for getAuthToken + Connection(?token=). */
export const EPHEMERAL_RPC_URL = defaultMagicblockTeeBase();

/**
 * ER validator identity for delegate instructions (must match TEE / environment).
 * https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development
 *
 * Override: NEXT_PUBLIC_MAGICBLOCK_VALIDATOR
 * - Devnet TEE: FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA
 * - Mainnet TEE: MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo
 * - Local ER: mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
 */
function defaultValidatorPubkey(): PublicKey {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_VALIDATOR?.trim();
  if (explicit) return new PublicKey(explicit);
  const cluster = getSolanaCluster();
  if (cluster === "mainnet-beta") {
    return new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
  }
  return new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");
}

export const VALIDATOR_PUBKEY = defaultValidatorPubkey();

export const LOOFTA_PER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PER_PROGRAM_ID || "EQMRkmeCbzZaXyEDwgqiTqgg8kUjxBXPe616odmPjSwL",
);

/**
 * Memo program text prepended to MagicBlock PER txs so wallets (e.g. Phantom) can show intent.
 * Keep short — adds to legacy tx size budget.
 */
export const LOOFTA_PER_WALLET_MEMO = "Loofta: MagicBlock PER (private USDC).";

/** Plain SPL send from /send — not the PER program path. */
export const LOOFTA_PLAIN_SEND_MEMO = "Loofta: direct USDC (not PER).";

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
