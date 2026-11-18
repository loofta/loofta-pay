"use client";

import { useEffect, useState } from "react";

export interface LiveTrade {
  id: string;
  side: "buy" | "sell";
  usd: number;
  amount: number;
  price: number;
  wallet: string;
  /** Milliseconds since epoch. */
  time: number;
}

/** Recent buys and sells for one coin, refreshed every second while the page is open and visible. */
export function useLiveTrades(mint: string): LiveTrade[] {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch(`/api/backend/mini/trades?mint=${mint}`);
        const j = (await r.json()) as { trades?: LiveTrade[] };
        if (alive && j.trades) setTrades(j.trades);
      } catch {
        /* keep the last list */
      } finally {
        busy = false;
      }
    };
    void load();
    const t = setInterval(load, 1_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint]);
  return trades;
}
