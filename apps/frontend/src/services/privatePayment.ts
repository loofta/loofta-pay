/**
 * Feature flags and display constants for MagicBlock PER private payments.
 */

/** When "true" or "1", PER private flows are enabled and default-on where applicable. */
export const PRIVATE_PAYMENT_ENABLED =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT === "true" ||
    process.env.NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT === "1");

/** Legacy name: private UX is gated until the env flag is on. */
export const PRIVATE_PAYMENT_COMING_SOON = !PRIVATE_PAYMENT_ENABLED;

/**
 * Withdraw fee estimates for optional-private display math (USDC amounts).
 * Not tied to any third-party SDK.
 */
export const PRIVATE_TRANSFER_DISPLAY_FEES = {
  withdraw_fee_rate: 0.0035,
  withdraw_rent_fee: 0.006,
  deposit_fee_rate: 0,
  minimum_withdrawal: { usdc: 2 },
  usdc_withdraw_rent_fee: 0.744548676,
};
