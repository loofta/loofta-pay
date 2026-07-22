/**
 * Send Payment API – create link, get public details, claim, reclaim
 * Backend: POST/GET /send-payment/*
 */

import { fetchApi } from './client';
import type { MagicblockTxResponse } from '../magicblockPaymentsApi';

export type SendPaymentStatus = 'OPEN' | 'FUNDED' | 'CLAIMED' | 'CANCELLED' | 'EXPIRED';
export type RecipientType = 'email' | 'twitter' | 'username' | 'discord' | 'github' | 'telegram';

export interface SendPaymentLinkPublic {
  id: string;
  amount: string;
  token: string;
  chain: string;
  recipient_type: RecipientType;
  status: SendPaymentStatus;
  message?: string | null;
  /** USDC ATA deposit address (derived from burner). The underlying burner wallet is never exposed. */
  deposit_address?: string | null;
  /** SOL lamports to send to burner for claim gas (e.g. 500000 = 0.0005 SOL). */
  required_sol_lamports?: number;
  is_sender?: boolean;
}

export interface CreateSendPaymentInput {
  amount: number;
  recipient_type: RecipientType;
  recipient_identifier: string;
  message?: string;
}

export interface CreateSendPaymentResult {
  id: string;
  link: string;
  /** USDC ATA deposit address (burner-derived). Send USDC here. */
  deposit_address: string;
  /** Burner wallet pubkey — needed to fund SOL gas for claim. */
  burner_address: string;
  /** SOL lamports sender should send to burner for claim gas (0.0005 SOL). */
  required_sol_lamports: number;
  amount: string;
  token: string;
  per_mode?: boolean;
}

export interface ClaimSendPaymentResult {
  claim_tx_hash: string;
  amount_received: string;
}

export interface ReclaimSendPaymentResult {
  reclaim_tx_hash: string;
  amount_reclaimed: string;
}

export async function createSendPayment(
  input: CreateSendPaymentInput,
  userId: string,
  accessToken?: string | null,
): Promise<CreateSendPaymentResult> {
  return fetchApi<CreateSendPaymentResult>('/send-payment/create', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
    accessToken,
  });
}

export interface MySendPaymentLinkItem {
  id: string;
  amount: string;
  token: string;
  status: string;
  recipient_type: string;
  created_at: string;
}

export async function getMySendPaymentLinks(userId: string, accessToken?: string | null): Promise<MySendPaymentLinkItem[]> {
  return fetchApi<MySendPaymentLinkItem[]>('/send-payment/my-links', { userId, accessToken });
}

export async function getSendPaymentPublic(
  id: string,
  userId?: string
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}`, { userId });
}

export async function confirmSendPaymentFunded(
  id: string,
  depositTxHash: string | null,
  userId: string,
  accessToken?: string | null,
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}/confirm-funded`, {
    method: 'POST',
    body: JSON.stringify({ deposit_tx_hash: depositTxHash || undefined }),
    userId,
    accessToken,
  });
}

export async function claimSendPayment(
  id: string,
  userId: string,
  options?: { forward_to?: { chain: string; token: string; address: string } },
  accessToken?: string | null,
): Promise<ClaimSendPaymentResult> {
  return fetchApi<ClaimSendPaymentResult>(`/send-payment/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
    userId,
    accessToken,
  });
}

export async function reclaimSendPayment(
  id: string,
  userId: string,
  accessToken?: string | null,
): Promise<ReclaimSendPaymentResult> {
  return fetchApi<ReclaimSendPaymentResult>(`/send-payment/${id}/reclaim`, {
    method: 'POST',
    body: JSON.stringify({}),
    userId,
    accessToken,
  });
}

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

/**
 * Build unsigned MagicBlock private transfer — recipient pubkey comes from DB only
 * (not sent from the browser).
 */
export async function buildSendPaymentPrivateTransfer(
  sendPaymentId: string,
  userId: string,
  senderWallet: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
): Promise<MagicblockTxResponse> {
  return fetchApi<MagicblockTxResponse>(`/send-payment/${sendPaymentId}/build-private-transfer`, {
    method: 'POST',
    body: JSON.stringify({ sender_wallet: senderWallet, cluster }),
    userId,
    accessToken,
  });
}
