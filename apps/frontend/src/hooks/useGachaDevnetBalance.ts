"use client";

// Small, Gacha-scoped balance readout — deliberately NOT wired through the app's general
// devnet/mainnet toggle (store/auth.ts networkMode). That toggle is effectively retired (reset
// to mainnet on every login/rehydrate) and, even when set, reads a different devnet USDC mint
// (lib/solanaRpc.ts's DEVNET_USDC_MINT) than the one Gacha/Collector Crypt actually uses. This
// hook hits the backend's own /gacha/my-devnet-balance instead, which reads the correct mint.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export interface GachaDevnetBalance {
  address: string;
  usdcBalance: number;
}

/** `enabled` defaults to true for direct Gacha-page usage; the header (which renders on every
 *  page for every user) passes `enabled: false` unless the NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS flag
 *  is on, so this never fires a devnet RPC call for people who never opted into seeing it. */
export function useGachaDevnetBalance(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const { authenticated, getAccessToken } = usePrivy();
  const [balance, setBalance] = useState<GachaDevnetBalance | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!authenticated || !enabled) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/gacha/my-devnet-balance", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.ok) setBalance(await res.json());
    } finally {
      setLoading(false);
    }
  }, [authenticated, enabled, getAccessToken]);

  useEffect(() => { refresh(); }, [refresh]);

  return { balance, loading, refresh };
}
