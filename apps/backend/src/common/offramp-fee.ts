/**
 * Cash-outs to Venmo / Cash App / Revolut / Wise / PayPal: Loofta takes no fee, and the standard rate is free for the
 * sender. Fast delivery is an option: the deposit is priced FAST_RATE_PERCENT under the oracle so a market maker
 * keeps that and fills sooner. All of it goes to the market maker. Loofta earns only its Peer referral share.
 * Must stay in sync with apps/frontend/src/services/peerCash.ts.
 */
export const FAST_RATE_PERCENT = 1;

const bps = (ratePercent: number) => BigInt(Math.round((ratePercent > 0 ? ratePercent : 0) * 100));

/** What the market maker keeps out of the gross amount at this rate (0 for standard). Not a Loofta fee. */
export function cashoutFeeAtomic(grossAtomic: bigint, ratePercent = 0): bigint {
  if (grossAtomic <= 0n) return 0n;
  return (grossAtomic * bps(ratePercent)) / 10_000n;
}

/** Base deposit size: the whole amount, since Loofta keeps nothing. */
export function cashoutDepositAtomic(grossAtomic: bigint): bigint {
  return grossAtomic > 0n ? grossAtomic : 0n;
}

export function cashoutLooftaFeeAtomic(grossAtomic: bigint): bigint {
  return grossAtomic - cashoutDepositAtomic(grossAtomic);
}

/** USDC the sender must put in so the recipient still gets `payout` after the market maker's share. */
export function cashoutGrossAtomic(payoutAtomic: bigint, ratePercent = 0): bigint {
  if (payoutAtomic <= 0n) return 0n;
  let gross = (payoutAtomic * 10_000n) / (10_000n - bps(ratePercent));
  while (gross - cashoutFeeAtomic(gross, ratePercent) < payoutAtomic) gross += 1n;
  return gross;
}

/** Negative oracle spread for the deposit. 0 at the standard rate, so no repricing is needed. */
export function fillerIncentiveSpreadBps(grossAtomic: bigint, ratePercent = 0): number {
  return cashoutDepositAtomic(grossAtomic) > 0n && ratePercent > 0 ? -Number(bps(ratePercent)) : 0;
}
