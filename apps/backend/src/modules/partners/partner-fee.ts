/** A partner may never take more than this share of any single payout, whatever fees it configures. */
export const MAX_PARTNER_FEE_SHARE = 0.25;

/**
 * The partner's cut for one withdrawal of `grossUsdc`, always on top of Loofta's own fee. A flat
 * fee is charged once per withdrawal (the caller passes the whole withdrawal's gross, not one
 * payout's), and the result is capped so a recipient always keeps at least 75% of what they were
 * paid, whatever the partner configured. Rounded up to the base unit. `flatAlreadyPaid` drops the flat part.
 */
export function computePartnerFeeUsdc(
  partner: { fee_fixed_usd: number | string; fee_percent_bps: number | string },
  grossUsdc: number,
  opts: { flatAlreadyPaid?: boolean } = {},
): number {
  // A retry after a partial failure must not charge the flat fee a second time: it was already taken from a payout
  // of the same withdrawal that went through.
  const flat = opts.flatAlreadyPaid ? 0 : Number(partner.fee_fixed_usd);
  const raw = flat + (grossUsdc * Number(partner.fee_percent_bps)) / 10_000;
  const capped = Math.min(raw, grossUsdc * MAX_PARTNER_FEE_SHARE);
  return Math.ceil(capped * 1_000_000) / 1_000_000;
}

/**
 * Splits one withdrawal's total partner fee across the payouts being withdrawn, in integer base
 * units. The shares always sum to exactly `totalFeeUnits` (no unit lost or invented), each share is
 * proportional to its payout (so the per-payout cap still holds), and the rounding remainder goes
 * to the largest payout.
 */
export function allocateFeeUnits(payoutUnits: bigint[], totalFeeUnits: bigint): bigint[] {
  const gross = payoutUnits.reduce((a, b) => a + b, BigInt(0));
  if (gross <= BigInt(0) || totalFeeUnits <= BigInt(0)) return payoutUnits.map(() => BigInt(0));
  const shares = payoutUnits.map((u) => (u * totalFeeUnits) / gross);
  const assigned = shares.reduce((a, b) => a + b, BigInt(0));
  let largest = 0;
  payoutUnits.forEach((u, i) => { if (u > payoutUnits[largest]) largest = i; });
  shares[largest] += totalFeeUnits - assigned;
  return shares;
}

/** Loofta's own fee on every partner withdrawal, whatever route the recipient picks: a flat part and a percentage. */
export const LOOFTA_WITHDRAW_FLAT_USD = 0.05;
export const LOOFTA_WITHDRAW_BPS = 30;
/** The two numbers that make Loofta's fee. The admin dashboard edits them; the constants above are the defaults. */
export type LooftaFeeRates = { flatUsd: number; bps: number };
export const DEFAULT_LOOFTA_FEE_RATES: LooftaFeeRates = { flatUsd: LOOFTA_WITHDRAW_FLAT_USD, bps: LOOFTA_WITHDRAW_BPS };
/** Hard ceilings, so a typo in the admin can never charge a recipient a huge fee. */
export const MAX_LOOFTA_FEE_FLAT_USD = 2;
export const MAX_LOOFTA_FEE_BPS = 300;
/** P2P cash-outs below this are refused: the peer market does not fill smaller orders reliably. */
export const P2P_MIN_USD = 10;
/** P2P partner cash-outs are always priced this many percent under the market rate, so a buyer fills them fast. */
export const P2P_RATE_PERCENT = 1;

/**
 * Loofta's fee for one withdrawal of `grossUsdc`, rounded up to the base unit. The flat part is charged once per
 * withdrawal; `flatAlreadyPaid` drops it for the leftovers of a withdrawal that partly failed and is being retried.
 */
export function computeLooftaWithdrawFeeUsdc(grossUsdc: number, opts: { flatAlreadyPaid?: boolean } & Partial<LooftaFeeRates> = {}): number {
  if (!(grossUsdc > 0)) return 0;
  // Whole base units all the way, so float noise (0.15 becoming 0.150001) can never round a fee up.
  const flat = opts.flatAlreadyPaid ? 0 : Math.round((opts.flatUsd ?? LOOFTA_WITHDRAW_FLAT_USD) * 1_000_000);
  const pct = Math.ceil((Math.round(grossUsdc * 1_000_000) * (opts.bps ?? LOOFTA_WITHDRAW_BPS)) / 10_000);
  return (flat + pct) / 1_000_000;
}
