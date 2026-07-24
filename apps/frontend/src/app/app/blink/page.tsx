"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { useState, useEffect, useMemo } from "react";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const BLINK_START_DATE = new Date("2026-07-02T12:00:00.000Z");
const BLINK_END_DATE = new Date("2026-08-15T00:00:00.000Z");

type BlinkTaskKey = "setup_passkeys" | "two_deposits" | "two_private_payments";

interface BlinkTaskStatus {
  key: BlinkTaskKey;
  label: string;
  description: string;
  completed: boolean;
  progress?: number;
  total?: number;
}

interface BlinkCampaignData {
  tasks: BlinkTaskStatus[];
  qualified: boolean;
}

const TASK_META: Record<BlinkTaskKey, { icon: string; demoLink?: string }> = {
  setup_passkeys: { icon: "🔑", demoLink: "https://x.com/looftapay/status/2072671554010264051" },
  two_deposits: { icon: "💳" },
  two_private_payments: { icon: "🔒" },
};

async function fetchBlinkCampaign(token: string | null, solanaAddress: string | null): Promise<BlinkCampaignData> {
  const url = new URL(`${BACKEND_URL}/rewards/blink/me`);
  if (solanaAddress) url.searchParams.set("address", solanaAddress);
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load Blink campaign");
  return res.json();
}

