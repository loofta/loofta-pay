import { PublicKey } from "@solana/web3.js";
import { getSolanaCluster, type SolanaClusterName } from "@/lib/solanaCluster";
import type { NetworkMode } from "@/lib/solanaRpc";

/**
 * MagicBlock PER / TEE — see:
 * https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart
 *
 * Override with NEXT_PUBLIC_MAGICBLOCK_URL (no query string; stripped if present).
 * Defaults are cluster-aware when unset:
 * - devnet / testnet: `https://tee.magicblock.app`  (devnet TEE — serves /auth/challenge + PER JSON-RPC)
 * - mainnet-beta:     `https://mainnet-tee.magicblock.app`
 *
 * NOTE: devnet.magicblock.app is a JSON-RPC-only endpoint (non-private ER) and
 *       does NOT expose /auth/challenge — do NOT use it as the TEE/PER base.
 *       devnet-tee.magicblock.app is actually the mainnet TEE (same identity as mainnet-tee)
 *       and monitors mainnet Solana — do NOT use it for devnet PER.
 *
 * Override: NEXT_PUBLIC_MAGICBLOCK_URL=http://localhost:7799 for local ephemeral-validator.
 */
function defaultMagicblockTeeBase(): string {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_URL?.replace(/\?.*$/, "").trim();
  if (explicit) return explicit;
  const cluster: SolanaClusterName = getSolanaCluster();
  if (cluster === "mainnet-beta") return "https://mainnet-tee.magicblock.app";
  return "https://tee.magicblock.app";
}

/** MagicBlock TEE / ephemeral HTTP(S) endpoint for getAuthToken + Connection(?token=). Build-time default. */
export const EPHEMERAL_RPC_URL = defaultMagicblockTeeBase();

/** Runtime networkMode-aware TEE URL — use this instead of EPHEMERAL_RPC_URL in hooks/components. */
export function getEphemeralRpcForMode(mode: NetworkMode): string {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_URL?.replace(/\?.*$/, "").trim();
  if (explicit) return explicit;
  return mode === "mainnet" ? "https://mainnet-tee.magicblock.app" : "https://tee.magicblock.app";
}

/**
 * ER validator identity for delegate instructions (must match TEE / environment).
 * https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development
 *
 * Override: NEXT_PUBLIC_MAGICBLOCK_VALIDATOR
 * - Devnet TEE (tee.magicblock.app):           FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA
 * - Mainnet TEE (mainnet-tee.magicblock.app):  MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo
 * - Local ER: mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
 *
 * NOTE: devnet-tee.magicblock.app is a misleading name — it is actually the mainnet TEE
 *       (same validator identity as mainnet-tee.magicblock.app) and monitors mainnet Solana.
 */
function defaultValidatorPubkey(): PublicKey {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_VALIDATOR?.trim();
  if (explicit) return new PublicKey(explicit);
  const cluster = getSolanaCluster();
  if (cluster === "mainnet-beta") return new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
  return new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");
}

export const VALIDATOR_PUBKEY = defaultValidatorPubkey();

/** Runtime networkMode-aware validator pubkey. */
export function getValidatorPubkeyForMode(mode: NetworkMode): PublicKey {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_VALIDATOR?.trim();
  if (explicit) return new PublicKey(explicit);
  return mode === "mainnet"
    ? new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo")
    : new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");
}

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
