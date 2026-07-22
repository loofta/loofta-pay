"use client";

import { useCallback, useMemo } from "react";
import type { Wallet } from "@coral-xyz/anchor";
import { Connection, Transaction, VersionedTransaction, SendTransactionError } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { getRpcForMode, getRpcFallbackForMode } from "@/lib/solanaRpc";
import { formatMagicblockPrivateDelayLogMs } from "@/services/magicblockPaymentsApi";
import { buildClaimPrivateTransfer } from "@/services/api/claims";
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
  claimId: string;
  onProgress?: (p: PerTransferProgress) => void;
  /** Informational (e.g. logging). */
  isBurnerRecipient?: boolean;
  /**
   * Called immediately after sendRawTransaction returns a signature, before confirmation polling.
   * Use this to persist the signature to the backend so it can be recovered if RPC polling fails.
   */
  onSignature?: (signature: string) => void | Promise<void>;
  /** Called after the tx is built — provides fee breakdown before user signs. */
  onTxBuilt?: (data: {
    feeAmountUsdc: number;
    feeBreakdown?: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number };
  }) => void;
  /**
   * Privy embedded wallet: sign only, caller broadcasts.
   * Used for the MagicBlock private transfer where the MB validator is already the fee payer.
   * Returns the base58 transaction signature string.
   */
  privySignAndSend?: (txBytes: Uint8Array) => Promise<string>;
  /** Default true. Pass false to retry without MB gas sponsorship (user pays SOL gas directly). */
  gasless?: boolean;
};

/**
 * Private SPL transfer: unsigned tx is built on the backend (MagicBlock `/v1/spl/transfer` is
 * server-side only) so the recipient wallet is never visible in the browser network tab.
 * MagicBlock gasless=true: their validator is the fee payer and pre-signs the tx server-side.
 * Flow: build → sign (Privy or wallet) → broadcast → confirm.
 */
export function usePerPrivateTransfer() {
  const networkMode = useAuthStore((s) => s.networkMode);
  const connection = useMemo(() => new Connection(getRpcForMode(networkMode), "confirmed"), [networkMode]);

  const transfer = useCallback(
    async (wallet: Wallet, options: PerPrivateTransferOptions): Promise<string> => {
      const { privyUserId, accessToken, claimId, onProgress, isBurnerRecipient, onSignature, onTxBuilt, privySignAndSend, gasless = true } = options;
      if (!privyUserId?.trim()) {
        throw new Error("Log in to send a private transfer.");
      }
      if (!claimId) {
        throw new Error("claimId is required for private transfer.");
      }

      onProgress?.({ phase: "preparing" });

      const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";
      const cluster = networkMode === "mainnet" ? "mainnet-beta" : "devnet";
      const sender = wallet.publicKey.toBase58();

      console.info(
        `[PrivatePay] ▶ start | cluster=${apiCluster} claim=${claimId} isBurner=${isBurnerRecipient ?? false} delayMs=${formatMagicblockPrivateDelayLogMs(apiCluster)}`,
      );

      // ─────────────────────────────────────────────────────────────────────────
      // MAIN: build and sign the MagicBlock private transfer
      // ─────────────────────────────────────────────────────────────────────────
      console.info(`[PrivatePay] building MB private transfer tx | cluster=${apiCluster} claim=${claimId}`);
      const txData = await buildClaimPrivateTransfer(claimId, privyUserId, sender, accessToken, apiCluster, gasless);

      if (txData.feeAmountUsdc != null) {
        onTxBuilt?.({ feeAmountUsdc: txData.feeAmountUsdc, feeBreakdown: txData.feeBreakdown });
      }

      const ephemeralRpc = getEphemeralRpcForMode(networkMode);
      const broadcastRpc = txData.sendTo === "ephemeral" ? ephemeralRpc : getRpcForMode(networkMode);
      const broadcastConn =
        txData.sendTo === "ephemeral"
          ? new Connection(ephemeralRpc, "confirmed")
          : connection;
      console.info(
        `[PrivatePay] MB tx built | sendTo=${txData.sendTo} rpc=${broadcastRpc} feeUsdc=${txData.feeAmountUsdc}`,
      );

      const rawTxBytes = Buffer.from(txData.transactionBase64, "base64");

      onProgress?.({ phase: "awaiting_signature", walletTransactionCount: 1 });
      onProgress?.({ phase: "broadcasting", step: "privateTransfer", index: 1, total: 1 });
      let signature: string;

      if (privySignAndSend) {
        // Privy path: MB validator is fee payer (pre-signed server-side).
        // Use sign-only so Privy doesn't run a gas-policy SOL-balance preflight check.
        // We broadcast directly after signing with our RPC.
        console.info(`[PrivatePay] Privy sign path | bytes=${rawTxBytes.length} version=${txData.version} sendTo=${txData.sendTo}`);
        signature = await privySignAndSend(rawTxBytes);
        console.info(`[PrivatePay] Privy sign complete | sig=${signature.slice(0, 12)}…`);
      } else {
        // Legacy path (Phantom, etc.): deserialize, sign, countersign if needed, broadcast.
        let tx: Transaction | VersionedTransaction;
        let txIsLegacy: boolean;
        try {
          tx = Transaction.from(rawTxBytes);
          txIsLegacy = true;
        } catch {
          tx = VersionedTransaction.deserialize(rawTxBytes);
          txIsLegacy = false;
        }
        console.info(`[PrivatePay] wallet sign | version=${txIsLegacy ? "legacy" : "v0"} feePayer=${(txIsLegacy ? (tx as Transaction).feePayer?.toBase58() : (tx as VersionedTransaction).message.staticAccountKeys[0]?.toBase58())?.slice(0, 8)}… sender=${sender.slice(0, 8)}…`);
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

        // MagicBlock gasless: MB validator is fee payer and has already pre-signed.
        // No countersign needed — just broadcast with user's signature.
        const feePayerAfterSign =
          signedTx instanceof Transaction
            ? signedTx.feePayer?.toBase58()
            : (signedTx as VersionedTransaction).message.staticAccountKeys[0]?.toBase58();
        console.info(`[PrivatePay] feePayer=${feePayerAfterSign?.slice(0, 8)}… broadcasting directly`);
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

      console.info(`[PrivatePay] MB tx broadcast | sig=${signature.slice(0, 12)}… — calling onSignature then polling confirmation`);
      try {
        await onSignature?.(signature);
      } catch (e) {
        console.warn("[PrivatePay] onSignature callback failed (non-fatal):", e);
      }

      // Ephemeral: fall back to the base RPC. Base layer: fall back to the secondary
      // RPC provider (Alchemy/Helius) in case the primary hasn't indexed the signature yet.
      const fallbackRpcUrl = txData.sendTo === "ephemeral" ? null : getRpcFallbackForMode(networkMode);
      const fallbackConn = txData.sendTo === "ephemeral"
        ? connection
        : (fallbackRpcUrl ? new Connection(fallbackRpcUrl, "confirmed") : undefined);
      await waitForSignatureConfirmation(broadcastConn, signature, 120_000, 1500, "privateTransfer", fallbackConn);
      const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=${apiCluster === "mainnet" ? "mainnet-beta" : "devnet"}`;
      console.info(`[PrivatePay] ✅ confirmed | sig=${signature} | ${explorerUrl}`);

      return signature;
    },
    [connection, networkMode],
  );

  return { transfer };
}
