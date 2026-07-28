/**
 * Loofta's own cut on Naira off-ramps ("claim in Naira" direct sweep and the manual PAJ
 * Cash withdraw flow). Taken by splitting the on-chain USDC transfer — PAJ itself pays out
 * 100% of whatever lands at the destination address, so there's no order-level fee param.
 * 10bps matches the existing SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS precedent
 * (magicblock-private-transfer.ts) already charged on private claims/multi-send.
 */
const PAJ_CASH_FEE_TIERS: Array<{ maxUsdc: number; bps: number }> = [
  { maxUsdc: 5, bps: 0 },
  { maxUsdc: 50, bps: 10 },
  { maxUsdc: 500, bps: 7 },
  { maxUsdc: Infinity, bps: 5 },
];

export function computeLooftaFeeUsdc(amountUsdc: number): number {
  if (!(amountUsdc > 0)) return 0;
  const tier = PAJ_CASH_FEE_TIERS.find((t) => amountUsdc < t.maxUsdc) ?? PAJ_CASH_FEE_TIERS[PAJ_CASH_FEE_TIERS.length - 1];
  // USDC has 6 decimals — round to the nearest base unit.
  return Math.round((amountUsdc * tier.bps / 10_000) * 1_000_000) / 1_000_000;
}
