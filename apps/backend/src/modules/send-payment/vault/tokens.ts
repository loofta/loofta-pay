/** From privacy-hack lib/privacycash/tokens.ts */
import { PublicKey } from '@solana/web3.js';

export const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const TOKEN_MINTS = {
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  SOL: SOL_MINT,
} as const;
export type TokenType = keyof typeof TOKEN_MINTS;
