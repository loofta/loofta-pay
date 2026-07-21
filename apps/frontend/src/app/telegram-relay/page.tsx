"use client";

import { useEffect, useRef, useState } from "react";
import type { TelegramAuthPayload } from "@/lib/telegramAuth";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "looftapay_bot";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

/**
 * Hosted on loofta.com (not pay.loofta.xyz) because Telegram's Login Widget doesn't work on
 * .xyz domains. Uses Telegram's own native Login Widget script directly — no Privy involved.
 * Privy's Telegram integration (both the generic login({loginMethods:["telegram"]}) call and the
 * dedicated useLoginWithTelegram hook) route into the same server-side check gated on the app's
 * `telegram_auth` config flag, which stayed false in Privy's dashboard despite Telegram OAuth
 * being fully configured there — a dependency outside this codebase's control. Telegram's widget
 * needs nothing from Privy: it signs its own payload with our bot's token, which we verify
 * ourselves (see lib/telegramAuth.ts) — the same trust anchor Privy would have used internally.
 *
 * Two modes, mutually exclusive:
 *  - `token`: connect Telegram to an ALREADY signed-in Loofta account. The token (minted by
 *    /api/users/telegram-relay-token) identifies which account. See /api/telegram-relay/complete.
 *  - `claimId`: pre-auth "is this payment for me?" check for a visitor with NO Loofta account
 *    yet — proves handle ownership against a specific claim's pending recipient without needing
 *    an account to attach it to. See /api/telegram-relay/verify-claim; the claim page redeems the
 *    resulting claim-scoped verification via /api/telegram-relay/attach-verified once the visitor
 *    has signed in to a real account.
 */
export default function TelegramRelayPage() {
  const [token, setToken] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "done" | "mismatch" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
    setClaimId(params.get("claimId"));
  }, []);

  const hasIdentifier = !!token || !!claimId;

  const handleTelegramAuth = (user: TelegramAuthPayload) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setStatus("connecting");
    const endpoint = token ? "/api/telegram-relay/complete" : "/api/telegram-relay/verify-claim";
    const body = token ? { token, telegramAuth: user } : { claimId, telegramAuth: user };
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) {
          setStatus("done");
          // This tab is normally opened via window.open() from the claim page, which polls
          // popup.closed to know linking/verifying finished — close() is the actual completion
          // signal. If it wasn't opened via script (e.g. visited this link directly), close() is
          // a silent no-op and the fallback redirect below covers that case instead.
          window.close();
          setTimeout(() => {
            const base = process.env.NEXT_PUBLIC_APP_URL || "https://pay.loofta.xyz";
            window.location.href = `${base}/app?connected=telegram`;
          }, 800);
        } else if (!token && data?.error) {
          // verify-claim's "wrong account" case — a real, informative mismatch, not a fetch/server error.
          setStatus("mismatch");
          setErrorMessage(data.error);
        } else {
          setStatus("error");
          setErrorMessage(data?.error || null);
        }
      })
      .catch(() => setStatus("error"));
  };

  // Telegram's widget calls a global function named in data-onauth — wire it up before the
  // widget script can possibly invoke it.
  useEffect(() => {
    window.onTelegramAuth = handleTelegramAuth;
    return () => {
      delete window.onTelegramAuth;
    };
  });

  // Telegram's widget self-renders (injects its own button/iframe) using the data attributes on
  // its own <script> tag — it's not a "load script, then call an API" pattern, so the tag itself
  // has to carry the config. Injected imperatively (not via next/script) since it needs to land
  // inside this specific container div once, not be managed as a page-level script.
  useEffect(() => {
    if (!hasIdentifier || !widgetContainerRef.current) return;
    const container = widgetContainerRef.current;
    container.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);
  }, [hasIdentifier]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0b0d12] text-white px-6 text-center">
      <h1 className="text-lg font-semibold">Connect Telegram to Loofta</h1>
      {!hasIdentifier && (
        <p className="text-sm text-slate-400 max-w-sm">
          This link is missing or expired. Go back to Loofta and click &quot;Connect Telegram&quot; again.
        </p>
      )}
      {hasIdentifier && status === "error" && (
        <p className="text-sm text-red-400 max-w-sm">{errorMessage || "Something went wrong. Go back to Loofta and try again."}</p>
      )}
      {hasIdentifier && status === "mismatch" && (
        <p className="text-sm text-red-400 max-w-sm">{errorMessage ?? "This Telegram account doesn't match."}</p>
      )}
      {hasIdentifier && status === "done" && (
        <p className="text-sm text-slate-400 max-w-sm">Connected! You can close this tab and go back to Loofta.</p>
      )}
      {hasIdentifier && status === "idle" && <div ref={widgetContainerRef} />}
      {hasIdentifier && status === "connecting" && (
        <p className="text-sm text-slate-400">Connecting your handle…</p>
      )}
    </div>
  );
}
