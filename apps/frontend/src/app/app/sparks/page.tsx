"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const MAGICBLOCK_SPARKS_THRESHOLD = 3000;

type TaskKey =
  | "connect_email"
  | "connect_twitter"
  | "first_payment"
  | "payment_to_unregistered"
  | "payment_link_paid"
  | "ten_payments";

interface TaskStatus {
  key: TaskKey;
  label: string;
  description: string;
  sparks: number;
  completed: boolean;
  progress?: number;
  total?: number;
}

interface SparksData {
  totalSparks: number;
  tasks: TaskStatus[];
}

const TASK_ICONS: Record<TaskKey, string> = {
  connect_email: "✉️",
  connect_twitter: "𝕏",
  first_payment: "⚡",
  payment_to_unregistered: "🌐",
  payment_link_paid: "🔗",
  ten_payments: "🔥",
};

async function fetchRewards(token: string | null, network: "mainnet" | "devnet"): Promise<SparksData> {
  const res = await fetch(`${BACKEND_URL}/rewards/me?network=${network}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load sparks");
  return res.json();
}

function SparksBadge({ amount, size = "md" }: { amount: number; size?: "sm" | "md" | "lg" }) {
  const sizeClass =
    size === "lg"
      ? "text-2xl font-bold"
      : size === "sm"
        ? "text-sm font-semibold"
        : "text-lg font-semibold";
  return (
    <span className={`inline-flex items-center gap-1 ${sizeClass} text-amber-300`}>
      <span>⚡</span>
      <span>+{amount.toLocaleString()}</span>
    </span>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="mt-2.5">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-slate-400">{value}/{max}</span>
        <span className="text-sm text-slate-400">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: TaskStatus }) {
  const showProgress =
    !task.completed && task.progress !== undefined && task.total !== undefined;

  return (
    <div
      className={[
        "rounded-2xl border p-4 transition-all",
        task.completed
          ? "bg-amber-500/8 border-amber-500/25"
          : "bg-white/5 border-white/10",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={[
              "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg",
              task.completed
                ? "bg-amber-500/20 border border-amber-500/30"
                : "bg-white/8 border border-white/10",
            ].join(" ")}
          >
            {task.completed ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-amber-400"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <span>{TASK_ICONS[task.key]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-lg font-semibold leading-tight ${task.completed ? "text-white" : "text-slate-200"}`}>
              {task.label}
            </p>
            <p className="text-base text-slate-400 mt-0.5 leading-snug">
              {task.description}
            </p>
            {showProgress && (
              <ProgressBar value={task.progress!} max={task.total!} />
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <SparksBadge amount={task.sparks} size="md" />
          {task.completed && (
            <p className="text-sm text-amber-400/70 mt-0.5">Earned</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SparksTotal({ total, max }: { total: number; max: number }) {
  const pct = Math.min(100, Math.round((total / max) * 100));
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-base md:text-sm font-medium text-slate-400 uppercase tracking-wider">
          Your Sparks
        </p>
        <p className="text-base md:text-sm text-slate-500">{total.toLocaleString()} / {max.toLocaleString()}</p>
      </div>
      <div className="flex items-end gap-3 mt-2 mb-4">
        <span className="text-4xl font-bold text-white tabular-nums leading-none">
          {total.toLocaleString()}
        </span>
        <span className="text-2xl mb-0.5">⚡</span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-base md:text-sm text-slate-500 mt-2">{pct}% of all Sparks earned</p>
    </div>
  );
}

function SparksSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 mb-6 h-36" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4 h-20" />
      ))}
    </div>
  );
}

