/**
 * User-facing copy for private MagicBlock pay failures (avoid raw RPC / web3.js boilerplate).
 */

/** Strip verbose SendTransactionError hints meant for developers. */
export function stripSolanaTxErrorBoilerplate(message: string): string {
  return message
    .replace(/\s*Catch the `SendTransactionError`[\s\S]*$/i, "")
    // Strip the whole Logs: [...] block regardless of content — raw program log lines
    // (e.g. "Program ... invoke [1]") are never meaningful to an end user.
    .replace(/\s*Logs:\s*\[[\s\S]*?\]\s*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True once a message is just a bare technical fragment not worth showing verbatim
 *  (e.g. "Simulation failed. Message: Transaction simulation failed: Error processing
 *  Instruction 1: invalid account data for instruction."). */
export function isRawOnChainProgramError(message: string): boolean {
  const s = message.toLowerCase();
  return (
    s.includes("simulation failed") ||
    s.includes("invalidaccountdata") ||
    s.includes("invalid account data") ||
    /error processing instruction/i.test(s) ||
    /custom program error/i.test(s)
  );
}

/** Our own confirmSignature.ts timeout — internal diagnostic (RPC host, cluster, signature),
 *  never meant for an end user. The underlying transfer frequently already landed; this just
 *  means our polling gave up, so point the user at retrying rather than a raw timeout dump. */
export function isConfirmPollingTimeout(message: string): boolean {
  return /^\[PER confirm\]/.test(message);
}

/** Typical simulation failure when the fee payer has no SOL / account never funded. */
export function isInsufficientSolOrNoPriorCreditError(message: string): boolean {
  const s = message.toLowerCase();
  return (
    (s.includes("debit") && (s.includes("prior credit") || s.includes("no record"))) ||
    s.includes("insufficient funds") ||
    s.includes("insufficient lamports") ||
    /attempt to debit/i.test(s)
  );
}

/**
 * @param cluster from `getSolanaCluster()` — devnet/testnet get faucet guidance; mainnet different copy.
 */
export function privatePayErrorMessageForUser(message: string, cluster: string): string {
  const cleaned = stripSolanaTxErrorBoilerplate(message);
  const isMainnet = cluster === "mainnet-beta";

  if (!isMainnet && isInsufficientSolOrNoPriorCreditError(cleaned)) {
    return (
      "This wallet has no SOL on devnet for network fees. Holding USDC is not enough — Solana charges a small fee in SOL. " +
      "Get devnet SOL from a faucet (for example https://faucet.solana.com), wait for it to arrive, then try again."
    );
  }

  if (isMainnet && isInsufficientSolOrNoPriorCreditError(cleaned)) {
    return (
      "This wallet does not have enough SOL to pay Solana network fees. Add a small amount of SOL for fees and try again."
    );
  }

  if (isRawOnChainProgramError(cleaned)) {
    return "This private transfer couldn't be completed right now. Please try again in a moment — if it keeps happening, contact support.";
  }

  if (isConfirmPollingTimeout(cleaned)) {
    return "This is taking longer than expected to confirm. It may have already gone through — please try again before assuming it failed, and check your balance first if you're unsure.";
  }

  if (cleaned.length > 400) {
    return `${cleaned.slice(0, 397)}…`;
  }
  return cleaned || "Could not complete the private transfer. Please try again.";
}
