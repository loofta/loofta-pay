import { fetchApi } from './client';

export type LotteryGiftStatus = 'pending_payment' | 'unclaimed' | 'claimed' | 'cancelled' | 'failed';

export interface LotteryGiftPublic {
  giftId: string | null;
  numTickets: number;
  note: string | null;
  status: LotteryGiftStatus;
  recipientType: 'email' | 'handle';
  recipientIdentifier: string | null;
  isSender: boolean;
  isClaimant: boolean;
  isRecipient: boolean;
  senderUsername: string | null;
  recipientHandle: string | null;
}

/** accessToken is optional — throws (404) when it identifies a logged-in viewer who is none of
 *  sender/claimant/recipient; the backend treats that exactly like a bad token (see
 *  lottery.service.ts getGiftPublic). */
export async function getLotteryGiftPublic(token: string, accessToken?: string | null): Promise<LotteryGiftPublic> {
  return fetchApi(`/lottery/gift/${token}`, { accessToken });
}

export async function claimLotteryGift(
  token: string,
  accessToken: string | null,
): Promise<{ ticketId: string; numTickets: number }> {
  return fetchApi(`/lottery/gift/${token}/claim`, { method: 'POST', body: JSON.stringify({}), accessToken });
}

/** Accepts a bare short_id ("Mh8NODM8") or a full claim URL and returns just the token. */
export function parseGiftToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    // .../gift/:token or .../gift/:token/claim
    const idx = parts.indexOf('gift');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return trimmed; // not a URL — treat as a bare token
  }
}
