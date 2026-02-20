/**
 * Private payments (Privacy Cash).
 * Frontend uses npm "privacycash": "^1.1.3" (same as loofta-pay-public). Dev/build use webpack (not Turbopack)
 * for WASM support; postinstall copies hasher.rs WASM files into dist/browser-fat/es. See next.config.mjs
 * webpack config and apps/frontend/package.json scripts/postinstall.
 */

import type { VersionedTransaction } from "@solana/web3.js";

export const PRIVACY_CASH_FEES = {
  withdraw_fee_rate: 0.0035,
  withdraw_rent_fee: 0.006,
  deposit_fee_rate: 0,
  minimum_withdrawal: { usdc: 2 },
  usdc_withdraw_rent_fee: 0.744548676,
};

/** When "true" or "1", private payment is enabled; otherwise UI shows "Coming soon". */
const enablePrivatePayment =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT === "true" ||
   process.env.NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT === "1");

export const PRIVATE_PAYMENT_COMING_SOON = !enablePrivatePayment;

/** No-op: private payments are coming soon. */
export async function payPrivatelyWithPrivacyCash(_options: {
  walletAddress: string;
  amountUSD: number;
  recipientAddress: string;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  recipientPaysFees?: boolean;
}): Promise<{ success: boolean; signature?: string; error?: string }> {
  return { success: false, error: "Private payments coming soon." };
}
