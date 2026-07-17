"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

// Campaign ended July 1 2026 at 18:00 CET (CEST = UTC+2) = 16:00 UTC
const SPARKS_END_DATE = new Date("2026-07-01T16:00:00.000Z");
// Blink campaign: July 2 at 2pm CET (UTC+2 in summer = UTC 12:00)
const BLINK_START_DATE = new Date("2026-07-02T12:00:00.000Z");
const BLINK_END_DATE = new Date("2026-08-15T00:00:00.000Z");
// Megapot campaign: July 7 at 5pm CET (UTC+2 in summer = UTC 15:00) — through Aug 30
const MEGAPOT_START_DATE = new Date("2026-07-07T15:00:00.000Z");
const MEGAPOT_END_DATE = new Date("2026-08-31T00:00:00.000Z");
const MEGAPOT_ACCENT = "#5EEAD4";
// Get Paid campaign: 2 weeks starting Jul 9 2026
const GETPAID_START_DATE = new Date("2026-07-09T00:00:00.000Z");
const GETPAID_END_DATE = new Date("2026-07-23T00:00:00.000Z");
const GETPAID_ACCENT = "#4ADE80";
const MAGICBLOCK_ACCENT = "#f97316"; // Loofta primary brand orange (--primary in globals.css)

function getDaysLeft(endDate: Date): number {
  const now = new Date();
  const diff = endDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getDaysUntil(date: Date): number {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// Sparks background — amber/lightning style
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
  <rect width="480" height="240" fill="#0c0700"/>
  <line x1="0" y1="80" x2="480" y2="80" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <line x1="0" y1="160" x2="480" y2="160" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <line x1="160" y1="0" x2="160" y2="240" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <line x1="320" y1="0" x2="320" y2="240" stroke="#f59e0b" stroke-width="0.3" opacity="0.06"/>
  <ellipse cx="240" cy="130" rx="240" ry="160" fill="url(#center-glow)"/>
  <path d="M252,18 L228,102 L246,102 L218,210 L258,118 L238,118 L265,18Z" fill="#f59e0b" opacity="0.12" filter="url(#blur-bolt)"/>
  <path d="M252,18 L228,102 L246,102 L218,210 L258,118 L238,118 L265,18Z" fill="#fbbf24" opacity="0.16"/>
  <path d="M88,50 L74,98 L84,98 L66,148 L90,108 L80,108 L95,50Z" fill="#f59e0b" opacity="0.13"/>
  <path d="M375,65 L364,100 L372,100 L357,138 L377,108 L368,108 L382,65Z" fill="#f59e0b" opacity="0.11"/>
  <path d="M428,20 L422,42 L427,42 L418,65 L430,44 L424,44 L434,20Z" fill="#fcd34d" opacity="0.10"/>
  <path d="M42,158 L36,178 L41,178 L32,200 L44,180 L38,180 L48,158Z" fill="#f59e0b" opacity="0.09"/>
  <path d="M30,38 L25,55 L30,55 L22,74 L33,57 L28,57 L36,38Z" fill="#fcd34d" opacity="0.08"/>
  <circle cx="168" cy="42" r="2.5" fill="#fbbf24" opacity="0.40"/>
  <circle cx="310" cy="55" r="2" fill="#fbbf24" opacity="0.35"/>
  <circle cx="400" cy="148" r="3" fill="#f59e0b" opacity="0.28"/>
  <circle cx="100" cy="132" r="2" fill="#fcd34d" opacity="0.32"/>
  <circle cx="200" cy="190" r="2.5" fill="#fbbf24" opacity="0.22"/>
  <circle cx="440" cy="92" r="1.5" fill="#f59e0b" opacity="0.28"/>
  <circle cx="50" cy="88" r="2" fill="#fcd34d" opacity="0.24"/>
  <circle cx="140" cy="168" r="1.5" fill="#fbbf24" opacity="0.20"/>
  <circle cx="356" cy="185" r="2" fill="#f59e0b" opacity="0.18"/>
  <line x1="145" y1="25" x2="132" y2="62" stroke="#fbbf24" stroke-width="0.8" opacity="0.18"/>
  <line x1="365" y1="175" x2="352" y2="208" stroke="#f59e0b" stroke-width="0.7" opacity="0.14"/>
  <line x1="420" y1="38" x2="410" y2="62" stroke="#fcd34d" stroke-width="0.6" opacity="0.12"/>
  <rect width="480" height="240" fill="url(#edge-dark)"/>
</svg>`;

const SPARKS_BG = `data:image/svg+xml,${encodeURIComponent(SPARKS_BG_SVG)}`;

// Blink background — dark/geometric with yellow glow
const BLINK_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="blink-glow" cx="70%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#F7C948" stop-opacity="0.22"/>
      <stop offset="70%" stop-color="#F7C948" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blink-edge" cx="50%" cy="50%" r="75%">
      <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.70"/>
    </radialGradient>
  </defs>
  <rect width="480" height="240" fill="#080600"/>
  <!-- Subtle diagonal grid -->
  <line x1="0" y1="0" x2="480" y2="240" stroke="#F7C948" stroke-width="0.4" opacity="0.04"/>
  <line x1="120" y1="0" x2="480" y2="160" stroke="#F7C948" stroke-width="0.4" opacity="0.03"/>
  <line x1="240" y1="0" x2="480" y2="80" stroke="#F7C948" stroke-width="0.4" opacity="0.03"/>
  <line x1="0" y1="80" x2="400" y2="240" stroke="#F7C948" stroke-width="0.4" opacity="0.03"/>
  <line x1="0" y1="160" x2="280" y2="240" stroke="#F7C948" stroke-width="0.4" opacity="0.03"/>
  <!-- Horizontal faint lines -->
  <line x1="0" y1="60" x2="480" y2="60" stroke="#F7C948" stroke-width="0.3" opacity="0.05"/>
  <line x1="0" y1="120" x2="480" y2="120" stroke="#F7C948" stroke-width="0.3" opacity="0.05"/>
  <line x1="0" y1="180" x2="480" y2="180" stroke="#F7C948" stroke-width="0.3" opacity="0.05"/>
  <!-- Right-side glow -->
  <ellipse cx="340" cy="100" rx="180" ry="140" fill="url(#blink-glow)"/>
  <!-- Dot sparkles -->
  <circle cx="320" cy="48" r="2" fill="#F7C948" opacity="0.35"/>
  <circle cx="400" cy="85" r="1.5" fill="#F7C948" opacity="0.28"/>
  <circle cx="440" cy="140" r="2.5" fill="#F7C948" opacity="0.22"/>
  <circle cx="380" cy="175" r="1.5" fill="#F7C948" opacity="0.20"/>
  <circle cx="155" cy="32" r="1.5" fill="#F7C948" opacity="0.18"/>
  <circle cx="60" cy="155" r="2" fill="#F7C948" opacity="0.15"/>
  <circle cx="270" cy="200" r="1.5" fill="#F7C948" opacity="0.14"/>
  <!-- Edge darkening -->
  <rect width="480" height="240" fill="url(#blink-edge)"/>
</svg>`;

const BLINK_BG = `data:image/svg+xml,${encodeURIComponent(BLINK_BG_SVG)}`;

// Megapot background — dark/teal jackpot style
const MEGAPOT_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="megapot-glow" cx="70%" cy="35%" r="55%">
      <stop offset="0%" stop-color="${MEGAPOT_ACCENT}" stop-opacity="0.22"/>
      <stop offset="70%" stop-color="${MEGAPOT_ACCENT}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="megapot-edge" cx="50%" cy="50%" r="75%">
      <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.70"/>
    </radialGradient>
  </defs>
  <rect width="480" height="240" fill="#080a09"/>
  <line x1="0" y1="80" x2="480" y2="80" stroke="${MEGAPOT_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="0" y1="160" x2="480" y2="160" stroke="${MEGAPOT_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="160" y1="0" x2="160" y2="240" stroke="${MEGAPOT_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="320" y1="0" x2="320" y2="240" stroke="${MEGAPOT_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <ellipse cx="340" cy="110" rx="220" ry="150" fill="url(#megapot-glow)"/>
  <circle cx="330" cy="55" r="2.5" fill="${MEGAPOT_ACCENT}" opacity="0.40"/>
  <circle cx="410" cy="90" r="2" fill="${MEGAPOT_ACCENT}" opacity="0.32"/>
  <circle cx="440" cy="150" r="2.5" fill="${MEGAPOT_ACCENT}" opacity="0.26"/>
  <circle cx="100" cy="132" r="2" fill="${MEGAPOT_ACCENT}" opacity="0.20"/>
  <circle cx="60" cy="60" r="1.5" fill="${MEGAPOT_ACCENT}" opacity="0.18"/>
  <circle cx="200" cy="190" r="2" fill="${MEGAPOT_ACCENT}" opacity="0.16"/>
  <rect width="480" height="240" fill="url(#megapot-edge)"/>
</svg>`;

const MEGAPOT_BG = `data:image/svg+xml,${encodeURIComponent(MEGAPOT_BG_SVG)}`;

// Get Paid background — dark/green cash style
const GETPAID_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="getpaid-glow" cx="70%" cy="35%" r="55%">
      <stop offset="0%" stop-color="${GETPAID_ACCENT}" stop-opacity="0.22"/>
      <stop offset="70%" stop-color="${GETPAID_ACCENT}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="getpaid-edge" cx="50%" cy="50%" r="75%">
      <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.70"/>
    </radialGradient>
  </defs>
  <rect width="480" height="240" fill="#080a09"/>
  <line x1="0" y1="80" x2="480" y2="80" stroke="${GETPAID_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="0" y1="160" x2="480" y2="160" stroke="${GETPAID_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="160" y1="0" x2="160" y2="240" stroke="${GETPAID_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="320" y1="0" x2="320" y2="240" stroke="${GETPAID_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <ellipse cx="340" cy="110" rx="220" ry="150" fill="url(#getpaid-glow)"/>
  <circle cx="330" cy="55" r="2.5" fill="${GETPAID_ACCENT}" opacity="0.40"/>
  <circle cx="410" cy="90" r="2" fill="${GETPAID_ACCENT}" opacity="0.32"/>
  <circle cx="440" cy="150" r="2.5" fill="${GETPAID_ACCENT}" opacity="0.26"/>
  <circle cx="100" cy="132" r="2" fill="${GETPAID_ACCENT}" opacity="0.20"/>
  <circle cx="60" cy="60" r="1.5" fill="${GETPAID_ACCENT}" opacity="0.18"/>
  <circle cx="200" cy="190" r="2" fill="${GETPAID_ACCENT}" opacity="0.16"/>
  <rect width="480" height="240" fill="url(#getpaid-edge)"/>
</svg>`;

const GETPAID_BG = `data:image/svg+xml,${encodeURIComponent(GETPAID_BG_SVG)}`;

// MagicBlock Quests background — dark/violet style
const MAGICBLOCK_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="magicblock-glow" cx="70%" cy="35%" r="55%">
      <stop offset="0%" stop-color="${MAGICBLOCK_ACCENT}" stop-opacity="0.22"/>
      <stop offset="70%" stop-color="${MAGICBLOCK_ACCENT}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="magicblock-edge" cx="50%" cy="50%" r="75%">
      <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.70"/>
    </radialGradient>
  </defs>
  <rect width="480" height="240" fill="#0a0a0f"/>
  <line x1="0" y1="80" x2="480" y2="80" stroke="${MAGICBLOCK_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="0" y1="160" x2="480" y2="160" stroke="${MAGICBLOCK_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="160" y1="0" x2="160" y2="240" stroke="${MAGICBLOCK_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <line x1="320" y1="0" x2="320" y2="240" stroke="${MAGICBLOCK_ACCENT}" stroke-width="0.3" opacity="0.06"/>
  <ellipse cx="340" cy="110" rx="220" ry="150" fill="url(#magicblock-glow)"/>
  <circle cx="330" cy="55" r="2.5" fill="${MAGICBLOCK_ACCENT}" opacity="0.40"/>
  <circle cx="410" cy="90" r="2" fill="${MAGICBLOCK_ACCENT}" opacity="0.32"/>
  <circle cx="440" cy="150" r="2.5" fill="${MAGICBLOCK_ACCENT}" opacity="0.26"/>
  <circle cx="100" cy="132" r="2" fill="${MAGICBLOCK_ACCENT}" opacity="0.20"/>
  <circle cx="60" cy="60" r="1.5" fill="${MAGICBLOCK_ACCENT}" opacity="0.18"/>
  <circle cx="200" cy="190" r="2" fill="${MAGICBLOCK_ACCENT}" opacity="0.16"/>
  <rect width="480" height="240" fill="url(#magicblock-edge)"/>
</svg>`;

const MAGICBLOCK_BG = `data:image/svg+xml,${encodeURIComponent(MAGICBLOCK_BG_SVG)}`;


export default function RewardsPage() {
  const t = useTranslations("RewardsPage");

  const [sparksEnded, setSparksEnded] = useState(false);
  const [blinkDaysLeft, setBlinkDaysLeft] = useState<number | null>(null);
  const [blinkActive, setBlinkActive] = useState(false);
  const [megapotDaysLeft, setMegapotDaysLeft] = useState<number | null>(null);
  const [megapotActive, setMegapotActive] = useState(false);
  const [getpaidDaysLeft, setGetpaidDaysLeft] = useState<number | null>(null);
  const [getpaidActive, setGetpaidActive] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    const now = new Date();
    setSparksEnded(now >= SPARKS_END_DATE);
    setBlinkDaysLeft(getDaysLeft(BLINK_END_DATE));
    setBlinkActive(now >= BLINK_START_DATE);
    setMegapotDaysLeft(getDaysLeft(MEGAPOT_END_DATE));
    setMegapotActive(now >= MEGAPOT_START_DATE);
    setGetpaidDaysLeft(getDaysLeft(GETPAID_END_DATE));
    setGetpaidActive(now >= GETPAID_START_DATE);
    setIsLocalhost(window.location.hostname === "localhost");
  }, []);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
          <p className="text-base text-slate-400 mt-1">{t("subtitle")}</p>
        </div>

        {/* ── ACTIVE CAMPAIGNS ── */}
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">
          {t("activeCampaigns")}
        </p>

        {/* Get Paid Campaign */}
        {(() => {
            const getpaidClickable = getpaidActive || isLocalhost;
            const getpaidCard = (
            <div
              className="relative rounded-2xl overflow-hidden border transition-all duration-200"
              style={{
                backgroundImage: `url("${GETPAID_BG}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderColor: `${GETPAID_ACCENT}33`,
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/15" />

              <div className="relative z-10 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <span
                    className="text-sm font-bold px-2.5 py-1 rounded-full border"
                    style={{ backgroundColor: `${GETPAID_ACCENT}26`, color: GETPAID_ACCENT, borderColor: `${GETPAID_ACCENT}40` }}
                  >
                    Mainnet
                  </span>
                  {getpaidDaysLeft !== null && (
                    <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-black/30 text-slate-400 border border-white/10">
                      Ends in {getpaidDaysLeft}d
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Image
                    src="/loofta-white.svg"
                    alt="Loofta"
                    width={72}
                    height={20}
                    priority
                    className="opacity-90"
                  />
                </div>

                <h2 className="text-2xl font-bold text-white leading-tight mb-2">
                  Get Paid Campaign
                </h2>

                <p className="text-base text-slate-300 mb-5 leading-relaxed">
                  Create a payment link, share it with someone, and get paid through it — 3 people who qualify each win $20.
                </p>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: `${GETPAID_ACCENT}99` }}>
                      Prize
                    </p>
                    <p className="text-3xl font-bold leading-none" style={{ color: GETPAID_ACCENT }}>
                      $20 × 3
                    </p>
                  </div>
                  {getpaidClickable && (
                    <div className="flex items-center gap-1.5 text-base font-semibold text-slate-300 group-hover:text-white transition-colors pb-0.5">
                      <span>View quest</span>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:translate-x-0.5 transition-transform">
                        <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
            return getpaidClickable
              ? <Link href="/rewards/getpaid" className="block group">{getpaidCard}</Link>
              : <div className="block">{getpaidCard}</div>;
        })()}

        {/* Blink Campaign */}
        <div className="mt-4">
        {(() => {
          const blinkClickable = blinkActive || isLocalhost;
          const blinkCard = (
          <div
            className="relative rounded-2xl overflow-hidden border border-[#F7C948]/20 group-hover:border-[#F7C948]/40 transition-all duration-200 group-hover:shadow-[0_0_32px_rgba(247,201,72,0.10)]"
            style={{ backgroundImage: `url("${BLINK_BG}")`, backgroundSize: "cover", backgroundPosition: "center" }}
          >
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/15" />

            {/* Blink icon watermark — top right */}
            <div className="absolute top-4 right-4 w-28 h-28 opacity-[0.12] pointer-events-none select-none">
              <Image
                src="/images/blink/icon-yellow.png"
                alt=""
                fill
                priority
                className="object-contain"
              />
            </div>

            <div className="relative z-10 p-6">
              {/* Badges */}
              <div className="flex items-center gap-2 mb-6">
                <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-[#F7C948]/15 text-[#F7C948] border border-[#F7C948]/25">
                  Mainnet
                </span>
                {blinkDaysLeft !== null && (
                  <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-black/30 text-slate-400 border border-white/10">
                    Ends Aug 15
                  </span>
                )}
              </div>

              {/* Loofta x Blink branding */}
              <div className="flex items-center gap-2 mb-3">
                <Image
                  src="/loofta-white.svg"
                  alt="Loofta"
                  width={72}
                  height={20}
                  priority
                  className="opacity-90"
                />
                <span className="text-slate-500 font-light text-lg">×</span>
                <Image
                  src="/images/blink/logo-white.png"
                  alt="Blink"
                  width={64}
                  height={20}
                  priority
                  className="opacity-90 object-contain"
                />
              </div>

              {/* Campaign title */}
              <h2 className="text-2xl font-bold text-white leading-tight mb-2">
                Blink Campaign
              </h2>

              {/* Description */}
              <p className="text-base text-slate-300 mb-5 leading-relaxed">
                Complete Blink quests and earn your share of the prize pool — paid out through Loofta.
              </p>

              {/* Reward + CTA */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#F7C948]/60 uppercase tracking-wider mb-1">
                    Total reward pool
                  </p>
                  <p className="text-3xl font-bold text-[#F7C948] leading-none">
                    $2,000
                  </p>
                </div>
                {blinkClickable && (
                  <div className="flex items-center gap-1.5 text-base font-semibold text-slate-300 group-hover:text-white transition-colors pb-0.5">
                    <span>View quests</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:translate-x-0.5 transition-transform">
                      <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
          return blinkClickable
            ? <Link href="/rewards/blink" className="block group">{blinkCard}</Link>
            : <div className="block">{blinkCard}</div>;
        })()}
        </div>

        {/* Megapot Campaign */}
        <div className="mt-4">
          {(() => {
            const megapotClickable = megapotActive || isLocalhost;
            const megapotCard = (
            <div
              className="relative rounded-2xl overflow-hidden border transition-all duration-200"
              style={{
                backgroundImage: `url("${MEGAPOT_BG}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderColor: `${MEGAPOT_ACCENT}33`,
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/15" />

              <div className="relative z-10 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <span
                    className="text-sm font-bold px-2.5 py-1 rounded-full border"
                    style={{ backgroundColor: `${MEGAPOT_ACCENT}26`, color: MEGAPOT_ACCENT, borderColor: `${MEGAPOT_ACCENT}40` }}
                  >
                    Mainnet
                  </span>
                  {megapotDaysLeft !== null && (
                    <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-black/30 text-slate-400 border border-white/10">
                      Ends Aug 30
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Image
                    src="/loofta-white.svg"
                    alt="Loofta"
                    width={72}
                    height={20}
                    priority
                    className="opacity-90"
                  />
                  <span className="text-slate-500 font-light text-lg">×</span>
                  <div className="bg-white rounded-md px-2 py-1 flex items-center">
                    <Image
                      src="/images/megapot/logo.svg"
                      alt="Megapot"
                      width={78}
                      height={15}
                      priority
                      className="object-contain"
                    />
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-white leading-tight mb-2">
                  Megapot Campaign
                </h2>

                <p className="text-base text-slate-300 mb-5 leading-relaxed">
                  Buy 5 lottery tickets privately on Loofta to enter the draw — the prize pool is shared across eligible participants.
                </p>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: `${MEGAPOT_ACCENT}99` }}>
                      Total reward pool
                    </p>
                    <p className="text-3xl font-bold leading-none" style={{ color: MEGAPOT_ACCENT }}>
                      $1,000
                    </p>
                  </div>
                  {megapotClickable && (
                    <div className="flex items-center gap-1.5 text-base font-semibold text-slate-300 group-hover:text-white transition-colors pb-0.5">
                      <span>View quest</span>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:translate-x-0.5 transition-transform">
                        <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
            return megapotClickable
              ? <Link href="/rewards/megapot" className="block group">{megapotCard}</Link>
              : <div className="block">{megapotCard}</div>;
          })()}
        </div>

        {/* MagicBlock Quests — ongoing, no end date */}
        <div className="mt-4">
          <Link href="/rewards/magicblock" className="block group">
            <div
              className="relative rounded-2xl overflow-hidden border transition-all duration-200"
              style={{
                backgroundImage: `url("${MAGICBLOCK_BG}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderColor: `${MAGICBLOCK_ACCENT}33`,
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/15" />

              <div className="relative z-10 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <span
                    className="text-sm font-bold px-2.5 py-1 rounded-full border"
                    style={{ backgroundColor: `${MAGICBLOCK_ACCENT}26`, color: MAGICBLOCK_ACCENT, borderColor: `${MAGICBLOCK_ACCENT}40` }}
                  >
                    Mainnet
                  </span>
                  <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-black/30 text-slate-400 border border-white/10">
                    Ongoing
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Image
                    src="/loofta-white.svg"
                    alt="Loofta"
                    width={72}
                    height={20}
                    priority
                    className="opacity-90"
                  />
                  <span className="text-slate-500 font-light text-lg">×</span>
                  <div className="w-7 h-7 rounded-md bg-white/10 border border-white/15 flex items-center justify-center p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/logo/magicblock-mark.svg" alt="MagicBlock" className="w-full h-full object-contain" />
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-white leading-tight mb-2">
                  MagicBlock Quests
                </h2>

                <p className="text-base text-slate-300 mb-5 leading-relaxed">
                  Connect your MagicBlock wallet once — private ticket purchases and private payments auto-validate, no clicks needed.
                </p>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: `${MAGICBLOCK_ACCENT}99` }}>
                      Quests
                    </p>
                    <p className="text-3xl font-bold leading-none" style={{ color: MAGICBLOCK_ACCENT }}>
                      Repeatable
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-base font-semibold text-slate-300 group-hover:text-white transition-colors pb-0.5">
                    <span>View quests</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:translate-x-0.5 transition-transform">
                      <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* ── ENDED ── */}
        <div className="mt-10">
          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">
            Ended
          </p>

          {/* Sparks Campaign — ended */}
          <Link href="/rewards/sparks" className="block group">
            <div
              className="relative rounded-2xl overflow-hidden border border-white/10 group-hover:border-white/20 transition-all duration-200 opacity-70"
              style={{ backgroundImage: `url("${SPARKS_BG}")`, backgroundSize: "cover", backgroundPosition: "center" }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />
              <div className="relative z-10 p-6">
                <div className="flex items-center gap-2 mb-7">
                  <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                    Devnet
                  </span>
                  <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-white/10 text-slate-400 border border-white/15">
                    Ended
                  </span>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl leading-none">⚡</span>
                  <h2 className="text-2xl font-bold text-white leading-tight">
                    {t("sparksTitle")} Campaign
                  </h2>
                </div>
                <p className="text-base text-slate-400 mb-6 leading-relaxed">
                  {t("sparksDescription")}
                </p>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-500/50 uppercase tracking-wider mb-1">
                      Total reward pool
                    </p>
                    <p className="text-3xl font-bold text-amber-400/60 leading-none">
                      10,000 ⚡
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-base font-semibold text-slate-500 group-hover:text-slate-400 transition-colors pb-0.5">
                    <span>View results</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="group-hover:translate-x-0.5 transition-transform">
                      <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>

      </div>
    </div>
  );
}