function MagicBlockQuestCard({ totalSparks, getAccessToken, questValidated }: {
  totalSparks: number;
  getAccessToken: () => Promise<string | null>;
  questValidated: boolean;
}) {
  const unlocked = totalSparks >= MAGICBLOCK_SPARKS_THRESHOLD;
  const [showForm, setShowForm] = useState(false);
  const [wallet, setWallet] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"success" | "already" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleValidate() {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/magicblock/validate-quest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ wallet: wallet.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Validation failed. Please try again.");
      } else if (data.alreadyCompleted) {
        setResult("already");
      } else {
        setResult("success");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isValidated = result === "success" || result === "already" || questValidated;

  if (isValidated) {
    const isAlready = result === "already" || (questValidated && !result);
    return (
      <div className={`rounded-2xl border p-5 ${isAlready ? "border-amber-500/30 bg-amber-500/10" : "border-white/20 bg-white/5"}`}>
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${isAlready ? "bg-amber-500/20 border border-amber-500/30 text-amber-400" : "bg-white/10 border border-white/20"}`}>
            {isAlready ? (
              <span className="font-bold text-lg">✓</span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <p className={`text-base font-semibold ${isAlready ? "text-amber-300" : "text-white"}`}>
              {isAlready ? "Quest already validated" : "Quest validated!"}
            </p>
            <p className="text-base text-slate-400 mt-0.5">
              You're in the MagicBlock 50,000 points pool. Check your rewards on{" "}
              <a href="https://quests.magicblock.app/projects/loofta-pay" target="_blank" rel="noopener noreferrer" className={`underline ${isAlready ? "text-amber-400 hover:text-amber-300" : "text-white hover:text-slate-300"}`}>
                quests.magicblock.app
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={[
      "rounded-2xl border p-5 transition-all",
      unlocked ? "border-white/25 bg-white/8" : "border-white/10 bg-white/5",
    ].join(" ")}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        {/* MagicBlock logo mark */}
        <div className={[
          "shrink-0 w-11 h-11 rounded-xl flex items-center justify-center p-2",
          unlocked ? "bg-white/15 border border-white/25" : "bg-white/8 border border-white/10",
        ].join(" ")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo/magicblock-mark.svg" alt="MagicBlock" className="w-full h-full object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-lg font-semibold ${unlocked ? "text-white" : "text-slate-300"}`}>
              MagicBlock Quest
            </p>
            <span className={[
              "text-[11px] font-semibold px-2 py-0.5 rounded-full",
              unlocked ? "bg-white/15 text-white" : "bg-white/10 text-slate-400",
            ].join(" ")}>
              {unlocked ? "Unlocked ✓" : `${MAGICBLOCK_SPARKS_THRESHOLD.toLocaleString()} Sparks required`}
            </span>
          </div>
          <p className="text-base text-slate-400 mt-0.5 leading-snug">
            Validate your Loofta Sparks on MagicBlock and earn from the{" "}
            <span className="text-slate-200">50,000 points pool</span> — unlock prizes, event tickets, merch & more.
          </p>
        </div>
      </div>

      {!unlocked && (
        <div className="mt-2">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-sm text-slate-400">{totalSparks.toLocaleString()} / {MAGICBLOCK_SPARKS_THRESHOLD.toLocaleString()} Sparks</span>
            <span className="text-sm text-slate-500">{Math.round((totalSparks / MAGICBLOCK_SPARKS_THRESHOLD) * 100)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-white/40 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.round((totalSparks / MAGICBLOCK_SPARKS_THRESHOLD) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {unlocked && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-1 w-full rounded-xl px-4 py-2.5 text-base font-semibold bg-white text-[#0f0f12] hover:bg-white/90 transition-opacity"
        >
          Validate quest on MagicBlock →
        </button>
      )}

      {unlocked && showForm && (
        <div className="mt-1 space-y-3">
          <div>
            <p className="text-sm text-slate-300 font-medium mb-1.5">
              Your MagicBlock wallet address
            </p>
            <p className="text-sm text-slate-500 mb-2">
              Paste the Solana wallet you used to sign in on Magicblock Questline.
              . Don't have an account?{" "}
              <a
                href="https://quests.magicblock.app/projects/loofta-pay"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white underline hover:text-slate-300"
              >
                Sign in first →
              </a>
            </p>
            <input
              type="text"
              value={wallet}
              onChange={(e) => { setWallet(e.target.value); setError(null); }}
              placeholder="e.g. 9CYi7RV2MmRvit6FA44V1yH58mn7GbRpoRny8ZK8Y57Z"
              className="w-full rounded-xl bg-[#1a1a22] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/40 transition-colors font-mono"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setWallet(""); setError(null); }}
              className="flex-1 rounded-xl px-4 py-2.5 text-base font-medium text-slate-400 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleValidate}
              disabled={submitting || wallet.trim().length < 32}
              className="flex-[2] rounded-xl px-4 py-2.5 text-base font-semibold bg-white text-[#0f0f12] hover:bg-white/90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Validating…" : "Validate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SparksPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin, getAccessToken } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);

  const {
    data,
    isLoading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["rewards", userId ?? "", networkMode],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      return fetchRewards(token, networkMode);
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Runs in parallel with sparks — card renders immediately, validated state arrives async
  const { data: questStatus } = useQuery({
    queryKey: ["mb-quest-status", userId],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/magicblock/validate-quest", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return res.ok ? res.json() : { validated: false };
    },
    enabled: Boolean(authenticated && userId),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const maxSparks = 250 + 250 + 500 + 2000 + 2000 + 5000; // 10000

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
            <div className="text-4xl mb-3">⚡</div>
            <h1 className="text-xl font-semibold text-white mb-2">Sparks</h1>
            <p className="text-slate-400 mb-4 text-base">
              Sign in to earn Sparks by completing missions on Loofta.
            </p>
            <button
              type="button"
              onClick={() =>
                privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })
              }
              className="rounded-xl px-5 py-2.5 font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold text-white">Sparks ⚡</h1>
            <p className="text-base text-slate-400 mt-0.5">
              Complete missions, earn Sparks
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isFetching ? "animate-spin" : ""}
            >
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <SparksSkeleton />
        ) : queryError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <p className="text-red-400 text-base md:text-sm">
              {(queryError as Error)?.message ?? "Failed to load sparks"}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 text-base md:text-sm text-slate-400 hover:text-white underline"
            >
              Try again
            </button>
          </div>
        ) : data ? (
          <>
            <SparksTotal total={data.totalSparks} max={maxSparks} />

            {/* MagicBlock quest — always visible, locked/unlocked based on sparks */}
            <div className="mb-6">
              <p className="text-base md:text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
                Partner Quest
              </p>
              <MagicBlockQuestCard totalSparks={data.totalSparks} getAccessToken={getAccessToken} questValidated={questStatus?.validated ?? false} />
            </div>

            <div className="mb-3 flex items-center justify-between">
              <p className="text-base md:text-sm font-medium text-slate-400 uppercase tracking-wider">
                Missions
              </p>
              <p className="text-base md:text-sm text-slate-500">
                {data.tasks.filter((t) => t.completed).length}/{data.tasks.length} completed
              </p>
            </div>

            <div className="space-y-3">
              {data.tasks.map((task) => (
                <TaskCard key={task.key} task={task} />
              ))}
            </div>

            {data.tasks.every((t) => t.completed) && (
              <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
                <div className="text-3xl mb-2">🏆</div>
                <p className="text-amber-300 font-semibold">All missions complete!</p>
                <p className="text-slate-400 text-base md:text-sm mt-1">
                  You've earned all {maxSparks.toLocaleString()} Sparks. More missions coming soon.
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
