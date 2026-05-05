"use client";

import { useCallback, useMemo } from "react";
import type { Wallet } from "@coral-xyz/anchor";
import { Connection, Transaction, VersionedTransaction, SendTransactionError } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { getRpcForMode } from "@/lib/solanaRpc";
import { formatMagicblockPrivateDelayLogMs } from "@/services/magicblockPaymentsApi";
import { buildClaimPrivateTransfer, countersignAndBroadcastPER } from "@/services/api/claims";
import { buildSendPaymentPrivateTransfer } from "@/services/api/sendPayment";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import { privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";

/** UI progress for wallet popups and broadcasting steps. */
export type PerTransferProgress =
  | { phase: "preparing" }
  | { phase: "awaiting_signature"; walletTransactionCount: number }
  | { phase: "broadcasting"; step: string; index: number; total: number };

export type PerPrivateTransferOptions = {
  /** Required — backend authorizes the payer and loads recipient from DB. */
  privyUserId: string;
  /** Privy access token — preferred over privyUserId for backend auth. */
  accessToken?: string | null;
  /** Pay a Loofta claim (`/c/[id]`). Recipient is never sent from the browser. */
  claimId?: string;
  /** Pay a send-payment link (`/send`). Recipient is never sent from the browser. */
  sendPaymentId?: string;
  onProgress?: (p: PerTransferProgress) => void;
  /** Informational (e.g. logging). */
  isBurnerRecipient?: boolean;
  /**
   * Called immediately after sendRawTransaction returns a signature, before confirmation polling.
   * Use this to persist the signature to the backend so it can be recovered if RPC polling fails.
   */
  onSignature?: (signature: string) => void | Promise<void>;
};

/**
 * Private SPL transfer: unsigned tx is built on the **backend** (MagicBlock `/v1/spl/transfer` is server-side only)
 * so the recipient wallet is not visible in the browser network tab.
 *
 * Delivery delay is configured on the server (devnet: 30s–15m; mainnet: none). Claim sweep: burner → recipient uses direct SPL on the backend.
 */
export function usePerPrivateTransfer() {
  const networkMode = useAuthStore((s) => s.networkMode);
  const connection = useMemo(() => new Connection(getRpcForMode(networkMode), "confirmed"), [networkMode]);

  const transfer = useCallback(
    async (wallet: Wallet, options: PerPrivateTransferOptions): Promise<string> => {
      const { privyUserId, accessToken, claimId, sendPaymentId, onProgress, isBurnerRecipient, onSignature } = options;
      if (!privyUserId?.trim()) {
        throw new Error("Log in to send a private transfer.");
      }
      if (!claimId && !sendPaymentId) {
        throw new Error("claimId or sendPaymentId is required for private transfer.");
      }
      if (claimId && sendPaymentId) {
        throw new Error("Pass only one of claimId or sendPaymentId.");
      }

      onProgress?.({ phase: "preparing" });

      const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";
      const cluster = networkMode === "mainnet" ? "mainnet-beta" : "devnet";
      const sender = wallet.publicKey.toBase58();

      console.info(
        `[PrivatePay] ▶ server-built tx | cluster=${apiCluster} claim=${claimId ?? "—"} send=${sendPaymentId ?? "—"} isBurner=${isBurnerRecipient ?? false} delayMs=${formatMagicblockPrivateDelayLogMs(apiCluster)}`,
      );

      const txData = claimId
        ? await buildClaimPrivateTransfer(claimId, privyUserId, sender, accessToken, apiCluster)
        : await buildSendPaymentPrivateTransfer(sendPaymentId!, privyUserId, sender, accessToken, apiCluster);

      const ephemeralRpc = getEphemeralRpcForMode(networkMode);
      const broadcastRpc = txData.sendTo === "ephemeral" ? ephemeralRpc : getRpcForMode(networkMode);
      const broadcastConn =
        txData.sendTo === "ephemeral"
          ? new Connection(ephemeralRpc, "confirmed")
          : connection;
      console.info(
        `[PrivatePay] tx built | kind=${txData.kind} sendTo=${txData.sendTo} rpc=${broadcastRpc} ix=${txData.instructionCount} signers=${txData.requiredSigners.join(",")}`,
      );

      const txBytes = Buffer.from(txData.transactionBase64, "base64");

      // MagicBlock may return a v0 versioned tx; backend converts to legacy when applying fee
      // sponsorship, but fall back to VersionedTransaction if it comes through as v0.
      let tx: Transaction | VersionedTransaction;
      let txIsLegacy: boolean;
      try {
        tx = Transaction.from(txBytes);
        txIsLegacy = true;
      } catch {
        tx = VersionedTransaction.deserialize(txBytes);
        txIsLegacy = false;
        console.warn("[PrivatePay] tx is versioned (v0) — fee sponsor may not be applied");
      }

      // Log fee sponsor state: fee payer + which signers already have a signature (sponsor partial-signs on devnet)
      let feePayerPk: string;
      let alreadySigned: string[];
      let stillNeeded: string[];
      if (txIsLegacy) {
        const legacyTx = tx as Transaction;
        feePayerPk = legacyTx.feePayer?.toBase58() ?? "none";
        const sigStates = legacyTx.signatures.map((s) => ({
          signer: s.publicKey.toBase58().slice(0, 8) + "…",
          signed: s.signature !== null,
        }));
        alreadySigned = sigStates.filter((s) => s.signed).map((s) => s.signer);
        stillNeeded = sigStates.filter((s) => !s.signed).map((s) => s.signer);
      } else {
        const vTx = tx as VersionedTransaction;
        // Signers are always in staticAccountKeys (never in ALTs) — safe to read without resolving LUTs
        const staticKeys = vTx.message.staticAccountKeys;
        feePayerPk = staticKeys[0]?.toBase58() ?? "none";
        const sigStates = vTx.signatures.map((sig, i) => ({
          signer: (staticKeys[i]?.toBase58().slice(0, 8) ?? `acct${i}`) + "…",
          signed: sig.some((b) => b !== 0),
        }));
        alreadySigned = sigStates.filter((s) => s.signed).map((s) => s.signer);
        stillNeeded = sigStates.filter((s) => !s.signed).map((s) => s.signer);
      }
      console.info(
        `[PrivatePay] tx deserialized | version=${txIsLegacy ? "legacy" : "v0"} feePayer=${feePayerPk.slice(0, 8)}… walletPubkey=${sender.slice(0, 8)}… ` +
          `alreadySigned=[${alreadySigned.join(", ") || "none"}] stillNeeded=[${stillNeeded.join(", ") || "none"}]`,
      );

      onProgress?.({ phase: "awaiting_signature", walletTransactionCount: 1 });
      onProgress?.({ phase: "broadcasting", step: "privateTransfer", index: 1, total: 1 });
      let signature: string;

      {
        // Fee payer is injected by the backend (both mainnet and devnet).
        // User signs first, then the backend countersigns and broadcasts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [signedTx] = await wallet.signAllTransactions([tx] as any);

        let missingAfterSign: string[];
        if (signedTx instanceof Transaction) {
          missingAfterSign = signedTx.signatures.filter((s) => !s.signature).map((s) => s.publicKey.toBase58().slice(0, 8) + "…");
        } else {
          const vSigned = signedTx as VersionedTransaction;
          const staticKeys = vSigned.message.staticAccountKeys;
          missingAfterSign = vSigned.signatures
            .map((sig, i) => ({ signer: (staticKeys[i]?.toBase58().slice(0, 8) ?? `acct${i}`) + "…", signed: sig.some((b) => b !== 0) }))
            .filter((s) => !s.signed).map((s) => s.signer);
        }
        console.info(`[PrivatePay] user signed | allSigned=${missingAfterSign.length === 0} missing=[${missingAfterSign.join(", ") || "none"}]`);

        const feePayerAfterSign =
          signedTx instanceof Transaction
            ? signedTx.feePayer?.toBase58()
            : (signedTx as VersionedTransaction).message.staticAccountKeys[0]?.toBase58();
        const needsCountersign = feePayerAfterSign && feePayerAfterSign !== sender;

        if (needsCountersign) {
          const serialized =
            signedTx instanceof Transaction
              ? signedTx.serialize({ requireAllSignatures: false, verifySignatures: false })
              : (signedTx as VersionedTransaction).serialize();
          console.info(`[PrivatePay] sending to backend for fee payer countersign | feePayer=${feePayerAfterSign?.slice(0, 8)}…`);
          const result = await countersignAndBroadcastPER(Buffer.from(serialized).toString("base64"), privyUserId, accessToken, apiCluster);
          signature = result.signature;
        } else {
          try {
            const serialized =
              signedTx instanceof Transaction
                ? signedTx.serialize()
                : (signedTx as VersionedTransaction).serialize();
            signature = await broadcastConn.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: "confirmed" });
          } catch (e) {
            if (e instanceof SendTransactionError) {
              try { const logs = await e.getLogs(broadcastConn); console.error("[PrivatePay] broadcast failed:", logs); } catch { /* ignore */ }
              throw new Error(privatePayErrorMessageForUser(e.message, cluster));
            }
            if (e instanceof Error) throw new Error(privatePayErrorMessageForUser(e.message, cluster));
            throw e;
          }
        }
      }

      // Persist the signature immediately — before confirmation polling — so the backend
      // can recover the payment if RPC polling times out or fails.
      try {
        await onSignature?.(signature);
      } catch (e) {
        console.warn("[PrivatePay] onSignature callback failed (non-fatal):", e);
      }

      // For ephemeral (MagicBlock PER) transactions, the tx settles on the base Solana chain.
      // Poll the base connection as fallback in case the ephemeral RPC doesn't index statuses.
      const fallbackConn = txData.sendTo === "ephemeral" ? connection : undefined;
      await waitForSignatureConfirmation(broadcastConn, signature, 120_000, 1500, "privateTransfer", fallbackConn);
      const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=${apiCluster === "mainnet" ? "mainnet-beta" : "devnet"}`;
      console.info(`[PrivatePay] ✅ Confirmed | sig=${signature} | ${explorerUrl}`);

      return signature;
    },
    [connection, networkMode],
  );

  return { transfer };
}
