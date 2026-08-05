/**
 * Server-side MagicBlock Payments API — keeps recipient out of the browser network tab.
 * https://payments.magicblock.app/reference
 */

import { Logger } from '@nestjs/common';
import { PublicKey, Transaction, VersionedTransaction, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';

const log = new Logger('MagicblockPrivateTransfer');

/**
 * CONFIRMED fee mechanics (verified against MagicBlock's own web app and the official `one/`
 * reference implementation):
 *  - Pass the clean, exact intended amount as `amount` plus `exactOut: true` — MagicBlock grosses
 *    up the sender's debit INTERNALLY (its own two-hop routing: sender → MagicBlock-controlled
 *    intermediate account for the gross amount, then a second transfer delivers the net amount to
 *    the recipient) and guarantees the recipient nets exactly `amount`. Never gross up `amount`
 *    ourselves — without exactOut, MagicBlock has no reason to run its fee-taking second hop and
 *    just moves whatever `amount` you send in full, so a manual gross-up is pure overpayment with
 *    nothing collected in return (this was a real bug — see git history on grossUpForMagicblockFee).
 *  - 0.002 SOL flat fee is charged as USDC from the sender via a separate gasless relay instruction.
 */
export const MAGICBLOCK_VOLUME_FEE_BPS = 10; // deducted from USDC amount by MagicBlock
export const MAGICBLOCK_GAS_SOL = 0.002;     // actual MagicBlock SOL charge (documented)
export const MAGICBLOCK_GAS_USDC = 0.2;      // flat USDC relay fee charged by MagicBlock (200_000 units)
export const MAGICBLOCK_MIN_SENDER_SOL = 0.003; // top-up target: 0.002 MB fee + tx fees + buffer
/** Loofta's own cut on the multi-send hub transfer, additive to MagicBlock's own bps, taken via
 *  platformFeeBps/platformFeeAccount in the same call — see private-balance.service.ts's
 *  PRIVATE_BALANCE_PLATFORM_FEE_BPS for the precedent this follows. */
export const MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS = 10;
/** Loofta's own cut on a single private payment (buildPrivateTransferForPayer sender→burner,
 *  sweepClaimBurnerPrivately burner→destination), additive to MagicBlock's own bps — same
 *  platformFeeBps/platformFeeAccount mechanism, same 10bps as PRIVATE_BALANCE_PLATFORM_FEE_BPS. */
export const SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS = 10;
/**
 * Kill switch — re-enabled 2026-07-24. Root cause (confirmed by MagicBlock support): `to` was a
 * fresh, never-before-used claim burner and `platformFeeAccount` was the fee collector's *wallet*
 * address; MagicBlock's API silently requires platformFeeAccount to be that wallet's already-
 * initialized USDC ATA (undocumented, unvalidated on their end) — passing the wallet address
 * itself produced a Token program `InvalidAccountData`. Fixed at every call site by deriving the
 * ATA via getAssociatedTokenAddress instead of passing the raw sponsor address; confirmed
 * on-chain that this fee payer's USDC ATA already exists. If this ever needs to go back off,
 * flip these — no need to re-derive any of the fee-calc plumbing below.
 */
export const ENABLE_SINGLE_PAYMENT_PLATFORM_FEE = true;
export const ENABLE_MULTI_SEND_PLATFORM_FEE = true;
/**
 * Cache TTL: 10 minutes. Trades some price staleness for far fewer Jupiter/Binance calls — a
 * fee-estimate use case tolerates a stale price much better than the raw magnitude of drift that
 * caused the real underfunding incident this fee-calc logic already had (see
 * resolveMagicblockRelayFeeUsdc's doc comment): that was caused by using a flat *never-updating*
 * $0.20 constant, not by a price that's merely up to 10 minutes old. Still, 10 minutes is longer
 * than SOL/USD can reasonably be assumed static — callers building an actual on-chain transfer
 * that's sensitive to underfunding (e.g. a burner with no gross-up padding) should keep their own
 * safety margin on top rather than assume this price is current-to-the-second.
 */
const SOL_PRICE_CACHE_TTL_MS = 600_000;

let _solPriceCached: number | null = null;
let _solPriceCachedAt = 0;

/**
 * Fetch current SOL/USD price. Tries Jupiter, then Binance. Returns null if both fail.
 * Never uses a hardcoded fallback — callers must handle null.
 * Caches result for SOL_PRICE_CACHE_TTL_MS.
 */
export async function fetchSolPriceUsd(): Promise<number | null> {
  const now = Date.now();
  if (_solPriceCached !== null && now - _solPriceCachedAt < SOL_PRICE_CACHE_TTL_MS) {
    return _solPriceCached;
  }

  // 1. Jupiter API v3 (authenticated)
  const jupKey = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  try {
    const res = await fetch(
      'https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
      {
        signal: AbortSignal.timeout(3_000),
        headers: jupKey ? { 'x-api-key': jupKey } : {},
      },
    );
    const data = await res.json() as { So11111111111111111111111111111111111111112?: { usdPrice?: number } };
    const price = Number(data?.['So11111111111111111111111111111111111111112']?.usdPrice);
    if (Number.isFinite(price) && price > 0) {
      log.log(`fetchSolPriceUsd: refreshed from Jupiter — $${price.toFixed(2)} (cached ${SOL_PRICE_CACHE_TTL_MS / 1000}s)`);
      _solPriceCached = price;
      _solPriceCachedAt = now;
      return price;
    }
  } catch { /* fall through */ }

  // 2. Binance public ticker (fallback)
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      { signal: AbortSignal.timeout(3_000) },
    );
    const data = await res.json() as { price?: string };
    const price = Number(data?.price);
    if (Number.isFinite(price) && price > 0) {
      log.warn(`fetchSolPriceUsd: Jupiter failed — using Binance price $${price.toFixed(2)} (cached ${SOL_PRICE_CACHE_TTL_MS / 1000}s)`);
      _solPriceCached = price;
      _solPriceCachedAt = now;
      return price;
    }
  } catch { /* fall through */ }

  log.warn('fetchSolPriceUsd: all price APIs failed — SOL recovery will be skipped');
  return null;
}

