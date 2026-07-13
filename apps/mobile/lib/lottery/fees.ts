/** Mirrors apps/frontend/src/app/app/megapot/page.tsx's fee constants exactly — same numbers,
 *  same formula, so the price shown on mobile always matches the price shown on web. */
const MAGICBLOCK_GASLESS_RELAY_FEE_USD = 0.2;
const MAGICBLOCK_BPS = 10;

export const TICKET_PRICE_USDC = 1;

/** The withdrawal floor is owned and enforced by the backend (WITHDRAW_MIN_USDC in
 *  lottery.service.ts), reported per-request as dashboard.withdrawMinUsdc and per-ticket as
 *  ticket.isFreeTicket. This is only a fallback until the dashboard loads — prefer the backend
 *  values. Below it a win is a "free ticket" (play-again only, no withdrawal). */
export const DEFAULT_WITHDRAW_MIN_USDC = 1.3;

/** Above this, withdrawing becomes the featured CTA instead of Play again — a win this size
 *  shouldn't default to nudging the user straight back into another draw. */
export const WITHDRAW_FEATURED_THRESHOLD_USDC = 5;

/** Whether an aggregate/total win is below the withdrawal floor (→ "Free ticket", play-again
 *  only). For a single ticket, prefer the authoritative ticket.isFreeTicket flag from the backend. */
export function isFreeTicketAmount(winUsdc: number | null | undefined, thresholdUsdc: number): boolean {
  const n = winUsdc ?? 0;
  return n > 0 && n < thresholdUsdc;
}

/** 10 BPS of `base` + the flat $0.20 gasless relay fee MagicBlock charges. */
export function mbFee(base: number): number {
  return (MAGICBLOCK_BPS / 10_000) * base + MAGICBLOCK_GASLESS_RELAY_FEE_USD;
}

export function totalCost(numTickets: number): number {
  // Loofta no longer adds a service fee — buyer pays ticket cost + MagicBlock's transfer fee only.
  const base = numTickets * TICKET_PRICE_USDC;
  return base + mbFee(base);
}

/** Public (non-private) purchases skip MagicBlock entirely — Loofta's fee wallet covers the
 *  NEAR Intents bridge fee itself (see buildPublicPurchaseTransferTx in lottery.service.ts), so
 *  the buyer only ever pays ticket cost. No fee line to show. */
export function publicTotalCost(numTickets: number): number {
  return numTickets * TICKET_PRICE_USDC;
}

export function fmt(n: number, localeTag = 'en-US'): string {
  return `$${n.toLocaleString(localeTag, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
