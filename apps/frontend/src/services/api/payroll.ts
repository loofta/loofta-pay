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
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  company_legal_name?: string | null;
  company_registration_number?: string | null;
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
  contributor_type: string | null;
  status: 'invited' | 'joined' | 'removed';
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  business_name?: string | null;
  business_registration_number?: string | null;
  kyc_status?: string | null;
  kyc_verified_at?: string | null;
}

export interface CreateOrganizationDto {
  name: string;
  logoUrl?: string;
}

export interface UpdateOrganizationDto {
  name?: string;
  logoUrl?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  company_legal_name?: string;
  company_registration_number?: string;
}

export interface CreateContributorDto {
  email: string;
  firstName?: string;
  lastName?: string;
  walletAddress?: string;
  network?: string;
  tokenSymbol?: string;
  department?: string;
  contributorType?: 'internal_staff' | 'contractor';
}

export interface UpdateContributorDto {
  firstName?: string;
  lastName?: string;
  walletAddress?: string;
  network?: string;
  tokenSymbol?: string;
  department?: string;
  contributorType?: 'internal_staff' | 'contractor';
  status?: 'invited' | 'joined' | 'removed';
}

export interface UpdateContributorProfileDto {
  firstName?: string;
  lastName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  businessName?: string;
  businessRegistrationNumber?: string;
  walletAddress?: string;
  network?: string;
  tokenSymbol?: string;
}

export const payrollApi = {
  // Organizations
  organizations: {
    async list(userId?: string): Promise<PayrollOrganization[]> {
      return fetchApi<PayrollOrganization[]>('/payroll/organizations', { userId });
    },
    async listAsContributor(userId?: string): Promise<(PayrollOrganization & { role: string })[]> {
      return fetchApi<(PayrollOrganization & { role: string })[]>('/payroll/organizations/as-contributor', { userId });
    },

    async get(id: string, userId?: string): Promise<PayrollOrganization> {
      return fetchApi<PayrollOrganization>(`/payroll/organizations/${id}`, { userId });
    },

    async getMyRole(id: string, userId?: string): Promise<{ role: 'owner' | 'admin' | 'member' | 'contributor' }> {
      return fetchApi<{ role: 'owner' | 'admin' | 'member' | 'contributor' }>(`/payroll/organizations/${id}/my-role`, { userId });
    },

    async create(data: CreateOrganizationDto, userId?: string): Promise<PayrollOrganization> {
      return fetchApi<PayrollOrganization>('/payroll/organizations', {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },

    async update(id: string, data: UpdateOrganizationDto, userId?: string): Promise<PayrollOrganization> {
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

    async getMe(orgId: string, userId?: string): Promise<PayrollContributor> {
      return fetchApi<PayrollContributor>(`/payroll/organizations/${orgId}/contributors/me`, { userId });
    },

    async updateMe(orgId: string, data: UpdateContributorProfileDto, userId?: string): Promise<PayrollContributor> {
      // API expects snake_case (backend ValidationPipe whitelist)
      const body: Record<string, string | undefined> = {};
      if (data.firstName !== undefined) body.first_name = data.firstName;
      if (data.lastName !== undefined) body.last_name = data.lastName;
      if (data.addressLine1 !== undefined) body.address_line1 = data.addressLine1;
      if (data.addressLine2 !== undefined) body.address_line2 = data.addressLine2;
      if (data.city !== undefined) body.city = data.city;
      if (data.state !== undefined) body.state = data.state;
      if (data.postalCode !== undefined) body.postal_code = data.postalCode;
      if (data.country !== undefined) body.country = data.country;
      if (data.businessName !== undefined) body.business_name = data.businessName;
      if (data.businessRegistrationNumber !== undefined) body.business_registration_number = data.businessRegistrationNumber;
      if (data.walletAddress !== undefined) body.wallet_address = data.walletAddress;
      if (data.network !== undefined) body.network = data.network;
      if (data.tokenSymbol !== undefined) body.token_symbol = data.tokenSymbol;
      return fetchApi<PayrollContributor>(`/payroll/organizations/${orgId}/contributors/me`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        userId,
      });
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

  runs: {
    async create(
      orgId: string,
      data: { entries: Array<{ contributorId: string; amount: string }>; tokenSymbol: string; network: string },
      userId?: string,
    ): Promise<PayrollRunResponse> {
      return fetchApi<PayrollRunResponse>(`/payroll/organizations/${orgId}/runs`, {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },

    async list(orgId: string, userId?: string): Promise<PayrollRunListItem[]> {
      return fetchApi<PayrollRunListItem[]>(`/payroll/organizations/${orgId}/runs`, { userId });
    },

    async get(orgId: string, runId: string, userId?: string): Promise<PayrollRunResponse> {
      return fetchApi<PayrollRunResponse>(`/payroll/organizations/${orgId}/runs/${runId}`, { userId });
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

export interface PayrollRunEntryWithIntent {
  id: string;
  contributor_id: string;
  amount: string;
  token_symbol: string;
  network: string;
  recipient_address: string;
  status: string;
  deposit_address?: string | null;
  memo?: string | null;
  deadline?: string | null;
  created_at: string;
}

export interface PayrollRunResponse {
  id: string;
  organization_id: string;
  created_by: string;
  status: string;
  total_entries: number;
  completed_entries: number;
  created_at: string;
  updated_at: string;
  entries: PayrollRunEntryWithIntent[];
}

export interface PayrollRunListItem {
  id: string;
  organization_id: string;
  created_by: string;
  status: string;
  total_entries: number;
  completed_entries: number;
  created_at: string;
  updated_at: string;
}
