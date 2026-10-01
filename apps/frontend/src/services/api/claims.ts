/**
 * Claims/Payments API Service
 *
 * Handles payment-related operations.
 * New records live in the `payments` table; legacy records remain in `claims`.
 */

import { fetchApi } from './client';
import type { MagicblockTxResponse } from '../magicblockPaymentsApi';

// ===========================================
// Types
// ===========================================

export type ClaimStatus =
  | 'OPEN'
  | 'PENDING_DEPOSIT'
  | 'IN_FLIGHT'
  | 'PRIVATE_TRANSFER_PENDING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'CANCELLED';

export type PaymentDirection = 'from_sender' | 'from_recipient';

/**
 * Unified payment shape returned by API routes.
 * New payments use the `payments` table; legacy claims are normalised to this same shape.
 * Backward-compat aliases (to_symbol, to_chain, claim_burner_address) are added by the
 * GET /api/claims/[id] route so the payment page doesn't need changes.
 */
export interface Claim {
  id: string;
  amount: string;
  direction: PaymentDirection;
  // Backward-compat aliases injected by the API layer for legacy UI code
  to_symbol: string;   // always "USDC" for new payments
  to_chain: string;    // always "solana" for new payments
  recipient_address?: string;
  recipient_username?: string | null;
  recipient_email?: string | null;
  created_by: string | null;
  status: ClaimStatus;
  paid_at: string | null;
  is_private: boolean | null;   // deprecated — always null for new payments
  paid_with_token: string | null; // deprecated — always null for new payments
  paid_with_chain: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  is_devnet?: boolean;
  sender_tx_hash?: string | null;
  // Burner (compat alias: claim_burner_address = burner_address)
  burner_address?: string | null;
  claim_burner_address?: string | null;
  // Creator display helpers (enriched by API)
  creator_email?: string | null;   // deprecated — maps to recipient_email for legacy
  creator_username?: string | null;
  org_referral?: string | null;
}

export interface ClaimIntent {
  id: string;
  claim_id: string;
  quote_id: string | null;
  deposit_address: string | null;
  memo: string | null;
  deadline: string | null;
  time_estimate: number | null;
  status: string | null;
  from_chain: string | null;
  to_chain: string | null;
  paid_amount: string | null;
  last_status_payload: unknown;
  created_at: string;
  updated_at: string;
}

export interface CreateClaimInput {
  amount: number;
  toSel: {
    symbol: string;
    chain: string;
  };
  recipient: string;
  userId?: string;
  orgReferral?: string;
  direction?: PaymentDirection;
  cluster?: 'devnet' | 'mainnet';
}

// ===========================================
// API Functions
// ===========================================

export async function createClaim(data: CreateClaimInput): Promise<{ claim: Claim }> {
  return fetchApi<{ claim: Claim }>('/claims', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getClaimById(id: string, userId?: string, accessToken?: string | null): Promise<{ claim: Claim }> {
  return fetchApi<{ claim: Claim }>(`/claims/${id}`, { userId, accessToken });
}

export async function getClaimWithLatestIntent(
  id: string
): Promise<{ claim: Claim; intent: ClaimIntent | null }> {
  return fetchApi<{ claim: Claim; intent: ClaimIntent | null }>(`/claims/${id}/latest-intent`);
}

export async function getClaimsByUser(userId: string, accessToken?: string | null): Promise<{ claims: Claim[] }> {
  return fetchApi<{ claims: Claim[] }>('/claims/user', { userId, accessToken });
}

export interface UpdateClaimStatusExtra {
  txHash?: string;
  paidWith?: string;
  isPrivate?: boolean;
  paidWithToken?: string;
  paidWithChain?: string;
  feeAmountUsdc?: number;
  feeBreakdown?: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number };
}

export async function updateClaimStatus(
  id: string,
  status: ClaimStatus,
  extra?: UpdateClaimStatusExtra,
  userId?: string,
  accessToken?: string | null,
): Promise<{ claim: Claim }> {
  return fetchApi<{ claim: Claim }>(`/claims/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, ...extra }),
    userId,
    accessToken,
  });
}

export async function countersignAndBroadcastPER(
  transactionBase64: string,
  userId: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
): Promise<{ signature: string }> {
  return fetchApi<{ signature: string }>('/claims/solana-sponsor/per/sign-and-broadcast', {
    method: 'POST',
    body: JSON.stringify({ transaction: transactionBase64, cluster }),
    userId,
    accessToken,
  });
}

export async function buildClaimPrivateTransfer(
  claimId: string,
  userId: string,
  senderWallet: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
  gasless = true,
  /** Same split/delay timing-obfuscation sliders as /fomo and GuestCheckoutPay — omit either to
   *  keep the backend's own default (auto split on mainnet, cluster-default delay). */
  split?: number,
  maxDelayMs?: number,
): Promise<MagicblockTxResponse> {
  return fetchApi<MagicblockTxResponse>(`/claims/${claimId}/build-private-transfer`, {
    method: 'POST',
    body: JSON.stringify({ sender_wallet: senderWallet, cluster, gasless, split, max_delay_ms: maxDelayMs }),
    userId,
    accessToken,
  });
}

export async function buildGiveawayFundingPrivateTransfer(
  giveawayId: string,
  userId: string,
  senderWallet: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
  gasless = true,
): Promise<MagicblockTxResponse> {
  return fetchApi<MagicblockTxResponse>(`/giveaways/${giveawayId}/funding/private-transfer`, {
    method: 'POST',
    body: JSON.stringify({ sender_wallet: senderWallet, cluster, gasless }),
    userId,
    accessToken,
  });
}

// ===========================================
// Default export
// ===========================================

export const claimsApi = {
  create: createClaim,
  getById: getClaimById,
  getWithLatestIntent: getClaimWithLatestIntent,
  getByUser: getClaimsByUser,
  updateStatus: updateClaimStatus,
};
