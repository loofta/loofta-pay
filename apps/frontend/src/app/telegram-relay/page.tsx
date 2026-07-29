"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";
import { AlertCircle, AlertTriangle, CheckCircle2, Link2, Loader2, Send } from "lucide-react";

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
 *
 * Uses useLoginWithOAuth({ provider: "telegram" }) — NOT the dedicated useLoginWithTelegram hook.
 * That hook (and the generic login({loginMethods:["telegram"]}) call) both route through Privy's
 * legacy bot-token widget flow (initLoginWithTelegram), which requires the app's `telegram_auth`
 * dashboard flag — stuck disabled for this app despite Telegram OAuth being fully configured.
 * useLoginWithOAuth's generic OAuth path (confirmed by Privy support, and by 'telegram' actually
 * being a valid value in @privy-io/api-types' OAuthProviderID) doesn't depend on that flag at all.
 */
export default function TelegramRelayPage() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { initOAuth: loginWithTelegram } = useLoginWithOAuth({
    onError: (e) => console.error("[telegram-relay] useLoginWithOAuth error:", e),
  });
  const [token, setToken] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "done" | "mismatch" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittedRef = useRef(false);

  // useLoginWithOAuth's initOAuth does a full top-level redirect (window.assign) to Telegram and
  // back — unlike a popup-based widget, this REMOUNTS the whole page/React tree when it returns.
  // A plain useRef can't survive that (it resets to its initial value on every fresh mount), so
  // relying on one here would let the auto-trigger effect below fire a SECOND time right as Privy
  // is still processing the OAuth return, re-redirecting instead of settling into "authenticated".
  // sessionStorage survives the redirect within the same tab, so it's the only thing that can
  // actually gate "have we already started this flow" across that reload.
  const AUTO_LOGIN_KEY = "telegram-relay:auto-login-attempted";

  // Once the flow reaches any terminal state, clear the persisted keys — a manual retry (clicking
  // the button again after an error) or a reused tab should start clean, not stay permanently
  // gated by a flag left over from the attempt that just finished.
  useEffect(() => {
    if (status === "done" || status === "error" || status === "mismatch") {
      sessionStorage.removeItem(AUTO_LOGIN_KEY);
      sessionStorage.removeItem("telegram-relay:token");
      sessionStorage.removeItem("telegram-relay:claimId");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Present only on the very first load (before initOAuth ever runs) — absent on the return
    // trip from Telegram, whose URL instead carries Privy's OWN oauth callback params (e.g.
    // privy_oauth_code/privy_oauth_state). That distinction is exactly what decides whether it's
    // safe to touch the URL below: Privy's SDK reads those return params straight off
    // window.location to complete the login, so this must never strip them mid-processing.
    const hasOwnParams = params.has("token") || params.has("claimId");

    // Same reload concern applies to the identifying params themselves — fall back to whatever
    // was persisted just before the redirect if this load's URL doesn't have them.
    const t = params.get("token") || sessionStorage.getItem("telegram-relay:token");
    const c = params.get("claimId") || sessionStorage.getItem("telegram-relay:claimId");
    if (t) sessionStorage.setItem("telegram-relay:token", t);
    if (c) sessionStorage.setItem("telegram-relay:claimId", c);
    setToken(t);
    setClaimId(c);

    // initOAuth uses the current page URL (including query string) as the implicit OAuth
    // redirect target, and Privy's dashboard "Allowed OAuth redirect URLs" list requires an
    // EXACT match with no query params — a URL like /telegram-relay?token=... can never match a
    // registered /telegram-relay entry, which is what was throwing "Redirect URL is not allowed".
    // Only strip on THIS (first) load, gated on hasOwnParams — token/claimId are already
    // persisted above, so nothing downstream needs them in the URL anymore. Stripping
    // unconditionally (including on the return trip, when hasOwnParams is false) was deleting
    // Privy's own callback params before its SDK could read them, which silently broke completing
    // the login — this is what caused "redirected back but shows the login form again."
    if (hasOwnParams) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const hasIdentifier = !!token || !!claimId;

  const startTelegramLogin = () =>
    loginWithTelegram({ provider: "telegram" }).catch((e) => {
      console.error("[telegram-relay] loginWithTelegram failed:", e);
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : null);
    });

  // The "mismatch" case leaves this tab authenticated (via this relay domain's own throwaway
  // Privy session) as the WRONG Telegram account, with no way to retry — logout() clears that
  // session so `authenticated` flips back to false, letting the visitor pick a different Telegram
  // account. submittedRef must be reset too, since it otherwise permanently blocks the
  // verify-claim effect from running again for this tab.
  const logoutAndRetry = async () => {
    submittedRef.current = false;
    setErrorMessage(null);
    setStatus("idle");
    await logout().catch((e) => console.error("[telegram-relay] logout failed:", e));
  };

  // Skip the extra manual click — trigger the Telegram login as soon as this page is ready, so
  // opening this tab immediately shows Telegram's own prompt instead of an intermediate "Log in
  // with Telegram" button. The button below still renders as a fallback, since a login triggered
  // outside a direct click can be blocked by some browsers' popup blockers; only fires once per
  // tab (sessionStorage, not a ref — see note above) so the post-redirect reload doesn't retrigger
  // a fresh login attempt instead of letting the just-completed one settle.
  useEffect(() => {
    if (!ready || authenticated || !hasIdentifier) return;
    if (sessionStorage.getItem(AUTO_LOGIN_KEY) === "1") return;
    sessionStorage.setItem(AUTO_LOGIN_KEY, "1");
    void startTelegramLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, hasIdentifier]);

  useEffect(() => {
    if (!ready || !authenticated || !user || !hasIdentifier || submittedRef.current) return;
    // Matches both possible type strings the same way this app already handles discord/github
    // ("discord" vs "discord_oauth", etc.) — an OAuth-linked Telegram account may come back as
    // either "telegram" or "telegram_oauth" depending on SDK version. Only used here to gate on
    // "has Telegram actually finished linking to this session yet" — the handle itself is never
    // sent to the backend; both endpoints re-derive it server-side from relayAccessToken, since a
    // client-supplied handle string can't be trusted.
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
    <div className="relative min-h-screen overflow-hidden bg-[#0f0f12] flex flex-col items-center justify-center px-4 text-center">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[420px] w-[420px] rounded-full bg-gradient-to-r from-[#FF0F00]/20 to-yellow-500/20 blur-[120px]" />
      </div>

      <div className="relative flex flex-col items-center w-full max-w-sm">
        <Image src="/images/logo/loofta-icon-white.svg" alt="Loofta" width={56} height={57} className="mb-8" />

        <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-8">
          {!hasIdentifier ? (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06]">
                <Link2 className="h-7 w-7 text-slate-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white">Link expired</h1>
              <p className="mt-2 text-base text-slate-400">
                This link is missing or expired. Go back to Loofta and click &quot;Connect Telegram&quot; again.
              </p>
            </>
          ) : status === "error" ? (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
                <AlertCircle className="h-7 w-7 text-red-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white">Something went wrong</h1>
              <p className="mt-2 text-base text-slate-400">
                {errorMessage || "Something went wrong."} Go back to Loofta and try again.
              </p>
            </>
          ) : status === "mismatch" ? (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
                <AlertTriangle className="h-7 w-7 text-amber-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white">Wrong Telegram account</h1>
              <p className="mt-2 text-base text-slate-400">{errorMessage ?? "This Telegram account doesn't match."}</p>
              <button
                type="button"
                onClick={() => void logoutAndRetry()}
                className="mt-6 w-full h-12 rounded-xl font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all"
              >
                Log out &amp; use a different account
              </button>
            </>
          ) : status === "done" ? (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white">Connected!</h1>
              <p className="mt-2 text-base text-slate-400">You can close this tab and go back to Loofta.</p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#26A5E4]/15">
                <Send className="h-7 w-7 text-[#26A5E4]" />
              </div>
              <h1 className="text-2xl font-semibold text-white">Connect Telegram to Loofta</h1>
              {!ready ? (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <Loader2 className="h-7 w-7 animate-spin text-white/30" />
                  <p className="text-base text-slate-400">Loading…</p>
                </div>
              ) : !authenticated ? (
                <>
                  <p className="mt-2 text-base text-slate-400">Verify your handle to continue.</p>
                  <button
                    type="button"
                    onClick={() => void startTelegramLogin()}
                    className="mt-6 w-full h-12 rounded-xl font-semibold text-white bg-[#26A5E4] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <Send className="h-4 w-4" />
                    Log in with Telegram
                  </button>
                </>
              ) : (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <Loader2 className="h-7 w-7 animate-spin text-white/30" />
                  <p className="text-base text-slate-400">Connecting your handle…</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
