/**
 * Local cache for the Mystery Pack config (price/tiers/availability), so the Pack tab can paint
 * a real price instantly on first visit instead of only relying on FALLBACK_PRICE_USDC while the
 * network fetch is in flight. Same pattern as lib/storage/walletBalances.ts. Never a substitute
 * for the live fetch — pending-payment/daily-limit state is never cached, only this mostly-static
 * config, and it's always overwritten by the next successful getPackConfig() call.
 */
import * as SecureStore from 'expo-secure-store';
import type { PackConfig } from '../api/pack';

const PACK_CONFIG_KEY = 'pack_config_cache';

export async function getCachedPackConfig(): Promise<PackConfig | null> {
  const raw = await SecureStore.getItemAsync(PACK_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedPackConfig(config: PackConfig): Promise<void> {
  await SecureStore.setItemAsync(PACK_CONFIG_KEY, JSON.stringify(config));
}
