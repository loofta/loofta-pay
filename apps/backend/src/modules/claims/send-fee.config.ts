/**
 * Send payment fee: 0.0015 SOL per send (both private and normal).
 * Collected to SOLANA_FEE_RECIPIENT to cover claim-related costs.
 */
export const SEND_PAYMENT_FEE_LAMPORTS = 1_500_000; // 0.0015 SOL
export const SEND_PAYMENT_FEE_SOL = 0.0015;

export function getSolanaFeeRecipient(): string | undefined {
  return process.env.SOLANA_FEE_RECIPIENT || undefined;
}
