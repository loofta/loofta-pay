/**
 * Mystery Pack — status reads for the caller.
 * Backend: GET /lottery/packs/my-status
 */

import { fetchApi } from './client';

export interface PackStatus {
  opensToday: number;
  dailyLimit: number | null;
  limitReached: boolean;
  /** Whether the caller has an unclaimed admin-granted free spin — powers the free-spin nudge
   *  toast (useFreeSpinToast) and the Mystery Pack page's own payment-gate variant. */
  hasFreeSpin: boolean;
}

export async function getMyPackStatus(userId: string, accessToken?: string | null): Promise<PackStatus> {
  return fetchApi<PackStatus>('/lottery/packs/my-status', { userId, accessToken });
}
