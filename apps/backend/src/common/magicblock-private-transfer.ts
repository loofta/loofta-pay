/**
 * Server-side MagicBlock Payments API — keeps recipient out of the browser network tab.
 * https://payments.magicblock.app/reference
 */

import { Logger } from '@nestjs/common';

const log = new Logger('MagicblockPrivateTransfer');

export const MAGICBLOCK_PRIVATE_MIN_DELAY_MS = '0';
export const MAGICBLOCK_PRIVATE_MAX_DELAY_MS = '0';

export interface MagicblockPrivateTransferTxResponse {
  kind: string;
  version: 'legacy' | 'v0';
  transactionBase64: string;
  sendTo: 'base' | 'ephemeral';
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator: string;
}

export async function requestMagicblockPrivateTransfer(params: {
  from: string;
  to: string;
  mint: string;
  amount: number;
  cluster: 'devnet' | 'mainnet';
}): Promise<MagicblockPrivateTransferTxResponse> {
  const body = {
    from: params.from,
    to: params.to,
    mint: params.mint,
    amount: params.amount,
    visibility: 'private',
    fromBalance: 'base',
    toBalance: 'base',
    cluster: params.cluster,
    initIfMissing: true,
    initAtasIfMissing: true,
    initVaultIfMissing: true,
    minDelayMs: MAGICBLOCK_PRIVATE_MIN_DELAY_MS,
    maxDelayMs: MAGICBLOCK_PRIVATE_MAX_DELAY_MS,
  };

  log.log(`POST https://payments.magicblock.app/v1/spl/transfer payload=${JSON.stringify(body)}`);

  const res = await fetch('https://payments.magicblock.app/v1/spl/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as MagicblockPrivateTransferTxResponse & {
    success?: boolean;
    error?: { message?: string };
    message?: string;
  };

  if (!res.ok || data.success === false) {
    const msg = data.error?.message ?? data.message ?? JSON.stringify(data);
    log.warn(`MagicBlock transfer build failed HTTP ${res.status}: ${msg} body=${JSON.stringify(body)}`);
    throw new Error(`MagicBlock transfer build failed (HTTP ${res.status}): ${msg}`);
  }

  const b64len = data.transactionBase64?.length ?? 0;
  log.log(
    `MagicBlock OK HTTP ${res.status} kind=${data.kind} sendTo=${data.sendTo} ix=${data.instructionCount} signers=${JSON.stringify(data.requiredSigners)} validator=${data.validator ?? 'n/a'} txBase64Len=${b64len} blockhash=${data.recentBlockhash?.slice(0, 8) ?? 'n/a'}…`,
  );

  return data as MagicblockPrivateTransferTxResponse;
}
