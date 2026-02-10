"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import {
  fetchPrivatePayInfo,
  buildPrivatePayTx,
  submitPrivatePay,
} from "@/services/privatePayments";

export interface UsePrivateSolanaPaymentOptions {
  enabled?: boolean;
}

/**
 * Private USDC payment for a claim: get pay info from backend, build tx (backend),
 * sign with session key, backend adds platform sig and submits to PER.
 */
export function usePrivateSolanaPayment(options: UsePrivateSolanaPaymentOptions = {}) {
  const { enabled = true } = options;
  const { getAccessToken, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makePrivatePayment = async (params: {
    claimId: string;
    amountUSD: number;
    /** Solana wallet address of the payer (e.g. embedded wallet). */
    payerAddress: string;
  }): Promise<string> => {
    if (!authenticated || !getAccessToken) {
      throw new Error("Please log in to use private payments.");
    }
    const token = await getAccessToken();
    if (!token) throw new Error("Not authenticated");

    setIsLoading(true);
    setError(null);
    try {
      const { recipientDepositPda, amount, tokenMint, claimId } =
        await fetchPrivatePayInfo(params.claimId, token);

      const amountLamports = Math.round(
        Number(amount) * 1e6
      ).toString();
      const sessionKeypair = Keypair.generate();

      const { serializedMessageBase64 } = await buildPrivatePayTx({
        claimId: params.claimId,
        payerPublicKey: params.payerAddress,
        sessionPublicKey: sessionKeypair.publicKey.toBase58(),
        amountLamports,
        accessToken: token,
      });

      const txBuf = Buffer.from(serializedMessageBase64, "base64");
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([sessionKeypair]);

      const signedB64 = Buffer.from(tx.serialize()).toString("base64");
      const { signature } = await submitPrivatePay({
        claimId: params.claimId,
        signedTxBase64: signedB64,
        accessToken: token,
      });

      return signature;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Private payment failed";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    makePrivatePayment,
    isLoading,
    error,
    isReady: enabled && authenticated && !!getAccessToken,
  };
}
