"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";

/**
 * Same-domain Telegram sign-in (no relay). Privy returns from OAuth to the exact URL that started
 * it, and its "Allowed OAuth redirect URLs" list only accepts exact URLs (no wildcards, no query
 * strings), so a dynamic page like /c/:id can never be the starting point. Every Telegram sign-in
 * starts at this fixed path instead, then returns to where it came from ("tg_login_return").
 * Register https://pay.loofta.com/telegram-login in the Privy dashboard.
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
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const { initOAuth } = useLoginWithOAuth({
    onError: (e) => {
      console.error("[telegram-login] useLoginWithOAuth error:", e);
      setError(String(e));
    },
  });

  useEffect(() => {
    if (!ready) return;
    if (authenticated) {
      goBack();
      return;
    }
    // On the return trip the URL carries Privy's own callback params; let the SDK finish the login
    // (authenticated flips true) instead of starting a second redirect.
    const returning = new URLSearchParams(window.location.search).has("privy_oauth_code");
    if (returning || startedRef.current) return;
    startedRef.current = true;
    initOAuth({ provider: "telegram" }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ready, authenticated, initOAuth]);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] flex flex-col items-center justify-center gap-4 px-4 text-center">
      {error ? (
        <>
          <p className="text-slate-100 text-base">Couldn&apos;t sign in with Telegram.</p>
          <p className="text-slate-400 text-base max-w-sm break-words">{error}</p>
          <button
            onClick={goBack}
            className="px-6 py-3 rounded-xl font-semibold text-white"
            style={{ background: "linear-gradient(to right, #FF1301, #EAB308)" }}
          >
            Go back
          </button>
        </>
      ) : (
        <p className="text-slate-300 text-base">Connecting to Telegram…</p>
      )}
    </div>
  );
}
