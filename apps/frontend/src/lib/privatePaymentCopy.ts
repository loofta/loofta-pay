import { formatDelayDuration } from "@/lib/privacyDelay";

/**
 * Keep in sync with MagicBlock Payments API: devnet private `maxDelayMs` ≤ 600_000 (10 minutes).
 * Backend: `MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS` in `magicblock-private-transfer.ts`. Used only
 * as the fallback below when the actual delay a sender chose isn't known yet — never state this
 * number when a real delayMs is on hand, since the sender's own slider can go well past it (up to
 * DELAY_UI_MAX_MS, see @/lib/privacyDelay) and this app has no fixed cap of its own to quote.
 */
export const PRIVATE_PAYMENT_MAX_WAIT_MINUTES = 10;

/** "All payments are private..." banner, e.g. shown when a link forces private mode and the
 *  sender's own split/delay choice can't be toggled off. Reflects the actual delay the sender
 *  picked (via formatDelayDuration) whenever it's known; falls back to the generic ~10-minute
 *  estimate only when no delayMs is available at all (e.g. delay hasn't been chosen/loaded yet). */
export function privatePaymentAllPrivateLine(delayMs?: number | null): string {
  const eta = typeof delayMs === "number" && delayMs > 0
    ? formatDelayDuration(delayMs)
    : `up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes`;
  return `All payments are private. Funds can take ${eta} to land entirely in recipient's wallet and may arrive in parts.`;
}

export function privatePaymentFundsAppearCopy(delayMs?: number | null): string {
  const eta = typeof delayMs === "number" && delayMs > 0
    ? formatDelayDuration(delayMs)
    : `up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes`;
  return `Funds can take ${eta} to land entirely in recipient's wallet and may arrive in parts.`;
}

export function privatePaymentWaitingAfterSenderCopy(delayMs?: number | null): string {
  const eta = typeof delayMs === "number" && delayMs > 0
    ? formatDelayDuration(delayMs)
    : `up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes`;
  return `Waiting for the payment to land — can take ${eta}.`;
}

/**
 * "Waiting for funds" copy for a claim whose burner hasn't received the sender's payment yet.
 * Every claim now routes through a burner regardless of privacy (see the universal-claim
 * architecture), so this state fires for plain public sends too — only mention the MagicBlock
 * landing delay when the payment was actually funded privately; a public SPL transfer confirms
 * in seconds, and implying otherwise is misleading.
 */
/**
 * Timestamp at which a private payment can be called Claimed: paid_at plus the
 * sender's delay. `delayMs === null` means the delay was not on the link and
 * was not saved, so the wait is the MagicBlock maximum — never paid_at itself.
 * A known delay of 0 means the sender chose no delay, so it lands at paid_at.
 * Returns null until that moment.
 */
export function privateFundsLandedAt(
  paidAt: string | null | undefined,
  delayMs: number | null | undefined,
  now = Date.now(),
): string | null {
  if (!paidAt) return null;
  const paidMs = new Date(paidAt).getTime();
  if (!Number.isFinite(paidMs)) return null;
  const wait = delayMs == null
    ? PRIVATE_PAYMENT_MAX_WAIT_MINUTES * 60_000
    : Math.max(0, delayMs);
  const landedMs = paidMs + wait;
  if (now < landedMs) return null;
  return new Date(landedMs).toISOString();
}

export function waitingForFundsCopy(isPrivate: boolean | null | undefined, delayMs?: number | null): string {
  if (!isPrivate) return "Waiting for the payment to land.";
  const eta = typeof delayMs === "number" && delayMs > 0
    ? formatDelayDuration(delayMs)
    : `up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes`;
  return `This is a private payment. Waiting for the payment to land, this can take ${eta}.`;
}
