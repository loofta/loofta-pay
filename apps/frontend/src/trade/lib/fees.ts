/**
 * Loofta's own fees in the mini app. Network fees and partner fees are separate and shown where they apply.
 *
 *  - Swaps (buy and sell): 0.30%, set in the backend (SWAP_FEE_BPS), taken from what you receive.
 *  - Sending to a Solana address: WITHDRAW_FEE_BPS, taken from the amount you send, paid to FEE_WALLET.
 *    Sending to another chain already includes the 0.30% bridge fee, so it carries no second fee.
 *
 *  - Prediction bets: PREDICT_FEE_BPS (0.8% by default, in line with wallet swap fees), added on top of the bet and paid to FEE_WALLET.
 *    Taken only after the bet has filled. Selling and claiming carry no Loofta fee.
 *
 * With no FEE_WALLET set, sends are free. That is on purpose: a missing setting must never send
 * money to a wrong address.
 */
export const SWAP_FEE_PERCENT = 0.3;
export const WITHDRAW_FEE_BPS = Number(process.env.NEXT_PUBLIC_WITHDRAW_FEE_BPS ?? 10);
export const FEE_WALLET = process.env.NEXT_PUBLIC_FEE_WALLET || "";

export const PREDICT_FEE_BPS = Number(process.env.NEXT_PUBLIC_PREDICT_FEE_BPS ?? 80);

/** The fee in dollars on a bet of `betUsd`, rounded up to whole cents. 0 when fees are off. */
export function predictFeeUsd(betUsd: number): number {
  if (!FEE_WALLET || !(PREDICT_FEE_BPS > 0) || !(betUsd > 0)) return 0;
  return Math.ceil((betUsd * PREDICT_FEE_BPS) / 100) / 100;
}

/** The fee in dollars for sending `amountUsd`, rounded to whole cents and never more than the amount. 0 when fees are off. */
export function withdrawFeeUsd(amountUsd: number): number {
  if (!FEE_WALLET || !(WITHDRAW_FEE_BPS > 0) || !(amountUsd > 0)) return 0;
  return Math.min(amountUsd, Math.ceil((amountUsd * WITHDRAW_FEE_BPS) / 100) / 100);
}
