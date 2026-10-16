"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";

/**
 * Fixed-path Telegram sign-in. Privy's dedicated Telegram login (the loginMethods modal button) is
 * disabled for this app ("Telegram Auth configuration is not loaded"), so Telegram goes through the
 * generic OAuth path (same as telegram-relay/page.tsx). That path needs a redirect URL registered in
 * the Privy dashboard with an exact match, which a dynamic claim URL (/c/:id) can never be, so every
 * Telegram sign-in starts here and returns to where it came from (sessionStorage "tg_login_return").
 */
const RETURN_KEY = "tg_login_return";

function goBack() {
  let target = "/";
  try {
    const saved = sessionStorage.getItem(RETURN_KEY);
    if (saved && saved.startsWith("/") && !saved.startsWith("//")) target = saved;
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // storage unavailable, fall back to home
  }
  window.location.replace(target);
}

export default function TelegramLoginPage() {
  const { ready, authenticated } = usePrivy();
  const startedRef = useRef(false);
  const { initOAuth } = useLoginWithOAuth({
    onError: (e) => console.error("[telegram-login] useLoginWithOAuth error:", e),
  });

  useEffect(() => {
    if (!ready) return;
    if (authenticated) {
      goBack();
      return;
    }
    // On the return trip from Telegram the URL carries Privy's own callback params; let the SDK
    // finish the login (authenticated flips true) instead of starting a second redirect.
    const returning = new URLSearchParams(window.location.search).has("privy_oauth_code");
    if (returning || startedRef.current) return;
    startedRef.current = true;
    void initOAuth({ provider: "telegram" });
  }, [ready, authenticated, initOAuth]);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] flex items-center justify-center px-4">
      <p className="text-slate-300 text-base">Connecting to Telegram…</p>
    </div>
  );
}
