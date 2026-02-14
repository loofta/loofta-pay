/**
 * In-repo deposit tx builder for Privacy Cash (USDC).
 * Wraps the same logic as privacy-hack so we do not call an external app.
 *
 * To enable: add privacycash and @lightprotocol/hasher.rs to backend, then
 * implement this module to call buildDepositSPLTransaction (e.g. copy from
 * privacy-hack lib/sponsor/depositBuilder.ts and adapt imports).
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

export interface BuildDepositParams {
  connection: Connection;
  userPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  baseUnits: number;
  token: 'USDC';
  storage: Storage;
  circuitBasePath: string;
}

export async function buildDepositSPLTransaction(
  _params: BuildDepositParams,
): Promise<{ transaction: VersionedTransaction; lastValidBlockHeight: number }> {
  // In-repo implementation: use privacycash when available.
  // For now throw so the app runs without the SDK; add real implementation when backend has privacycash.
  throw new Error(
    'Private payments need the vault SDK. Add privacycash and @lightprotocol/hasher.rs to the backend and implement deposit-builder-inline, or use regular payment.',
  );
}
