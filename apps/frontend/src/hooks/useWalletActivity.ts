"use client";

import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { getRpcForMode } from "@/lib/solanaRpc";
import { getWalletTxTags, type WalletTxTag } from "@/lib/walletActivityTags";

const WSOL = "So11111111111111111111111111111111111111112";
const LIMIT = 25;
/** Fee and rent noise below this is ignored when deciding whether a SOL change is a real transfer. */
const SOL_DUST = 0.00002;
const SOL_NOISE_WHEN_TOKEN_MOVES = 0.01;

export type ActivityKind = "sent" | "received" | "swap" | "bridge";

export type ActivityItem = {
  signature: string;
  kind: ActivityKind;
  at: number | null;
  /** What left the wallet (sent, swap, bridge). */
  out?: { mint: string; amount: number };
  /** What arrived (received, swap). */
  into?: { mint: string; amount: number };
  counterparty?: string;
  private: boolean;
  label?: string;
};

export type ActivityToken = { symbol: string; icon: string | null };

type Move = { mint: string; delta: number };

function walletMoves(tx: ParsedTransactionWithMeta, me: string): { moves: Move[]; counterparty?: string } {
  const meta = tx.meta;
  if (!meta) return { moves: [] };
  const keys = tx.transaction.message.accountKeys;
  const meIdx = keys.findIndex((k) => k.pubkey.toBase58() === me);
  const byMint = new Map<string, number>();
  const add = (mint: string, d: number) => byMint.set(mint, (byMint.get(mint) ?? 0) + d);

  if (meIdx >= 0) {
    const feePaidByMe = keys[0].pubkey.toBase58() === me ? meta.fee : 0;
    add(WSOL, (meta.postBalances[meIdx] - meta.preBalances[meIdx] + feePaidByMe) / 1e9);
  }
  const tokenDelta = (list: typeof meta.preTokenBalances) =>
    (list ?? []).filter((b) => b.owner === me).map((b) => ({ mint: b.mint, ui: Number(b.uiTokenAmount.uiAmount ?? 0) }));
  const pre = new Map(tokenDelta(meta.preTokenBalances).map((b) => [b.mint, b.ui]));
  const post = new Map(tokenDelta(meta.postTokenBalances).map((b) => [b.mint, b.ui]));
  for (const mint of new Set([...pre.keys(), ...post.keys()])) add(mint, (post.get(mint) ?? 0) - (pre.get(mint) ?? 0));

  let moves: Move[] = [...byMint.entries()].map(([mint, delta]) => ({ mint, delta })).filter((m) => Math.abs(m.delta) > (m.mint === WSOL ? SOL_DUST : 0));
  const hasPositive = moves.some((m) => m.delta > 0);
  const tokenMoved = moves.some((m) => m.mint !== WSOL);
  // Rent and fees ride along on token sends; they are not part of what the user sent.
  if (!hasPositive && tokenMoved) moves = moves.filter((m) => m.mint !== WSOL || Math.abs(m.delta) >= SOL_NOISE_WHEN_TOKEN_MOVES);

  // Counterparty: whoever moved the same asset the other way.
  let counterparty: string | undefined;
  const main = [...moves].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (main) {
    if (main.mint === WSOL) {
      let best = 0;
      keys.forEach((k, i) => {
        if (i === meIdx || !k.writable) return;
        const d = (meta.postBalances[i] - meta.preBalances[i]) / 1e9;
        if (Math.sign(d) === -Math.sign(main.delta) && Math.abs(d) > best) {
          best = Math.abs(d);
          counterparty = k.pubkey.toBase58();
        }
      });
    } else {
      const other = [...(meta.postTokenBalances ?? [])].find((b) => b.mint === main.mint && b.owner && b.owner !== me);
      counterparty = other?.owner;
    }
  }
  return { moves, counterparty };
}

function classify(sig: string, tx: ParsedTransactionWithMeta, me: string, tags: Record<string, WalletTxTag>): ActivityItem | null {
  if (!tx.meta || tx.meta.err) return null;
  const tag = tags[sig];
  const { moves, counterparty } = walletMoves(tx, me);
  if (moves.length === 0) return null;
  const outs = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta);
  const ins = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta);
  const base = { signature: sig, at: tx.blockTime ?? null, private: !!tag?.private };
  if (outs.length && ins.length) {
    return { ...base, kind: tag?.kind === "bridge" ? "bridge" : "swap", out: { mint: outs[0].mint, amount: -outs[0].delta }, into: { mint: ins[0].mint, amount: ins[0].delta }, label: tag?.label };
  }
  if (outs.length) {
    return { ...base, kind: tag?.kind === "bridge" ? "bridge" : "sent", out: { mint: outs[0].mint, amount: -outs[0].delta }, counterparty: tag?.to ?? counterparty, label: tag?.label };
  }
  return { ...base, kind: "received", into: { mint: ins[0].mint, amount: ins[0].delta }, counterparty, label: tag?.label };
}

/** The wallet's own on-chain activity: sends, receives and swaps, newest first. */
export function useWalletActivity(enabled: boolean) {
  const { user, authenticated } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const address = deriveSolanaEmbeddedAddress(user ?? null);

  return useQuery({
    queryKey: ["walletActivity", address, networkMode],
    enabled: enabled && authenticated === true && !!address,
    staleTime: 20_000,
    queryFn: async () => {
      const conn = new Connection(getRpcForMode(networkMode), "confirmed");
      const sigs = await conn.getSignaturesForAddress(new PublicKey(address as string), { limit: LIMIT });
      const ok = sigs.filter((s) => !s.err);
      const txs = await Promise.all(ok.map((s) => conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null)));
      const tags = getWalletTxTags();
      const items: ActivityItem[] = [];
      txs.forEach((tx, i) => {
        if (!tx) return;
        const item = classify(ok[i].signature, tx, address as string, tags);
        if (item) items.push(item);
      });
      const mints = [...new Set(items.flatMap((it) => [it.out?.mint, it.into?.mint]).filter((m): m is string => !!m))].slice(0, 50);
      const tokens: Record<string, ActivityToken> = {};
      if (mints.length) {
        try {
          const r = await fetch(`/api/tokens/jupiter?mints=${mints.join(",")}`);
          const json = (await r.json()) as { tokens?: Array<{ mint: string; symbol: string | null; icon: string | null }> };
          for (const t of json.tokens ?? []) tokens[t.mint] = { symbol: t.symbol ?? `${t.mint.slice(0, 4)}...`, icon: t.icon };
        } catch { /* symbols fall back to short mints */ }
      }
      return { items, tokens };
    },
  });
}
