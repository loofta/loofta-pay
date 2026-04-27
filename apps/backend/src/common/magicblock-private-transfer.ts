/**
 * Server-side MagicBlock Payments API — keeps recipient out of the browser network tab.
 * https://payments.magicblock.app/reference
 */

import { Logger } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';

const log = new Logger('MagicblockPrivateTransfer');

/**
 * CONFIRMED fee mechanics (from live devnet test):
 *  - `amount` = gross USDC taken from sender. MagicBlock deducts 10 BPS before routing to recipient.
 *  - 0.002 SOL flat fee is charged in native SOL from the sender's wallet (mainnet only, separate ix).
 *  - Loofta appends its own 10 BPS USDC transfer instruction to the same transaction.
 *
 * Gross-up formula: to ensure recipient gets exactly N units, send ceil(N * 10000 / 9990).
 */
export const MAGICBLOCK_VOLUME_FEE_BPS = 10; // deducted from USDC amount by MagicBlock
export const LOOFTA_FEE_BPS = 10;            // Loofta fee via appended ix (10 BPS of net)
export const MAGICBLOCK_GAS_SOL = 0.002;     // flat SOL fee charged by MagicBlock (mainnet only)
/** Conservative SOL fallback price used when the price API is unavailable. */
const SOL_PRICE_FALLBACK_USD = 180;
/** Cache TTL: 60 seconds. */
const SOL_PRICE_CACHE_TTL_MS = 60_000;

let _solPriceCached: number | null = null;
let _solPriceCachedAt = 0;

/** Fetch current SOL/USD price from Jupiter. Caches result for 60s. Falls back to a conservative estimate on error. */
export async function fetchSolPriceUsd(): Promise<number> {
  const now = Date.now();
  if (_solPriceCached !== null && now - _solPriceCachedAt < SOL_PRICE_CACHE_TTL_MS) {
    return _solPriceCached;
  }
  try {
    const res = await fetch(
      'https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112',
      { signal: AbortSignal.timeout(3_000) },
    );
    const data = await res.json() as { data?: { So11111111111111111111111111111111111111112?: { price?: string } } };
    const price = Number(data?.data?.['So11111111111111111111111111111111111111112']?.price);
    if (Number.isFinite(price) && price > 0) {
      _solPriceCached = price;
      _solPriceCachedAt = now;
      return price;
    }
  } catch { /* fall through to fallback */ }
  log.warn(`fetchSolPriceUsd: Jupiter price API failed — using fallback $${SOL_PRICE_FALLBACK_USD}`);
  return SOL_PRICE_FALLBACK_USD;
}

/**
 * Gross-up USDC base units so the recipient receives exactly `netBaseUnits` after
 * MagicBlock deducts their 10 BPS volume fee from `amount`.
 * The 0.002 SOL flat fee is charged in native SOL by MagicBlock — not included here.
 */
export function grossUpForMagicblockFee(netBaseUnits: number): number {
  // +1 extra unit ($0.000001) as a rounding buffer in case MagicBlock rounds their fee up.
  return Math.ceil((netBaseUnits * 10_000) / (10_000 - MAGICBLOCK_VOLUME_FEE_BPS)) + 1;
}

/**
 * Delivery delays break timing correlation between send and receive events.
 * API constraint: `maxDelayMs` must be ≤ 600_000 (10 minutes).
 *
 * Mainnet: 10s–60s random window — enough to break timing analysis, short enough UX is fine.
 * Devnet:  30s–600s (wider window for testing the full delay range).
 * Localhost: no delay.
 */
export const MAGICBLOCK_PRIVATE_API_MAX_DELAY_MS = 600_000;
export const MAGICBLOCK_PRIVATE_DEVNET_MIN_DELAY_MS = 30_000;
export const MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS = MAGICBLOCK_PRIVATE_API_MAX_DELAY_MS;
export const MAGICBLOCK_PRIVATE_MAINNET_MIN_DELAY_MS = 10_000;  // 10s
export const MAGICBLOCK_PRIVATE_MAINNET_MAX_DELAY_MS = 60_000;  // 60s

export function magicblockPrivateDelayForCluster(cluster: 'devnet' | 'mainnet' | 'localhost'): {
  minDelayMs: string;
  maxDelayMs: string;
} {
  if (cluster === 'devnet') {
    return {
      minDelayMs: String(MAGICBLOCK_PRIVATE_DEVNET_MIN_DELAY_MS),
      maxDelayMs: String(MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS),
    };
  }
  if (cluster === 'mainnet') {
    return {
      minDelayMs: String(MAGICBLOCK_PRIVATE_MAINNET_MIN_DELAY_MS),
      maxDelayMs: String(MAGICBLOCK_PRIVATE_MAINNET_MAX_DELAY_MS),
    };
  }
  return { minDelayMs: '0', maxDelayMs: '0' };
}

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
  cluster: 'devnet' | 'mainnet' | 'localhost';
}): Promise<MagicblockPrivateTransferTxResponse> {
  const { minDelayMs, maxDelayMs } = magicblockPrivateDelayForCluster(params.cluster);
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
    initVaultIfMissing: false,
    minDelayMs,
    maxDelayMs,
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

/**
 * Appends a USDC SPL transfer instruction to the MagicBlock transaction so Loofta
 * collects its 10 BPS fee directly from the sender in the same atomic transaction.
 *
 * `amount` passed to MagicBlock must be `baseUnits` (what recipient gets).
 * This ix transfers `ceil(baseUnits * LOOFTA_FEE_BPS / 10_000)` from sender → feeCollector.
 *
 * If the tx is versioned (v0) we cannot easily append instructions, so we log a warning
 * and return the transaction unchanged.
 */
export async function appendLooftaFeeInstruction(
  transactionBase64: string,
  senderWallet: string,
  feeCollectorWallet: string,
  netBaseUnits: number,
  usdcMint: PublicKey,
  connection: Connection,
  feePayer: PublicKey,
): Promise<string> {
  const feeUnits = Math.ceil(netBaseUnits * LOOFTA_FEE_BPS / 10_000);
  if (feeUnits <= 0) return transactionBase64;

  const txBytes = Buffer.from(transactionBase64, 'base64');
  let tx: Transaction;
  try {
    tx = Transaction.from(txBytes);
  } catch {
    log.warn('[FeeCollector] MagicBlock returned a versioned (v0) tx — cannot append fee ix, skipping');
    return transactionBase64;
  }

  const sender = new PublicKey(senderWallet);
  const feeCollector = new PublicKey(feeCollectorWallet);
  const senderAta = await getAssociatedTokenAddress(usdcMint, sender);
  const feeCollectorAta = await getAssociatedTokenAddress(usdcMint, feeCollector);

  // Create the fee collector ATA if it doesn't exist yet (fee payer covers the rent).
  try {
    await getAccount(connection, feeCollectorAta);
  } catch {
    log.log(`[FeeCollector] Creating USDC ATA for fee collector ${feeCollector.toBase58().slice(0, 8)}…`);
    tx.add(createAssociatedTokenAccountInstruction(feePayer, feeCollectorAta, feeCollector, usdcMint));
  }

  tx.add(createTransferInstruction(senderAta, feeCollectorAta, sender, feeUnits));

  log.log(`[FeeCollector] Appended ${feeUnits} USDC fee units (${LOOFTA_FEE_BPS} BPS of ${netBaseUnits}) → ${feeCollector.toBase58().slice(0, 8)}…`);
  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}
