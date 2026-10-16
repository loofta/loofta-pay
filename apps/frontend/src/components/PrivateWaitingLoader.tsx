"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatDelayDuration } from "@/lib/privacyDelay";
import { waitingForFundsCopy } from "@/lib/privatePaymentCopy";

/** Waiting state for a payment whose funds haven't landed yet. For a private payment it quotes
 *  the exact delay the sender picked, shows progress against it when the start time is known,
 *  and asks the recipient to be patient — the delay is deliberate, it is what makes it private. */
export function PrivateWaitingLoader({
  isPrivate,
  delayMs,
  startedAt,
}: {
  isPrivate: boolean | null | undefined;
  delayMs: number;
  startedAt?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPrivate || delayMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isPrivate, delayMs]);

  if (!isPrivate) {
    return (
      <div className="flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
        <span className="text-gray-500">{waitingForFundsCopy(false, delayMs)}</span>
      </div>
    );
  }

  const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const hasStart = Number.isFinite(startMs) && delayMs > 0;
  const elapsed = hasStart ? Math.max(0, now - startMs) : 0;
  const pct = hasStart ? Math.min(100, (elapsed / delayMs) * 100) : 0;
  const overdue = hasStart && elapsed >= delayMs;

  return (
    <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-500/15">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
      <p className="text-lg font-semibold text-gray-900 dark:text-white">
        {overdue ? "Almost there" : "Your private payment is on its way"}
      </p>
      <p className="mt-1 text-base text-gray-600 dark:text-slate-300">
        {delayMs > 0
          ? `The sender chose a delay of ${formatDelayDuration(delayMs)}. Funds arrive in parts at random moments inside that window.`
          : "Funds should land right away and may arrive in parts."}
      </p>
      {hasStart && (
        <div className="mx-auto mt-3 h-2 w-full max-w-xs overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] transition-[width] duration-1000"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
      )}
      <p className="mt-3 text-base text-gray-600 dark:text-slate-300">
        Please be patient. The wait is on purpose, it is what keeps this payment private. You can keep this page open or come back later, your funds are safe.
      </p>
    </div>
  );
}
