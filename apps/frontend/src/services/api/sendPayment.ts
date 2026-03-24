/**
 * Send Payment API – create link, get public details, claim, reclaim
 * Backend: POST/GET /send-payment/*
 */

import { fetchApi } from './client';

export type SendPaymentStatus = 'OPEN' | 'FUNDED' | 'CLAIMED' | 'CANCELLED' | 'EXPIRED';
export type RecipientType = 'email' | 'twitter' | 'username';

export interface SendPaymentLinkPublic {
  id: string;
  amount: string;
  token: string;
  chain: string;
  recipient_type: RecipientType;
  status: SendPaymentStatus;
  message?: string | null;
  deposit_address?: string | null;
  burner_address?: string | null;
  /** Resolved recipient (MagicBlock PER). */
  per_recipient_pubkey?: string | null;
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
  deposit_address: string;
  burner_address: string;
  /** SOL lamports sender should send to burner for claim gas (0.0005 SOL). */
  required_sol_lamports: number;
  amount: string;
  token: string;
  per_recipient_pubkey?: string;
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
  userId: string
): Promise<CreateSendPaymentResult> {
  return fetchApi<CreateSendPaymentResult>('/send-payment/create', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
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

export async function getMySendPaymentLinks(userId: string): Promise<MySendPaymentLinkItem[]> {
  return fetchApi<MySendPaymentLinkItem[]>('/send-payment/my-links', { userId });
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
  userId: string
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}/confirm-funded`, {
    method: 'POST',
    body: JSON.stringify({ deposit_tx_hash: depositTxHash || undefined }),
    userId,
  });
}

export async function claimSendPayment(
  id: string,
  userId: string,
  options?: { forward_to?: { chain: string; token: string; address: string } }
): Promise<ClaimSendPaymentResult> {
  return fetchApi<ClaimSendPaymentResult>(`/send-payment/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
    userId,
  });
}

export async function reclaimSendPayment(
  id: string,
  userId: string
): Promise<ReclaimSendPaymentResult> {
  return fetchApi<ReclaimSendPaymentResult>(`/send-payment/${id}/reclaim`, {
    method: 'POST',
    body: JSON.stringify({}),
    userId,
  });
}
