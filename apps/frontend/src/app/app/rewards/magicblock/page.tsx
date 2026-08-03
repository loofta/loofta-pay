"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ACCENT = "#f97316"; // Loofta primary brand orange (--primary in globals.css)
const MAGICBLOCK_PROJECT_URL = "https://quests.magicblock.app/projects/loofta-pay";

type MagicblockQuestType = "lottery_ticket" | "private_payment";

interface MagicblockQuestStatusItem {
  questType: MagicblockQuestType;
  questId: number;
  completions: number;
  lastPushedAt: string | null;
  lastError: string | null;
}

interface MagicblockQuestStatus {
  wallet: string | null;
  quests: MagicblockQuestStatusItem[];
  resetsAt: string;
}

const QUEST_COPY: Record<MagicblockQuestType, { title: string; description: string; icon: string; ctaLabel: string; ctaHref: string }> = {
  lottery_ticket: {
    title: "Purchase 1 lottery ticket privately",
    description: "Buy a Megapot ticket using a private payment on Loofta.",
    icon: "🎟️",
    ctaLabel: "Buy a ticket",
    ctaHref: "/megapot",
  },
  private_payment: {
    title: "Make 1 private payment",
    description: "Send any private payment to someone on Loofta.",
    icon: "🔒",
    ctaLabel: "Send a private payment",
    ctaHref: "/",
  },
};

async function fetchMagicblockQuestStatus(token: string | null): Promise<MagicblockQuestStatus> {
  console.info("[MagicblockQuest] GET /rewards/magicblock/me", { hasToken: !!token });
  const res = await fetch(`${BACKEND_URL}/rewards/magicblock/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json().catch((e) => {
    console.error("[MagicblockQuest] response was not valid JSON:", e);
    return null;
  });
  if (!res.ok) {
    console.error("[MagicblockQuest] fetch failed", { status: res.status, body });
    throw new Error("Failed to load MagicBlock quests");
  }
  console.info("[MagicblockQuest] status", {
    wallet: body?.wallet,
    resetsAt: body?.resetsAt,
    quests: body?.quests?.map((q: MagicblockQuestStatusItem) => ({
      questType: q.questType,
      questId: q.questId,
      completions: q.completions,
      lastPushedAt: q.lastPushedAt,
      lastError: q.lastError,
    })),
  });
  return body;
}

async function connectMagicblockWallet(token: string | null, wallet: string): Promise<{ wallet: string }> {
  const res = await fetch(`${BACKEND_URL}/rewards/magicblock/wallet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ wallet }),
  });
  const data = await res.json().catch(() => ({}));
  console.info("[MagicblockQuest] POST /rewards/magicblock/wallet", { status: res.status, data });
  // 409 = already connected (e.g. a double-submit race) — treat like success, just refetch.
  if (!res.ok && res.status !== 409) {
    throw new Error(data?.message ?? "Failed to connect wallet");
  }
  return data;
}

function truncateWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-6)}` : wallet;
}

function formatLastPushed(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatResetsAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Europe/Paris" });
}

function Header() {
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 180" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="mb-glow" cx="70%" cy="40%" r="50%">
        <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="mb-edge" cx="50%" cy="50%" r="75%">
        <stop offset="35%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>
      </radialGradient>
    </defs>
    <rect width="480" height="180" fill="#0a0a0f"/>
    <line x1="0" y1="0" x2="480" y2="180" stroke="${ACCENT}" stroke-width="0.4" opacity="0.05"/>
    <line x1="120" y1="0" x2="480" y2="120" stroke="${ACCENT}" stroke-width="0.4" opacity="0.04"/>
    <line x1="0" y1="60" x2="480" y2="60" stroke="${ACCENT}" stroke-width="0.3" opacity="0.05"/>
    <line x1="0" y1="120" x2="480" y2="120" stroke="${ACCENT}" stroke-width="0.3" opacity="0.05"/>
    <ellipse cx="340" cy="80" rx="180" ry="120" fill="url(#mb-glow)"/>
    <circle cx="320" cy="38" r="2" fill="${ACCENT}" opacity="0.4"/>
    <circle cx="400" cy="70" r="1.5" fill="${ACCENT}" opacity="0.3"/>
    <circle cx="440" cy="120" r="2.5" fill="${ACCENT}" opacity="0.25"/>
    <rect width="480" height="180" fill="url(#mb-edge)"/>
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
            className="text-sm font-bold px-2.5 py-1 rounded-full border"
            style={{ backgroundColor: `${ACCENT}26`, color: ACCENT, borderColor: `${ACCENT}40` }}
          >
            Mainnet
          </span>
          <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-black/30 text-slate-300 border border-white/15">
            Ongoing
          </span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Image src="/loofta-white.svg" alt="Loofta" width={64} height={18} priority className="opacity-90" />
          <span className="text-slate-500 font-light">×</span>
          <div className="w-6 h-6 rounded-md bg-white/10 border border-white/15 flex items-center justify-center p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo/magicblock-mark.svg" alt="MagicBlock" className="w-full h-full object-contain" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">MagicBlock Quests</h1>
        <p className="text-base text-slate-300 leading-relaxed">
          Connect your MagicBlock wallet once — every qualifying private ticket purchase or private payment
          you make on Loofta is validated automatically, no button clicks needed.
        </p>
      </div>
    </div>
  );
}

function StartQuestLink() {
  return (
    <a
      href={MAGICBLOCK_PROJECT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-4 flex items-center justify-between gap-3 rounded-2xl border p-4 hover:bg-white/[0.07] transition-colors"
      style={{ borderColor: `${ACCENT}40`, backgroundColor: `${ACCENT}14` }}
    >
      <div className="min-w-0">
        <p className="text-base font-semibold text-white">Start the quests on MagicBlock</p>
        <p className="text-sm text-slate-400 mt-0.5">
          Quests must be started there first — track your progress on the Questline.
        </p>
      </div>
      <span className="shrink-0 text-lg" style={{ color: ACCENT }}>→</span>
    </a>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 h-28" />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
    </div>
  );
}

function ConnectWalletForm({ onConnected }: { onConnected: (wallet: string) => void }) {
  const { getAccessToken } = usePrivy();
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const result = await connectMagicblockWallet(token, wallet.trim());
      onConnected(result.wallet ?? wallet.trim());
    } catch (e) {
      setError((e as Error)?.message ?? "Failed to connect wallet");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-lg font-semibold text-white mb-1">Connect your MagicBlock wallet</p>
      <p className="text-base text-slate-400 mb-4 leading-snug">
        First, start both quests on MagicBlock&apos;s Questline with the wallet you&apos;ll paste below —
        the push only works if the quest has already been started there.{" "}
        <a href={MAGICBLOCK_PROJECT_URL} target="_blank" rel="noopener noreferrer" className="text-white underline hover:text-slate-300">
          Start quests on MagicBlock →
        </a>
      </p>

      <p className="text-sm text-slate-300 font-medium mb-1.5">Your MagicBlock wallet address</p>
      <p className="text-sm text-amber-400/90 mb-2">
        This can only be set once — double-check it before submitting. Contact support if you need to change it later.
      </p>
      <input
        type="text"
        value={wallet}
        onChange={(e) => { setWallet(e.target.value); setError(null); }}
        placeholder="e.g. 9CYi7RV2MmRvit6FA44V1yH58mn7GbRpoRny8ZK8Y57Z"
        className="w-full rounded-xl bg-[#1a1a22] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/40 transition-colors font-mono"
      />

      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || wallet.trim().length < 32}
        className="mt-3 w-full rounded-xl px-4 py-2.5 text-base font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ backgroundColor: ACCENT }}
      >
        {submitting ? "Connecting…" : "Connect wallet"}
      </button>
    </div>
  );
}

function QuestCard({ quest }: { quest: MagicblockQuestStatusItem }) {
  const copy = QUEST_COPY[quest.questType];
  const completed = quest.completions > 0;
  const lastPushed = formatLastPushed(quest.lastPushedAt);

  return (
    <div
      className="rounded-2xl border p-4"
      style={completed ? { backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}40` } : { borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.05)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg border"
          style={completed
            ? { backgroundColor: `${ACCENT}33`, borderColor: `${ACCENT}4d` }
            : { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.1)" }}
        >
          {completed ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <span>{copy.icon}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-semibold leading-tight ${completed ? "text-white" : "text-slate-200"}`}>
            {copy.title}
          </p>
          <p className="text-base text-slate-400 mt-0.5 leading-snug">{copy.description}</p>
          {completed ? (
            <p className="text-sm mt-1.5 font-medium" style={{ color: ACCENT }}>
              Completed {quest.completions}× {lastPushed ? `· last ${lastPushed}` : ""}
            </p>
          ) : quest.lastError ? (
            <p className="text-sm text-amber-400 mt-1.5">
              Not validated yet — make sure this quest is started on MagicBlock with the wallet you connected.
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-1.5">Not completed yet</p>
          )}
        </div>
      </div>

      <Link
        href={copy.ctaHref}
        className="mt-4 block text-center rounded-xl px-5 py-3 font-semibold text-black hover:opacity-90 transition-opacity"
        style={{ backgroundColor: ACCENT }}
      >
        {copy.ctaLabel}
      </Link>
    </div>
  );
}

export default function RewardsMagicblockPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin, getAccessToken } = usePrivy();
  const queryClient = useQueryClient();

  // Every GET /me makes the backend retry any previously-failed quest push. On a fresh page
  // load, poll a handful of times so a stuck-but-now-fixable quest self-heals without a manual
  // refresh, then settle — this counter resets each time the page (re)mounts.
  const pollAttemptsRef = useRef(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["magicblock-quest-me", userId],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      return fetchMagicblockQuestStatus(token);
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const status = query.state.data as MagicblockQuestStatus | undefined;
      if (!status) return false;
      const hasRetryable = status.quests.some((q) => q.completions === 0 && q.lastError);
      if (!hasRetryable || pollAttemptsRef.current >= 6) return false;
      pollAttemptsRef.current += 1;
      return 5_000;
    },
  });

  function handleConnected() {
    queryClient.invalidateQueries({ queryKey: ["magicblock-quest-me", userId] });
  }

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link
            href="/rewards"
            className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Back to rewards</span>
          </Link>
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <Header />
          <StartQuestLink />

          {!authenticated ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <div className="text-4xl mb-3">✨</div>
              <p className="text-lg font-semibold text-white mb-1">Sign in to connect your wallet</p>
              <p className="text-base text-slate-400 mb-4">
                Connect your account to link your MagicBlock wallet and start auto-validating quests.
              </p>
              <button
                type="button"
                onClick={() => privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
                className="rounded-xl px-5 py-2.5 font-semibold text-black hover:opacity-90 transition-opacity"
                style={{ backgroundColor: ACCENT }}
              >
                Sign in
              </button>
            </div>
          ) : isLoading ? (
            <Skeleton />
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
              <p className="text-red-400 text-base">{(error as Error)?.message ?? "Failed to load quests"}</p>
              <button type="button" onClick={() => refetch()} className="mt-3 text-base text-slate-400 hover:text-white underline">
                Try again
              </button>
            </div>
          ) : data ? (
            <>
              {!data.wallet ? (
                <ConnectWalletForm onConnected={handleConnected} />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-400">Connected wallet</p>
                      <p className="text-base font-mono text-white truncate">{truncateWallet(data.wallet)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold px-2.5 py-1 rounded-full bg-white/10 text-slate-400 border border-white/15">
                      Locked
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-2">Contact support if you need to change this.</p>
                </div>
              )}

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Quests</p>
                  <p className="text-sm text-slate-500">Resets {formatResetsAt(data.resetsAt)} · 10:00 CET</p>
                </div>
                {data.quests.map((quest) => (
                  <QuestCard key={quest.questType} quest={quest} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
