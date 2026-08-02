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
  contact_email: string | null;
  website_url: string | null;
  owner_privy_user_id?: string | null;
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
  contact_email?: string;
  website_url?: string;
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

export interface CreateCheckoutSessionInput {
  amount: number;
  description?: string;
  isPrivate?: boolean;
  callbackUrl?: string;
}

export interface CheckoutSessionResult {
  id: string;
  short_id: string;
  link: string;
}

/**
 * Create a checkout session (payment link) for an organization — public, called by the
 * hosted /checkout page and PayButton. Funds settle to the org's own recipient_wallet.
 */
export async function createCheckoutSession(
  organizationId: string,
  data: CreateCheckoutSessionInput
): Promise<CheckoutSessionResult> {
  return fetchApi<CheckoutSessionResult>(
    `/organizations/${encodeURIComponent(organizationId)}/checkout-sessions`,
    { method: 'POST', body: JSON.stringify(data) }
  );
}

// ===========================================
// Self-serve API (auth required, org owner)
// ===========================================

/**
 * Self-serve organization signup — lands as 'pending' until an admin approves it.
 */
export async function createOrganizationSelfServe(
  data: CreateOrganizationInput,
  accessToken: string
): Promise<{ organization: Organization }> {
  return fetchApi<{ organization: Organization }>('/organizations/self-serve', {
    method: 'POST',
    body: JSON.stringify(data),
    accessToken,
  });
}

/**
 * List organizations owned by the calling user.
 */
export async function getMyOrganizations(accessToken: string): Promise<{ organizations: Organization[] }> {
  return fetchApi<{ organizations: Organization[] }>('/organizations/mine', { accessToken });
}

export interface UpdateOrganizationSelfServeInput {
  name?: string;
  logo_url?: string;
  recipient_wallet?: string;
  token_symbol?: string;
  token_chain?: string;
  bg_color?: string;
  contact_email?: string;
  website_url?: string;
}

/**
 * Update settings for an organization you own (name/logo/wallet/branding — not checkout_status).
 */
export async function updateOrganizationSelfServe(
  id: string,
  data: UpdateOrganizationSelfServeInput,
  accessToken: string
): Promise<{ organization: Organization }> {
  return fetchApi<{ organization: Organization }>(`/organizations/${encodeURIComponent(id)}/self-serve`, {
    method: 'POST',
    body: JSON.stringify(data),
    accessToken,
  });
}

/**
 * Mint a new API key for an organization you own (must already be admin-approved).
 */
export async function createOrganizationApiKey(
  id: string,
  accessToken: string
): Promise<{ apiKey: string; keyPrefix: string }> {
  return fetchApi<{ apiKey: string; keyPrefix: string }>(`/organizations/${encodeURIComponent(id)}/api-keys`, {
    method: 'POST',
    accessToken,
  });
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
  createCheckoutSession,
  // Self-serve
  createSelfServe: createOrganizationSelfServe,
  createApiKey: createOrganizationApiKey,
  // Admin
  list: listOrganizations,
  getById: getOrganizationById,
  create: createOrganization,
  update: updateOrganization,
  delete: deleteOrganization,
};
