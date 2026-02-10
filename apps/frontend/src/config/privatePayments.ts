/**
 * Private USDC payments on Solana via Magic Block Private Ephemeral Rollup (PER).
 * Used for request payment page and username link payments.
 */

import { PublicKey } from "@solana/web3.js";

/** Program ID (from Anchor.toml / declare_id!). Replace after anchor build if using a new keypair. */
export const PRIVATE_PAYMENTS_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PRIVATE_PAYMENTS_PROGRAM_ID ||
    "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

/** PDA seeds (must match program). */
export const DEPOSIT_PDA_SEED = Buffer.from("deposit");
export const VAULT_PDA_SEED = Buffer.from("vault");
export const CONFIG_PDA_SEED = Buffer.from("config");
export const PAYMENT_REQUEST_SEED = Buffer.from("payment_request");
export const AUDIT_LOG_SEED = Buffer.from("audit_log");

/** PER / TEE RPC. Use TEE URL for private rollup. */
export const PER_RPC_URL =
  process.env.NEXT_PUBLIC_PER_RPC_URL ||
  process.env.NEXT_PUBLIC_MAGICBLOCK_URL ||
  "https://devnet.magicblock.app";

/** TEE (Private ER) for confidential state. */
export const PER_TEE_RPC_URL =
  process.env.NEXT_PUBLIC_PER_TEE_RPC_URL || "https://tee.magicblock.app";

/** Validator for delegation (TEE validator). */
export const PER_VALIDATOR_PUBKEY = new PublicKey(
  process.env.NEXT_PUBLIC_PER_VALIDATOR_PUBKEY ||
    "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA"
);

/** USDC on Solana (mainnet). Use devnet mint for testing. */
export const USDC_MINT_SOLANA = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT_SOLANA ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export function getDepositPda(user: PublicKey, tokenMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [DEPOSIT_PDA_SEED, user.toBuffer(), tokenMint.toBuffer()],
    PRIVATE_PAYMENTS_PROGRAM_ID
  );
  return pda;
}

export function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [CONFIG_PDA_SEED],
    PRIVATE_PAYMENTS_PROGRAM_ID
  );
  return pda;
}

export function getAuditLogPda(paymentId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [AUDIT_LOG_SEED, paymentId],
    PRIVATE_PAYMENTS_PROGRAM_ID
  );
  return pda;
}
