/**
 * Self-serve developer API keys — POST /payment-links auth.
 * See apps/backend/src/modules/integrators/self-serve-integrators.controller.ts.
 */

import { fetchApi } from './client';

export interface SelfServeKeySummary {
  id: string;
  key_prefix: string;
}

export interface SelfServeStatus {
  provisioned: boolean;
  keys: SelfServeKeySummary[];
}

export interface MintedApiKey {
  /** Raw key — shown once, never retrievable again. */
  api_key: string;
  key_prefix: string;
}

export async function getSelfServeStatus(accessToken: string | null): Promise<SelfServeStatus> {
  return fetchApi<SelfServeStatus>('/integrators/self-serve', { accessToken });
}

export async function provisionSelfServeKey(accessToken: string | null): Promise<MintedApiKey> {
  return fetchApi<MintedApiKey>('/integrators/self-serve', { method: 'POST', accessToken });
}

export async function rotateSelfServeKey(accessToken: string | null): Promise<MintedApiKey> {
  return fetchApi<MintedApiKey>('/integrators/self-serve/rotate', { method: 'POST', accessToken });
}

export async function revokeSelfServeKey(accessToken: string | null, keyId: string): Promise<void> {
  await fetchApi<{ revoked: boolean }>(`/integrators/self-serve/keys/${keyId}/revoke`, { method: 'POST', accessToken });
}

export interface SelfServeBranding {
  name: string | null;
  logo_url: string | null;
}

export async function getSelfServeBranding(accessToken: string | null): Promise<SelfServeBranding> {
  return fetchApi<SelfServeBranding>('/integrators/self-serve/branding', { accessToken });
}

export async function updateSelfServeBranding(
  accessToken: string | null,
  branding: { name?: string; logo_url?: string },
): Promise<SelfServeBranding> {
  return fetchApi<SelfServeBranding>('/integrators/self-serve/branding', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(branding),
  });
}
