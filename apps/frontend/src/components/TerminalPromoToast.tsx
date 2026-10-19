"use client";

import { X } from "lucide-react";

const LOOFTA_ICON_WHITE = "/images/icons/loofta-icon-white.svg";

export function TerminalPromoToast({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="relative rounded-2xl border border-white/10 bg-[#0f0f12]/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-4">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3 pr-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7A2A] to-[#EAB308] shadow-lg shadow-orange-500/40">
            <img src={LOOFTA_ICON_WHITE} alt="" className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold font-sans text-base">Try the Loofta bot on Telegram</p>
            <p className="text-slate-400 text-base mt-0.5">
              Just message who to pay, like &quot;send $5 to @alice on X&quot;, for faster payments with no form-filling.
            </p>
            <a
              href="https://t.me/looftapay_bot"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 mt-3 rounded-xl px-3 py-1.5 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity"
            >
              Open Telegram bot
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
