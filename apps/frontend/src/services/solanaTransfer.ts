/**
 * Send USDC (SPL token) from one Solana address to another.
 * Uses VersionedTransaction for Privy signing.
 */

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { getUsdcMint } from "@/lib/per/constants";
import type { NetworkMode } from "@/lib/solanaRpc";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const USDC_DECIMALS = 6;

const RETRYABLE_RPC_MESSAGE = /too many requests|429|rate limit/i;

async function rpcWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error ?? "");
      const shouldRetry = RETRYABLE_RPC_MESSAGE.test(message) && attempt < retries;
      if (!shouldRetry) throw error;
      const waitMs = 250 * Math.pow(2, attempt);
      console.warn(`[solanaTransfer] ${label} rate-limited, retrying in ${waitMs}ms`, error);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`RPC failed for ${label}`);
}

/**
 * Build and return an unsigned VersionedTransaction for USDC transfer.
 * Default: sender pays fees (Privy gas sponsorship or user's SOL).
 * Optional `feePayerAddress`: Loofta backend (`SOLANA_FEE_PAYER_PRIVATE_KEY`) pays fees + ATA rent;
 * user still signs as token authority; backend co-signs and broadcasts via `/claims/solana-sponsor/sign-and-broadcast`.
 */
export async function buildUSDCTransferTransaction(params: {
  senderAddress: string;
  recipientAddress: string;
  amountUSDC: number;
  connection?: Connection;
  /** Optional memo (e.g. for Near Intents deposit); added as SPL Memo instruction. */
  memo?: string | null;
  /** When set (and distinct from sender), transaction fee payer + ATA rent payer for new accounts. */
  feePayerAddress?: string | null;
  /** Override USDC mint (for networkMode-aware callers). Defaults to cluster-based getUsdcMint(). */
  usdcMint?: PublicKey;
  /** Optional second transfer leg in the same transaction/signature — used for the Loofta fee
   * cut on PAJ Cash Naira withdrawals (fee wallet + net amount to PAJ, one user signature). */
  extraTransfer?: { recipientAddress: string; amountUSDC: number };
  /** When false, never let feePayer create a new recipient ATA — throws a clear error up front
   *  instead. Used for withdrawals to an arbitrary user-supplied address, which (unlike claim
   *  payments, giveaway funding, etc.) has no backend-tracked record to bind an ATA-creation-rent
   *  sponsorship against, so the backend refuses to sponsor it anyway (see project memory: solana
   *  sponsor security hardening). Sponsoring the transaction's network fee is unaffected — this
   *  only gates the ATA *rent* the fee payer would otherwise pay for a brand-new recipient.
   *  Defaults to true so claim payments etc. (which DO have a real record to bind to) are
   *  unaffected. */
  sponsorNewRecipientAccounts?: boolean;
}): Promise<VersionedTransaction> {
  const connection =
    params.connection || new Connection(getSolanaHttpRpc(), "confirmed");
  const mint = params.usdcMint ?? getUsdcMint();
  const sender = new PublicKey(params.senderAddress);
  const recipient = new PublicKey(params.recipientAddress);
  const feePayerRaw = params.feePayerAddress?.trim();
  const feePayer =
    feePayerRaw &&
    feePayerRaw.length > 0 &&
    feePayerRaw !== params.senderAddress.trim()
      ? new PublicKey(feePayerRaw)
      : null;

  const amountRaw = Math.floor(params.amountUSDC * 10 ** USDC_DECIMALS);
  if (amountRaw <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  const senderAta = getAssociatedTokenAddressSync(
    mint,
    sender,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("[buildUSDCTransferTransaction] Building USDC transfer", {
    senderAta: senderAta.toBase58(),
    recipientAta: recipientAta.toBase58(),
    amountUSDC: params.amountUSDC,
    amountRaw,
    memo: params.memo ?? undefined,
  });

  const instructions: TransactionInstruction[] = [];

  // Memo first (if present) so it appears in transaction logs
  if (params.memo && params.memo.trim()) {
    instructions.push(
      new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: Buffer.from(params.memo.trim(), "utf8"),
      })
    );
  }

  // Create recipient ATA if it doesn't exist (rent paid by feePayer when set, else sender)
  const ataPayer = feePayer ?? sender;
  const recipientAccountInfo = await rpcWithRetry(
    () => connection.getAccountInfo(recipientAta),
    "getAccountInfo(recipientAta)"
  );
  if (!recipientAccountInfo) {
    if (feePayer && params.sponsorNewRecipientAccounts === false) {
      throw new Error(
        "This wallet doesn't have a USDC account yet — it needs to receive USDC at least once before you can send to it this way."
      );
    }
    instructions.push(
      createAssociatedTokenAccountInstruction(
        ataPayer,
        recipientAta,
        recipient,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  instructions.push(
    createTransferInstruction(
      senderAta,
      recipientAta,
      sender,
      amountRaw,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  if (params.extraTransfer) {
    const extraAmountRaw = Math.round(params.extraTransfer.amountUSDC * 10 ** USDC_DECIMALS);
    if (extraAmountRaw > 0) {
      const extraRecipient = new PublicKey(params.extraTransfer.recipientAddress);
      const extraRecipientAta = getAssociatedTokenAddressSync(
        mint,
        extraRecipient,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const extraAccountInfo = await rpcWithRetry(
        () => connection.getAccountInfo(extraRecipientAta),
        "getAccountInfo(extraRecipientAta)"
      );
      if (!extraAccountInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            ataPayer,
            extraRecipientAta,
            extraRecipient,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
      instructions.push(
        createTransferInstruction(
          senderAta,
          extraRecipientAta,
          sender,
          extraAmountRaw,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }
  }

  // Use a real blockhash so RPC simulation succeeds; Privy still handles signing/broadcast.
  const { blockhash } = await rpcWithRetry(
    () => connection.getLatestBlockhash("confirmed"),
    "getLatestBlockhash"
  );
  const message = new TransactionMessage({
    payerKey: feePayer ?? sender,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return tx;
}

/**
 * Send USDC after signing. Returns signature.
 */
export async function sendSignedUSDCTransfer(
  signedTx: VersionedTransaction,
  connection?: Connection
): Promise<string> {
  const conn =
    connection || new Connection(getSolanaHttpRpc(), "confirmed");
  const sig = await rpcWithRetry(
    () =>
      conn.sendTransaction(signedTx, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      }),
    "sendTransaction"
  );
  return sig;
}
