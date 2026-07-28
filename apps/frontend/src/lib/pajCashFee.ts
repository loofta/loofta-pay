/**
 * Client-side mirror of the backend's Loofta fee schedule for PAJ Cash Naira off-ramps
 * (apps/backend/src/common/paj-cash-fee.ts) — used only for display before the amount is
 * submitted. The backend is the source of truth and always recomputes/enforces this itself.
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
  return Math.round((amountUsdc * tier.bps / 10_000) * 1_000_000) / 1_000_000;
}
