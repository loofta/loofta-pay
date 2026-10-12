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
  /** Large batches are split into several txs (Solana's 1232-byte limit). Sign + broadcast each
   *  in order and multiConfirm each entry's payment_ids. Absent on older backends. */
  transactions?: Array<{ transactionBase64: string; payment_ids: string[]; networkFeeUsdc: number }>;
}

/** The sender's one private MagicBlock transfer for a batch — sender wallet → this batch's
 *  fresh, single-use throwaway burner (never the shared fee-payer wallet). */
export interface MultiSendFundingBuildResult {
  transactionBase64: string;
  version: string;
  sendTo: string;
  feeAmountUsdc: number;
  paymentIds: string[];
  totalAmountUsdc: number;
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
  multi_send_batch_id: string;
}

export async function createMultiPayments(
  input: {
    recipients: MultiSendRecipient[];
    sender_wallet: string;
    cluster?: 'devnet' | 'mainnet';
    /** MagicBlock split (1–15) applied to every recipient's private payout. */
    split?: number;
    /** MagicBlock max delivery delay in ms, applied to every recipient's private payout. */
    maxDelayMs?: number;
  },
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

/** Step 2 of the private flow — one MagicBlock private transfer, sender wallet → this batch's
 *  fresh throwaway burner, for the whole batch multi-create just created. The sender's only
 *  signature for the batch. */
export async function buildMultiSendFunding(
  input: { multi_send_batch_id: string; sender_wallet: string; cluster?: 'devnet' | 'mainnet' },
  userId: string,
  accessToken?: string | null,
): Promise<MultiSendFundingBuildResult> {
  return fetchApi<MultiSendFundingBuildResult>('/send-payment/multi-build-funding', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
    accessToken,
  });
}

/** Step 3 of the private flow — sender broadcast the funding transfer; flips this batch's rows
 *  to IN_FLIGHT and kicks off the backend fan-out from the batch burner. Fire-and-forget on the
 *  backend, resolves immediately. */
export async function confirmMultiSendFunding(
  multiSendBatchId: string,
  userId: string,
  accessToken?: string | null,
  txHash?: string,
): Promise<void> {
  await fetchApi<{ ok: boolean }>('/send-payment/multi-confirm-funding', {
    method: 'POST',
    body: JSON.stringify({
      multi_send_batch_id: multiSendBatchId,
      ...(txHash ? { tx_hash: txHash } : {}),
    }),
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
