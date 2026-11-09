/**
 * Flat USDC fee charged when paying an email or social handle (unregistered claim path) —
 * covers burner ATA / claim infrastructure. Charged on public and private payments.
 * A Loofta username and a direct wallet send skip this. Kept separate from MagicBlock's
 * private relay fee.
 */
export const UNREGISTERED_ACCOUNT_FEE_USD = 0.2;

/** The web app waives the claim fee (shown as "Waived"). The Telegram bot and MCP still charge it
 *  through their own backend paths, which do not read this flag. */
export const UNREGISTERED_ACCOUNT_FEE_WAIVED = false;

/** Loofta fee-collection wallet (same env as private-transfer Loofta cut). Undefined when not
 *  configured — callers should skip collecting the fee rather than fail the whole payment. */
export function looftaPlatformFeeWallet(): string | null {
  const address = process.env.NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET?.trim();
  return address || null;
}

export function totalWithUnregisteredAccountFee(amountUsd: number, applies: boolean): number {
  return applies ? amountUsd + UNREGISTERED_ACCOUNT_FEE_USD : amountUsd;
}

/** Charged when this handle/email is not a Loofta account, or is one that has never received USDC.
 *  Do not assume unregistered while the request is in flight or after it fails. */
export function unregisteredClaimFeeUsd(opts: {
  destApplies: boolean;
  registered: boolean;
  lookupResolved: boolean;
  /** Registered, but has never received USDC: first payment is a claim payment too. */
  needsClaim?: boolean;
  /** The destination is a Loofta username (which destApplies excludes for unknown handles). */
  usernameDest?: boolean;
}): number {
  if (UNREGISTERED_ACCOUNT_FEE_WAIVED) return 0;
  return unregisteredClaimFeeWouldApply(opts) ? UNREGISTERED_ACCOUNT_FEE_USD : 0;
}

/** True when the fee would be charged if it were not waived. Drives the "Waived" label. */
export function unregisteredClaimFeeWouldApply(opts: {
  destApplies: boolean;
  registered: boolean;
  lookupResolved: boolean;
  needsClaim?: boolean;
  usernameDest?: boolean;
}): boolean {
  if (!opts.lookupResolved) return false;
  if (opts.registered) return !!opts.needsClaim && (opts.destApplies || !!opts.usernameDest);
  return opts.destApplies && !opts.registered;
}
