/**
 * Send Payment API – create link, get public details, claim, reclaim
 * Backend: POST/GET /send-payment/*
 */

import { fetchApi } from './client';
import type { MagicblockTxResponse } from '../magicblockPaymentsApi';

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
