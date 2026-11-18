/** A partner may never take more than this share of any single payout, whatever fees it configures. */
export const MAX_PARTNER_FEE_SHARE = 0.25;

/**
 * The partner's cut for one withdrawal of `grossUsdc`, always on top of Loofta's own fee. A flat
 * fee is charged once per withdrawal (the caller passes the whole withdrawal's gross, not one
 * payout's), and the result is capped so a recipient always keeps at least 75% of what they were
 * paid, whatever the partner configured. Rounded up to the base unit.
 */
export function computePartnerFeeUsdc(
  partner: { fee_fixed_usd: number | string; fee_percent_bps: number | string },
  grossUsdc: number,
): number {
  const raw = Number(partner.fee_fixed_usd) + (grossUsdc * Number(partner.fee_percent_bps)) / 10_000;
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
