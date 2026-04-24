/**
 * Server-side MagicBlock Payments API — keeps recipient out of the browser network tab.
 * https://payments.magicblock.app/reference
 */

import { Logger } from '@nestjs/common';

const log = new Logger('MagicblockPrivateTransfer');

/**
 * MagicBlock pricing (Solana Mainnet): fixed 0.002 SOL + 0.1% volume fee deducted from the transferred amount.
 * Loofta passes through MagicBlock's fee exactly — no additional markup.
 * The gas conversion uses a 20% buffer to cover SOL price moves between calculation and settlement.
 * Recipient always receives the exact requested amount.
 */
export const MAGICBLOCK_VOLUME_FEE_BPS = 10; // 0.1% — deducted by MagicBlock
export const TOTAL_FEE_BPS = MAGICBLOCK_VOLUME_FEE_BPS; // 0.1% total
export const MAGICBLOCK_SPONSORED_GAS_SOL = 0.002;
/** 20% buffer on gas fee to cover SOL price moves between calculation and settlement. */
export const GAS_FEE_BUFFER_PCT = 1.20;
/** Conservative SOL fallback price used when the price API is unavailable. */
const SOL_PRICE_FALLBACK_USD = 180;
/** Cache TTL: 60 seconds — price doesn't need to be real-time for fee estimation. */
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
 * Returns the gross USDC base units the sender must transfer so that after:
 *   - MagicBlock's 0.1% volume fee
 *   - 0.002 SOL gas fee (buffered 20%) converted to USDC
 * …the recipient receives exactly `netBaseUnits`.
 */
export function grossUpForMagicblockFee(netBaseUnits: number, solPriceUsd: number): number {
  const gasFeeBaseUnits = Math.ceil(MAGICBLOCK_SPONSORED_GAS_SOL * solPriceUsd * GAS_FEE_BUFFER_PCT * 1_000_000);
  return Math.ceil(((netBaseUnits + gasFeeBaseUnits) * 10_000) / (10_000 - TOTAL_FEE_BPS));
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
