"use client";

import { useCallback, useMemo } from "react";
import type { Wallet } from "@coral-xyz/anchor";
import { Connection, Transaction, VersionedTransaction, SendTransactionError } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { getRpcForMode, getRpcFallbackForMode } from "@/lib/solanaRpc";
import { buildPrivateTokenWithdrawal, type PrivateTokenWithdrawalBuild } from "@/services/api/privateBalance";
import { privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";

export type PerPrivateTokenWithdrawalOptions = {
  privyUserId: string;
  accessToken?: string | null;
  /** SPL mint of the token being sent. */
  mint: string;
  /** Human-readable amount (not base units). */
  amount: string;
  destinationAddress: string;
  /** MagicBlock delivery split (1-15) and longest random delay in ms. Omit to keep the backend defaults. */
  split?: number;
  maxDelayMs?: number;
  /** Awaited before the signature is requested, so the caller can show the real fee and let the user back out. Throw to abort. */
  onTxBuilt?: (data: PrivateTokenWithdrawalBuild) => void | Promise<void>;
};

/**
 * Private send of any SPL token to any Solana address. Mainnet only. The backend builds the
 * MagicBlock private transfer (the recipient never appears in the browser), the user signs with
 * their own Loofta wallet and pays the network fee in SOL: MagicBlock only sponsors gas for
 * stablecoins. Delivery is relayed with a delay and split, same as the USDC private withdrawal.
 */
export function usePerPrivateTokenWithdrawal() {
  const networkMode = useAuthStore((s) => s.networkMode);
  const connection = useMemo(() => new Connection(getRpcForMode(networkMode), "confirmed"), [networkMode]);

  const send = useCallback(
    async (wallet: Wallet, options: PerPrivateTokenWithdrawalOptions): Promise<{ signature: string; build: PrivateTokenWithdrawalBuild }> => {
      const { privyUserId, accessToken, mint, amount, destinationAddress, split, maxDelayMs, onTxBuilt } = options;
      if (!privyUserId?.trim()) throw new Error("Log in to send privately.");
      if (networkMode !== "mainnet") throw new Error("Private token sends are available on mainnet only.");

      const build = await buildPrivateTokenWithdrawal({ mint, amount, destinationAddress, split, maxDelayMs }, privyUserId, accessToken);
      await onTxBuilt?.(build);

      const raw = Buffer.from(build.transactionBase64, "base64");
      let tx: Transaction | VersionedTransaction;
      try {
        tx = Transaction.from(raw);
      } catch {
        tx = VersionedTransaction.deserialize(raw);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [signedTx] = await wallet.signAllTransactions([tx] as any);

      let signature: string;
      try {
        const serialized = signedTx instanceof Transaction ? signedTx.serialize() : (signedTx as VersionedTransaction).serialize();
        signature = await connection.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: "confirmed" });
      } catch (e) {
        if (e instanceof SendTransactionError) {
          throw new Error(privatePayErrorMessageForUser(e.message, "mainnet-beta"));
        }
        if (e instanceof Error) throw new Error(privatePayErrorMessageForUser(e.message, "mainnet-beta"));
        throw e;
      }

      const fallbackRpcUrl = getRpcFallbackForMode(networkMode);
      const fallbackConn = fallbackRpcUrl ? new Connection(fallbackRpcUrl, "confirmed") : undefined;
      await waitForSignatureConfirmation(connection, signature, 120_000, 1500, "privateTokenWithdrawal", fallbackConn);
      return { signature, build };
    },
    [connection, networkMode],
  );

  return { send };
}
