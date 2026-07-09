/**
 * Gift a Megapot ticket — public claim-page reads + claim action.
 * Backend: GET/POST /lottery/gift/*
 */

import { fetchApi } from './client';

export type LotteryGiftStatus = 'unclaimed' | 'claimed' | 'cancelled' | 'failed';

export interface LotteryGiftPublic {
  numTickets: number;
  note: string | null;
  status: LotteryGiftStatus;
  recipientType: 'email' | 'handle';
}

export interface ClaimLotteryGiftResult {
  ticketId: string;
  numTickets: number;
}

export async function getLotteryGiftPublic(token: string): Promise<LotteryGiftPublic> {
  return fetchApi<LotteryGiftPublic>(`/lottery/gift/${token}`);
}

export async function claimLotteryGift(
  token: string,
  userId: string,
  accessToken?: string | null,
): Promise<ClaimLotteryGiftResult> {
  return fetchApi<ClaimLotteryGiftResult>(`/lottery/gift/${token}/claim`, {
    method: 'POST',
    body: JSON.stringify({}),
    userId,
    accessToken,
  });
}
