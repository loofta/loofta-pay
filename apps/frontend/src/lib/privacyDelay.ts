/**
 * MagicBlock's private transfer endpoint accepts maxDelayMs up to 31 days. The
 * `≤ 600000 (10 min)` figure elsewhere in this repo belongs to `/v1/swap/swap`, not this
 * transfer. DELAY_UI_MAX_MS is that 31-day API maximum, and the days slider stops there.
 * Ten minutes is only the default spread on a send form, not a ceiling.
 */
export type DelayUnit = "minutes" | "hours" | "days";

export const DELAY_UNITS: DelayUnit[] = ["minutes", "hours", "days"];

/** Slider max within each unit. Days stops at the private-transfer API maximum (31). */
export const DELAY_UNIT_MAX: Record<DelayUnit, number> = {
  minutes: 59,
  hours: 23,
  days: 31,
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

/** Private-transfer API maximum (31 days). */
export const DELAY_UI_MAX_MS = DELAY_UNIT_MAX.days * DELAY_UNIT_MS.days;

/** Default spread on every send form until the sender opens Advanced options and changes it. */
export const DEFAULT_SPREAD_MS = 10 * DELAY_UNIT_MS.minutes;

/** Default split is a random count in 2–15. The slider still lets the sender pick 1–15. */
export function randomPrivacySplit(max = 15): number {
  const min = 2;
  const cap = Math.max(min, Math.round(max));
  return min + Math.floor(Math.random() * (cap - min + 1));
}

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
