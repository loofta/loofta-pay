/**
 * POST /payouts — authed with a raw integrator API key (not a Privy access token), same pattern
 * as paymentLinks.ts's createPaymentLinkWithKey.
 */

import { fetchApi } from './client';

export type PayoutRecipientType = 'email' | 'username' | 'twitter' | 'discord' | 'github' | 'telegram';
export const PAYOUT_RECIPIENT_TYPES: PayoutRecipientType[] = ['email', 'username', 'twitter', 'discord', 'github', 'telegram'];

export type PayoutFundingSource = 'gram_ton' | 'usdc_base' | 'usdc_stellar';

export interface CreatedPayout {
  payment_id: string;
  short_id: string | null;
  claim_link: string;
  is_private: boolean;
  unsigned_transaction?: string;
  transaction_version?: 'legacy' | 'v0';
  send_to?: 'base' | 'ephemeral';
  fee_amount_usdc?: number;
  funding_source?: PayoutFundingSource;
  deposit_address?: string;
  deposit_memo?: string | null;
  deposit_amount?: string;
  deposit_deadline?: string;
  deposit_note?: string;
}

export async function createPayoutWithKey(
  apiKey: string,
  input: {
    amount: number;
    recipientType: PayoutRecipientType;
    recipientIdentifier: string;
    senderWallet?: string;
    fundingSource?: PayoutFundingSource;
    refundWallet?: string;
    message?: string;
    isPrivate?: boolean;
  },
): Promise<CreatedPayout> {
  return fetchApi<CreatedPayout>('/payouts', {
    method: 'POST',
    accessToken: apiKey,
    body: JSON.stringify({
      amount: input.amount,
      recipient_type: input.recipientType,
      recipient_identifier: input.recipientIdentifier,
      sender_wallet: input.senderWallet,
      funding_source: input.fundingSource,
      refund_wallet: input.refundWallet,
      message: input.message,
      is_private: input.isPrivate,
    }),
  });
}
