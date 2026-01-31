/**
 * Send USDC (SPL token) from one Solana address to another.
 * Uses VersionedTransaction for Privy signing.
 */

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { USDC_MINT } from "./solanaBalance";

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (process.env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com");

const USDC_DECIMALS = 6;

/**
 * Build and return an unsigned VersionedTransaction for USDC transfer.
 * Caller must sign with signTransaction and then send.
 */
export async function buildUSDCTransferTransaction(params: {
  senderAddress: string;
  recipientAddress: string;
  amountUSDC: number;
  connection?: Connection;
}): Promise<VersionedTransaction> {
  const connection =
    params.connection || new Connection(SOLANA_RPC_URL, "confirmed");
  const mint = new PublicKey(USDC_MINT);
  const sender = new PublicKey(params.senderAddress);
  const recipient = new PublicKey(params.recipientAddress);

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

  const instructions = [];

  // Optional: create recipient ATA if it doesn't exist (check and add createAssociatedTokenAccountInstruction)
  const recipientAccountInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAccountInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        sender,
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

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: sender,
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
    connection || new Connection(SOLANA_RPC_URL, "confirmed");
  const sig = await conn.sendTransaction(signedTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  return sig;
}
