/**
 * Flat USDC fee charged when paying an email or social handle (unregistered claim path) —
 * covers burner ATA / claim infrastructure. Charged on public and private payments.
 * A Loofta username and a direct wallet send skip this. Kept separate from MagicBlock's
 * private relay fee.
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
