import { fetchApi } from './client';

export type PackRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export interface PackTierPublic {
  tierKey: string;
  ticketsAwarded: number;
  rarity: PackRarity;
  displayOrder: number;
}

export interface PackConfig {
  priceUsdc: number;
  treasuryAddress: string;
  usdcMint: string;
  /** Treasury can't currently cover the largest enabled payout — the backend refuses to build a
   *  charge regardless, so the UI should show this up front rather than after a failed payment. */
  available: boolean;
  tiers: PackTierPublic[];
}

export interface PackOpenResult {
  id: string;
  tierKey: string;
  ticketsAwarded: number;
  rarity: PackRarity;
}

export async function getPackConfig(accessToken: string | null): Promise<PackConfig> {
  return fetchApi('/lottery/packs/config', { accessToken });
}

export async function buildPackPaymentTx(
  userSolanaAddress: string,
  accessToken: string | null,
): Promise<{ txBase64: string }> {
  return fetchApi('/lottery/packs/pay-tx', {
    method: 'POST',
    body: JSON.stringify({ userSolanaAddress }),
    accessToken,
  });
}

export async function openPack(paymentTxHash: string, accessToken: string | null): Promise<PackOpenResult> {
  return fetchApi('/lottery/packs/open', {
    method: 'POST',
    body: JSON.stringify({ paymentTxHash }),
    accessToken,
  });
}

/** Same real tier roll as openPack, but no payment required and no real ticket purchased — the
 *  backend hard-blocks this in production regardless of what the client sends (see PackService),
 *  so gating the UI entry point behind __DEV__ is purely cosmetic, not the actual enforcement. */
export async function demoOpenPack(accessToken: string | null): Promise<PackOpenResult> {
  return fetchApi('/lottery/packs/demo-open', { method: 'POST', accessToken });
}

/** Recovers a real, confirmed payment the caller already sent but never redeemed (e.g. the app
 *  was killed after broadcasting but before /open) — lets the UI reuse it instead of charging
 *  a second time. */
export async function getPendingPackPayment(accessToken: string | null): Promise<{ paymentTxHash: string | null }> {
  return fetchApi('/lottery/packs/pending-payment', { accessToken });
}

export async function getMyPackStatus(
  accessToken: string | null,
): Promise<{ opensToday: number; dailyLimit: number | null; limitReached: boolean }> {
  return fetchApi('/lottery/packs/my-status', { accessToken });
}
