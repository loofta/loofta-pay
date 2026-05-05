/**
 * Server-side MagicBlock Payments API — keeps recipient out of the browser network tab.
 * https://payments.magicblock.app/reference
 */

import { Logger } from '@nestjs/common';
import { PublicKey, Transaction, VersionedTransaction, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js';
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
export const MAGICBLOCK_GAS_SOL = 0.002;     // actual MagicBlock SOL charge (documented)
export const MAGICBLOCK_MIN_SENDER_SOL = 0.003; // top-up target: 0.002 MB fee + tx fees + buffer
/** Cache TTL: 60 seconds. */
const SOL_PRICE_CACHE_TTL_MS = 60_000;

let _solPriceCached: number | null = null;
let _solPriceCachedAt = 0;

/**
 * Fetch current SOL/USD price. Tries Jupiter, then Binance. Returns null if both fail.
 * Never uses a hardcoded fallback — callers must handle null.
 * Caches result for 60 seconds.
 */
export async function fetchSolPriceUsd(): Promise<number | null> {
  const now = Date.now();
  if (_solPriceCached !== null && now - _solPriceCachedAt < SOL_PRICE_CACHE_TTL_MS) {
    return _solPriceCached;
  }

  // 1. Jupiter lite API
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
  } catch { /* fall through */ }

  // 2. Binance public ticker (no API key required)
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      { signal: AbortSignal.timeout(3_000) },
    );
    const data = await res.json() as { price?: string };
    const price = Number(data?.price);
    if (Number.isFinite(price) && price > 0) {
      log.warn(`fetchSolPriceUsd: Jupiter failed — using Binance price $${price.toFixed(2)}`);
      _solPriceCached = price;
      _solPriceCachedAt = now;
      return price;
    }
  } catch { /* fall through */ }

  log.warn('fetchSolPriceUsd: all price APIs failed — SOL recovery will be skipped');
  return null;
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
 * Devnet:  30s–300s (5 min window for testing the full delay range).
 * Localhost: no delay.
 */
export const MAGICBLOCK_PRIVATE_API_MAX_DELAY_MS = 600_000;
export const MAGICBLOCK_PRIVATE_DEVNET_MIN_DELAY_MS = 30_000;
export const MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS = 300_000;  // 5 min
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
  feeAmountUsdc?: number;
  feeBreakdown?: {
    looftaBpsUsdc: number;    // 10 BPS of claim amount, in USDC
    solRecoveryUsdc: number;  // SOL cost converted to USDC (capped)
    solLamports: number;      // actual lamports topped up
    solPriceUsd: number;      // SOL/USD price used at payment time
  };
}

export async function requestMagicblockPrivateTransfer(params: {
  from: string;
  to: string;
  mint: string;
  amount: number;
  cluster: 'devnet' | 'mainnet' | 'localhost';
}): Promise<MagicblockPrivateTransferTxResponse> {
  const { minDelayMs, maxDelayMs } = magicblockPrivateDelayForCluster(params.cluster);
  const body: Record<string, unknown> = {
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
 * collects its fee (10 BPS + SOL gas recovery) from the sender in the same atomic tx.
 *
 * `feeUnits` must be pre-calculated by the caller (bps fee + sol recovery in USDC units).
 * The MagicBlock `amount` must already be net of this fee (sender pays exactly the stated amount).
 *
 * Supports both legacy and v0 (ALT-based) transactions. v0 is decompiled, fee ix appended,
 * and recompiled as v0 so the tx stays compact (~750b instead of ~1210b legacy expansion).
 */
export async function appendLooftaFeeInstruction(
  transactionBase64: string,
  senderWallet: string,
  feeCollectorWallet: string,
  feeUnits: number,
  usdcMint: PublicKey,
  connection: Connection,
  feePayer: PublicKey,
): Promise<string> {
  if (feeUnits <= 0) return transactionBase64;

  const txBytes = Buffer.from(transactionBase64, 'base64');

  const sender = new PublicKey(senderWallet);
  const feeCollector = new PublicKey(feeCollectorWallet);
  const senderAta = await getAssociatedTokenAddress(usdcMint, sender);
  const feeCollectorAta = await getAssociatedTokenAddress(usdcMint, feeCollector);

  const feeIxs: ReturnType<typeof createTransferInstruction>[] = [];
  try {
    await getAccount(connection, feeCollectorAta);
  } catch {
    log.log(`[FeeCollector] Creating USDC ATA for fee collector ${feeCollector.toBase58()}…`);
    feeIxs.push(createAssociatedTokenAccountInstruction(feePayer, feeCollectorAta, feeCollector, usdcMint) as never);
  }
  feeIxs.push(createTransferInstruction(senderAta, feeCollectorAta, sender, feeUnits) as never);

  log.log(
    `[FeeCollector] *** FEE COLLECTION ***\n` +
    `  fee_collector : ${feeCollector.toBase58()}\n` +
    `  fee_collector_ata: ${feeCollectorAta.toBase58()}\n` +
    `  sender        : ${senderWallet}\n` +
    `  TOTAL_FEE     : ${feeUnits} units ($${(feeUnits / 1_000_000).toFixed(6)} USDC)`,
  );

  // Legacy tx path
  let legacyTx: Transaction | null = null;
  try { legacyTx = Transaction.from(txBytes); } catch { legacyTx = null; }
  if (legacyTx) {
    for (const ix of feeIxs) legacyTx.add(ix);
    return legacyTx.serialize({ requireAllSignatures: false }).toString('base64');
  }

  // v0 tx path — resolve ALTs, decompile, append fee ixs, recompile as v0 (stays compact)
  const v0Tx = VersionedTransaction.deserialize(txBytes);
  const altAccounts: AddressLookupTableAccount[] = [];
  for (const lookup of v0Tx.message.addressTableLookups) {
    const r = await connection.getAddressLookupTable(lookup.accountKey);
    if (r.value) altAccounts.push(r.value);
  }
  const decompiledMsg = TransactionMessage.decompile(v0Tx.message, { addressLookupTableAccounts: altAccounts });
  const newV0Msg = new TransactionMessage({
    payerKey: decompiledMsg.payerKey,
    recentBlockhash: decompiledMsg.recentBlockhash,
    instructions: [...decompiledMsg.instructions, ...feeIxs],
  }).compileToV0Message(altAccounts);
  const newV0Tx = new VersionedTransaction(newV0Msg);
  const ser = newV0Tx.serialize();
  log.log(`[FeeCollector] v0 fee ix appended | tx size: ${txBytes.length}b → ${ser.length}b`);
  return Buffer.from(ser).toString('base64');
}
