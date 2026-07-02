/**
 * Send USDC from Privy embedded Solana wallet.
 *
 * Mainnet: attempts Privy gas sponsorship ({ sponsor: true }) after a per-user rate-limit check.
 * If sponsorship is paused in the Privy dashboard, falls back to backend fee payer automatically.
 *
 * Devnet: backend fee payer co-signs.
 */

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getPrivySolanaChain } from "@/lib/solanaCluster";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import {
  fetchSolanaFeePayerAddress,
  signAndBroadcastSponsoredTx,
  isPrivyGasSponsorNotConfiguredError,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any;
}) => Promise<{ signedTransaction: Uint8Array }>;

/**
 * Call the backend rate-limit gate before sponsoring.
 * Returns true if sponsoring is allowed, false if rate-limited.
 * Never throws — on any check failure we allow the send (fail-open so legitimate users aren't blocked).
 */
async function checkSponsorRateLimit(
  walletAddress: string,
  privyUserId: string,
  accessToken: string | null | undefined,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const res = await fetch("/api/payments/sponsor-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ walletAddress, userId: privyUserId }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as { reason?: string };
      return { allowed: false, reason: body.reason ?? "Rate limit exceeded. Please wait before sending again." };
    }
    return { allowed: true };
  } catch {
    // Fail-open: don't block legitimate users if the gate is unreachable.
    console.warn("[sponsorCheck] rate-limit check failed, proceeding anyway");
    return { allowed: true };
  }
}

/** Mainnet path — Privy gas sponsorship with rate-limit gate and backend-fee-payer fallback. */
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
  accessToken?: string | null;
}): Promise<string> {
  const { senderAddress, recipientAddress, amountUSDC, connection, wallet, memo, usdcMint, signAndSendTransaction } = params;
  const chain = params.chain ?? getPrivySolanaChain();

  // Rate-limit gate: enforce per-wallet and per-user daily caps before sponsoring.
  if (params.privyUserId) {
    const check = await checkSponsorRateLimit(senderAddress, params.privyUserId, params.accessToken);
    if (!check.allowed) {
      throw new Error(check.reason ?? "Sponsorship rate limit reached.");
    }
  }

  const unsignedTx = await buildUSDCTransferTransaction({
    senderAddress,
    recipientAddress: recipientAddress.trim(),
    amountUSDC,
    connection,
    memo: memo ?? undefined,
    usdcMint,
  });

  try {
    const { signature } = await signAndSendTransaction({
      transaction: unsignedTx.serialize(),
      wallet,
      chain,
      options: { sponsor: true } as never,
    });
    return bs58.encode(signature);
  } catch (err) {
    // Privy sponsorship paused/disabled in dashboard → fall back to backend fee payer transparently.
    if (isPrivyGasSponsorNotConfiguredError(err) && params.signTransaction && params.privyUserId) {
      console.warn("[sendUsdc] Privy sponsorship unavailable, falling back to backend fee payer");
      return sendUsdcWithBackendFeePayer({
        ...params,
        privyUserId: params.privyUserId,
        signTransaction: params.signTransaction as SignTransactionFn,
        network: "mainnet",
      });
    }
    throw err;
  }
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