/**
 * MagicBlock's gasless relay charge, priced in USD at the live SOL/USD rate. Its actual cost is
 * MAGICBLOCK_GAS_SOL (0.002 SOL), not a fixed dollar figure — SOL/USD moves, so pricing off the
 * flat MAGICBLOCK_GAS_USDC constant drifts wrong over time. This already caused a real incident
 * (see lottery.service.ts git history: a private withdrawal assumed the flat figure always
 * covered MagicBlock's real cost, and once SOL/USD had drifted, the relay rejected the transfer
 * as underfunded even though the burner plainly had the money). Falls back to the flat constant
 * only if the price feed is unreachable — every caller building an actual on-chain transfer
 * should go through this instead of reading MAGICBLOCK_GAS_USDC directly.
 */
export async function resolveMagicblockRelayFeeUsdc(): Promise<number> {
  const solPriceUsd = await fetchSolPriceUsd();
  const dynamicEstimate = solPriceUsd ? MAGICBLOCK_GAS_SOL * solPriceUsd : MAGICBLOCK_GAS_USDC;
  // Floor at the flat constant, confirmed against MagicBlock's actual on-chain charge (root-caused
  // incident 2026-08-05: the `gasless: true` relay fee is a separate plain spl-token transfer of
  // EXACTLY 200,000 base units / 0.2 USDC every time — full tx logs decoded via getTransaction —
  // while the SOL-price-dynamic estimate above had drifted to ~147,958 units at the time, silently
  // undershooting by ~52k units. Every unpadded caller (private-balance-processor's deposit
  // delivery, which has no gross-up buffer) failed 100% of attempts on-chain with SPL Token
  // "insufficient funds" (custom error 0x1) until this floor was added — reserving too little here
  // fails the transfer outright, reserving too much just delivers a few cents less, so always erring
  // high is the safe direction. +5% on top of the floor itself, since landing exactly on the
  // observed fee with zero margin is what caused this incident in the first place.
  return Math.max(dynamicEstimate, MAGICBLOCK_GAS_USDC) * 1.05;
}

/**
 * Estimated gross debit for UI display only — NOT what's sent as `amount` to MagicBlock.
 * The real transfer always sends the clean `netBaseUnits` with `exactOut: true` and lets
 * MagicBlock compute its own gross-up internally (see requestMagicblockPrivateTransfer).
 * This just approximates that internal math so a "platform fee" line has something to show.
 *
 * `totalBpsOverride` lets callers that also take a platformFeeBps cut (e.g. multi-send's hub
 * transfer) estimate the combined gross-up — defaults to MagicBlock's own bps alone.
 */
export function estimateMagicblockGrossUp(netBaseUnits: number, totalBpsOverride?: number): number {
  const bps = totalBpsOverride ?? MAGICBLOCK_VOLUME_FEE_BPS;
  return Math.ceil((netBaseUnits * 10_000) / (10_000 - bps)) + 1;
}

/**
 * Delivery delays break timing correlation between send and receive events.
 *
 * Mainnet: 1 min–10 min random window — breaks timing analysis while keeping funds in transit ≤10 min (API max).
 * Devnet:  30s–300s (5 min window for testing the full delay range).
 * Localhost: no delay.
 */
