/**
 * Send USDC from Privy embedded Solana wallet using Privy gas sponsorship.
 */

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getPrivySolanaChain } from "@/lib/solanaCluster";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";

type PrivySolanaChain = ReturnType<typeof getPrivySolanaChain>;

type SignAndSendTransactionFn = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  chain?: PrivySolanaChain;
  options?: { sponsor?: boolean; skipPreflight?: boolean };
}) => Promise<{ signature: Uint8Array }>;

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
