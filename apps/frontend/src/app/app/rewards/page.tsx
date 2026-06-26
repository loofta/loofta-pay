"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

const SPARKS_END_DATE = new Date("2026-07-01T00:00:00.000Z");

function getDaysLeft(endDate: Date): number {
  const now = new Date();
  const diff = endDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function EndBadge({ endDate, t }: { endDate: Date; t: ReturnType<typeof useTranslations<"RewardsPage">> }) {
  const daysLeft = getDaysLeft(endDate);
  const isEnding = daysLeft <= 3;
  const label = daysLeft === 0
    ? t("endsToday")
    : t("daysLeft", { days: daysLeft });

  return (
    <span
      className={[
        "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
        isEnding
          ? "bg-red-500/20 text-red-400 border-red-500/25"
          : "bg-white/10 text-slate-400 border-white/10",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export default function RewardsPage() {
  const t = useTranslations("RewardsPage");

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">{t("title")}</h1>
          <p className="text-base text-slate-400 mt-0.5">{t("subtitle")}</p>
        </div>

        <p className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
          {t("activeCampaigns")}
        </p>

        <Link href="/app/rewards/sparks" className="block group">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 group-hover:bg-white/[0.08] transition-colors">
            <div className="flex items-center gap-4">
              <div className="shrink-0 w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-3xl">
                ⚡
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-semibold text-white">{t("sparksTitle")}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/25">
                    Devnet
                  </span>
                  <EndBadge endDate={SPARKS_END_DATE} t={t} />
                </div>
                <p className="text-base text-slate-400 mt-1 leading-snug">
                  {t("sparksDescription")}
                </p>
              </div>
              <ChevronRight size={20} className="shrink-0 text-slate-500 group-hover:text-slate-300 transition-colors" />
            </div>
          </div>
        </Link>

        <div className="mt-8">
          <p className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            {t("comingSoon")}
          </p>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="flex items-center gap-4">
              <div className="shrink-0 w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl opacity-40">
                🔮
              </div>
              <div className="flex-1 min-w-0 opacity-40">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-slate-300">{t("nextCampaign")}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-slate-500 border border-white/10">
                    {t("comingSoon")}
                  </span>
                </div>
                <p className="text-base text-slate-500 mt-1">{t("nextCampaignSubtitle")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
