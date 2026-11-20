"use client";

// Local-only preview of the claim card's crypto / cash options. No claim or data needed.
// Not linked from any nav; shows nothing outside development.

import { Landmark, Wallet } from "lucide-react";
import { ClaimCashTiles } from "@/components/claim/ClaimCashTiles";

export default function ClaimCashPreviewPage() {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-md">
        <p className="mb-4 text-base text-slate-400">Preview only. Nothing here claims anything.</p>

        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-5 text-base font-semibold text-white shadow-md">
          <Wallet className="h-5 w-5" />
          <span>Claim in crypto</span>
        </button>

        <div className="my-3.5 flex w-full items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-base font-medium uppercase tracking-widest text-slate-500">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <button type="button" className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-amber-400 to-red-500 p-[1.5px]">
          <span className="flex flex-col items-stretch gap-3 rounded-[calc(1rem-1.5px)] bg-[#0f0f12] px-4 py-4 text-base font-semibold text-slate-100">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Landmark className="h-4 w-4 shrink-0" />
                <span>Claim to cash</span>
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-medium text-amber-300">Easiest</span>
            </span>
            <ClaimCashTiles />
          </span>
        </button>
      </div>
    </div>
  );
}
