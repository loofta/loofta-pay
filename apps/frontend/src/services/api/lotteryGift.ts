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
  /** True only when the logged-in viewer is the one who sent this gift. */
  isSender: boolean;
  /** True only when the logged-in viewer is the one who actually claimed it. */
  isClaimant: boolean;
}

export interface ClaimLotteryGiftResult {
  ticketId: string;
  numTickets: number;
}

/** accessToken is optional — the page works for anonymous visitors too, just without
 *  isSender/isClaimant (those require knowing who's looking). */
export async function getLotteryGiftPublic(token: string, accessToken?: string | null): Promise<LotteryGiftPublic> {
  return fetchApi<LotteryGiftPublic>(`/lottery/gift/${token}`, { accessToken });
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

export async function getMyGifts(
  userId: string,
  offset: number,
  limit: number,
  accessToken?: string | null,
): Promise<{ gifts: MyGiftItem[]; total: number }> {
  return fetchApi<{ gifts: MyGiftItem[]; total: number }>(
    `/lottery/my-gifts?offset=${offset}&limit=${limit}`,
    { userId, accessToken },
  );
}
