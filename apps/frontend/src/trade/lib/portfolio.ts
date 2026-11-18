"use client";

import { useCallback, useEffect, useState } from "react";
import { getSolBalance, getTokenBalance } from "@/trade/lib/balances";
import { getHoldings, lookup, type Holding } from "@/trade/lib/holdings";
import { fromToken } from "@/trade/lib/coin";
import { USDC, WSOL } from "@/trade/lib/solana";

/** Anything worth less than this is dust: it is not listed, and it can be cleared from Wallet. */
export const DUST_USD = 0.01;

export type Portfolio = { usdc: number; sol: number; solUsd: number | null; /** SOL plus every other coin worth showing, largest first. */ holdings: Holding[]; /** USD price per coin for every priced coin we found, including dust. */ prices: Record<string, number>; at: number };

const mem = new Map<string, Portfolio>();
const KEY = (a: string) => `loofta.portfolio.${a}`;

function readCache(address: string): Portfolio | null {
  const m = mem.get(address);
  if (m) return m;
  try {
    const raw = localStorage.getItem(KEY(address));
    return raw ? (JSON.parse(raw) as Portfolio) : null;
  } catch {
    return null;
  }
}

/** Everything in one pass: cash (USDC), SOL, and the other coins. All requests run together. */
export async function fetchPortfolio(address: string): Promise<Portfolio> {
  const [sol, usdc, others, solTok] = await Promise.all([
    getSolBalance(address).catch(() => 0),
    getTokenBalance(address, USDC).catch(() => 0),
    getHoldings(address).catch(() => [] as Holding[]),
    lookup(WSOL),
  ]);
  const solUsd = solTok?.usd ?? null;
  // Wrapped SOL is how Jupiter names the mint. People hold plain SOL, so it is shown as SOL, once, with any wrapped leftovers counted in.
  const wrapped = others.find((h) => h.coin.mint === WSOL)?.amount ?? 0;
  const rows: Holding[] = others.filter((h) => h.coin.mint !== USDC && h.coin.mint !== WSOL && (h.usd == null || h.usd >= DUST_USD));
  const solAll = sol + wrapped;
  if (solTok && solAll * (solUsd ?? 0) >= DUST_USD) rows.push({ coin: { ...fromToken(solTok), name: "Solana", symbol: "SOL" }, amount: solAll, usd: solUsd != null ? solUsd * solAll : null });
  rows.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const prices: Record<string, number> = {};
  for (const h of others) if (h.usd != null && h.amount > 0) prices[h.coin.mint] = h.usd / h.amount;
  const p = { usdc, sol, solUsd, holdings: rows, prices, at: Date.now() };
  mem.set(address, p);
  try {
    localStorage.setItem(KEY(address), JSON.stringify(p));
  } catch {
    /* storage can be blocked */
  }
  return p;
}

/** Shows the last known balance straight away, then refreshes it. Home and Wallet share the same numbers. */
export function usePortfolio(address: string | null, refreshMs = 20_000) {
  const [pf, setPf] = useState<Portfolio | null>(null);
  const load = useCallback(() => {
    if (!address) return Promise.resolve();
    return fetchPortfolio(address).then(setPf).catch(() => {});
  }, [address]);
  useEffect(() => {
    if (!address) return;
    const cached = readCache(address);
    if (cached) setPf(cached);
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [address, load, refreshMs]);
  const coinsUsd = pf ? pf.holdings.reduce((a, h) => a + (h.usd ?? 0), 0) : 0;
  const total = pf ? pf.usdc + coinsUsd : null;
  return { pf, total, coinsUsd, reload: load };
}
