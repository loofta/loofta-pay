"use client";

import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";

/**
 * TEMPORARY minimal test version — no auto-trigger, no token/claimId handling, no backend calls,
 * no redirect back to the claim page. Just: click the button, see whether Privy's Telegram OAuth
 * actually completes and dump the raw result on screen. Once this is confirmed working (or the
 * real failure is isolated), restore the full relay flow from git history
 * (git log --oneline -- apps/frontend/src/app/telegram-relay/page.tsx).
 */
export default function TelegramRelayPage() {
  const { ready, authenticated, user } = usePrivy();
  const { initOAuth, state } = useLoginWithOAuth({
    onComplete: (result) => console.log("[TEST] onComplete:", result),
    onError: (error) => console.error("[TEST] onError:", error),
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0b0d11] text-white px-6 text-center">
      <h1 className="text-lg font-semibold">Telegram OAuth test (minimal)</h1>
      <p className="text-sm text-slate-400">ready: {String(ready)} · authenticated: {String(authenticated)}</p>
      <p className="text-sm text-slate-400">flow state: {state.status}</p>
      {!authenticated && (
        <button
          type="button"
          onClick={() => initOAuth({ provider: "telegram" })}
          className="px-5 py-2.5 rounded-xl bg-[#26A5E4] text-white font-semibold hover:opacity-90"
        >
          Log in with Telegram
        </button>
      )}
      <pre className="mt-4 max-w-lg w-full overflow-auto text-left text-xs bg-white/5 rounded-lg p-4 whitespace-pre-wrap break-all">
        {JSON.stringify({ state, user }, null, 2)}
      </pre>
    </div>
  );
}
