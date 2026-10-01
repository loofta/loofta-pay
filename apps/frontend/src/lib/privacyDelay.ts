/**
 * MagicBlock's transfer endpoint (POST /v1/spl/transfer) documents no maximum for maxDelayMs —
 * its own field table just says "Private only. Max delay. Defaults to '0' or minDelayMs." (see
 * .claude/skills/magicblock/private-payments.md, the "POST /v1/spl/transfer" section). The
 * `≤ 600000 (10 min)` figure that's floated around this codebase belongs to a DIFFERENT endpoint,
 * `/v1/swap/swap` — confirmed straight from that same doc's swap section, not inferred. Don't
 * reintroduce a 10-minute ceiling here without a fresh, verified reason (an actual reproduced
 * transfer-endpoint rejection, quoted in full) — a stray backend comment or a paraphrased error
 * isn't enough; this file was wrongly capped that way once already this way from exactly that.
 * DELAY_UI_MAX_MS below is this app's own deliberate ceiling, not an API limit, chosen so the
 * slider stays usable rather than because MagicBlock requires it.
 */
export type DelayUnit = "minutes" | "hours" | "days";

export const DELAY_UNITS: DelayUnit[] = ["minutes", "hours", "days"];

/** Slider max within each unit — e.g. "days" goes 0-7, not 0-10080 minutes on one linear track. */
export const DELAY_UNIT_MAX: Record<DelayUnit, number> = {
  minutes: 59,
  hours: 23,
  days: 7,
};

export const DELAY_UNIT_MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export const DELAY_UNIT_LABEL: Record<DelayUnit, string> = {
  minutes: "min",
  hours: "hr",
  days: "day",
};

/** Deliberate UI ceiling (7 days), not an API limit — see file header. */
export const DELAY_UI_MAX_MS = DELAY_UNIT_MAX.days * DELAY_UNIT_MS.days;

/** Human copy for how long a private transfer may take to land, e.g. "up to 6 hours" — used both
 *  on the slider itself and as the payment-page ETA (see PrivacyTimingControls, GuestCheckoutPay,
 *  c/[id]/page.tsx). */
export function formatDelayDuration(delayMs: number): string {
  if (delayMs <= 0) return "no delay";
  if (delayMs < DELAY_UNIT_MS.hours) {
    const min = Math.round(delayMs / DELAY_UNIT_MS.minutes);
    return `up to ${min} ${min === 1 ? "minute" : "minutes"}`;
  }
  if (delayMs < DELAY_UNIT_MS.days) {
    const hr = Math.round(delayMs / DELAY_UNIT_MS.hours);
    return `up to ${hr} ${hr === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round(delayMs / DELAY_UNIT_MS.days);
  return `up to ${days} ${days === 1 ? "day" : "days"}`;
}

/** Picks the coarsest unit that represents delayMs as a whole number — used to initialize the
 *  unit toggle from a value that arrived pre-set (e.g. the ?delayMs= query param carried from the
 *  Send form to /c/[id], see privacyQuery() in app/app/page.tsx). */
export function unitForDelayMs(delayMs: number): DelayUnit {
  if (delayMs > 0 && delayMs % DELAY_UNIT_MS.days === 0) return "days";
  if (delayMs > 0 && delayMs % DELAY_UNIT_MS.hours === 0) return "hours";
  return "minutes";
}
