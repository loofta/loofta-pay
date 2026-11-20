"use client";

// Local-only preview of the Fast delivery switch, using Peer's real estimate.
// Nothing here signs or saves anything. Not linked from any nav; shows nothing outside development.

import { useEffect, useState } from "react";
import { FastDeliverySwitch } from "@/components/cashout/FastDeliveryControls";
import { FAST_RATE_PERCENT, cashoutGrossUsdc } from "@/services/peerCash";

const PLATFORMS = [
  { id: "revolut", name: "Revolut", currency: "USD" },
  { id: "wise", name: "Wise", currency: "USD" },
  { id: "paypal", name: "PayPal", currency: "USD" },
  { id: "venmo", name: "Venmo", currency: "USD" },
];

export default function SpeedUpPreviewPage() {
  const isDev = process.env.NODE_ENV === "development";
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [amount, setAmount] = useState(50);
  const [fast, setFast] = useState(false);
  const [eta, setEta] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isDev) return;
    let cancelled = false;
    setLoading(true);
    setEta(null);
    (async () => {
      try {
        const { getPeerEstimate, usdc } = await import("@/services/peerCash");
        const gross = cashoutGrossUsdc(amount, fast ? FAST_RATE_PERCENT : 0);
        const est = await getPeerEstimate(usdc(gross), platform.currency, platform.id, true);
        if (!cancelled) setEta(est.eta?.label ?? null);
      } catch {
        if (!cancelled) setEta(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDev, platform, amount, fast]);

  if (!isDev) return null;

  const pay = cashoutGrossUsdc(amount, fast ? FAST_RATE_PERCENT : 0);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] px-4 py-8 text-white">
      <div className="mx-auto max-w-md space-y-8">
        <p className="text-base text-slate-400">Preview only. Nothing is signed or saved.</p>

        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlatform(p)}
              className={`rounded-full border px-4 py-2 text-base ${platform.id === p.id ? "border-orange-500 text-white" : "border-white/10 text-slate-400"}`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[10, 50, 200].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(a)}
              className={`rounded-full border px-4 py-2 text-base ${amount === a ? "border-orange-500 text-white" : "border-white/10 text-slate-400"}`}
            >
              ${a}
            </button>
          ))}
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">When paying</h2>
          <div className="rounded-2xl border border-white/10 bg-[#141419] p-4 space-y-3">
            <div className="flex justify-between text-base"><span className="text-slate-400">They receive</span><span>${amount.toFixed(2)}</span></div>
            <FastDeliverySwitch
              checked={fast}
              onChange={setFast}
              estimateLabel={eta}
              estimateLoading={loading}
              extraUsd={cashoutGrossUsdc(amount, FAST_RATE_PERCENT) - amount}
            />
            <button type="button" className="h-12 w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-base font-semibold">
              Pay ${pay.toFixed(2)}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
