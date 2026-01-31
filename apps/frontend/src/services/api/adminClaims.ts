/**
 * Admin Claims API Service
 */

import { fetchApi } from './client';
import type { Claim, ClaimIntent, ClaimStatus } from './claims';

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
