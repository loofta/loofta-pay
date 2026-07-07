"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const MEGAPOT_START_DATE = new Date("2026-07-07T15:00:00.000Z"); // Jul 7 2026, 5pm CET
const MEGAPOT_END_DATE = new Date("2026-08-31T00:00:00.000Z"); // through Aug 30 2026
const REQUIRED_TICKETS = 5;
const ACCENT = "#5EEAD4"; // teal — distinct from Blink's yellow and Sparks' amber

interface MegapotCampaignData {
  ticketsPurchased: number;
  required: number;
  qualified: boolean;
  prizePoolUsd: number;
}

async function fetchMegapotCampaign(token: string | null): Promise<MegapotCampaignData> {
  const res = await fetch(`${BACKEND_URL}/rewards/megapot/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load Megapot campaign");
  return res.json();
}

function getDaysLeft(date: Date): number {
  const diff = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="mt-2.5">
      <div className="flex justify-between items-center mb-1">
        <span className="text-base text-slate-400">{value} / {max} tickets</span>
        <span className="text-base text-slate-400">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: ACCENT }}
        />
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4 mt-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
    </div>
  );
}

function CampaignHeader({ daysLeft }: { daysLeft: number | null }) {
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 180" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="mh-glow" cx="70%" cy="40%" r="50%">
        <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="mh-edge" cx="50%" cy="50%" r="75%">
        <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>
      </radialGradient>
    </defs>
    <rect width="480" height="180" fill="#080a09"/>
    <line x1="0" y1="0" x2="480" y2="180" stroke="${ACCENT}" stroke-width="0.4" opacity="0.05"/>
    <line x1="120" y1="0" x2="480" y2="120" stroke="${ACCENT}" stroke-width="0.4" opacity="0.04"/>
    <line x1="0" y1="60" x2="480" y2="60" stroke="${ACCENT}" stroke-width="0.3" opacity="0.05"/>
    <line x1="0" y1="120" x2="480" y2="120" stroke="${ACCENT}" stroke-width="0.3" opacity="0.05"/>
    <ellipse cx="340" cy="80" rx="180" ry="120" fill="url(#mh-glow)"/>
    <circle cx="320" cy="38" r="2" fill="${ACCENT}" opacity="0.4"/>
    <circle cx="400" cy="70" r="1.5" fill="${ACCENT}" opacity="0.3"/>
    <circle cx="440" cy="120" r="2.5" fill="${ACCENT}" opacity="0.25"/>
    <rect width="480" height="180" fill="url(#mh-edge)"/>
  </svg>`;
  const bg = `data:image/svg+xml,${encodeURIComponent(bgSvg)}`;

  return (
    <div
      className="relative rounded-2xl overflow-hidden border mb-6"
      style={{ backgroundImage: `url("${bg}")`, backgroundSize: "cover", borderColor: `${ACCENT}33` }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />
      <div className="relative z-10 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full border"
            style={{ backgroundColor: `${ACCENT}26`, color: ACCENT, borderColor: `${ACCENT}40` }}
          >
            Mainnet
          </span>
          {daysLeft !== null && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-black/30 text-slate-300 border border-white/15">
              Ends in {daysLeft}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Image src="/loofta-white.svg" alt="Loofta" width={64} height={18} priority className="opacity-90" />
          <span className="text-slate-500 font-light">×</span>
          <div className="bg-white rounded-md px-2 py-1 flex items-center">
            <Image src="/images/megapot/logo.svg" alt="Megapot" width={70} height={13} priority className="object-contain" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">Megapot Campaign</h1>
        <p className="text-base text-slate-300 mb-4 leading-relaxed">
          Buy at least {REQUIRED_TICKETS} lottery tickets privately on Loofta to enter the draw.
          The prize pool is split among eligible participants in a lucky draw after the campaign ends.
        </p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: `${ACCENT}99` }}>
            Total reward pool
          </p>
          <p className="text-3xl font-bold leading-none" style={{ color: ACCENT }}>$1,000</p>
        </div>
      </div>
    </div>
  );
}

export default function RewardsMegapotPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin, getAccessToken } = usePrivy();

  const [isActive, setIsActive] = useState(false);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    setIsActive(Date.now() >= MEGAPOT_START_DATE.getTime());
    setDaysLeft(getDaysLeft(MEGAPOT_END_DATE));
  }, []);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["megapot-campaign", userId],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      return fetchMegapotCampaign(token);
    },
    enabled: Boolean(authenticated && userId && isActive),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link
            href="/rewards"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} />
            <span>Back to rewards</span>
          </Link>
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <CampaignHeader daysLeft={isActive ? daysLeft : null} />

          {!authenticated ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <div className="text-4xl mb-3">🎟️</div>
              <p className="text-lg font-semibold text-white mb-1">Sign in to participate</p>
              <p className="text-base text-slate-400 mb-4">
                Connect your account to track your ticket count and enter the draw.
              </p>
              <button
                type="button"
                onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
                className="rounded-xl px-5 py-2.5 font-semibold text-black hover:opacity-90 transition-opacity"
                style={{ backgroundColor: ACCENT }}
              >
                Sign in
              </button>
            </div>
          ) : !isActive ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-base text-slate-400">Campaign starts Jul 7 · 5pm CET</p>
            </div>
          ) : isLoading ? (
            <Skeleton />
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
              <p className="text-red-400 text-base">{(error as Error)?.message ?? "Failed to load quest"}</p>
              <button type="button" onClick={() => refetch()} className="mt-3 text-base text-slate-400 hover:text-white underline">
                Try again
              </button>
            </div>
          ) : data ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Quest</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  aria-label="Refresh"
                >
                  <svg
                    width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                    className={isFetching ? "animate-spin" : ""}
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                </button>
              </div>

              <div
                className={[
                  "rounded-2xl border p-4 transition-all",
                  data.qualified ? "bg-white/5" : "bg-white/5 border-white/10",
                ].join(" ")}
                style={data.qualified ? { backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}40` } : undefined}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg border"
                    style={data.qualified
                      ? { backgroundColor: `${ACCENT}33`, borderColor: `${ACCENT}4d` }
                      : { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.1)" }}
                  >
                    {data.qualified ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span>🎟️</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-lg font-semibold leading-tight ${data.qualified ? "text-white" : "text-slate-200"}`}>
                      Buy {REQUIRED_TICKETS} lottery tickets privately
                    </p>
                    <p className="text-base text-slate-400 mt-0.5 leading-snug">
                      Purchase Megapot tickets using a private payment on Loofta — spread across as many purchases as you like.
                    </p>
                    <ProgressBar value={Math.min(data.ticketsPurchased, REQUIRED_TICKETS)} max={REQUIRED_TICKETS} />
                  </div>
                </div>
              </div>

              <Link
                href="/megapot"
                className="mt-4 block text-center rounded-xl px-5 py-3 font-semibold text-black hover:opacity-90 transition-opacity"
                style={{ backgroundColor: ACCENT }}
              >
                Buy Megapot tickets
              </Link>

              {data.qualified && (
                <div
                  className="mt-6 rounded-2xl border p-5 text-center"
                  style={{ backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}4d` }}
                >
                  <div className="text-3xl mb-2">🏆</div>
                  <p className="font-semibold text-lg" style={{ color: ACCENT }}>You&apos;re entered in the draw!</p>
                  <p className="text-slate-400 text-base mt-1">
                    The $1,000 prize pool is shared across all eligible participants in a lucky draw once the campaign ends on Aug 30.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
