import { formatDelayDuration } from "@/lib/privacyDelay";

/**
 * Fallback phrase only when the sender's delay has not loaded yet. A known delay — including
 * the 10-minute default, a longer spread up to 31 days, or no delay — is quoted as chosen.
 */
export const PRIVATE_PAYMENT_MAX_WAIT_MINUTES = 10;

/** The delay the sender actually picked. Null only when that choice is not available yet. */
function chosenDelayPhrase(delayMs?: number | null): string | null {
  if (typeof delayMs !== "number" || !Number.isFinite(delayMs)) return null;
  if (delayMs <= 0) return "right away";
  return formatDelayDuration(delayMs);
}

/** "All payments are private..." banner, e.g. shown when a link forces private mode and the
 *  sender's own split/delay choice can't be toggled off. Reflects the actual delay the sender
 *  picked (via formatDelayDuration) whenever it's known; falls back to the generic ~10-minute
 *  estimate only when no delayMs is available at all (e.g. delay hasn't been chosen/loaded yet). */
function fundsEta(delayMs?: number | null): string {
  return chosenDelayPhrase(delayMs) ?? `up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes`;
}

export function privatePaymentAllPrivateLine(delayMs?: number | null): string {
  const eta = fundsEta(delayMs);
  if (eta === "right away") {
    return "All payments are private. Funds land in the recipient's wallet right away and may arrive in parts.";
  }
  return `All payments are private. Funds can take ${eta} to land entirely in recipient's wallet and may arrive in parts.`;
}

export function privatePaymentFundsAppearCopy(delayMs?: number | null): string {
  const eta = fundsEta(delayMs);
  if (eta === "right away") {
    return "Funds land in the recipient's wallet right away and may arrive in parts.";
  }
  return `Funds can take ${eta} to land entirely in recipient's wallet and may arrive in parts.`;
}

export function privatePaymentWaitingAfterSenderCopy(delayMs?: number | null): string {
  const eta = fundsEta(delayMs);
  if (eta === "right away") return "Waiting for the payment to land — it should arrive right away.";
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
  const eta = fundsEta(delayMs);
  if (eta === "right away") return "This is a private payment. Waiting for the payment to land — it should arrive right away.";
  return `This is a private payment. Waiting for the payment to land, this can take ${eta}.`;
}
