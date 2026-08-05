/**
 * Send USDC from Privy embedded Solana wallet.
 *
 * All paths (mainnet + devnet) route through the backend fee payer:
 *   1. User signs the transaction with their Privy embedded wallet (client-side, required)
 *   2. Our backend adds the fee payer signature and broadcasts
 *
 * This eliminates the { sponsor: true } client-side Privy gas sponsorship path.
 * Gas cost is negligible (~$0.001/tx from our fee payer SOL wallet) and fully
 * server-controlled — external callers cannot bypass our rate limiting.
 */

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Connection, PublicKey } from "@solana/web3.js";
import { getPrivySolanaChain } from "@/lib/solanaCluster";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import {
  fetchSolanaFeePayerAddress,
  signAndBroadcastSponsoredTx,
} from "@/services/solanaSponsor";

type PrivySolanaChain = ReturnType<typeof getPrivySolanaChain>;

type SignTransactionFn = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  chain?: PrivySolanaChain;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any;
}) => Promise<{ signedTransaction: Uint8Array }>;

/**
 * Mainnet USDC send via backend fee payer.
 * User signs with their Privy embedded wallet; our backend co-signs and broadcasts.
 * Kept as a named export so existing call sites don't need renaming.
 */
export async function sendUsdcWithPrivyEmbeddedWallet(params: {
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
  /** Legacy params — unused, kept for call-site compatibility */
  signAndSendTransaction?: unknown;
  skipLooftaFeePayer?: boolean;
}): Promise<string> {
  return sendUsdcWithBackendFeePayer({
    ...params,
    network: params.network ?? "mainnet",
  });
}

/**
 * Backend fee payer path — user signs, backend co-signs and broadcasts.
 * Works for both mainnet and devnet; pass network: "devnet" for test sends.
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
  /** Loofta's cut on this send (e.g. PAJ Cash Naira withdraw fee) — sent to the same backend
   * fee-payer wallet as a second transfer leg in the same transaction/signature. */
  looftaFeeUsdc?: number;
  /** When this send is paying into a specific existing claim/request (e.g. the claim page's
   *  "Pay with Loofta" button), pass its id so the backend can verify the recipient ATA it's
   *  about to sponsor matches that claim's own recipient on file, instead of trusting any
   *  destination the client supplies (see project memory: solana sponsor security hardening,
   *  Attack 6 / intent-binding fix). Omit for flows with no such backend-tracked intent yet
   *  (near-intents withdraw) — falls back to the per-user volume cap. */
  claimId?: string;
  /** Same idea as claimId, for a PAJ Cash offramp order (created server-side before this send —
   *  see PajCashOfframpView.tsx). */
  pajOrderId?: string;
  /** Same idea, for a Near Intents withdrawal order (created server-side before this send — see
   *  BalanceModal.tsx's handleWithdraw / prepareNearIntentsWithdrawal). */
  nearIntentsOrderId?: string;
  /** Same idea, for a "peer offramp" (ZKP2P/Base bridging) request — see BalanceModal.tsx's
   *  handlePeerSubmit, which already creates a real offramp_requests row via POST /api/offramp. */
  offrampRequestId?: string;
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
    looftaFeeUsdc,
    claimId,
    pajOrderId,
    nearIntentsOrderId,
    offrampRequestId,
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
    extraTransfer: looftaFeeUsdc && looftaFeeUsdc > 0
      ? { recipientAddress: feePayerAddress, amountUSDC: looftaFeeUsdc }
      : undefined,
  });

  // showWalletUIs: false — skip Privy's SOL-balance preflight.
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
    claimId,
    pajOrderId,
    nearIntentsOrderId,
    offrampRequestId,
  );
}
