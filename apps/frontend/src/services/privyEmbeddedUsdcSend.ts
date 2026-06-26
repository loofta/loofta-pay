/**
 * Send USDC from Privy embedded Solana wallet.
 *
 * Mainnet: Privy handles gas sponsorship (signAndSendTransaction with sponsor: true).
 *
 * Devnet: backend fee payer co-signs.
 *   - Same keypair as mainnet, just needs devnet SOL (airdrop to fee payer address once).
 *   - signTransaction with { uiOptions: { showWalletUIs: false } } skips Privy's preflight
 *     SOL-balance check (fee payer is the backend, not the user's wallet).
 *   - sign-and-broadcast receives network: "devnet" so the backend uses the devnet RPC.
 *   - skipPreflight: true on the backend means no simulation — tx is accepted/rejected on-chain.
 */

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getPrivySolanaChain } from "@/lib/solanaCluster";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import {
  fetchSolanaFeePayerAddress,
  signAndBroadcastSponsoredTx,
} from "@/services/solanaSponsor";

type PrivySolanaChain = ReturnType<typeof getPrivySolanaChain>;

type SignAndSendTransactionFn = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  chain?: PrivySolanaChain;
  options?: { sponsor?: boolean; skipPreflight?: boolean };
}) => Promise<{ signature: Uint8Array }>;

type SignTransactionFn = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  chain?: PrivySolanaChain;
  options?: unknown;
}) => Promise<{ signedTransaction: Uint8Array }>;

/** Mainnet path — Privy handles gas sponsorship. */
export async function sendUsdcWithPrivyEmbeddedWallet(params: {
  senderAddress: string;
  recipientAddress: string;
  amountUSDC: number;
  connection: Connection;
  wallet: ConnectedStandardSolanaWallet;
  privyUserId?: string;
  signAndSendTransaction: SignAndSendTransactionFn;
  memo?: string | null;
  usdcMint?: PublicKey;
  chain?: PrivySolanaChain;
  /** Unused — kept for call-site compatibility. */
  skipLooftaFeePayer?: boolean;
  signTransaction?: unknown;
}): Promise<string> {
  const { senderAddress, recipientAddress, amountUSDC, connection, wallet, memo, usdcMint, signAndSendTransaction } = params;
  const chain = params.chain ?? getPrivySolanaChain();

  const unsignedTx = await buildUSDCTransferTransaction({
    senderAddress,
    recipientAddress: recipientAddress.trim(),
    amountUSDC,
    connection,
    memo: memo ?? undefined,
    usdcMint,
  });

  const { signature } = await signAndSendTransaction({
    transaction: unsignedTx.serialize(),
    wallet,
    chain,
    options: { sponsor: true } as never,
  });
  return bs58.encode(signature);
}

/**
 * Devnet path — backend fee payer co-signs so the user's embedded wallet pays no SOL.
 *
 * Requires the fee payer to have devnet SOL. Airdrop once to the fee payer address:
 *   solana airdrop 1 <FEE_PAYER_ADDRESS> --url devnet
 *
 * showWalletUIs: false skips Privy's SOL-balance preflight (fee payer is the backend).
 * network: "devnet" tells the backend's sign-and-broadcast to use the devnet RPC.
 */
export async function sendUsdcWithBackendFeePayer(params: {
  senderAddress: string;
  recipientAddress: string;
  amountUSDC: number;
  connection: Connection;
  wallet: ConnectedStandardSolanaWallet;
  privyUserId: string;
  signTransaction: SignTransactionFn;
  memo?: string | null;
  usdcMint?: PublicKey;
  chain?: PrivySolanaChain;
  accessToken?: string | null;
  network?: "mainnet" | "devnet";
}): Promise<string> {
  const {
    senderAddress,
    recipientAddress,
    amountUSDC,
    connection,
    wallet,
    privyUserId,
    memo,
    usdcMint,
    signTransaction,
    accessToken,
    network,
  } = params;
  const chain = params.chain ?? getPrivySolanaChain();

  const feePayerAddress = await fetchSolanaFeePayerAddress(privyUserId, accessToken);
  if (!feePayerAddress) throw new Error("Backend fee payer not available — contact support.");

  const unsignedTx = await buildUSDCTransferTransaction({
    senderAddress,
    recipientAddress: recipientAddress.trim(),
    amountUSDC,
    connection,
    memo: memo ?? undefined,
    usdcMint,
    feePayerAddress,
  });

  // showWalletUIs: false — skip Privy's preflight SOL-balance check.
  // The fee payer is the backend, not the user's wallet.
  const { signedTransaction } = await signTransaction({
    transaction: unsignedTx.serialize(),
    wallet,
    chain,
    options: { uiOptions: { showWalletUIs: false } },
  });

  return signAndBroadcastSponsoredTx(
    signedTransaction,
    privyUserId,
    "withdrawal",
    accessToken,
    network,
  );
}
