/**
 * Budget for a paid, tightly metered API (Solana Tracker: 2,500 requests a month). Pure maths so it can
 * be tested: how many calls may still be spent today, spreading what is left evenly over the days left
 * in the month so one busy day cannot use it all.
 */
export interface BudgetInput {
  monthlyCap: number;
  usedThisMonth: number;
  usedToday: number;
  now: Date;
}

export function daysLeftInMonth(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

/** Calls that may still be made today (never negative). */
export function allowanceToday(b: BudgetInput): number {
  const remainingMonth = Math.max(0, b.monthlyCap - b.usedThisMonth);
  // Today's share of what was left at the start of today, so spending today does not shrink today's share.
  const leftAtStartOfToday = remainingMonth + b.usedToday;
  const share = Math.ceil(leftAtStartOfToday / daysLeftInMonth(b.now));
  return Math.max(0, Math.min(remainingMonth, share - b.usedToday));
}
