"use client";

import { useCallback, useMemo } from "react";
import type { Wallet } from "@coral-xyz/anchor";
import { Connection, Transaction, VersionedTransaction, SendTransactionError } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { getRpcForMode, getRpcFallbackForMode } from "@/lib/solanaRpc";
import { buildPrivateWithdrawal, recordPrivateWithdrawalSignature, type PrivateTokenRef } from "@/services/api/privateBalance";
import { privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";

export type PerSelfTransferProgress =
  | { phase: "preparing" }
  | { phase: "awaiting_signature" }
  | { phase: "broadcasting" };

export type PerPrivateWithdrawalOptions = {
  privyUserId: string;
  accessToken?: string | null;
  amountUsdc: number;
  destinationAddress: string;
  /** Omit for USDC on Solana direct. Provide for any other destination token/chain (Near Intents bridge, server-side). */
  destinationToken?: PrivateTokenRef;
  onProgress?: (p: PerSelfTransferProgress) => void;
  onTxBuilt?: (data: {
    id: string;
    feeAmountUsdc: number;
    feeBreakdown?: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number };
  }) => void;
};

/**
 * Private Withdrawal — leg 1 only (user's Loofta wallet -> one-time burner). Leg 2 (burner ->
 * user-entered destination) is fully server-side, driven by the backend cron once this
 * signature is recorded — see PrivateBalanceProcessorService. Always the user's own already-
 * connected embedded wallet; no external wallet connect involved (unlike claim/send-payment
 * private transfers, the sender here is always the caller's own account).
 */
export function usePerPrivateSelfTransfer() {
  const networkMode = useAuthStore((s) => s.networkMode);
  const connection = useMemo(() => new Connection(getRpcForMode(networkMode), "confirmed"), [networkMode]);

  const withdraw = useCallback(
    async (wallet: Wallet, options: PerPrivateWithdrawalOptions): Promise<{ id: string; signature: string }> => {
      const { privyUserId, accessToken, amountUsdc, destinationAddress, destinationToken, onProgress, onTxBuilt } = options;
      if (!privyUserId?.trim()) {
        throw new Error("Log in to send a private withdrawal.");
      }

      onProgress?.({ phase: "preparing" });
      const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";
      const cluster = networkMode === "mainnet" ? "mainnet-beta" : "devnet";

      const txData = await buildPrivateWithdrawal(amountUsdc, destinationAddress, privyUserId, accessToken, apiCluster, destinationToken);
      if (txData.feeAmountUsdc != null) {
        onTxBuilt?.({ id: txData.id, feeAmountUsdc: txData.feeAmountUsdc, feeBreakdown: txData.feeBreakdown });
      }

      const rawTxBytes = Buffer.from(txData.transactionBase64, "base64");
      onProgress?.({ phase: "awaiting_signature" });

      let tx: Transaction | VersionedTransaction;
      try {
        tx = Transaction.from(rawTxBytes);
      } catch {
        tx = VersionedTransaction.deserialize(rawTxBytes);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [signedTx] = await wallet.signAllTransactions([tx] as any);

      onProgress?.({ phase: "broadcasting" });
      let signature: string;
      try {
        const serialized =
          signedTx instanceof Transaction
            ? signedTx.serialize()
            : (signedTx as VersionedTransaction).serialize();
        signature = await connection.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: "confirmed" });
      } catch (e) {
        if (e instanceof SendTransactionError) {
          try { const logs = await e.getLogs(connection); console.error("[PrivateSelfTransfer] broadcast failed:", logs); } catch { /* ignore */ }
          throw new Error(privatePayErrorMessageForUser(e.message, cluster));
        }
        if (e instanceof Error) throw new Error(privatePayErrorMessageForUser(e.message, cluster));
        throw e;
      }

      // Persist the signature immediately — the backend cron takes over leg 2 from here even
      // if the user closes the modal before confirmation.
      try {
        await recordPrivateWithdrawalSignature(txData.id, signature, privyUserId, accessToken);
      } catch (e) {
        console.warn("[PrivateSelfTransfer] failed to record signature (non-fatal, status poll will retry):", e);
      }

      const fallbackRpcUrl = getRpcFallbackForMode(networkMode);
      const fallbackConn = fallbackRpcUrl ? new Connection(fallbackRpcUrl, "confirmed") : undefined;
      await waitForSignatureConfirmation(connection, signature, 120_000, 1500, "privateSelfTransfer", fallbackConn);

      return { id: txData.id, signature };
    },
    [connection, networkMode],
  );

  return { withdraw };
}
