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

async function buildMagicBlockPrivateTransfer(params: {
  from: string;
  to: string;
  amountUSDC: number;
  memo?: string;
}): Promise<MagicBlockTransferResponse> {
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
      initVaultIfMissing: true,
      idempotent: true,
      // No timing-obfuscation delay or splitting — checkout needs a prompt, single confirmation,
      // not graph-analysis resistance over time.
      minDelayMs: "0",
      maxDelayMs: "0",
      split: 1,
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
}): Promise<Transaction | VersionedTransaction> {
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
