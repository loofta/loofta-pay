/**
 * Local cache for the connected wallet's Seeker ID (skrDomain / username), so the profile
 * screen can paint instantly instead of showing "Not connected" while the network fetch is
 * in flight. Cleared on disconnect (see logoutSeeker in lib/auth/useSeekerLogin.ts).
 */
import * as SecureStore from 'expo-secure-store';

const SEEKER_IDENTITY_KEY = 'seeker_identity_cache';

export interface CachedSeekerIdentity {
  skrDomain: string | null;
  username: string | null;
}

export async function getCachedSeekerIdentity(): Promise<CachedSeekerIdentity | null> {
  const raw = await SecureStore.getItemAsync(SEEKER_IDENTITY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedSeekerIdentity(identity: CachedSeekerIdentity): Promise<void> {
  await SecureStore.setItemAsync(SEEKER_IDENTITY_KEY, JSON.stringify(identity));
}

/** Updates just the skrDomain half of the cache (e.g. a fresh wallet-reported label), preserving
 *  whatever username is already cached instead of clobbering it. No-ops on a null/empty label so
 *  a wallet that doesn't report one doesn't erase a previously known-good domain. */
export async function updateCachedSkrDomain(skrDomain: string | null): Promise<void> {
  if (!skrDomain) return;
  const existing = await getCachedSeekerIdentity();
  await setCachedSeekerIdentity({ skrDomain, username: existing?.username ?? null });
}

/** Same merge semantics as updateCachedSkrDomain, for the username half. */
export async function updateCachedUsername(username: string | null): Promise<void> {
  if (!username) return;
  const existing = await getCachedSeekerIdentity();
  await setCachedSeekerIdentity({ skrDomain: existing?.skrDomain ?? null, username });
}

export async function clearCachedSeekerIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(SEEKER_IDENTITY_KEY);
}
