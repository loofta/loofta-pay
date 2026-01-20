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
  },
};
