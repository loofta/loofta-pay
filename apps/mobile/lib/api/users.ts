import { fetchApi } from './client';

/** Idempotent — call once right after login (see UsersService.ensureAppUser on the backend). */
export async function ensureProfile(accessToken: string | null): Promise<{ id: string; username: string | null }> {
  return fetchApi('/users/me/ensure-profile', { method: 'POST', body: JSON.stringify({}), accessToken });
}

export interface WalletBalances {
  walletAddress: string;
  solBalance: number;
  usdcBalance: number;
  skrDomain: string | null;
}

export async function getWalletBalances(accessToken: string | null): Promise<WalletBalances> {
  return fetchApi('/users/me/wallet/balances', { accessToken });
}
