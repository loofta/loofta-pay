"use client";

import { useState } from "react";
import { Wallet, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const LOOFTA_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_GRADIENT = "bg-gradient-to-r from-[#4F46E5] to-[#06B6D4]";

// The actual inline logo mark used on the real claim page (apps/app/c/[id]/page.tsx's LooftaIcon),
// simplified for a small static preview: same path, no drop-shadow filter.
function LooftaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 57" fill="none" className={className} aria-hidden>
      <path
        d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z"
        fill="#FF4A26"
      />
    </svg>
  );
}

/** A minimal, static mockup of the real /c/:id claim page (dark bg, translucent card, brand-gradient
 *  button and message accent) with a switch that swaps in a whitelabeled skin: a different domain in
 *  the URL bar, a merchant logo instead of the Loofta mark, and a different accent gradient. Nothing
 *  here calls the live claim flow; it's a static preview for the docs, not the real component. */
export function ClaimPagePreview() {
  const [branded, setBranded] = useState(false);

  const url = branded ? "claim.acmeco.com/aB3xK9pQ" : "pay.loofta.com/c/aB3xK9pQ";
  const accent = branded ? BRAND_GRADIENT : LOOFTA_GRADIENT;
  const pageBg = branded ? "bg-[#0b1220]" : "bg-[#0f0f12]";

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-base text-slate-300 font-medium">
          {branded ? "Whitelabeled: your domain, your brand" : "Default: pay.loofta.com"}
        </p>
        <label className="flex items-center gap-2.5 text-base text-slate-400 cursor-pointer select-none shrink-0">
          Whitelabel preview
          <Switch checked={branded} onCheckedChange={setBranded} />
        </label>
      </div>

      <div className="rounded-2xl overflow-hidden border border-white/10 shadow-xl">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1e] border-b border-white/10">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
          </div>
          <div className="flex-1 flex items-center gap-1.5 bg-black/30 rounded-md px-2.5 py-1 ml-2 min-w-0">
            <Lock className="w-3 h-3 text-slate-500 shrink-0" />
            <span className="text-[13px] text-slate-400 truncate font-mono">{url}</span>
          </div>
        </div>

        <div className={`${pageBg} px-6 py-10 flex flex-col items-center text-center transition-colors duration-300`}>
          {branded ? (
            <div className="flex items-center gap-2 mb-6">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4F46E5] to-[#06B6D4]" />
              <span className="text-base font-semibold text-slate-100">Acme Co</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-6 opacity-50">
              <LooftaMark className="w-5 h-5" />
              <span className="text-[13px] text-slate-500">pay.loofta.com</span>
            </div>
          )}

          <div className="text-5xl font-semibold text-white mb-2">+ $25.00</div>
          <div className="text-base text-slate-400 mb-5">from alice@example.com</div>

          <div className="relative w-full max-w-xs pl-4 pr-3 py-3 rounded-xl bg-white/[0.06] text-left mb-6">
            <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${accent}`} />
            <p className="text-sm text-white/90 italic">&quot;Thanks for the design work!&quot;</p>
          </div>

          <button
            type="button"
            tabIndex={-1}
            className={`w-full max-w-xs flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white pointer-events-none ${accent}`}
          >
            <Wallet className="w-4 h-4" />
            Claim to wallet
          </button>
        </div>
      </div>

      <p className="text-base text-slate-400 mt-3">
        Same claim flow either way. Only the domain, the logo, and the accent color change.{" "}
        {branded ? "This is what “contact us to whitelabel” gets you." : "Flip the switch to see the whitelabeled version."}
      </p>
    </div>
  );
}
