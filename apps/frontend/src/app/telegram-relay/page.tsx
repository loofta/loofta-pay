"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Hosted on loofta.com (not pay.loofta.xyz) because Telegram's Login Widget doesn't work on
 * .xyz domains — loofta.com is registered as an additional domain on the same Privy app instead.
 * `token` identifies which pay.loofta.xyz account to attach the resulting handle to (minted by
 * /api/users/telegram-relay-token there). Logging in here creates a separate, throwaway Privy
 * session scoped to this domain — we only read the resulting Telegram handle off it and hand it
 * back via /api/telegram-relay/complete, authenticated by the one-time token rather than Privy's
 * session, since the two domains don't share one.
 */
export default function TelegramRelayPage() {
  const { ready, authenticated, user, login } = usePrivy();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "done" | "error">("idle");
  const submittedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || !user || !token || submittedRef.current) return;
    const account = (user.linkedAccounts || []).find((a: { type?: string }) => a.type === "telegram");
    const raw = account ? (account as { username?: string }).username : null;
    if (!raw) return;

    submittedRef.current = true;
    setStatus("connecting");
    fetch("/api/telegram-relay/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, handle: raw }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) {
          setStatus("done");
          // This tab is normally opened via window.open() from the claim page, which polls
          // popup.closed to know linking finished — close() is the actual completion signal.
          // If it wasn't opened via script (e.g. visited this link directly), close() is a
          // silent no-op and the fallback redirect below covers that case instead.
          window.close();
          setTimeout(() => {
            const base = process.env.NEXT_PUBLIC_APP_URL || "https://pay.loofta.xyz";
            window.location.href = `${base}/app?connected=telegram`;
          }, 800);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [ready, authenticated, user, token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0b0d12] text-white px-6 text-center">
      <h1 className="text-lg font-semibold">Connect Telegram to Loofta</h1>
      {!token && (
        <p className="text-sm text-slate-400 max-w-sm">
          This link is missing or expired. Go back to Loofta and click &quot;Connect Telegram&quot; again.
        </p>
      )}
      {token && status === "error" && (
        <p className="text-sm text-red-400 max-w-sm">Something went wrong. Go back to Loofta and try again.</p>
      )}
      {token && status === "done" && (
        <p className="text-sm text-slate-400 max-w-sm">Connected! You can close this tab and go back to Loofta.</p>
      )}
      {token && (status === "idle" || status === "connecting") && (
        <>
          {!ready ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !authenticated ? (
            <button
              type="button"
              onClick={() => login({ loginMethods: ["telegram"], disableSignup: true })}
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
