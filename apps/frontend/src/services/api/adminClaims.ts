/**
 * Admin Claims API Service
 */

import { fetchApi, BACKEND_URL } from './client';

export interface Claim {
  id: string;
  amount: string;
  to_symbol: string;
  to_chain: string;
  recipient_address: string;
  created_by: string | null;
  creator_email: string | null;
  status: 'OPEN' | 'PENDING_DEPOSIT' | 'IN_FLIGHT' | 'SUCCESS' | 'REFUNDED' | 'EXPIRED' | 'CANCELLED';
  created_at: string;
  updated_at: string | null;
  paid_at: string | null;
}

export interface ClaimIntent {
  id: string;
  claim_id: string;
  quote_id: string | null;
  deposit_address: string | null;
  memo: string | null;
  deadline: string | null;
  time_estimate: number | null;
  status: string;
  from_chain: string | null;
  to_chain: string | null;
  paid_amount: string | null;
  last_status_payload: unknown;
  created_at: string;
  updated_at: string | null;
}

export interface ListClaimsResponse {
  claims: Claim[];
  total: number;
}

export interface ClaimWithIntentsResponse {
  claim: Claim;
  intents: ClaimIntent[];
}

export const adminClaimsApi = {
  /**
   * List all claims (paginated)
   */
  async list(
    options?: {
      status?: Claim['status'];
      limit?: number;
      offset?: number;
    },
    userId?: string,
  ): Promise<ListClaimsResponse> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    
    const query = params.toString();
    return fetchApi<ListClaimsResponse>(
      `/admin/claims${query ? `?${query}` : ''}`,
      { userId },
    );
  },

  /**
   * Get claim with all intents
   */
  async getWithIntents(id: string, userId?: string): Promise<ClaimWithIntentsResponse> {
    return fetchApi<ClaimWithIntentsResponse>(`/admin/claims/${id}`, { userId });
  },

  /**
   * Update claim status
   */
  async updateStatus(
    id: string,
    status: Claim['status'],
    userId?: string,
  ): Promise<Claim> {
    return fetchApi<Claim>(`/admin/claims/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
      userId,
    });
  },

  /**
   * Delete a claim
   */
  async delete(id: string, userId?: string): Promise<void> {
    await fetchApi<void>(`/admin/claims/${id}`, {
      method: 'DELETE',
      userId,
    });
  },

  /**
   * Delete multiple claims
   */
  async deleteMany(ids: string[], userId?: string): Promise<{ deleted: number }> {
    return fetchApi<{ deleted: number }>(`/admin/claims`, {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
      userId,
    });
  },
};
