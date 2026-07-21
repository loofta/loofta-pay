"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useLoginWithTelegram, useLoginWithOAuth } from "@privy-io/react-auth";

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
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  // Dedicated hook for Telegram specifically — usePrivy().login({loginMethods:["telegram"]})
  // routes into Privy's legacy bot-token widget flow (initLoginWithTelegram) regardless of
  // whether OAuth-based Telegram is enabled in the dashboard, which is what was throwing
  // "Telegram Auth configuration is not loaded" even after telegram was added to the app's
  // loginMethods. useLoginWithTelegram is the OAuth-compatible entry point.
  const { login: loginWithTelegram } = useLoginWithTelegram();
  // TEMPORARY diagnostic — not part of the real flow. Tests whether OAuth-family logins work at
  // all on this relay page/domain (loofta.com, isolated Privy session), to isolate whether the
  // "Telegram Auth configuration is not loaded" error is specific to Telegram or a symptom of
  // something wrong with this page/domain more broadly. Remove once Telegram is sorted out.
  const { initOAuth: loginWithTwitterTest, state: twitterTestState } = useLoginWithOAuth({
    onError: (e) => console.error("[telegram-relay][DIAGNOSTIC twitter test] failed:", e),
  });
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
    loginWithTelegram().catch((e) => {
      console.error("[telegram-relay] loginWithTelegram failed:", e);
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : null);
    });
  }, [ready, authenticated, hasIdentifier, loginWithTelegram]);

  useEffect(() => {
    if (!ready || !authenticated || !user || !hasIdentifier || submittedRef.current) return;
    // Matches both possible type strings the same way this app already handles discord/github
    // ("discord" vs "discord_oauth", etc.) — an OAuth-linked Telegram account likely comes back
    // as "telegram_oauth" given Privy's dashboard itself distinguishes telegram_auth (legacy)
    // from telegram_oauth (this flow), not necessarily the plain "telegram" checked before.
    // Only used here to gate on "has Telegram actually finished linking to this session yet" —
    // the handle itself is never sent to the backend; both endpoints re-derive it server-side
    // from relayAccessToken, since a client-supplied handle string can't be trusted.
    const account = (user.linkedAccounts || []).find(
      (a: { type?: string }) => a.type === "telegram" || a.type === "telegram_oauth",
    );
    if (!account) return;

    submittedRef.current = true;
    setStatus("connecting");
    (async () => {
      const relayAccessToken = await getAccessToken().catch((e) => {
        console.error("[telegram-relay] getAccessToken failed:", e);
        return null;
      });
      if (!relayAccessToken) {
        submittedRef.current = false;
        setStatus("error");
        setErrorMessage("Could not get a session token — try again in a moment.");
        return;
      }
      const endpoint = token ? "/api/telegram-relay/complete" : "/api/telegram-relay/verify-claim";
      const body = token ? { token, relayAccessToken } : { claimId, relayAccessToken };
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => null);
          if (!r.ok || !data) {
            console.error(`[telegram-relay] ${endpoint} failed:`, r.status, data);
            setStatus("error");
            setErrorMessage(data?.error || `Request failed (${r.status}).`);
            return;
          }
          if (data.success) {
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
          } else if (!token && data.error) {
            // verify-claim's "wrong account" case — a real, informative mismatch, not a fetch/server error.
            setStatus("mismatch");
            setErrorMessage(data.error);
          } else {
            console.error(`[telegram-relay] ${endpoint} returned no success:`, data);
            setStatus("error");
            setErrorMessage(data.error || null);
          }
        })
        .catch((e) => {
          console.error(`[telegram-relay] ${endpoint} threw:`, e);
          setStatus("error");
          setErrorMessage(e instanceof Error ? e.message : null);
        });
    })();
  }, [ready, authenticated, user, hasIdentifier, token, claimId, getAccessToken]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0b0d12] text-white px-6 text-center">
      <h1 className="text-lg font-semibold">Connect Telegram to Loofta</h1>
      {!hasIdentifier && (
        <p className="text-sm text-slate-400 max-w-sm">
          This link is missing or expired. Go back to Loofta and click &quot;Connect Telegram&quot; again.
        </p>
      )}
      {hasIdentifier && status === "error" && (
        <p className="text-sm text-red-400 max-w-sm">
          {errorMessage || "Something went wrong."} Go back to Loofta and try again.
        </p>
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
              onClick={() =>
                loginWithTelegram().catch((e) => {
                  console.error("[telegram-relay] loginWithTelegram failed:", e);
                  setStatus("error");
                  setErrorMessage(e instanceof Error ? e.message : null);
                })
              }
              className="px-5 py-2.5 rounded-xl bg-[#26A5E4] text-white font-semibold hover:opacity-90"
            >
              Log in with Telegram
            </button>
          ) : (
            <p className="text-sm text-slate-400">Connecting your handle…</p>
          )}
        </>
      )}
      {/* TEMPORARY diagnostic button — see comment above on loginWithTwitterTest. */}
      {hasIdentifier && !authenticated && (
        <div className="mt-6 pt-6 border-t border-white/10 w-full max-w-xs">
          <p className="text-xs text-slate-500 mb-2">Diagnostic only — not part of the real flow:</p>
          <button
            type="button"
            onClick={() => loginWithTwitterTest({ provider: "twitter" })}
            className="px-5 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:opacity-90 w-full"
          >
            Test: Log in with Twitter ({twitterTestState.status})
          </button>
        </div>
      )}
    </div>
  );
}