function getDaysUntil(date: Date): number {
  const diff = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
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
        <span className="text-base text-slate-400">{value} / {max}</span>
        <span className="text-base text-slate-400">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#F7C948] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: BlinkTaskStatus }) {
  const showProgress = !task.completed && task.progress !== undefined && task.total !== undefined;
  const meta = TASK_META[task.key];

  return (
    <div
      className={[
        "rounded-2xl border p-4 transition-all",
        task.completed
          ? "bg-[#F7C948]/8 border-[#F7C948]/25"
          : "bg-white/5 border-white/10",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={[
              "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg",
              task.completed
                ? "bg-[#F7C948]/20 border border-[#F7C948]/30"
                : "bg-white/8 border border-white/10",
            ].join(" ")}
          >
            {task.completed ? (
              <svg
                width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                className="text-[#F7C948]"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <span>{meta.icon}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-lg font-semibold leading-tight ${task.completed ? "text-white" : "text-slate-200"}`}>
              {task.label}
            </p>
            <p className="text-base text-slate-400 mt-0.5 leading-snug">
              {task.description}
            </p>
            {meta.demoLink && (
              <a
                href={meta.demoLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-sm text-[#F7C948]/70 hover:text-[#F7C948] transition-colors"
              >
                Watch demo →
              </a>
            )}
            {showProgress && (
              <ProgressBar value={task.progress!} max={task.total!} />
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {task.completed && (
            <p className="text-base text-[#F7C948]/70 mt-0.5">Done ✓</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4 mt-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4 h-20" />
      ))}
    </div>
  );
}

// Countdown until campaign starts
function Countdown({ target }: { target: Date }) {
  const [diff, setDiff] = useState(target.getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => setDiff(target.getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const total = Math.max(0, diff);
  const d = Math.floor(total / 86400000);
  const h = Math.floor((total % 86400000) / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);

  return (
    <div className="flex items-center justify-center gap-3 my-2">
      {[{ v: d, l: "days" }, { v: h, l: "hrs" }, { v: m, l: "min" }, { v: s, l: "sec" }].map(({ v, l }) => (
        <div key={l} className="text-center">
          <p className="text-3xl font-bold text-white tabular-nums leading-none">{String(v).padStart(2, "0")}</p>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">{l}</p>
        </div>
      ))}
    </div>
  );
}

// Campaign header banner
function CampaignHeader({ daysLeft }: { daysLeft: number | null }) {
  const BLINK_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 180" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="bh-glow" cx="70%" cy="40%" r="50%">
        <stop offset="0%" stop-color="#F7C948" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="bh-edge" cx="50%" cy="50%" r="75%">
        <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>
      </radialGradient>
    </defs>
    <rect width="480" height="180" fill="#080600"/>
    <line x1="0" y1="0" x2="480" y2="180" stroke="#F7C948" stroke-width="0.4" opacity="0.04"/>
    <line x1="120" y1="0" x2="480" y2="120" stroke="#F7C948" stroke-width="0.4" opacity="0.03"/>
    <line x1="0" y1="60" x2="480" y2="60" stroke="#F7C948" stroke-width="0.3" opacity="0.05"/>
    <line x1="0" y1="120" x2="480" y2="120" stroke="#F7C948" stroke-width="0.3" opacity="0.05"/>
    <ellipse cx="340" cy="80" rx="180" ry="120" fill="url(#bh-glow)"/>
    <circle cx="320" cy="38" r="2" fill="#F7C948" opacity="0.35"/>
    <circle cx="400" cy="70" r="1.5" fill="#F7C948" opacity="0.28"/>
    <circle cx="440" cy="120" r="2.5" fill="#F7C948" opacity="0.22"/>
    <rect width="480" height="180" fill="url(#bh-edge)"/>
  </svg>`;
  const bg = `data:image/svg+xml,${encodeURIComponent(BLINK_BG_SVG)}`;

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-[#F7C948]/20 mb-6"
      style={{ backgroundImage: `url("${bg}")`, backgroundSize: "cover" }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />
      <div className="absolute top-3 right-3 w-20 h-20 opacity-[0.10] pointer-events-none">
        <Image src="/images/blink/icon-yellow.png" alt="" fill priority className="object-contain" />
      </div>
      <div className="relative z-10 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-[#F7C948]/15 text-[#F7C948] border border-[#F7C948]/25">
            Mainnet
          </span>
          {daysLeft !== null && (
            <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-black/30 text-slate-300 border border-white/15">
              Ends in {daysLeft}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <Image src="/loofta-white.svg" alt="Loofta" width={64} height={18} priority className="opacity-90" />
          <span className="text-slate-500 font-light">×</span>
          <Image src="/images/blink/logo-white.png" alt="Blink" width={56} height={18} priority className="opacity-90 object-contain" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">Blink Campaign</h1>
        <p className="text-base text-slate-300 mb-4 leading-relaxed">
          Complete Blink & Loofta quests and earn your share of the prize pool.
          Prizes are paid out directly through Loofta.
        </p>
        <div>
          <p className="text-sm font-semibold text-[#F7C948]/60 uppercase tracking-wider mb-1">
            Total reward pool
          </p>
          <p className="text-3xl font-bold text-[#F7C948] leading-none">$2,000</p>
        </div>
      </div>
    </div>
  );
}

export default function BlinkCampaignPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin, getAccessToken, user } = usePrivy();
  const { wallets: solanaWallets, ready: walletsReady } = useWallets();
  const solanaAddress = useMemo(
    () => deriveSolanaEmbeddedAddress(user) ?? solanaWallets[0]?.address ?? null,
    [user, solanaWallets],
  );

  const [isActive, setIsActive] = useState(false);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    setIsActive(Date.now() >= BLINK_START_DATE.getTime());
    setDaysLeft(getDaysLeft(BLINK_END_DATE));
  }, []);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["blink-campaign", userId, solanaAddress],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      return fetchBlinkCampaign(token, solanaAddress);
    },
    enabled: Boolean(authenticated && userId && isActive && walletsReady),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Not signed in
  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <CampaignHeader daysLeft={daysLeft} />
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
            <div className="text-4xl mb-3">🔑</div>
            <p className="text-lg font-semibold text-white mb-1">Sign in to participate</p>
            <p className="text-base text-slate-400 mb-4">
              Connect your account to track quest completion and claim rewards.
            </p>
            <button
              type="button"
              onClick={() => privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
              className="rounded-xl px-5 py-2.5 font-semibold bg-[#F7C948] text-black hover:opacity-90 transition-opacity"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Campaign not started yet
  if (!isActive) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <CampaignHeader daysLeft={null} />

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center mb-6">
            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Campaign starts in</p>
            <Countdown target={BLINK_START_DATE} />
            <p className="text-base text-slate-400 mt-4">Jul 1 · 3pm CET — Aug 15, 2026</p>
          </div>

          {/* Quest preview — locked */}
          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Quests</p>
          <div className="space-y-3">
            {(
              [
                { key: "setup_passkeys", label: "Set up Blink with passkeys", description: "Go to your balance, tap Top up, and deposit with Blink — this creates your Blink account and passkeys." },
                { key: "two_deposits", label: "Make at least 2 deposits with Blink", description: "Deposit funds into your Blink wallet twice during the campaign. Make sure you have enough to cover private payments." },
                { key: "two_private_payments", label: "Send 2 mainnet private payments", description: "Send at least 2 private payments on Loofta mainnet (min $5 each)" },
              ] as { key: BlinkTaskKey; label: string; description: string }[]
            ).map((task) => (
              <div
                key={task.key}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 opacity-50"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg">
                    {TASK_META[task.key].icon}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-300">{task.label}</p>
                    <p className="text-base text-slate-500 mt-0.5">{task.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Campaign active
  const completedCount = data?.tasks.filter((t) => t.completed).length ?? 0;
  const totalCount = data?.tasks.length ?? 3;

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <CampaignHeader daysLeft={daysLeft} />

        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <p className="text-red-400 text-base">
              {(error as Error)?.message ?? "Failed to load quests"}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 text-base text-slate-400 hover:text-white underline"
            >
              Try again
            </button>
          </div>
        ) : data ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Quests</p>
              <div className="flex items-center gap-2">
                <p className="text-base text-slate-500">{completedCount}/{totalCount} completed</p>
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
            </div>

            <div className="space-y-3">
              {data.tasks.map((task) => (
                <TaskCard key={task.key} task={task} />
              ))}
            </div>

            {data.qualified && (
              <div className="mt-6 rounded-2xl border border-[#F7C948]/30 bg-[#F7C948]/8 p-5 text-center">
                <div className="text-3xl mb-2">🏆</div>
                <p className="text-[#F7C948] font-semibold text-lg">You qualify!</p>
                <p className="text-slate-400 text-base mt-1">
                  All quests complete. Your reward will be sent through Loofta once the campaign ends on Aug 15.
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
