"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";

const TERMINAL_PROMO_KEY = "loofta.terminalPromoShown";

/**
 * Nudges toward the AI terminal every time the Send tab is activated on the Send&Receive home
 * page — not just once ever — until the user explicitly closes it, which is remembered for the
 * rest of this session (not "forever") so it keeps coming back for anyone who hasn't dismissed
 * it, without re-nagging someone who already said "not now" by closing it. Reacts to
 * useAuthStore's homeActiveTab (set by app/app/page.tsx) rather than owning any tab state itself,
 * so it can render from AppShell's shared toast stack alongside the other nudge toasts.
 */
export function useTerminalPromoToast() {
  const { authenticated } = useAuth();
  const homeActiveTab = useAuthStore((s) => s.homeActiveTab);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(TERMINAL_PROMO_KEY)) {
      setDismissed(true);
    }
  }, []);

  const dismiss = () => {
    if (typeof window !== "undefined") sessionStorage.setItem(TERMINAL_PROMO_KEY, "1");
    setDismissed(true);
  };

  const showTerminalPromo = authenticated && homeActiveTab === "send" && !dismissed;

  return { showTerminalPromo, dismiss };
}
