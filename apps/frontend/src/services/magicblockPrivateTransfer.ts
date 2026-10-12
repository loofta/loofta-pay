/**
 * Builds a private USDC transfer via MagicBlock's own public Payments API
 * (https://payments.magicblock.app) — a stateless, third-party-hosted endpoint that only ever
 * builds unsigned transactions, never signs or sponsors them itself (see .claude/skills/magicblock/
 * private-payments.md). No Loofta backend involvement and no Privy auth required: the connected
 * wallet only ever needs to sign the token-transfer authority, not pay SOL gas — `gasless: true`
 * makes MagicBlock's own configured sponsor the fee payer, and its relay-fee (MagicBlock's cut,
 * 10bps + $0.20) is prepended to the transaction automatically by the API itself, to MagicBlock's
 * own sponsor ATA. Loofta's backend only ever verifies the on-chain result afterward (same
 * PATCH /api/claims/[id] on-chain-balance check the plain, non-private guest transfer already uses).
 *
 * Loofta's own separate cut (10 bps, to Loofta's own fee wallet — not MagicBlock's) is appended as
 * an additional plain SPL transfer instruction in the SAME transaction — one signature, no extra
 * prompt — rather than deducted later at claim/sweep time, to preserve the existing "recipient
 * always nets exactly `amount`, fee is on the payer" guarantee every other payment method follows.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const MAGICBLOCK_PAYMENTS_BASE_URL = "https://payments.magicblock.app";
// Mainnet USDC — this checkout flow is mainnet-only (see "no sandbox mode" elsewhere in the app).
const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const LOOFTA_FEE_BPS = 10;
// MagicBlock's own cut for gasless: true — collected automatically by their API (a relay-fee
// transfer to their sponsor ATA, prepended to the transaction they build), not something this
// file builds or sends anywhere itself. Only defined here so the UI can show the real total.
const MAGICBLOCK_GASLESS_FEE_BPS = 10;
const MAGICBLOCK_GASLESS_FEE_FLAT_USD = 0.2;

/** What the connected wallet actually gets debited for — the merchant's `amount` plus Loofta's
 *  10bps (appended as an instruction in this file) plus MagicBlock's own 10bps + $0.20 (prepended
 *  automatically by their API for gasless: true). UI showing "Pay $X privately" should use this,
 *  not the raw claim amount, or the button understates what the wallet is about to send. */
export function totalWithLooftaPrivateFee(amountUsd: number): number {
  const bps = LOOFTA_FEE_BPS + MAGICBLOCK_GASLESS_FEE_BPS;
  return amountUsd + amountUsd * (bps / 10_000) + MAGICBLOCK_GASLESS_FEE_FLAT_USD;
}

/** Same, for flows that take no Loofta cut at all (see buildMagicBlockPrivateTransferNoFee): just
 *  the amount plus MagicBlock's own gasless relay fee, which their API collects itself. */
export function totalWithMagicBlockPrivateFee(amountUsd: number): number {
  return amountUsd + amountUsd * (MAGICBLOCK_GASLESS_FEE_BPS / 10_000) + MAGICBLOCK_GASLESS_FEE_FLAT_USD;
}

interface MagicBlockTransferResponse {
  kind: string;
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator: string;
}

/** Timing-obfuscation knobs MagicBlock accepts on private transfers. Both default to "off"
 *  (single transfer, no delay) because checkout needs one prompt confirmation; flows that want
 *  graph-analysis resistance (e.g. the /fomo private deposit) opt in explicitly. */
export interface MagicBlockPrivacyOptions {
  /** Split into N sub-transfers. Per MagicBlock's own OpenAPI spec for this endpoint
   *  (POST /v1/spl/transfer): "Must be between 1 and 15 and cannot exceed `amount`." — a real,
   *  documented API limit, unlike maxDelayMs below. */
  split?: number;
  /** Upper bound of the random delivery delay in ms. MagicBlock's transfer endpoint documents no
   *  maximum at all — its field table just says "Defaults to '0' or minDelayMs." The 600_000
   *  (10 min) figure floated around this codebase belongs to the SWAP endpoint
   *  (POST /v1/swap/swap: "Must be ≤ 600000 (10 minutes)"), confirmed straight from
   *  .claude/skills/magicblock/private-payments.md — not this one. See DELAY_UI_MAX_MS in
   *  @/lib/privacyDelay for the deliberate UI ceiling this app chooses instead. */
  maxDelayMs?: number;
}

export const MAGICBLOCK_MAX_SPLIT = 15;

