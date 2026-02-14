/**
 * In-repo withdraw from Privacy Cash vault to burner (for private claim).
 * Wraps the same logic as privacy-hack so we do not call an external app.
 *
 * To enable: add privacycash and @lightprotocol/hasher.rs to backend, then
 * implement this to call withdrawSPL (e.g. from privacycash/dist/withdrawSPL.js).
 */
import { Connection, PublicKey } from '@solana/web3.js';

export interface WithdrawToBurnerParams {
  connection: Connection;
  mintAddress: PublicKey;
  baseUnits: number;
  senderPublicKey: PublicKey;
  recipientBurner: PublicKey;
  sessionSignature: Uint8Array;
  circuitBasePath: string;
  storage: Storage;
}

export async function withdrawSPLToBurner(_params: WithdrawToBurnerParams): Promise<string> {
  // In-repo implementation: use privacycash withdrawSPL when available.
  throw new Error(
    'Private payments need the vault SDK. Add privacycash and @lightprotocol/hasher.rs to the backend and implement withdraw-inline, or use regular payment.',
  );
}
