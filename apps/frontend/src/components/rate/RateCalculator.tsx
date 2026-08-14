'use client'

import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { CONVERSION_AMOUNTS } from "./conversionAmounts";
import type { UsdcNgnRateSnapshot } from "@/lib/usdcNgnRate";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";
const POLL_MS = 60_000;

function formatNgn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `₦${Math.round(value).toLocaleString("en-US")}`;
}

export function RateCalculator({
  initialSnapshot,
  sendUnitLabel = "USDC",
  ctaLabel = "Send USDC to Nigeria now",
  utmCampaign,
  pageKey,
}: {
  initialSnapshot: UsdcNgnRateSnapshot;
  /** Label shown next to the amount input and in the table header — e.g. "USDC" or "USD". Both
   * are treated as ~1:1 for this calculator since USDC is a dollar-pegged stablecoin. */
  sendUnitLabel?: string;
  ctaLabel?: string;
  utmCampaign: string;
  pageKey: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [amount, setAmount] = useState("100");
  const [mounted, setMounted] = useState(false);
  const trackedInteraction = useRef(false);

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/rates/usdc-ngn", { cache: "no-store" });
        if (res.ok) setSnapshot(await res.json());
      } catch {
        // Keep showing the last good snapshot rather than blank the calculator.
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 0;
  const bankNgn = snapshot.bankRateNgn !== null ? validAmount * snapshot.bankRateNgn : null;
  const looftaNgn = snapshot.looftaRateNgn !== null ? validAmount * snapshot.looftaRateNgn : null;
  const pctBetter =
    bankNgn !== null && looftaNgn !== null && bankNgn > 0
      ? Math.round(((looftaNgn - bankNgn) / bankNgn) * 100)
      : null;

  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (!trackedInteraction.current) {
      trackedInteraction.current = true;
      posthog.capture("seo_calculator_interaction", { page: pageKey });
    }
  };

  const handleCtaClick = () => {
    posthog.capture("seo_cta_click", { page: pageKey });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
      <label htmlFor={`${pageKey}-amount`} className="block font-grotesk text-base font-semibold text-slate-200 uppercase tracking-wide mb-2">
        You send
      </label>
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <input
          id={`${pageKey}-amount`}
          type="number"
          min="0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          className="w-full bg-transparent font-mono tabular-nums text-2xl font-semibold text-slate-100 outline-none"
        />
        <span className="font-grotesk text-lg font-semibold text-slate-300 flex-shrink-0">{sendUnitLabel}</span>
      </div>

      {/* Bank vs Loofta, side by side so the better rate is obvious at a glance */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:gap-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4">
          <p className="font-grotesk text-base font-semibold text-slate-300 uppercase tracking-wide mb-2">
            At the bank
          </p>
          <span className="font-mono tabular-nums text-2xl md:text-3xl font-semibold text-slate-200">
            {formatNgn(bankNgn)}
          </span>
        </div>

        <div className="relative rounded-xl border border-[#FF4A26]/40 bg-[#FF4A26]/[0.1] px-4 py-4">
          <p className="font-grotesk text-base font-semibold text-[#FFA97D] uppercase tracking-wide mb-2">
            Via Loofta
          </p>
          <span className="font-mono tabular-nums text-2xl md:text-3xl font-semibold text-white">
            {formatNgn(looftaNgn)}
          </span>
          {pctBetter !== null && pctBetter > 0 && (
            <span className="absolute -top-3 right-3 rounded-full bg-[#4ADE80] px-2.5 py-1 text-sm font-bold text-black">
              +{pctBetter}%
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 font-grotesk text-base text-slate-400" suppressHydrationWarning>
        {mounted ? `Rates last updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}` : " "}
      </p>

      <a
        href={`${APP_URL}?utm_source=seo&utm_medium=organic&utm_campaign=${utmCampaign}`}
        onClick={handleCtaClick}
        className={`mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-lg font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
      >
        {ctaLabel}
        <span className="text-white/70">→</span>
      </a>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full border-collapse min-w-[420px]">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left font-grotesk text-base font-semibold text-slate-300 uppercase tracking-widest py-3 pr-4">
                {sendUnitLabel}
              </th>
              <th className="text-left font-grotesk text-base font-semibold text-slate-300 uppercase tracking-widest py-3 pr-4">
                At the bank
              </th>
              <th className="text-left font-grotesk text-base font-semibold text-[#FFA97D] uppercase tracking-widest py-3">
                Via Loofta
              </th>
            </tr>
          </thead>
          <tbody>
            {CONVERSION_AMOUNTS.map((usdc) => (
              <tr key={usdc} className="border-b border-white/[0.06]">
                <td className="font-mono tabular-nums text-lg text-slate-100 py-3 pr-4">{usdc}</td>
                <td className="font-mono tabular-nums text-lg text-slate-200 py-3 pr-4">
                  {formatNgn(snapshot.bankRateNgn !== null ? usdc * snapshot.bankRateNgn : null)}
                </td>
                <td className="font-mono tabular-nums text-lg text-[#FFA97D] font-semibold py-3">
                  {formatNgn(snapshot.looftaRateNgn !== null ? usdc * snapshot.looftaRateNgn : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
