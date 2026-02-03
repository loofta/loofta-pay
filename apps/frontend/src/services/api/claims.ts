/**
 * Claims API Service
 * 
 * Handles claim-related operations:
 * - Creating payment claims
 * - Fetching claim details
 * - Managing claim intents
 */

import { fetchApi } from './client';

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

export interface Claim {
  id: string;
  amount: string;
  to_symbol: string;
  to_chain: string;
  recipient_address: string;
  created_by: string | null;
  creator_email: string | null;
  creator_username?: string | null;
  notify_email_to: string | null;
  status: ClaimStatus;
  paid_at: string | null;
  org_referral: string | null;
  is_private: boolean | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  created_at: string;
  updated_at: string;
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
  from_symbol: string | null;
  from_chain: string | null;
  to_chain: string | null;
  paid_amount: string | null;
  companion_address: string | null;
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
}

// ===========================================
// API Functions
// ===========================================

/**
 * Create a new payment claim
 */
export async function createClaim(data: CreateClaimInput): Promise<{ claim: Claim }> {
  return fetchApi<{ claim: Claim }>('/claims', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Get claim by ID
 */
export async function getClaimById(id: string): Promise<{ claim: Claim }> {
  return fetchApi<{ claim: Claim }>(`/claims/${id}`);
}

/**
 * Get claim with its latest intent
 */
export async function getClaimWithLatestIntent(
  id: string
): Promise<{ claim: Claim; intent: ClaimIntent | null }> {
  return fetchApi<{ claim: Claim; intent: ClaimIntent | null }>(`/claims/${id}/latest-intent`);
}

/**
 * Get claims by user (requires auth)
 */
export async function getClaimsByUser(userId: string): Promise<{ claims: Claim[] }> {
  return fetchApi<{ claims: Claim[] }>('/claims/user', { userId });
}

/**
 * Update claim status (internal use)
 */
export async function updateClaimStatus(
  id: string,
  status: ClaimStatus,
  userId?: string
): Promise<{ claim: Claim }> {
  return fetchApi<{ claim: Claim }>(`/claims/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    userId,
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
