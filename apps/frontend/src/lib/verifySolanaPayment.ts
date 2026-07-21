import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getRpcForMode, getUsdcMintForMode } from "@/lib/solanaRpc";

/** A client-reported txHash for a payment must represent something that actually just happened. */
const MAX_TX_AGE_SECONDS = 30 * 60;

export interface VerifySolanaUsdcPaymentInput {
  txHash: string;
  /** Wallet the funds must have landed in (the claim's burner, or a direct recipient wallet). */
  destinationWallet: string;
  /** Minimum USD amount that must have been transferred (payments.amount). */
  minAmountUsd: number;
  /** Any of the caller's own linked Solana wallet addresses — the tx must be signed by one of them. */
  callerWalletAddresses: string[];
  isDevnet: boolean;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Confirms a client-reported Solana USDC transfer actually happened, on-chain, recently, signed
 * by the caller, and landed the expected amount at the expected destination — before anything
 * calling this trusts a "payment succeeded" status transition. Without this, PATCH /api/claims/
 * [id] (or any endpoint accepting a client-supplied txHash) would let any authenticated user
 * mark any payment request as paid by them by citing a fabricated or unrelated transaction hash.
 * Fails closed: any lookup/parsing problem returns invalid rather than benefit-of-the-doubt.
 */
export async function verifySolanaUsdcPayment(input: VerifySolanaUsdcPaymentInput): Promise<VerifyResult> {
  const { txHash, destinationWallet, minAmountUsd, callerWalletAddresses, isDevnet } = input;

  if (!txHash || typeof txHash !== "string" || txHash.length < 32) {
    return { valid: false, reason: "Missing or malformed transaction signature." };
  }

  let destinationPubkey: PublicKey;
  try {
    destinationPubkey = new PublicKey(destinationWallet);
  } catch {
    return { valid: false, reason: "This claim has no valid on-chain destination to verify against." };
  }

  const mode = isDevnet ? "devnet" : "mainnet";
  const connection = new Connection(getRpcForMode(mode), "confirmed");

  let tx;
  try {
    tx = await connection.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  } catch {
    return { valid: false, reason: "Could not look up this transaction." };
  }

  if (!tx) {
    return { valid: false, reason: "Transaction not found on-chain." };
  }
  if (tx.meta?.err) {
    return { valid: false, reason: "Transaction failed on-chain." };
  }
  if (typeof tx.blockTime !== "number") {
    return { valid: false, reason: "Transaction has no confirmed block time." };
  }
  const ageSeconds = Date.now() / 1000 - tx.blockTime;
  if (ageSeconds > MAX_TX_AGE_SECONDS || ageSeconds < -30) {
    return { valid: false, reason: "This transaction is too old to be accepted as fresh proof of payment." };
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const normalizedCallerWallets = new Set(callerWalletAddresses.map((w) => w.trim()));
  const callerIsSigner = accountKeys.some(
    (k) => k.signer && normalizedCallerWallets.has(k.pubkey.toBase58()),
  );
  if (!callerIsSigner) {
    return { valid: false, reason: "This transaction wasn't signed by your own wallet." };
  }

  const usdcMint = getUsdcMintForMode(mode);
  const destinationAta = await getAssociatedTokenAddress(usdcMint, destinationPubkey);
  const destinationAtaStr = destinationAta.toBase58();

  const pre = tx.meta?.preTokenBalances?.find((b) => b.owner === destinationPubkey.toBase58() || accountKeys[b.accountIndex]?.pubkey.toBase58() === destinationAtaStr);
  const post = tx.meta?.postTokenBalances?.find((b) => b.owner === destinationPubkey.toBase58() || accountKeys[b.accountIndex]?.pubkey.toBase58() === destinationAtaStr);

  const preAmount = pre?.uiTokenAmount?.uiAmount ?? 0;
  const postAmount = post?.uiTokenAmount?.uiAmount ?? 0;
  const delta = postAmount - preAmount;

  // Small epsilon for floating-point USDC amounts.
  if (delta < minAmountUsd - 0.000001) {
    return { valid: false, reason: "This transaction didn't transfer enough USDC to the expected destination." };
  }

  return { valid: true };
}