async function buildMagicBlockPrivateTransfer(params: {
  from: string;
  to: string;
  amountUSDC: number;
  memo?: string;
} & MagicBlockPrivacyOptions): Promise<MagicBlockTransferResponse> {
  const split = Math.min(MAGICBLOCK_MAX_SPLIT, Math.max(1, Math.round(params.split ?? 1)));
  // No min() clamp here — MagicBlock's transfer endpoint documents no maximum for maxDelayMs
  // (unlike split, which is really capped at 15). Pass whatever the caller asks for; the UI-side
  // ceiling (DELAY_UI_MAX_MS in @/lib/privacyDelay) is a deliberate app choice, not enforced here.
  const maxDelayMs = Math.max(0, Math.round(params.maxDelayMs ?? 0));
  const amount = Math.round(params.amountUSDC * 10 ** USDC_DECIMALS);
  if (amount <= 0) throw new Error("Amount must be greater than 0");

  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE_URL}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      mint: USDC_MINT_MAINNET,
      amount,
      // Explicit, not left to whatever the API defaults to — this app is mainnet-only, real money.
      cluster: "mainnet-private",
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      initIfMissing: true,
      initAtasIfMissing: true,
      // Leave the vault alone. Initializing it adds extra account-creation instructions that
      // wallets preview as a SOL debit instead of the USDC payment.
      initVaultIfMissing: false,
      // Recipient receives exactly `amount`. MagicBlock adds its own fee on top, which is what
      // the wallet balance change should show (payment + relay), not a fee-only transfer.
      exactOut: true,
      // Defaults to no delay and no splitting (checkout needs a prompt, single confirmation);
      // callers opt into timing obfuscation via MagicBlockPrivacyOptions.
      minDelayMs: "0",
      maxDelayMs: String(maxDelayMs),
      split,
      // MagicBlock's own configured sponsor pays the SOL network fee and automatically prepends
      // its relay-fee token transfer (its 10bps + $0.20 cut) to its own sponsor ATA — none of that
      // is Loofta's to build or collect. Loofta's separate 10bps below is appended on top of
      // whatever this produces, to Loofta's own fee wallet, not MagicBlock's.
      gasless: true,
      // Not forcing legacy: a private transfer already needs many accounts (permission PDAs,
      // delegation program, ER accounts, ...) — the API's own v0 + address-lookup-table default
      // exists specifically to fit that under Solana's 1232-byte limit. Forcing legacy here threw
      // that compaction away right before appending another instruction, guaranteeing overflow
      // ("Transaction too large: 1489 > 1232"). Handle whichever version comes back instead.
      ...(params.memo?.trim() ? { memo: params.memo.trim() } : {}),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `MagicBlock transfer build failed (${res.status})`;
    throw new Error(message);
  }
  return data as MagicBlockTransferResponse;
}

/**
 * MagicBlock's private transfer exactly as their API builds it, with nothing appended: no Loofta
 * instruction, so no Loofta fee wallet is needed or used. MagicBlock's own sponsor pays the SOL
 * network fee (`gasless: true`) and collects its own relay fee (10bps + $0.20) in USDC from the
 * payer inside the same transaction, so the payer's wallet covers everything and Loofta funds
 * nothing. Use this wherever Loofta isn't taking a cut; use the WithLooftaFee variant below only
 * where it is.
 */
export async function buildMagicBlockPrivateTransferNoFee(params: {
  from: string;
  to: string;
  amountUSDC: number;
  memo?: string;
} & MagicBlockPrivacyOptions): Promise<{
  transaction: Transaction | VersionedTransaction;
  /** Where the signed transaction has to be submitted. Base-to-base private transfers use "base". */
  sendTo: "base" | "ephemeral";
}> {
  const built = await buildMagicBlockPrivateTransfer(params);
  const rawBytes = Buffer.from(built.transactionBase64, "base64");
  const transaction = built.version === "v0" ? VersionedTransaction.deserialize(rawBytes) : Transaction.from(rawBytes);
  return { transaction, sendTo: built.sendTo };
}

function snapshotSignatures(tx: Transaction | VersionedTransaction): Uint8Array[] {
  if (tx instanceof VersionedTransaction) {
    return tx.signatures.map((sig) => Uint8Array.from(sig));
  }
  return tx.signatures.map((slot) => (slot.signature ? Uint8Array.from(slot.signature) : new Uint8Array()));
}

function signatureIsEmpty(sig: Uint8Array | undefined): boolean {
  return !sig || sig.length === 0 || sig.every((byte) => byte === 0);
}

/** MagicBlock gasless transfers arrive with the sponsor already signed as fee payer. Some
 *  wallets wipe that signature while adding the user's. Put it back or the broadcast fails. */
function restoreSponsorSignatures(tx: Transaction | VersionedTransaction, before: Uint8Array[]) {
  if (tx instanceof VersionedTransaction) {
    before.forEach((sig, i) => {
      if (!signatureIsEmpty(sig) && signatureIsEmpty(tx.signatures[i])) tx.signatures[i] = sig;
    });
    return;
  }
  before.forEach((sig, i) => {
    const slot = tx.signatures[i];
    if (slot && !slot.signature && !signatureIsEmpty(sig)) slot.signature = Buffer.from(sig);
  });
}

