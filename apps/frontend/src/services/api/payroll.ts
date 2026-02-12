/**
 * Payroll API Service
 */

import { fetchApi } from './client';

export interface PayrollOrganization {
  id: string;
  name: string;
  logo_url: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
}

export interface PayrollContributor {
  id: string;
  organization_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  wallet_address: string | null;
  network: string | null;
  token_symbol: string | null;
  department: string | null;
  status: 'invited' | 'joined' | 'removed';
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateOrganizationDto {
  name: string;
  logoUrl?: string;
}

export interface CreateContributorDto {
  email: string;
  firstName?: string;
  lastName?: string;
  walletAddress?: string;
  network?: string;
  tokenSymbol?: string;
  department?: string;
}

export interface UpdateContributorDto {
  firstName?: string;
  lastName?: string;
  walletAddress?: string;
  network?: string;
  tokenSymbol?: string;
  department?: string;
  status?: 'invited' | 'joined' | 'removed';
}

export const payrollApi = {
  // Organizations
  organizations: {
    async list(userId?: string): Promise<PayrollOrganization[]> {
      return fetchApi<PayrollOrganization[]>('/payroll/organizations', { userId });
    },

    async get(id: string, userId?: string): Promise<PayrollOrganization> {
      return fetchApi<PayrollOrganization>(`/payroll/organizations/${id}`, { userId });
    },

    async create(data: CreateOrganizationDto, userId?: string): Promise<PayrollOrganization> {
      return fetchApi<PayrollOrganization>('/payroll/organizations', {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },

    async update(id: string, data: Partial<CreateOrganizationDto>, userId?: string): Promise<PayrollOrganization> {
      return fetchApi<PayrollOrganization>(`/payroll/organizations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        userId,
      });
    },

    async delete(id: string, userId?: string): Promise<void> {
      await fetchApi<void>(`/payroll/organizations/${id}`, {
        method: 'DELETE',
        userId,
      });
    },
  },

  // Contributors
  contributors: {
    async list(orgId: string, userId?: string, status?: string): Promise<PayrollContributor[]> {
      const params = status ? `?status=${status}` : '';
      return fetchApi<PayrollContributor[]>(`/payroll/organizations/${orgId}/contributors${params}`, { userId });
    },

    async get(orgId: string, contributorId: string, userId?: string): Promise<PayrollContributor> {
      return fetchApi<PayrollContributor>(`/payroll/organizations/${orgId}/contributors/${contributorId}`, { userId });
    },

    async create(orgId: string, data: CreateContributorDto, userId?: string): Promise<PayrollContributor> {
      return fetchApi<PayrollContributor>(`/payroll/organizations/${orgId}/contributors`, {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },

    async update(orgId: string, contributorId: string, data: UpdateContributorDto, userId?: string): Promise<PayrollContributor> {
      return fetchApi<PayrollContributor>(`/payroll/organizations/${orgId}/contributors/${contributorId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        userId,
      });
    },

    async remove(orgId: string, contributorId: string, userId?: string): Promise<void> {
      await fetchApi<void>(`/payroll/organizations/${orgId}/contributors/${contributorId}`, {
        method: 'DELETE',
        userId,
      });
    },

    async bulkInvite(
      orgId: string,
      contributors: Array<{ email: string; firstName?: string; lastName?: string }>,
      userId?: string,
    ): Promise<{ created: number; skipped: number; errors: string[] }> {
      return fetchApi<{ created: number; skipped: number; errors: string[] }>(
        `/payroll/organizations/${orgId}/contributors/bulk-invite`,
        {
          method: 'POST',
          body: JSON.stringify({ contributors }),
          userId,
        },
      );
    },

    async sendInvite(
      orgId: string,
      contributorId: string,
      userId?: string,
      baseUrl?: string,
    ): Promise<{ inviteLink: string }> {
      return fetchApi<{ inviteLink: string }>(
        `/payroll/organizations/${orgId}/contributors/${contributorId}/send-invite`,
        {
          method: 'POST',
          body: JSON.stringify({ baseUrl: baseUrl || (typeof window !== 'undefined' ? window.location.origin : undefined) }),
          userId,
        },
      );
    },
  },

  invite: {
    async getByToken(token: string): Promise<PayrollInviteInfo> {
      const res = await fetch(`/api/payroll/invite/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Invalid invite');
      }
      return res.json();
    },
    async onboard(token: string, data: { walletAddress: string; network: string; tokenSymbol: string; username?: string }): Promise<PayrollContributor> {
      const res = await fetch(`/api/payroll/invite/${encodeURIComponent(token)}/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Onboarding failed');
      }
      return res.json();
    },
  },
};

export interface PayrollInviteInfo {
  organizationName: string;
  organizationId: string;
  contributorId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}
