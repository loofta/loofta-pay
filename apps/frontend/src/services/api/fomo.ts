import { fetchApi } from './client';

export interface FomoResolution {
  handle: string;
  /** The handle exists on fomo.family. */
  found: boolean;
  /** found AND a Solana wallet is linked — i.e. we can actually pay them. */
  resolvable: boolean;
  displayName: string | null;
  solanaAddress: string | null;
  profilePicture: string | null;
  fomoUserId: string | null;
}

/** Resolve a fomo.family username to its verified Solana wallet (via the backend, key stays server-side). */
export async function resolveFomoHandle(handle: string, signal?: AbortSignal): Promise<FomoResolution> {
  return fetchApi<FomoResolution>(`/fomo/resolve/${encodeURIComponent(handle)}`, { signal });
}

export const fomoApi = { resolveFomoHandle };
