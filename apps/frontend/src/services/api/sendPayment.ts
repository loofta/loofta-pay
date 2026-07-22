/**
 * Send Payment API – multi-send (combined public SPL transfer or per-recipient MagicBlock)
 * Backend: POST /send-payment/multi-*
 */

import { fetchApi } from './client';

export type RecipientType = 'email' | 'twitter' | 'username' | 'discord' | 'github' | 'telegram';

export interface MultiSendRecipient {
  amount: number;
  recipient_type: RecipientType;
  recipient_identifier: string;
  message?: string;
}

/** One payment record per recipient — each gets their own unique /c/:id claim page and email. */
export interface MultiSendLinkItem {
  id: string;
  link: string;
  recipient_identifier: string;
  amount: string;
}

/** Single combined SPL transaction — fee payer pre-signed, sender must add signature. */
export interface MultiSendResult {
  transactionBase64: string;
  version: 'v0';
  lastValidBlockHeight: number;
  links: MultiSendLinkItem[];
  /** Payment IDs to pass to multiConfirm after the tx lands on-chain. */
  payment_ids: string[];
  totalAmountUsdc: number;
  recipientCount: number;
  /** ATA-rent recovery charged on top of totalAmountUsdc; 0 when every recipient already has a USDC ATA. */
  networkFeeUsdc: number;
}

/** One MagicBlock private transfer tx per recipient — sign all in one go. */
export interface MultiPrivateTxItem {
  paymentId: string;
  recipientIdentifier: string;
  amount: string;
  transactionBase64: string;
  version: string;
  sendTo: string;
  feeAmountUsdc: number;
}

export interface MultiPrivateBuildResult {
  transactions: MultiPrivateTxItem[];
  links: MultiSendLinkItem[];
  payment_ids: string[];
  totalAmountUsdc: number;
  recipientCount: number;
}

export interface MultiFeeItem {
  payment_id: string;
  recipient_identifier: string;
  amount: string;
  fee_usdc: number;
}

export interface MultiCreateResult {
  payment_ids: string[];
  links: MultiSendLinkItem[];
  fee_items: MultiFeeItem[];
  total_amount_usdc: number;
  total_fee_usdc: number;
  recipient_count: number;
}

export async function createMultiPayments(
  input: { recipients: MultiSendRecipient[]; sender_wallet: string; cluster?: 'devnet' | 'mainnet' },
  userId: string,
  accessToken?: string | null,
): Promise<MultiCreateResult> {
  return fetchApi<MultiCreateResult>('/send-payment/multi-create', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
    accessToken,
  });
}

export async function buildMultiPrivate(
  input: { recipients: MultiSendRecipient[]; sender_wallet: string; cluster?: 'devnet' | 'mainnet' },
  userId: string,
  accessToken?: string | null,
): Promise<MultiPrivateBuildResult> {
  return fetchApi<MultiPrivateBuildResult>('/send-payment/multi-build-private', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
    accessToken,
  });
}

export async function buildMultiSend(
  input: { recipients: MultiSendRecipient[]; sender_wallet: string; cluster?: 'devnet' | 'mainnet' },
  userId: string,
  accessToken?: string | null,
): Promise<MultiSendResult> {
  return fetchApi<MultiSendResult>('/send-payment/multi-build', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
    accessToken,
  });
}

export async function multiConfirm(
  paymentIds: string[],
  userId: string,
  accessToken?: string | null,
  txHash?: string,
  feeUsdc?: number,
): Promise<void> {
  await fetchApi<{ ok: boolean }>('/send-payment/multi-confirm', {
    method: 'POST',
    body: JSON.stringify({
      payment_ids: paymentIds,
      ...(txHash ? { tx_hash: txHash } : {}),
      ...(feeUsdc !== undefined ? { fee_usdc: feeUsdc } : {}),
    }),
    userId,
    accessToken,
  });
}