export const MAGICBLOCK_PRIVATE_API_MAX_DELAY_MS = 600_000;      // API hard limit
export const MAGICBLOCK_PRIVATE_DEVNET_MIN_DELAY_MS = 30_000;
export const MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS = 300_000;  // 5 min
export const MAGICBLOCK_PRIVATE_MAINNET_MIN_DELAY_MS = 60_000;   // 1 min
export const MAGICBLOCK_PRIVATE_MAINNET_MAX_DELAY_MS = 600_000;  // 10 min (API max)

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

/**
 * Picks the delivery split count for a private transfer. Randomized (not a pure function of
 * amount) so identical dollar amounts don't always produce the same split count — a formula like
 * `2 + floor(amount) % 3` is itself a fingerprint once an observer notices the pattern. Still
 * loosely scales with amount (larger transfers get a wider band) since bigger payments benefit
 * from more mixing surface anyway.
 */
export function computeSplitForAmount(baseUnits: number): number {
  const amountUsd = baseUnits / 1_000_000;
  const [min, max] = amountUsd >= 500 ? [5, 10] : amountUsd >= 50 ? [4, 8] : amountUsd >= 20 ? [3, 6] : [2, 5];
  return min + Math.floor(Math.random() * (max - min + 1));
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
  /** Jupiter USDC→SOL swap transaction to sign & send BEFORE the private transfer (mainnet only, when sender SOL balance is low). */
  solSwapTransactionBase64?: string;
}

/**
 * What actually goes to the browser for a private-transfer build. Deliberately NOT the raw
 * MagicBlock response — `kind`, `recentBlockhash`, `lastValidBlockHeight`, `instructionCount`,
 * `requiredSigners` (includes MagicBlock's own relay/crank address) and `validator` are all
 * internal routing details the client doesn't need to sign or broadcast the transaction, and
 * spreading the raw upstream object (as the old code did) leaks whatever MagicBlock includes,
 * documented or not — same goal as this file's original "keeps recipient out of the browser
 * network tab" design, just applied to the rest of the payload too.
 */
export interface MagicblockPrivateTransferClientResponse {
  transactionBase64: string;
  version: 'legacy' | 'v0';
  sendTo: 'base' | 'ephemeral';
  feeAmountUsdc?: number;
  feeBreakdown?: {
    looftaBpsUsdc: number;
    solRecoveryUsdc: number;
    solLamports: number;
    solPriceUsd: number;
  };
}

export function toClientResponse(
  txResponse: MagicblockPrivateTransferTxResponse,
  overrides: { feeAmountUsdc: number; feeBreakdown: MagicblockPrivateTransferClientResponse['feeBreakdown'] },
): MagicblockPrivateTransferClientResponse {
  return {
    transactionBase64: txResponse.transactionBase64,
    version: txResponse.version,
    sendTo: txResponse.sendTo,
    feeAmountUsdc: overrides.feeAmountUsdc,
    feeBreakdown: overrides.feeBreakdown,
  };
}

