/**
 * Organizations API Service
 * 
 * Handles organization-related operations including:
 * - Public organization lookup (for checkout)
 * - Admin CRUD operations
 */

import { fetchApi } from './client';

// ===========================================
// Types
// ===========================================

export interface Organization {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: 'active' | 'inactive' | 'pending';
  org_referral: string;
  recipient_wallet: string | null;
  token_symbol: string | null;
  token_chain: string | null;
  bg_color: string | null;
  payment_config?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

export interface PublicOrganization {
  name: string;
  logo_url: string | null;
  bg_color: string | null;
  checkout_status: string;
  token_symbol?: string;
  token_chain?: string;
}

export interface CreateOrganizationInput {
  organization_id: string;
  name: string;
  logo_url?: string;
  checkout_status?: 'active' | 'inactive' | 'pending';
  recipient_wallet?: string;
  token_symbol?: string;
  token_chain?: string;
  bg_color?: string;
}

export interface UpdateOrganizationInput {
  id: string;
  name?: string;
  logo_url?: string;
  checkout_status?: 'active' | 'inactive' | 'pending';
  organization_id?: string;
  recipient_wallet?: string;
  token_symbol?: string;
  token_chain?: string;
  bg_color?: string;
}

// ===========================================
// Public API (no auth required)
// ===========================================

/**
 * Get organization by referral code (for checkout pages)
 */
export async function getOrganizationByReferral(referralCode: string): Promise<PublicOrganization> {
  return fetchApi<PublicOrganization>(
    `/organizations/public/by-referral?code=${encodeURIComponent(referralCode)}`
  );
}

/**
 * Get organization by organization_id (for checkout pages)
 */
export async function getOrganizationByOrganizationId(
  organizationId: string
): Promise<{ organization: Organization }> {
  return fetchApi<{ organization: Organization }>(
    `/organizations/public/by-id?organizationId=${encodeURIComponent(organizationId)}`
  );
}

// ===========================================
// Admin API (auth required)
// ===========================================

/**
 * List all organizations (admin only)
 */
export async function listOrganizations(userId: string): Promise<{ organizations: Organization[] }> {
  return fetchApi<{ organizations: Organization[] }>('/organizations', { userId });
}

/**
 * Get organization by ID (admin only)
 */
export async function getOrganizationById(
  id: string,
  userId: string
): Promise<{ organization: Organization }> {
  return fetchApi<{ organization: Organization }>(`/organizations/${id}`, { userId });
}

/**
 * Create a new organization (admin only)
 */
export async function createOrganization(
  data: CreateOrganizationInput,
  userId: string
): Promise<{ organization: Organization }> {
  return fetchApi<{ organization: Organization }>('/organizations', {
    method: 'POST',
    body: JSON.stringify(data),
    userId,
  });
}

/**
 * Update an organization (admin only)
 */
export async function updateOrganization(
  data: UpdateOrganizationInput,
  userId: string
): Promise<{ organization: Organization }> {
  return fetchApi<{ organization: Organization }>('/organizations', {
    method: 'PUT',
    body: JSON.stringify(data),
    userId,
  });
}

/**
 * Delete an organization (admin only)
 */
export async function deleteOrganization(
  id: string,
  userId: string
): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/organizations/${id}`, {
    method: 'DELETE',
    userId,
  });
}

// ===========================================
// Default export for convenience
// ===========================================

export const organizationsApi = {
  // Public
  getByReferral: getOrganizationByReferral,
  getByOrganizationId: getOrganizationByOrganizationId,
  // Admin
  list: listOrganizations,
  getById: getOrganizationById,
  create: createOrganization,
  update: updateOrganization,
  delete: deleteOrganization,
};
