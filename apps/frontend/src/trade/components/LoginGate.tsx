"use client";

import { useEffect, useRef, useState } from "react";
import { useLogin, useLoginWithTelegram, usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";
import { isInsideTelegram } from "@/trade/lib/telegram";
import { Tile } from "@/trade/components/ui";

/**
 * Inside Telegram, Privy's seamless login normally signs the user in with no click. If that did not
 * happen (seamless not enabled in the dashboard, or an older session), we fall back to a one tap
 * Telegram login. Outside Telegram (desktop browser, dev) we show Privy's modal with email.
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { login: loginTelegram, state } = useLoginWithTelegram({
    onError: (error) => console.error("[loofta] privy telegram login error", error),
  });
  const { login: openModal } = useLogin();
  const [inTelegram, setInTelegram] = useState(false);
  const tried = useRef(false);

  useEffect(() => setInTelegram(isInsideTelegram()), []);

  useEffect(() => {
    if (state.status === "error") console.error("[loofta] privy telegram login failed", state.error);
  }, [state]);

  // Give seamless login a moment to finish on its own, then try the headless Telegram login once.
  useEffect(() => {
    if (!ready || authenticated || !inTelegram || tried.current) return;
    const t = setTimeout(() => {
      if (tried.current) return;
      tried.current = true;
      void loginTelegram().catch((error) => console.error("[loofta] privy telegram login rejected", error));
    }, 1500);
    return () => clearTimeout(t);
  }, [ready, authenticated, inTelegram, loginTelegram]);

  if (!ready) return <Splash />;
  if (authenticated) return <>{children}</>;

  const working = state.status === "loading";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="anim-bob">
        <Tile tone="brand" size={112}>
          <img src="/icons/loofta-icon-white.svg" alt="" className="h-16 w-16" />
        </Tile>
      </div>
      <div>
        <div className="font-display text-4xl font-extrabold">Loofta</div>
        <p className="mx-auto mt-2 max-w-xs text-base leading-snug text-mute">Find memecoins, trade in a few taps. Your wallet is made for you.</p>
      </div>
      {working ? (
        <Loader2 className="animate-spin text-mute" />
      ) : (
        <button type="button" onClick={() => (inTelegram ? loginTelegram().catch(() => {}) : openModal())} className="btn3d h-16 w-full max-w-xs text-lg">
          {inTelegram ? "Continue with Telegram" : "Log in"}
        </button>
      )}
      {state.status === "error" && (
        <div className="flex max-w-xs flex-col items-center gap-1">
          <p className="text-base text-down">Login failed. Try again.</p>
          {state.error?.message && <p className="break-words font-mono text-xs text-mute">{state.error.message}</p>}
        </div>
      )}
    </div>
  );
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="anim-bob">
        <Tile tone="brand" size={88}>
          <img src="/icons/loofta-icon-white.svg" alt="" className="h-12 w-12" />
        </Tile>
      </div>
    </div>
  );
}
