"use client";

import { useEffect, useState } from "react";
import { TradeDesktop } from "@/trade/components/desktop/TradeDesktop";
import type { CoinRef } from "@/trade/lib/coin";
import { useWallet } from "@/trade/hooks/useWallet";
import { claimReferral, startInviteCode, tailPost } from "@/trade/lib/rewards";
import { fetchCall, startCallId } from "@/trade/lib/takes";

/**
 * The web trade page. The Loofta header already carries the balance, deposit and account, so this is only the market:
 * Trade's content, laid out for a wide screen. Home, Feed, Earn and Wallet live elsewhere on the site.
 */
export function AppShell() {
  const [open, setOpen] = useState<CoinRef | null>(null);
  const { userId, getAccessToken } = useWallet();

  // Opened from a friend's invite link: tell the backend once. It ignores repeats, your own link, and people who already traded.
  useEffect(() => {
    const code = startInviteCode();
    if (!code || !userId) return;
    try {
      if (localStorage.getItem("ref-claimed") === code) return;
    } catch {
      /* storage can be blocked, the backend still ignores repeats */
    }
    getAccessToken()
      .then((t) => claimReferral(code, t))
      .then(() => {
        try {
          localStorage.setItem("ref-claimed", code);
        } catch {
          /* not needed */
        }
      })
      .catch(() => undefined);
  }, [userId, getAccessToken]);

  // Opened from a shared call: show that coin straight away so it is one click to buy, and tail the caller so they earn their share.
  useEffect(() => {
    const id = startCallId();
    if (!id || !userId) return;
    try {
      if (sessionStorage.getItem("call-opened") === id) return;
      sessionStorage.setItem("call-opened", id);
    } catch {
      /* storage can be blocked, opening twice is harmless */
    }
    fetchCall(id)
      .then(async (c) => {
        setOpen({ mint: c.mint, symbol: c.symbol, name: c.coinName ?? c.symbol, icon: c.icon, decimals: 6, usd: null, mcap: null, change: c.change24h });
        // Tailing fails for your own call, an old one or a caller who sold. The coin is still open to buy.
        await tailPost(id, await getAccessToken()).catch(() => undefined);
      })
      .catch(() => undefined);
  }, [userId, getAccessToken]);

  return <TradeDesktop initialCoin={open} />;
}
