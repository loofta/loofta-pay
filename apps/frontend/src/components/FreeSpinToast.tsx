"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export function FreeSpinToast({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations("FreeSpinToast");

  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="relative rounded-2xl border border-white/10 bg-[#0f0f12]/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-4">
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3 pr-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7A2A] to-[#EAB308] shadow-lg shadow-orange-500/40 text-2xl">
            🎁
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold font-sans text-base">{t("title")}</p>
            <p className="text-slate-400 text-base mt-0.5">{t("body")}</p>
            <Link
              href="/app/megapot/packs"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 mt-3 rounded-xl px-3 py-1.5 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity"
            >
              {t("open")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
