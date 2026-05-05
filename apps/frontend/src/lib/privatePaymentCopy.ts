/**
 * Keep in sync with MagicBlock Payments API: devnet private `maxDelayMs` ≤ 600_000 (10 minutes).
 * Backend: `MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS` in `magicblock-private-transfer.ts`.
 */
export const PRIVATE_PAYMENT_MAX_WAIT_MINUTES = 5;

export const PRIVATE_PAYMENT_ALL_PRIVATE_LINE = `All payments are private. Funds can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes to appear.`;

export function privatePaymentFundsAppearCopy(): string {
  return `Funds can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes to appear.`;
}

export function privatePaymentWaitingAfterSenderCopy(): string {
  return `Waiting for the payment to land — can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes after the sender pays.`;
}