export async function requestMagicblockPrivateTransfer(params: {
  from: string;
  to: string;
  mint: string;
  amount: number;
  cluster: 'devnet' | 'mainnet' | 'localhost';
  /** When true, MagicBlock uses the configured sponsor as fee payer and prepends a fixed
   *  relay-fee USDC transfer (sender → sponsor ATA) to cover SOL gas. No SOL needed from sender. */
  gasless?: boolean;
  /** Override cluster-default min delay (ms). Pass 0 for instant. */
  minDelayMs?: number;
  /** Override cluster-default max delay (ms). Pass 0 for instant. */
  maxDelayMs?: number;
  /** When true, `amount` is what the destination receives net — MagicBlock grosses up the
   *  sender's debit internally to cover its own fee. This is the official reference pattern
   *  (confirmed against MagicBlock's own web app and the payments-demo `one/` reference repo):
   *  never gross up `amount` ourselves, just pass the clean intended amount with exactOut: true. */
  exactOut?: boolean;
  /** Loofta's own cut, taken by MagicBlock as part of this same transfer (proportional, bps of
   *  `amount`) — requires platformFeeAccount too. Lets a caller collect its fee without a
   *  separate fee-collection transaction/signature. Both fields are optional and additive — omit
   *  either to get today's behavior (no platform fee taken). */
  platformFeeBps?: number;
  /** Destination wallet for platformFeeBps — must be paired with platformFeeBps. */
  platformFeeAccount?: string;
}): Promise<MagicblockPrivateTransferTxResponse> {
  const defaults = magicblockPrivateDelayForCluster(params.cluster);
  const minDelayMs = params.minDelayMs !== undefined ? String(params.minDelayMs) : defaults.minDelayMs;
  const maxDelayMs = params.maxDelayMs !== undefined ? String(params.maxDelayMs) : defaults.maxDelayMs;
  const body: Record<string, unknown> = {
    from: params.from,
    to: params.to,
    mint: params.mint,
    amount: params.amount,
    visibility: 'private',
    fromBalance: 'base',
    toBalance: 'base',
    cluster: params.cluster === 'mainnet' ? 'mainnet-private' : 'devnet',
    initIfMissing: true,
    initAtasIfMissing: true,
    initVaultIfMissing: false,
    minDelayMs,
    maxDelayMs,
    ...(params.cluster === 'mainnet' ? { split: computeSplitForAmount(params.amount) } : {}),
    ...(params.gasless ? { gasless: true } : {}),
    ...(params.exactOut !== undefined ? { exactOut: params.exactOut } : {}),
    ...(params.platformFeeBps !== undefined && params.platformFeeAccount
      ? { platformFeeBps: params.platformFeeBps, platformFeeAccount: params.platformFeeAccount }
      : {}),
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

const TOKEN_PROGRAM_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Decodes the actual total USDC debit from the sender's ATA by summing all SPL Transfer
 * instructions in the MagicBlock-built transaction. Returns units, or null on parse failure.
 *
 * actualFee = decodedDebit - netBaseUnits
 *
 * LIMITATION — only sees TOP-LEVEL instructions in the unsigned tx. MagicBlock's private transfer
 * routes the real debit through its own vault program, which CPIs into the Token program at
 * runtime (visible in simulation logs as "invoke [2]" inside a MagicBlock-owned program ID) — that
 * nested transfer is never present in the raw transaction bytes, so this function cannot see it and
 * will silently under-report the true debit. Confirmed in production: a caller used this to
 * "verify sufficient balance before signing" and it passed while the real send still failed
 * on-chain with insufficient funds. Do not treat this as a sufficient-balance check — the RPC's own
 * preflight simulation (which does execute CPIs) is the only reliable ground truth for that.
 */
export async function decodeActualSenderDebit(
  transactionBase64: string,
  senderWallet: string,
  usdcMint: PublicKey,
  connection?: Connection,
): Promise<number | null> {
  try {
    const senderAta = await getAssociatedTokenAddress(usdcMint, new PublicKey(senderWallet));
    const senderAtaStr = senderAta.toBase58();
    const txBytes = Buffer.from(transactionBase64, 'base64');

    type IxInfo = { programId: string; accounts: string[]; data: Buffer };
    let instructions: IxInfo[];

    let legacyTx: Transaction | null = null;
    try { legacyTx = Transaction.from(txBytes); } catch { /* fall through to v0 */ }

    if (legacyTx) {
      instructions = legacyTx.instructions.map(ix => ({
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map(k => k.pubkey.toBase58()),
        data: Buffer.from(ix.data),
      }));
    } else {
      const v0Tx = VersionedTransaction.deserialize(txBytes);
      const altAccounts: AddressLookupTableAccount[] = [];
      if (connection && v0Tx.message.addressTableLookups.length > 0) {
        for (const lookup of v0Tx.message.addressTableLookups) {
          const r = await connection.getAddressLookupTable(lookup.accountKey);
          if (r.value) altAccounts.push(r.value);
        }
      }
      const decompiledMsg = TransactionMessage.decompile(v0Tx.message, { addressLookupTableAccounts: altAccounts });
      instructions = decompiledMsg.instructions.map(ix => ({
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map(k => k.pubkey.toBase58()),
        data: Buffer.from(ix.data),
      }));
    }

    let totalDebit = 0;
    for (const ix of instructions) {
      if (ix.programId !== TOKEN_PROGRAM_STR) continue;
      if (ix.data.length < 9) continue;
      const disc = ix.data[0];
      // SPL Transfer = 3, TransferChecked = 12 — both have source as accounts[0]
      if (disc !== 3 && disc !== 12) continue;
      if (ix.accounts[0] !== senderAtaStr) continue;
      totalDebit += Number(ix.data.readBigUInt64LE(1));
    }

    if (totalDebit === 0) {
      log.warn(`[decode] no sender transfers found for ${senderWallet.slice(0, 8)}…`);
      return null;
    }
    return totalDebit;
  } catch (e) {
    log.warn(`[decode] failed to decode sender debit: ${String(e)}`);
    return null;
  }
}

// NOTE: an earlier version of this file appended a Loofta fee instruction directly onto
// MagicBlock's built transaction (decompile -> push instruction -> recompile -> re-serialize).
// That broke real payments: gasless transfers have MagicBlock's own relay/crank account as a
// REQUIRED CO-SIGNER (confirmed via requiredSigners in production), and it's presigned
// server-side before the transaction reaches us. Rebuilding the message invalidates that
// existing signature, so the tx fails "did not pass signature verification" once the sender
// signs their part. Any future attempt at appending a Loofta-collected fee needs either a
// genuinely separate transaction (extra signature prompt) or a MagicBlock API param that lets
// them build our instruction in — not post-hoc modification of their returned transaction.
