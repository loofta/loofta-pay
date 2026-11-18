import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/trade/lib/balances";
import { WSOL } from "@/trade/lib/solana";
import type { CoinRef, JupToken } from "@/trade/lib/coin";
import { fromToken } from "@/trade/lib/coin";

const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

export type Holding = { coin: CoinRef; amount: number; usd: number | null };

export async function lookup(mint: string): Promise<JupToken | null> {
  try {
    const res = await fetch(`/api/backend/mini/tokens/search?q=${encodeURIComponent(mint)}`);
    const data = (await res.json()) as { tokens?: JupToken[] };
    return data.tokens?.find((t) => t.mint === mint) ?? null;
  } catch {
    return null;
  }
}

export async function getSolUsd(): Promise<number | null> {
  return (await lookup(WSOL))?.usd ?? null;
}

/** The user's non-empty classic SPL token balances, largest first, priced through the Jupiter search route. */
export async function getHoldings(owner: string, limit = 12): Promise<Holding[]> {
  const results = await Promise.all(TOKEN_PROGRAMS.map((p) => getConnection().getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: new PublicKey(p) })));
  const byMint = new Map<string, number>();
  for (const a of results.flatMap((r) => r.value)) {
    const info = a.account.data.parsed?.info;
    const amount = info?.tokenAmount?.uiAmount ?? 0;
    if (amount > 0 && info?.mint) byMint.set(info.mint, (byMint.get(info.mint) ?? 0) + amount);
  }
  const mints = [...byMint.keys()].slice(0, limit);
  const found = await Promise.all(mints.map(lookup));
  const out: Holding[] = [];
  mints.forEach((mint, i) => {
    const t = found[i];
    const amount = byMint.get(mint) ?? 0;
    // Skip tokens we cannot price or trade, they would be dead rows on the Home screen.
    if (!t) return;
    out.push({ coin: fromToken(t), amount, usd: t.usd != null ? t.usd * amount : null });
  });
  return out.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}
