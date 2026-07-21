"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useLoginWithTelegram } from "@privy-io/react-auth";

/**
 * Hosted on loofta.com (not pay.loofta.xyz) because Telegram's Login Widget doesn't work on
 * .xyz domains — loofta.com is registered as an additional domain on the same Privy app instead.
 * Logging in here creates a separate, throwaway Privy session scoped to this domain — we only
 * read the resulting Telegram handle off it and hand it back to pay.loofta.xyz, since the two
 * domains don't share a session. Two modes, mutually exclusive:
 *  - `token`: connect Telegram to an ALREADY signed-in Loofta account. The token (minted by
 *    /api/users/telegram-relay-token) identifies which account. See /api/telegram-relay/complete.
 *  - `claimId`: pre-auth "is this payment for me?" check for a visitor with NO Loofta account
 *    yet — proves handle ownership against a specific claim's pending recipient without needing
 *    an account to attach it to. See /api/telegram-relay/verify-claim; the claim page redeems the
 *    resulting claim-scoped verification via /api/telegram-relay/attach-verified once the visitor
 *    has signed in to a real account.
 */
export default function TelegramRelayPage() {
  const { ready, authenticated, user } = usePrivy();
  // Dedicated hook for Telegram specifically — usePrivy().login({loginMethods:["telegram"]})
  // routes into Privy's legacy bot-token widget flow (initLoginWithTelegram) regardless of
  // whether OAuth-based Telegram is enabled in the dashboard, which is what was throwing
  // "Telegram Auth configuration is not loaded" even after telegram was added to the app's
  // loginMethods. useLoginWithTelegram is the OAuth-compatible entry point.
  const { login: loginWithTelegram } = useLoginWithTelegram();
  const [token, setToken] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "done" | "mismatch" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const autoLoginAttemptedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
    setClaimId(params.get("claimId"));
  }, []);

  const hasIdentifier = !!token || !!claimId;

  // Skip the extra manual click — trigger the Telegram login widget as soon as this page is
  // ready, so opening this tab immediately shows Telegram's own prompt instead of an
  // intermediate "Log in with Telegram" button. The button below still renders as a fallback,
  // since a login triggered outside a direct click can be blocked by some browsers' popup
  // blockers; only fires once so a cancelled/dismissed widget doesn't get reopened in a loop.
  useEffect(() => {
    if (!ready || authenticated || !hasIdentifier || autoLoginAttemptedRef.current) return;
    autoLoginAttemptedRef.current = true;
    loginWithTelegram().catch(() => setStatus("error"));
  }, [ready, authenticated, hasIdentifier, loginWithTelegram]);

  useEffect(() => {
    if (!ready || !authenticated || !user || !hasIdentifier || submittedRef.current) return;
    const account = (user.linkedAccounts || []).find((a: { type?: string }) => a.type === "telegram");
    const raw = account ? (account as { username?: string }).username : null;
    if (!raw) return;

    submittedRef.current = true;
    setStatus("connecting");
    const endpoint = token ? "/api/telegram-relay/complete" : "/api/telegram-relay/verify-claim";
    const body = token ? { token, handle: raw } : { claimId, handle: raw };
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
        }
      })
      .catch(() => setStatus("error"));
  }, [ready, authenticated, user, hasIdentifier, token, claimId]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0b0d12] text-white px-6 text-center">
      <h1 className="text-lg font-semibold">Connect Telegram to Loofta</h1>
      {!hasIdentifier && (
        <p className="text-sm text-slate-400 max-w-sm">
          This link is missing or expired. Go back to Loofta and click &quot;Connect Telegram&quot; again.
        </p>
      )}
      {hasIdentifier && status === "error" && (
        <p className="text-sm text-red-400 max-w-sm">Something went wrong. Go back to Loofta and try again.</p>
      )}
      {hasIdentifier && status === "mismatch" && (
        <p className="text-sm text-red-400 max-w-sm">{errorMessage ?? "This Telegram account doesn't match."}</p>
      )}
      {hasIdentifier && status === "done" && (
        <p className="text-sm text-slate-400 max-w-sm">Connected! You can close this tab and go back to Loofta.</p>
      )}
      {hasIdentifier && (status === "idle" || status === "connecting") && (
        <>
          {!ready ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !authenticated ? (
            <button
              type="button"
              onClick={() => loginWithTelegram().catch(() => setStatus("error"))}
              className="px-5 py-2.5 rounded-xl bg-[#26A5E4] text-white font-semibold hover:opacity-90"
            >
              Log in with Telegram
            </button>
          ) : (
            <p className="text-sm text-slate-400">Connecting your handle…</p>
          )}
        </>
      )}
    </div>
  );
}
