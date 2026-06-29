"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

const SPARKS_END_DATE = new Date("2026-07-01T00:00:00.000Z");

function getDaysLeft(endDate: Date): number {
  const now = new Date();
  const diff = endDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// Inline SVG background — loofta amber/lightning style
const SPARKS_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="center-glow" cx="50%" cy="55%" r="55%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.30"/>
      <stop offset="60%" stop-color="#b45309" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#0d0800" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="edge-dark" cx="50%" cy="50%" r="75%">
      <stop offset="30%" stop-color="#0d0800" stop-opacity="0"/>
      <stop offset="100%" stop-color="#050200" stop-opacity="0.75"/>
    </radialGradient>
    <filter id="blur-bolt">
      <feGaussianBlur stdDeviation="2.5"/>
    </filter>
  </defs>
  <!-- Base -->
  <rect width="480" height="240" fill="#0c0700"/>
  <!-- Subtle grid lines -->
  <line x1="0" y1="80" x2="480" y2="80" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <line x1="0" y1="160" x2="480" y2="160" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <line x1="160" y1="0" x2="160" y2="240" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <line x1="320" y1="0" x2="320" y2="240" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <!-- Ambient center glow -->
  <ellipse cx="240" cy="130" rx="240" ry="160" fill="url(#center-glow)"/>
  <!-- Large background bolt (blurred glow) -->
  <path d="M252,18 L228,102 L246,102 L218,210 L258,118 L238,118 L265,18Z" fill="#f59e0b" opacity="0.12" filter="url(#blur-bolt)"/>
  <!-- Large background bolt (sharp) -->
  <path d="M252,18 L228,102 L246,102 L218,210 L258,118 L238,118 L265,18Z" fill="#fbbf24" opacity="0.16"/>
  <!-- Left bolt -->
  <path d="M88,50 L74,98 L84,98 L66,148 L90,108 L80,108 L95,50Z" fill="#f59e0b" opacity="0.13"/>
  <!-- Right bolt -->
  <path d="M375,65 L364,100 L372,100 L357,138 L377,108 L368,108 L382,65Z" fill="#f59e0b" opacity="0.11"/>
  <!-- Top-right micro bolt -->
  <path d="M428,20 L422,42 L427,42 L418,65 L430,44 L424,44 L434,20Z" fill="#fcd34d" opacity="0.10"/>
  <!-- Bottom-left micro bolt -->
  <path d="M42,158 L36,178 L41,178 L32,200 L44,180 L38,180 L48,158Z" fill="#f59e0b" opacity="0.09"/>
  <!-- Top-left micro bolt -->
  <path d="M30,38 L25,55 L30,55 L22,74 L33,57 L28,57 L36,38Z" fill="#fcd34d" opacity="0.08"/>
  <!-- Sparkle dots -->
  <circle cx="168" cy="42" r="2.5" fill="#fbbf24" opacity="0.40"/>
  <circle cx="310" cy="55" r="2" fill="#fbbf24" opacity="0.35"/>
  <circle cx="400" cy="148" r="3" fill="#f59e0b" opacity="0.28"/>
  <circle cx="100" cy="132" r="2" fill="#fcd34d" opacity="0.32"/>
  <circle cx="200" cy="190" r="2.5" fill="#fbbf24" opacity="0.22"/>
  <circle cx="440" cy="92" r="1.5" fill="#f59e0b" opacity="0.28"/>
  <circle cx="50" cy="88" r="2" fill="#fcd34d" opacity="0.24"/>
  <circle cx="140" cy="168" r="1.5" fill="#fbbf24" opacity="0.20"/>
  <circle cx="356" cy="185" r="2" fill="#f59e0b" opacity="0.18"/>
  <!-- Streak lines -->
  <line x1="145" y1="25" x2="132" y2="62" stroke="#fbbf24" stroke-width="0.8" opacity="0.18"/>
  <line x1="365" y1="175" x2="352" y2="208" stroke="#f59e0b" stroke-width="0.7" opacity="0.14"/>
  <line x1="420" y1="38" x2="410" y2="62" stroke="#fcd34d" stroke-width="0.6" opacity="0.12"/>
  <!-- Edge darkening -->
  <rect width="480" height="240" fill="url(#edge-dark)"/>
</svg>`;

const SPARKS_BG = `data:image/svg+xml,${encodeURIComponent(SPARKS_BG_SVG)}`;

export default function RewardsPage() {
  const t = useTranslations("RewardsPage");
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  useEffect(() => { setDaysLeft(getDaysLeft(SPARKS_END_DATE)); }, []);
  const isEnding = daysLeft !== null && daysLeft <= 3;

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
          <p className="text-base text-slate-400 mt-1">{t("subtitle")}</p>
        </div>

        {/* ── ACTIVE CAMPAIGNS ── */}
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
          {t("activeCampaigns")}
        </p>

        <Link href="/app/rewards/sparks" className="block group">
          <div
            className="relative rounded-2xl overflow-hidden border border-amber-500/25 group-hover:border-amber-500/45 transition-all duration-200 group-hover:shadow-[0_0_32px_rgba(245,158,11,0.12)]"
            style={{ backgroundImage: `url("${SPARKS_BG}")`, backgroundSize: "cover", backgroundPosition: "center" }}
          >
            {/* Gradient overlay for readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/10" />

            {/* Card content */}
            <div className="relative z-10 p-6">
              {/* Badges row */}
              <div className="flex items-center gap-2 mb-7">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                  Devnet
                </span>
                {daysLeft !== null && (
                  daysLeft === 0 ? (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/25 text-red-400 border border-red-500/30">
                      {t("endsToday")}
                    </span>
                  ) : (
                    <span
                      className={[
                        "text-xs font-bold px-2.5 py-1 rounded-full border",
                        isEnding
                          ? "bg-red-500/20 text-red-400 border-red-500/25"
                          : "bg-black/30 text-slate-300 border-white/15",
                      ].join(" ")}
                    >
                      {t("daysLeft", { days: daysLeft })}
                    </span>
                  )
                )}
              </div>

              {/* Campaign title */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-4xl leading-none">⚡</span>
                <h2 className="text-2xl font-bold text-white leading-tight">
                  {t("sparksTitle")} Campaign
                </h2>
              </div>

              {/* Description */}
              <p className="text-base text-slate-300 mb-6 leading-relaxed">
                {t("sparksDescription")}
              </p>

              {/* Reward + CTA */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs font-semibold text-amber-500/70 uppercase tracking-wider mb-1">
                    Total reward pool
                  </p>
                  <p className="text-3xl font-bold text-amber-400 leading-none">
                    10,000 ⚡
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-base font-semibold text-slate-300 group-hover:text-white transition-colors pb-0.5">
                  <span>View quests</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="group-hover:translate-x-0.5 transition-transform"
                  >
                    <path
                      d="M6 12l4-4-4-4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </Link>

        {/* ── COMING SOON ── */}
        <div className="mt-10">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
            {t("comingSoon")}
          </p>

          <div className="rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.025]">
            <div className="p-6 opacity-40">
              {/* Badges row */}
              <div className="flex items-center gap-2 mb-7">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10 text-slate-400 border border-white/10">
                  {t("comingSoon")}
                </span>
              </div>

              {/* Title */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-4xl leading-none">🔮</span>
                <h2 className="text-2xl font-bold text-slate-300 leading-tight">
                  {t("nextCampaign")}
                </h2>
              </div>

              {/* Description */}
              <p className="text-base text-slate-500 mb-6 leading-relaxed">
                {t("nextCampaignSubtitle")}
              </p>

              {/* Reward placeholder */}
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Total reward pool
                </p>
                <p className="text-3xl font-bold text-slate-600 leading-none">
                  ??? ⭐
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