/**
 * Sign a gasless MagicBlock transfer with an external wallet (Phantom, Solflare).
 *
 * `signTransaction` on those wallets throws "Unexpected error" when the fee payer is
 * MagicBlock's sponsor rather than the user, and the preview then only shows the $0.20
 * relay fee. `signAllTransactions` is the path that keeps the sponsor signature and
 * simulates the full USDC debit.
 */
export async function signExternalWalletTransaction<T extends Transaction | VersionedTransaction>(
  tx: T,
  sign: {
    signTransaction?: (tx: T) => Promise<T>;
    signAllTransactions?: (txs: T[]) => Promise<T[]>;
  },
): Promise<T> {
  const before = snapshotSignatures(tx);
  let signed: T;
  if (sign.signAllTransactions) {
    const batch = await sign.signAllTransactions([tx]);
    signed = batch[0];
  } else if (sign.signTransaction) {
    signed = await sign.signTransaction(tx);
  } else {
    throw new Error("This wallet cannot sign the payment.");
  }
  restoreSponsorSignatures(signed, before);
  return signed;
}

/** A dedicated fee-collection wallet, distinct from SolanaSponsorService's fee-payer/gas-sponsor
 *  wallet (SOLANA_FEE_PAYER_PRIVATE_KEY) — that one fronts SOL gas for other, Privy-authorized
 *  sponsored flows and has nothing to do with this one, which doesn't use Loofta's sponsor at all
 *  (gas here comes from MagicBlock's own sponsor via gasless: true). Set once you have a real
 *  address — this deliberately throws rather than silently falling back to the sponsor wallet or
 *  skipping the fee.
 */
function looftaFeeWalletAddress(): PublicKey {
  const address = process.env.NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET?.trim();
  if (!address) {
    throw new Error("Loofta fee wallet is not configured (NEXT_PUBLIC_SOLANA_FEE_ATA_WALLET).");
  }
  return new PublicKey(address);
}

/**
 * Builds the full transaction a guest's connected wallet needs to sign: MagicBlock's private
 * transfer instructions, plus a plain public SPL transfer of Loofta's 10 bps cut to the same fee
 * wallet the existing authenticated private-transfer flow already uses.
 */
export async function buildMagicBlockPrivateTransferWithLooftaFee(params: {
  from: string;
  to: string;
  amountUSDC: number;
  memo?: string;
  connection: Connection;
} & MagicBlockPrivacyOptions): Promise<Transaction | VersionedTransaction> {
  const feeWallet = looftaFeeWalletAddress();
  const built = await buildMagicBlockPrivateTransfer(params);
  const rawBytes = Buffer.from(built.transactionBase64, "base64");

  const feeAmount = Math.round(params.amountUSDC * (LOOFTA_FEE_BPS / 10_000) * 10 ** USDC_DECIMALS);
  if (feeAmount <= 0) {
    // Nothing to append — hand back exactly what MagicBlock built.
    return built.version === "v0" ? VersionedTransaction.deserialize(rawBytes) : Transaction.from(rawBytes);
  }

  const mint = new PublicKey(USDC_MINT_MAINNET);
  const payer = new PublicKey(params.from);
  const payerAta = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const feeAta = getAssociatedTokenAddressSync(mint, feeWallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const feeAtaInfo = await params.connection.getAccountInfo(feeAta);
  const feeInstructions: TransactionInstruction[] = [];
  if (!feeAtaInfo) {
    feeInstructions.push(
      createAssociatedTokenAccountInstruction(payer, feeAta, feeWallet, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    );
  }
  feeInstructions.push(createTransferInstruction(payerAta, feeAta, payer, feeAmount, [], TOKEN_PROGRAM_ID));

  if (built.version === "legacy") {
    const tx = Transaction.from(rawBytes);
    tx.add(...feeInstructions);
    return tx;
  }

  // v0: decompile, append the fee instructions, recompile — reusing whatever address lookup
  // tables the original message referenced, so the recompiled message stays compact enough to
  // actually fit both the private transfer and the fee instruction under the 1232-byte limit.
  const vtx = VersionedTransaction.deserialize(rawBytes);
  const lookupTableAccounts: AddressLookupTableAccount[] = [];
  for (const lookup of vtx.message.addressTableLookups) {
    const res = await params.connection.getAddressLookupTable(lookup.accountKey);
    if (res.value) lookupTableAccounts.push(res.value);
  }
  const decompiled = TransactionMessage.decompile(vtx.message, { addressLookupTableAccounts: lookupTableAccounts });
  decompiled.instructions.push(...feeInstructions);
  const newMessage = decompiled.compileToV0Message(lookupTableAccounts);
  return new VersionedTransaction(newMessage);
}
