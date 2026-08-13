"use client";

import { X, Mail } from "lucide-react";
import { useTranslations } from "next-intl";

export function AddEmailToast({
  onAddEmail,
  onDismiss,
  loading,
  alreadyLinked,
}: {
  onAddEmail: () => void;
  onDismiss: () => void;
  loading: boolean;
  alreadyLinked: boolean;
}) {
  const t = useTranslations("AddEmailToast");

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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7A2A] to-[#EAB308] shadow-lg shadow-orange-500/40">
            <Mail size={20} className="text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold font-sans text-base">{t("title")}</p>
            <p className="text-slate-400 text-base mt-0.5">{t("body")}</p>
            {alreadyLinked && <p className="text-amber-300 text-sm mt-1">{t("alreadyLinked")}</p>}
            <button
              type="button"
              onClick={onAddEmail}
              disabled={loading}
              className="inline-flex items-center gap-1 mt-3 rounded-xl px-3 py-1.5 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {loading ? t("adding") : t("addEmail")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
