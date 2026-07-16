import { PublicKey } from '@solana/web3.js';

/** Validates a Solana address by actually decoding it (base58 -> exactly 32 bytes). */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address.trim());
    return true;
  } catch {
    return false;
  }
}
