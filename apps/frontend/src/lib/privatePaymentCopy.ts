/**
 * Keep in sync with MagicBlock Payments API: devnet private `maxDelayMs` ≤ 600_000 (10 minutes).
 * Backend: `MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS` in `magicblock-private-transfer.ts`.
 */
export const PRIVATE_PAYMENT_MAX_WAIT_MINUTES = 10;

export const PRIVATE_PAYMENT_ALL_PRIVATE_LINE = `All payments are private. Funds can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes to land entirely in recipient's wallet and may arrive in parts.`;

export function privatePaymentFundsAppearCopy(): string {
  return `Funds can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes to land entirely in recipient's wallet and may arrive in parts.`;
}

export function privatePaymentWaitingAfterSenderCopy(): string {
  return `Waiting for the payment to land — can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes.`;
}

/**
 * "Waiting for funds" copy for a claim whose burner hasn't received the sender's payment yet.
 * Every claim now routes through a burner regardless of privacy (see the universal-claim
 * architecture), so this state fires for plain public sends too — only mention the up-to-10-min
 * MagicBlock landing delay when the payment was actually funded privately; a public SPL transfer
 * confirms in seconds, and implying otherwise is misleading.
 */
export function waitingForFundsCopy(isPrivate: boolean | null | undefined): string {
  return isPrivate
    ? privatePaymentWaitingAfterSenderCopy()
    : "This is a private payment. Waiting for the payment to land, this can take up to 10 minutes.";
}
