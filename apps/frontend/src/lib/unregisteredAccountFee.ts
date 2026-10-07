/**
 * Flat USDC fee charged when paying a handle/email (unregistered claim path) — covers burner
 * ATA / claim infrastructure. Direct wallet-to-wallet sends skip this; the recipient already
 * has an address, so there's no claim to set up. Inspired by hush's flat $0.10 leg, kept
 * separate from MagicBlock's private relay fee.
 */
export const UNREGISTERED_ACCOUNT_FEE_USD = 0.1;

/** Loofta fee-collection wallet (same env as private-transfer Loofta cut). Undefined when not
 *  configured — callers should skip collecting the fee rather than fail the whole payment. */
export function looftaPlatformFeeWallet(): string | null {
  const address = process.env.NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET?.trim();
  return address || null;
}

export function totalWithUnregisteredAccountFee(amountUsd: number, applies: boolean): number {
  return applies ? amountUsd + UNREGISTERED_ACCOUNT_FEE_USD : amountUsd;
}
