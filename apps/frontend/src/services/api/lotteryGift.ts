/**
 * Gift a Megapot ticket — public claim-page reads + claim action.
 * Backend: GET/POST /lottery/gift/*
 */

import { fetchApi } from './client';

export type LotteryGiftStatus = 'pending_payment' | 'unclaimed' | 'claimed' | 'cancelled' | 'failed';

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

export interface MyGiftItem {
  giftId: string;
  createdAt: string;
  numTickets: number;
  note: string | null;
  recipientType: 'email' | 'handle';
  recipientIdentifier: string;
  status: LotteryGiftStatus;
  claimedAt: string | null;
  claimToken: string;
  claimUrl: string;
}

export async function getMyGifts(userId: string, accessToken?: string | null): Promise<MyGiftItem[]> {
  return fetchApi<MyGiftItem[]>('/lottery/my-gifts', { userId, accessToken });
}
