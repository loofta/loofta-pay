/**
 * Local cache for the connected wallet's SOL/USDC balances, so the header chip and profile
 * screen can paint instantly instead of showing "—" while the network fetch is in flight.
 * Cleared on disconnect (see logoutSeeker in lib/auth/useSeekerLogin.ts).
 */
import * as SecureStore from 'expo-secure-store';

const WALLET_BALANCE_KEY = 'wallet_balance_cache';

export interface CachedWalletBalances {
  solBalance: number;
  usdcBalance: number;
}

export async function getCachedWalletBalances(): Promise<CachedWalletBalances | null> {
  const raw = await SecureStore.getItemAsync(WALLET_BALANCE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedWalletBalances(balances: CachedWalletBalances): Promise<void> {
  await SecureStore.setItemAsync(WALLET_BALANCE_KEY, JSON.stringify(balances));
}

export async function clearCachedWalletBalances(): Promise<void> {
  await SecureStore.deleteItemAsync(WALLET_BALANCE_KEY);
}
