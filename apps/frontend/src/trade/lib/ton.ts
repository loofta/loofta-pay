"use client";

import { useEffect, useState } from "react";
import type { TonConnectUI } from "@tonconnect/ui";

/** One TON Connect instance for the whole app, created on first use in the browser. */
let instance: Promise<TonConnectUI> | null = null;

export function getTonConnect(): Promise<TonConnectUI> {
  if (!instance) {
    instance = import("@tonconnect/ui").then(({ TonConnectUI }) => {
      const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      return new TonConnectUI({
        manifestUrl: `${origin}/tonconnect-manifest.json`,
        // Where Telegram Wallet sends the user back to after approving, e.g. https://t.me/<bot>/<app>.
        actionsConfiguration: process.env.NEXT_PUBLIC_TELEGRAM_APP_URL ? { twaReturnUrl: process.env.NEXT_PUBLIC_TELEGRAM_APP_URL as `${string}://${string}` } : undefined,
      });
    });
  }
  return instance;
}

/** The connected TON wallet's raw address ("0:abc..."), or null. Also returns the instance once ready. */
export function useTonWallet(): { ui: TonConnectUI | null; rawAddress: string | null } {
  const [ui, setUi] = useState<TonConnectUI | null>(null);
  const [rawAddress, setRaw] = useState<string | null>(null);
  useEffect(() => {
    let off = () => {};
    let alive = true;
    void getTonConnect().then((u) => {
      if (!alive) return;
      setUi(u);
      setRaw(u.account?.address ?? null);
      off = u.onStatusChange((w) => setRaw(w?.account.address ?? null));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { ui, rawAddress };
}
