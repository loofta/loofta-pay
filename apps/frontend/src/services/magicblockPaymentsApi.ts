/**
 * MagicBlock SPL Private Payments REST API
 * https://payments.magicblock.app/reference
 *
 * All endpoints return unsigned serialized transactions (base64 legacy format).
 * Caller is responsible for signing with the requiredSigners and broadcasting to `sendTo`.
 */

const BASE_URL = "https://payments.magicblock.app";

/** Devnet private leg: random delay in [min, max] (must match backend; MagicBlock API caps max at 600_000). */
export const MAGICBLOCK_PRIVATE_MIN_DELAY_MS = "30000";
export const MAGICBLOCK_PRIVATE_MAX_DELAY_MS_DEVNET = String(300_000);

/** For console logs — actual delay is chosen server-side when building the transfer. */
export function formatMagicblockPrivateDelayLogMs(apiCluster: "devnet" | "mainnet"): string {
  if (apiCluster === "devnet") {
    return `${MAGICBLOCK_PRIVATE_MIN_DELAY_MS}–${MAGICBLOCK_PRIVATE_MAX_DELAY_MS_DEVNET}`;
  }
  return "0–0";
}

/**
 * Shape returned by our own backend's build-private-transfer endpoints — deliberately trimmed
 * server-side to just what the client needs to sign/broadcast + display a fee. It does NOT
 * include MagicBlock's internal routing details (requiredSigners/validator/recentBlockhash/etc)
 * — those never leave the backend, see toClientResponse in magicblock-private-transfer.ts.
 */
export interface MagicblockTxResponse {
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  feeAmountUsdc?: number;
  feeBreakdown?: {
    looftaBpsUsdc: number;
    solRecoveryUsdc: number;
    solLamports: number;
    solPriceUsd: number;
  };
}

/** Private `/v1/spl/transfer` is built on the backend so the recipient is not exposed in the browser network tab. */

export interface MagicblockWithdrawParams {
  owner: string;
  mint: string;
  /** Amount in base units */
  amount: number;
  cluster?: "mainnet" | "devnet";
  initIfMissing?: boolean;
  initAtasIfMissing?: boolean;
}

/**
 * Build an unsigned withdraw transaction (for backend burner keypair to sign).
 * Withdraws SPL tokens from the ephemeral rollup back to the owner's base-chain ATA.
 */
export async function buildMagicblockWithdraw(
  params: MagicblockWithdrawParams,
): Promise<MagicblockTxResponse> {
  const res = await fetch(`${BASE_URL}/v1/spl/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner: params.owner,
      mint: params.mint,
      amount: params.amount,
      cluster: params.cluster ?? "devnet",
      initIfMissing: params.initIfMissing ?? true,
      initAtasIfMissing: params.initAtasIfMissing ?? true,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
    const msg = data.error?.message ?? data.message ?? JSON.stringify(data);
    throw new Error(`MagicBlock withdraw build failed: ${msg}`);
  }
  return data as MagicblockTxResponse;
}

/**
 * Get base-chain (Solana ATA) balance for an address.
 */
export async function getMagicblockBaseBalance(
  address: string,
  mint: string,
  cluster?: "mainnet" | "devnet",
): Promise<{ balance: string; ata: string; location: string }> {
  const params = new URLSearchParams({ address, mint, ...(cluster ? { cluster } : {}) });
  const res = await fetch(`${BASE_URL}/v1/spl/balance?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`MagicBlock base-balance error: ${JSON.stringify(data)}`);
  return data;
}

/**
 * Get ephemeral (PER) balance for an address.
 */
export async function getMagicblockPrivateBalance(
  address: string,
  mint: string,
  cluster?: "mainnet" | "devnet",
): Promise<{ balance: string; ata: string }> {
  const params = new URLSearchParams({ address, mint, ...(cluster ? { cluster } : {}) });
  const res = await fetch(`${BASE_URL}/v1/spl/private-balance?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`MagicBlock private-balance error: ${JSON.stringify(data)}`);
  return data;
}
