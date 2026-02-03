/**
 * Private payments (Privacy Cash) – Coming soon.
 * SDK integration removed; UI shows "Coming soon" for private payment flows.
 */

import type { VersionedTransaction } from "@solana/web3.js";

export const PRIVACY_CASH_FEES = {
  withdraw_fee_rate: 0.0035,
  withdraw_rent_fee: 0.006,
  deposit_fee_rate: 0,
  minimum_withdrawal: { usdc: 2 },
  usdc_withdraw_rent_fee: 0.744548676,
};

export const PRIVATE_PAYMENT_COMING_SOON = true;

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
