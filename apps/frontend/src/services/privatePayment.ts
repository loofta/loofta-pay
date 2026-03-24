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
