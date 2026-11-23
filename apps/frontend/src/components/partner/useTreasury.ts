"use client";

import { useCallback, useEffect, useState } from "react";
import { useSignTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { getPrivySolanaChainForMode, getRpcForMode, getRpcFallbackForMode } from "@/lib/solanaRpc";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { post, usePartnerApi } from "./usePartnerApi";

export type TreasuryMember = {
  wallet: string;
  member_id: string | null;
  name: string | null;
  role: string | null;
  is_me: boolean;
  can_initiate: boolean;
  can_vote: boolean;
  can_execute: boolean;
};
export type TreasuryProposal = {
  id: string;
  kind: "payout" | "config";
  batch_id: string | null;
  chunk_index: number | null;
  transaction_index: number;
  status: "draft" | "active" | "approved" | "executed" | "rejected" | "cancelled" | "stale";
  summary: {
    label?: string | null;
    payouts?: number;
    total_usdc?: number;
    gas_usdc?: number;
    threshold_after?: number;
    actions?: Array<{ type: string; name: string | null; role: string; wallet: string }>;
  };
  created_at: string;
  approvals: string[];
  approvals_count: number;
  approvals_needed: number;
  i_approved: boolean;
  can_approve: boolean;
  can_execute: boolean;
};
export type TreasuryState =
  | { created: false; my_wallet: string | null; can_create: boolean; creation_fee_sol: number | null }
  | {
      created: true;
      multisig: string;
      vault: string;
      threshold: number;
      usdc: number;
      my_wallet: string | null;
      am_member: boolean;
      members: TreasuryMember[];
      proposals: TreasuryProposal[];
      addable: Array<{ member_id: string; name: string | null; role: string }>;
    };
export type UnsignedTx = { proposal_id: string; unsigned_transaction: string };

const TREASURY_CHANGED = "loofta:treasury-changed";

/** Call after anything that moves money in or out of the company wallet (a payout sent, a payout taken back). Every open wallet view refreshes. */
export function notifyTreasuryChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TREASURY_CHANGED));
}

/**
 * The partner's company wallet (a Squads multisig): its state, and the one way to act on it. Every
 * transaction is built by the server and signed here with the member's own Loofta wallet.
 */
export function useTreasury(orgId: string | null, enabled: boolean) {
  const call = usePartnerApi();
  const networkMode = useAuthStore((s) => s.networkMode);
  const mode = networkMode === "mainnet" ? "mainnet" : "devnet";
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const [state, setState] = useState<TreasuryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = orgId ? `partners/${encodeURIComponent(orgId)}/treasury` : null;

  const refresh = useCallback(async () => {
    if (!base || !enabled) return;
    try {
      setState(await call<TreasuryState>(base));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base, call, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Money moved somewhere else in the portal: refresh now, and again shortly after, because the chain and the funding job take a few seconds to settle.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onChanged = () => {
      void refresh();
      timers.push(setTimeout(() => void refresh(), 4000), setTimeout(() => void refresh(), 12000));
    };
    window.addEventListener(TREASURY_CHANGED, onChanged);
    return () => {
      window.removeEventListener(TREASURY_CHANGED, onChanged);
      timers.forEach(clearTimeout);
    };
  }, [refresh]);

  /** Signs a server-built transaction with this member's wallet, sends it and waits for it. */
  const signAndSend = useCallback(
    async (unsignedBase64: string): Promise<string> => {
      const mine = state && state.my_wallet ? wallets.find((w) => w.address === state.my_wallet) : null;
      if (!mine) throw new Error("Your Loofta wallet is not ready. Try signing out and in again.");
      const conn = new Connection(getRpcForMode(mode), "confirmed");
      const fallbackUrl = getRpcFallbackForMode(mode);
      const fallback = fallbackUrl ? new Connection(fallbackUrl, "confirmed") : undefined;
      const signed = await signTransaction({
        transaction: Buffer.from(unsignedBase64, "base64") as Uint8Array,
        wallet: mine,
        chain: getPrivySolanaChainForMode(mode),
        options: { uiOptions: { showWalletUIs: false } },
      } as never);
      const sig = await conn.sendRawTransaction((signed as { signedTransaction: Uint8Array }).signedTransaction, { maxRetries: 3 });
      await waitForSignatureConfirmation(conn, sig, 120_000, 1500, "partner-treasury", fallback);
      return sig;
    },
    [state, wallets, mode, signTransaction],
  );

  /** Build on the server, sign here, then tell the server it landed. */
  const act = useCallback(
    async (path: string, body?: unknown): Promise<UnsignedTx & { signature: string }> => {
      if (!base) throw new Error("No organization selected.");
      const built = await call<UnsignedTx>(`${base}/${path}`, post(body));
      const signature = await signAndSend(built.unsigned_transaction);
      await call(`${base}/proposals/${built.proposal_id}/confirm`, post({ signature }));
      return { ...built, signature };
    },
    [base, call, signAndSend],
  );

  return { state, error, refresh, act, signAndSend, base };
}

export type Treasury = ReturnType<typeof useTreasury>;
