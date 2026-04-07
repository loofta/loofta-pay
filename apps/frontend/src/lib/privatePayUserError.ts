/**
 * User-facing copy for private MagicBlock pay failures (avoid raw RPC / web3.js boilerplate).
 */

/** Strip verbose SendTransactionError hints meant for developers. */
export function stripSolanaTxErrorBoilerplate(message: string): string {
  return message
    .replace(/\s*Catch the `SendTransactionError`[\s\S]*$/i, "")
    .replace(/\s*Logs:\s*\[\s*\]\s*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
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

  if (cleaned.length > 400) {
    return `${cleaned.slice(0, 397)}…`;
  }
  return cleaned || "Could not complete the private transfer. Please try again.";
}
