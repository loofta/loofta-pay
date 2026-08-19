import { PublicKey } from '@solana/web3.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

/** Validates a Solana address by actually decoding it (base58 -> exactly 32 bytes). */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address.trim());
    return true;
  } catch {
    return false;
  }
}

/** Validates a Solana transaction signature's shape (base58 -> exactly 64 bytes, an ed25519
 *  sig). This only rejects strings that could never be a real signature — it does NOT confirm
 *  the signature exists on-chain or moved any funds, that's SolanaTxVerifierService's job. */
export function isValidSolanaSignature(signature: string): boolean {
  try {
    return bs58.decode(signature.trim()).length === 64;
  } catch {
    return false;
  }
}
