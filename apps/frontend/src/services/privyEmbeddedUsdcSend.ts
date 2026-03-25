/**
 * Send USDC from Privy embedded Solana wallet: prefer Loofta backend fee payer, then Privy gas sponsorship, then user SOL.
 */

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { getPrivySolanaChain } from "@/lib/solanaCluster";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";
import {
  fetchSolanaFeePayerAddress,
  isPrivyGasSponsorNotConfiguredError,
  signAndBroadcastSponsoredTx,
} from "@/services/solanaSponsor";

type PrivySolanaChain = ReturnType<typeof getPrivySolanaChain>;

type SignTransactionFn = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  chain?: PrivySolanaChain;
}) => Promise<{ signedTransaction: Uint8Array }>;

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
  privyUserId: string | undefined;
  signTransaction: SignTransactionFn;
  signAndSendTransaction: SignAndSendTransactionFn;
  memo?: string | null;
}): Promise<string> {
  const {
    senderAddress,
    recipientAddress,
    amountUSDC,
    connection,
    wallet,
    privyUserId,
    signTransaction,
    signAndSendTransaction,
    memo,
  } = params;
  const chain = getPrivySolanaChain();

  const feePayerAddr = await fetchSolanaFeePayerAddress(privyUserId);
  if (feePayerAddr && privyUserId) {
    try {
      const unsignedTx = await buildUSDCTransferTransaction({
        senderAddress,
        recipientAddress: recipientAddress.trim(),
        amountUSDC,
        connection,
        memo: memo ?? undefined,
        feePayerAddress: feePayerAddr,
      });
      const { signedTransaction } = await signTransaction({
        transaction: new Uint8Array(unsignedTx.serialize()),
        wallet,
        chain,
      });
      return await signAndBroadcastSponsoredTx(signedTransaction, privyUserId);
    } catch (e) {
      console.warn("[privyEmbeddedUsdcSend] Loofta fee payer path failed, trying Privy sponsor", e);
    }
  }

  const unsignedTx = await buildUSDCTransferTransaction({
    senderAddress,
    recipientAddress: recipientAddress.trim(),
    amountUSDC,
    connection,
    memo: memo ?? undefined,
  });
  try {
    const { signature } = await signAndSendTransaction({
      transaction: unsignedTx.serialize(),
      wallet,
      chain,
      options: { sponsor: true } as never,
    });
    return bs58.encode(signature);
  } catch (e: unknown) {
    if (isPrivyGasSponsorNotConfiguredError(e)) {
      const selfPayTx = await buildUSDCTransferTransaction({
        senderAddress,
        recipientAddress: recipientAddress.trim(),
        amountUSDC,
        connection,
        memo: memo ?? undefined,
      });
      const { signature } = await signAndSendTransaction({
        transaction: selfPayTx.serialize(),
        wallet,
        chain,
        options: { sponsor: false, skipPreflight: true } as never,
      });
      return bs58.encode(signature);
    }
    throw e;
  }
}
