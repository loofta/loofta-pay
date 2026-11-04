/**
 * Flat USDC fee charged when paying an email or social handle (unregistered claim path) —
 * covers burner ATA / claim infrastructure. Charged on public and private payments.
 * A Loofta username and a direct wallet send skip this. Kept separate from MagicBlock's
 * private relay fee.
 */
export const UNREGISTERED_ACCOUNT_FEE_USD = 0.1;

/** The web app waives the claim fee (shown as "Waived"). The Telegram bot and MCP still charge it
 *  through their own backend paths, which do not read this flag. */
export const UNREGISTERED_ACCOUNT_FEE_WAIVED = true;

/** Loofta fee-collection wallet (same env as private-transfer Loofta cut). Undefined when not
 *  configured — callers should skip collecting the fee rather than fail the whole payment. */
export function looftaPlatformFeeWallet(): string | null {
  const address = process.env.NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET?.trim();
  return address || null;
}

export function totalWithUnregisteredAccountFee(amountUsd: number, applies: boolean): number {
  return applies ? amountUsd + UNREGISTERED_ACCOUNT_FEE_USD : amountUsd;
}

/** $0.10 only after lookup confirms this handle/email is not a Loofta account.
 *  Do not assume unregistered while the request is in flight or after it fails. */
export function unregisteredClaimFeeUsd(opts: {
  destApplies: boolean;
  registered: boolean;
  lookupResolved: boolean;
}): number {
  if (UNREGISTERED_ACCOUNT_FEE_WAIVED) return 0;
  return unregisteredClaimFeeWouldApply(opts) ? UNREGISTERED_ACCOUNT_FEE_USD : 0;
}

/** True when the fee would be charged if it were not waived. Drives the "Waived" label. */
export function unregisteredClaimFeeWouldApply(opts: {
  destApplies: boolean;
  registered: boolean;
  lookupResolved: boolean;
}): boolean {
  return opts.destApplies && opts.lookupResolved && !opts.registered;
}
