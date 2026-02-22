/**
 * Send payment fee: 0.0015 SOL per send (both private and normal).
 * Collected to SOLANA_FEE_RECIPIENT to cover claim-related costs.
 * Set SOLANA_FEE_RECIPIENT in backend env (e.g. .env.local) so Solana fees are sent correctly.
 */
export const SEND_PAYMENT_FEE_LAMPORTS = 1_500_000; // 0.0015 SOL
export const SEND_PAYMENT_FEE_SOL = 0.0015;

/** SOL fee recipient wallet (Solana). When set, SOL fees from send-payment/claim flows should be sent here. */
export function getSolanaFeeRecipient(config?: { get: (key: string) => string | undefined }): string | undefined {
  const fromConfig = config?.get?.('SOLANA_FEE_RECIPIENT');
  if (fromConfig && typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  return process.env.SOLANA_FEE_RECIPIENT?.trim() || undefined;
}
