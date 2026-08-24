/**
 * Gift a Megapot ticket — public claim-page reads + claim action.
 * Backend: GET/POST /lottery/gift/*
 */

import { fetchApi } from './client';

export type LotteryGiftStatus = 'pending_payment' | 'unclaimed' | 'claimed' | 'cancelled' | 'failed';

export interface LotteryGiftPublic {
  /** Only populated when the viewer is the sender — needed to call updateGiftRecipient. */
  giftId: string | null;
  numTickets: number;
  note: string | null;
  status: LotteryGiftStatus;
  recipientType: 'email' | 'handle';
  /** Raw recipient identifier (email or handle) — only populated for the sender, who already knows it. */
  recipientIdentifier: string | null;
  /** True only when the logged-in viewer is the one who sent this gift. */
  isSender: boolean;
  /** True only when the logged-in viewer is the one who actually claimed it. */
  isClaimant: boolean;
  /** True only when the logged-in viewer's linked email/X/username matches the gift's recipient
   *  and it hasn't been claimed yet — lets the genuine recipient see the claim UI pre-claim. */
  isRecipient: boolean;
  /** Loofta username of whoever sent the gift, or null if unresolved. */
  senderUsername: string | null;
  /** Sender's X handle, only set when they have X linked — prefer over senderUsername for display. */
  senderHandle: string | null;
  /** Sender's X profile picture, only set when they have X linked. */
  senderAvatarUrl: string | null;
  /** Claimant's X profile picture, only set once claimed and only when they have X linked. */
  recipientAvatarUrl: string | null;
  /** Recipient's X/Loofta handle — only set when the gift targeted a handle, never an email. */
  recipientHandle: string | null;
  createdAt: string;
  claimedAt: string | null;
  /** Only populated when the viewer is the claimant — lets the claim page resume polling for
   *  numbers after a page reload, instead of only knowing the ticket id from the one-shot
   *  claimLotteryGift() response at the moment of claiming. */
  resultingTicketId: string | null;
  /** What the sender actually paid for this gift (numTickets × ticket price) — the recipient
   *  never pays anything, but the sender's own "You paid" line needs the real figure, not $0. */
  costUsdc: number;
}

export interface ClaimLotteryGiftResult {
  ticketId: string;
  numTickets: number;
}

/** accessToken is optional — the page works for anonymous visitors too, just without
 *  isSender/isClaimant/isRecipient (those require knowing who's looking). Throws (404) when
 *  accessToken identifies a logged-in viewer who is none of sender/claimant/recipient — the
 *  backend treats that exactly like a bad token. */
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
  costUsdc: number;
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

export interface BuyGiftResult {
  giftId: string;
  txBase64: string;
  requiredSigners: string[];
}

/** POST /lottery/buy-gift — returns the unsigned MagicBlock tx (one signature, no separate fee
 *  tx) that funds the gift's holding burner. The Megapot purchase itself only happens later, when
 *  the recipient claims (see claimLotteryGift). */
export async function buyGift(
  dto: {
    numTickets: number;
    userSolanaAddress: string;
    recipientType: 'email' | 'handle';
    recipientIdentifier: string;
    note?: string;
    route?: 'solana_private' | 'solana_public';
  },
  userId: string,
  accessToken?: string | null,
): Promise<BuyGiftResult> {
  return fetchApi<BuyGiftResult>('/lottery/buy-gift', {
    method: 'POST',
    body: JSON.stringify(dto),
    userId,
    accessToken,
  });
}

/** POST /lottery/buy-gift-confirm — confirms the signed tx and returns the claim link. */
export async function confirmGiftSend(
  giftId: string,
  senderTxHash: string,
  userId: string,
  accessToken?: string | null,
): Promise<{ claimUrl: string }> {
  return fetchApi<{ claimUrl: string }>('/lottery/buy-gift-confirm', {
    method: 'POST',
    body: JSON.stringify({ giftId, senderTxHash }),
    userId,
    accessToken,
  });
}

export interface UnclaimedGift {
  shortId: string;
  numTickets: number;
  senderUsername: string | null;
  createdAt: string;
}

/** Gifts sent to the current user that they haven't claimed yet — powers the unclaimed-gift toast. */
export async function getMyUnclaimedGifts(userId: string, accessToken?: string | null): Promise<UnclaimedGift[]> {
  return fetchApi<UnclaimedGift[]>('/lottery/my-unclaimed-gifts', { userId, accessToken });
}

/** Fix a typo'd recipient on a gift you sent — only works while it's still unclaimed. */
export async function updateGiftRecipient(
  giftId: string,
  recipientType: 'email' | 'handle',
  recipientIdentifier: string,
  userId: string,
  accessToken?: string | null,
): Promise<{ claimUrl: string }> {
  return fetchApi<{ claimUrl: string }>(`/lottery/my-gifts/${giftId}/recipient`, {
    method: 'POST',
    body: JSON.stringify({ recipientType, recipientIdentifier }),
    userId,
    accessToken,
  });
}
