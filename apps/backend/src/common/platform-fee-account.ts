import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

/**
 * MagicBlock's platformFeeAccount must be the fee collector's initialized USDC ATA, not its
 * wallet address. On mainnet a missing fee payer must abort the transfer instead of silently
 * dropping platformFeeBps and moving the money for free.
 */
export async function resolvePlatformFeeAccount(
  feePayerAddress: string | null | undefined,
  mint: PublicKey,
  cluster: string,
): Promise<string | null> {
  if (!feePayerAddress) {
    if (cluster === 'devnet' || cluster === 'localhost') return null;
    throw new Error('Platform fee account unavailable (fee payer not configured) — refusing to build a private transfer without the Loofta fee');
  }
  return (await getAssociatedTokenAddress(mint, new PublicKey(feePayerAddress))).toBase58();
}
