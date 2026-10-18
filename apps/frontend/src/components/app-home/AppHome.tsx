"use client";

import { ChanceModal } from "@/components/ChanceModal";
import { useDashboardStore } from "@/store/dashboard";
import { useDrawStatus } from "@/hooks/useDrawStatus";
import { QuestHistoryDialog, type QuestReward } from "@/components/QuestHistoryDialog";
import { useToast } from "@/components/ui/use-toast";
import { RankBadge } from "@/components/RankBadge";
import { RankProgressDialog } from "@/components/RankProgressDialog";
import { TIERS } from "@/lib/tiers";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { useAuthStore } from "@/store/auth";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "./loofta-app.css";

// Giveaway card is hidden while the Megapot ticket card is being tested. Flip to true to restore it.
const SHOW_GIVEAWAY_CARD = false;

type HistoryRow = {
  id: string;
  amount: string;
  direction: "from_sender" | "from_recipient";
  status: string;
  created_at: string;
  recipient_username?: string | null;
  recipient_email?: string | null;
  recipient_address?: string;
  receipt_path?: string | null;
  creator_username?: string | null;
  sender_username?: string | null;
};

// Weekly quest: move this much in a week (sends + withdrawals) to unlock a free entry in the daily $200K draw.
// Tuned here for now; the real budget/target will live server-side and is never shown as a cap.
const WEEKLY_QUEST_TARGET_USD = 150;

function startOfWeekUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.getTime();
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

function money(n: number) {
  if (!Number.isFinite(n)) return "$0.00";
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cashStatus(status: string, sent: boolean) {
  switch (status.toUpperCase()) {
    case "SUCCESS":
    case "CLAIMED":
      return sent ? "Paid" : "Received";
    case "PRIVATE_TRANSFER_PENDING":
    case "OPEN":
      return "Open";
    case "PENDING_DEPOSIT":
    case "IN_FLIGHT":
      return "Pending";
    case "CANCELLED":
      return "Cancelled";
    case "REFUNDED":
      return "Refunded";
    case "EXPIRED":
      return "Expired";
    default:
      return sent ? "Sent" : "Received";
  }
}

function whoLabel(row: HistoryRow, sent: boolean) {
  if (sent) {
    const ra = row.recipient_address || "";
    if (ra.startsWith("PENDING_SOCIAL:")) {
      const rest = ra.slice("PENDING_SOCIAL:".length);
      const sep = rest.indexOf(":");
      const platform = sep >= 0 ? rest.slice(0, sep) : "";
      const handle = sep >= 0 ? rest.slice(sep + 1) : rest;
      const name = platform === "venmo" ? "Venmo" : platform === "cashapp" ? "Cash App" : platform === "revolut" ? "Revolut" : platform === "xmoney" ? "X Money" : "";
      if (name && handle) return `To ${handle} on ${name}`;
    }
    if (row.recipient_username) return `To @${row.recipient_username}`;
    if (row.recipient_email) return `To ${row.recipient_email}`;
    return "To someone";
  }
  if (row.sender_username) return `From @${row.sender_username}`;
  if (row.creator_username) return `From @${row.creator_username}`;
  return "From someone";
}

export function AppHome() {
  const router = useRouter();
  const { authenticated, userId, getAccessToken, login } = useAuth();
  const username = useAuthStore((s) => s.username);
  const networkMode = useAuthStore((s) => s.networkMode);
  const tierKey = useAuthStore((s) => s.tier);
  const tierInfo = TIERS.find((t) => t.key === tierKey) ?? TIERS[0];
  const totalVolumeUsd = useAuthStore((s) => s.totalVolumeUsd);
  const [rankOpen, setRankOpen] = useState(false);
  const [chanceOpen, setChanceOpen] = useState(false);
  const { balanceUSD, isLoading } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated });

  const history = useQuery({
    queryKey: ["app-home-recent", userId, networkMode],
    enabled: authenticated && !!userId,
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      const params = networkMode ? `?network=${networkMode}` : "";
      const r = await fetch(`/api/payments/history${params}`, { headers, cache: "no-store" });
      if (!r.ok) throw new Error("history");
      return r.json() as Promise<{ sent: HistoryRow[]; received: HistoryRow[] }>;
    },
    retry: 2,
  });

  // Withdrawals and deposits live in their own tables; merged into the same list so the
  // dashboard shows every movement of money, not just payments.
  const moves = useQuery({
    queryKey: ["app-home-moves", userId, networkMode],
    enabled: authenticated && !!userId,
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      const [w, d] = await Promise.all([
        fetch(`/api/withdrawals?devnet=${networkMode === "devnet"}`, { headers, cache: "no-store" }).then((r) => (r.ok ? r.json() : { withdrawals: [] })).catch(() => ({ withdrawals: [] })),
        fetch("/api/users/deposits", { headers, cache: "no-store" }).then((r) => (r.ok ? r.json() : { deposits: [] })).catch(() => ({ deposits: [] })),
      ]);
      return { withdrawals: (w.withdrawals ?? []) as any[], deposits: (d.deposits ?? []) as any[] };
    },
    retry: 1,
  });

  type Activity = { key: string; sent: boolean; title: string; sub: string; amount: number; created_at: string; href: string };
  const liveRecent: Activity[] = [
    ...(history.data?.sent ?? []).map((row): Activity => ({ key: `s-${row.id}`, sent: true, title: whoLabel(row, true), sub: cashStatus(row.status, true), amount: Number(row.amount) || 0, created_at: row.created_at, href: row.receipt_path || "/app/history" })),
    ...(history.data?.received ?? []).map((row): Activity => ({ key: `r-${row.id}`, sent: false, title: whoLabel(row, false), sub: cashStatus(row.status, false), amount: Number(row.amount) || 0, created_at: row.created_at, href: row.receipt_path || "/app/history" })),
    ...(moves.data?.withdrawals ?? []).map((w): Activity => ({
      key: `w-${w.id}`, sent: true, title: "Withdrawal", amount: Number(w.amount_usdc) || 0, created_at: w.created_at, href: "/app/history",
      sub: w.is_near_intents && !w.near_intents_complete ? "Pending" : "Withdrawn",
    })),
    ...(moves.data?.deposits ?? []).filter((d) => ["complete", "completed", "success"].includes(String(d.status).toLowerCase())).map((d): Activity => ({
      key: `d-${d.id}`, sent: false, title: "Deposit", amount: Number(d.amount_usdc) || 0, created_at: d.created_at, href: "/app/history", sub: "Added",
    })),
  ]
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 8);

  const weekStart = startOfWeekUtc();
  const DEAD = new Set(["CANCELLED", "EXPIRED", "REFUNDED", "DELETED"]);
  const weeklyVolume = [
    ...(history.data?.sent ?? []).filter((r) => !DEAD.has(String(r.status).toUpperCase())).map((r) => ({ at: r.created_at, amt: Number(r.amount) || 0 })),
    ...(moves.data?.withdrawals ?? []).map((w) => ({ at: w.created_at, amt: Number(w.amount_usdc) || 0 })),
  ].filter((x) => +new Date(x.at) >= weekStart).reduce((a, x) => a + x.amt, 0);
  // Last known values (persisted) fill the gaps while live data loads, so nothing flashes $0 / empty.
  const cache = useDashboardStore();
  const cached = cache.userId === userId;
  const historyLive = history.isSuccess;
  const recent: Activity[] = historyLive ? liveRecent : cached ? cache.recent : [];
  // Server-side quest status is the source of truth (same numbers the hourly award job uses); the
  // browser-side estimate below is only a fallback while it loads or if the endpoint is unavailable.
  const quest = useQuery({
    queryKey: ["weekly-quest", userId],
    enabled: authenticated && !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const r = await fetch("/api/weekly-quest", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!r.ok) throw new Error("weekly-quest");
      return r.json() as Promise<{ volumeUsd: number; targetUsd: number; daysUntilNext: number; qualified: boolean; projectedTickets?: number; history?: QuestReward[]; unseenAward?: (QuestReward & { id: string }) | null }>;
    },
  });
  const { toast } = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);
  const unseen = quest.data?.unseenAward ?? null;
  useEffect(() => {
    if (!unseen) return;
    toast({
      title: "Your weekly reward is in",
      description: `You received ${unseen.tickets} free ${unseen.tickets === 1 ? "entry" : "entries"} in the daily $200K draw for last week's ${money(unseen.volumeUsd)} volume.`,
      duration: 12000,
    });
    void (async () => {
      const token = await getAccessToken().catch(() => null);
      await fetch("/api/weekly-quest", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ awardId: unseen.id }) }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ["weekly-quest"] });
      void queryClient.invalidateQueries({ queryKey: ["draw-status"] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen?.id]);
  const questTarget = quest.data?.targetUsd ?? WEEKLY_QUEST_TARGET_USD;
  const weeklyShown = quest.data ? quest.data.volumeUsd : historyLive ? weeklyVolume : cached && cache.weekStart === weekStart ? cache.weeklyVolumeUsd : 0;
  const balanceLive = authenticated && !isLoading;
  const balanceShown = balanceLive ? balanceUSD : cached && cache.balanceUsd !== null ? cache.balanceUsd : null;

  const queryClient = useQueryClient();
  const draw = useDrawStatus({ userId, enabled: authenticated, getAccessToken });
  const entries = draw.data ? draw.data.entries : cached ? cache.entries ?? 0 : 0;
  const nextDrawAt = draw.data ? draw.data.drawTime : cached ? cache.nextDrawAt : null;

  useEffect(() => {
    if (!authenticated || !userId) return;
    cache.update(userId, {
      ...(balanceLive ? { balanceUsd: balanceUSD } : {}),
      ...(historyLive ? { recent: liveRecent, weeklyVolumeUsd: weeklyVolume, weekStart } : {}),
      ...(draw.data ? { entries: draw.data.entries, nextDrawAt: draw.data.drawTime } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userId, balanceLive, balanceUSD, historyLive, history.dataUpdatedAt, moves.dataUpdatedAt, draw.data]);

  // Ticking countdown to the next draw.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!nextDrawAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [nextDrawAt]);
  const msLeft = nextDrawAt ? new Date(nextDrawAt).getTime() - nowMs : null;

  const questPct = Math.min(100, (weeklyShown / questTarget) * 100);
  const questDone = weeklyShown >= questTarget;
  const daysLeft = quest.data?.daysUntilNext ?? null;

  const greet = (username || "there").replace(/^@/, "").toUpperCase();
  const goSend = () => router.push("/app/send");
  const goReceive = () => router.push("/app/receive");
  const openBalance = (tab: "topup" | "withdraw") => {
    if (!authenticated) {
      login();
      return;
    }
    window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab } }));
  };
  const goDeposit = () => openBalance("topup");
  const goWithdraw = () => openBalance("withdraw");

  const actions = [
    { title: "Send payment", body: "Pay a handle, email, or wallet. They cash out their way.", glyph: "↑", ink: "#fff", go: goSend, tile: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", rim: "#9C2802" },
    { title: "Get paid", body: "Share your receive link or QR. No wallet needed for them.", glyph: "↓", ink: "#16161C", go: goReceive, tile: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", rim: "#8C8898" },
    { title: "Deposit", body: "Add funds from any chain, bank or card. Lands as USDC.", glyph: "+", ink: "#fff", go: goDeposit, tile: "radial-gradient(120% 120% at 28% 18%,#9CC8FF 0%,#2775CA 48%,#1A55A0 100%)", rim: "#123E78" },
  ];

  return (
    <div className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 1080, margin: "0 auto", padding: "clamp(24px, 4vw, 48px) clamp(16px, 4vw, 32px) 96px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20 }}>
          <div style={{ position: "relative", overflow: "hidden", minWidth: 0, padding: "clamp(18px,5vw,30px)", borderRadius: 30, background: "linear-gradient(160deg,#1C1C24,#121217)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ position: "absolute", right: -60, top: -60, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,90,26,0.28),rgba(255,90,26,0) 70%)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.18em", color: "#FF8A4A", overflowWrap: "anywhere" }}>HEY {greet}</span>
                {authenticated && (
                  <button type="button" onClick={() => setRankOpen(true)} aria-label="See your rank" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                    <RankBadge tier={tierInfo.key} size={40} label={tierInfo.label} />
                  </button>
                )}
              </span>
              <span style={{ fontSize: 15, color: "#9A98A3", fontWeight: 600 }}>Your balance</span>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: "clamp(44px,7vw,64px)", letterSpacing: "-0.05em", lineHeight: 1 }}>
                {authenticated ? (balanceShown === null ? "…" : money(balanceShown)) : money(0)}
              </span>
              <span style={{ fontSize: 14, color: "#6E6C78" }}>USDC on Solana</span>
            </div>
            {authenticated && (
              <div style={{ position: "relative" }}>
                <style>{`
                  @keyframes lhGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                  @keyframes lhGlowPulse { 0%,100% { opacity: .3; } 50% { opacity: .6; } }
                  @media (prefers-reduced-motion: reduce) { .lh-glow { animation: none !important; opacity: .7 !important; } }
                `}</style>
                <div aria-hidden className="lh-glow" style={{ position: "absolute", inset: -2, borderRadius: 22, filter: "blur(6px)", background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)", backgroundSize: "220% 100%", animation: "lhGlowShift 6s linear infinite, lhGlowPulse 4s ease-in-out infinite" }} />
                {entries > 0 ? (
                  <button type="button" onClick={() => setChanceOpen(true)} aria-label="See your chances, the prize pool and odds" style={{ position: "relative", width: "100%", cursor: "pointer", textAlign: "left", color: "inherit", display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 20, border: "1px solid rgba(255,138,74,0.45)", background: "linear-gradient(135deg,#1d140e,#14110f)" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1, minWidth: 64 }}>
                      <span style={{ fontFamily: SORA, fontWeight: 800, fontSize: 52, letterSpacing: "-0.05em", background: "linear-gradient(180deg,#FFD25A,#FF6A1A)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", fontVariantNumeric: "tabular-nums" }}>{entries}</span>
                      <span style={{ marginTop: 4, fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", color: "#FF8A4A" }}>{entries === 1 ? "CHANCE" : "CHANCES"}</span>
                    </div>
                    <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.15 }}>to win up to $200K today</span>
                      {msLeft !== null && msLeft > 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, color: "#9A98A3", marginRight: 1 }}>Draw in</span>
                          {[["h", Math.floor(msLeft / 3_600_000)], ["m", Math.floor((msLeft % 3_600_000) / 60_000)], ["s", Math.floor((msLeft % 60_000) / 1000)]].map(([u, v]) => (
                            <span key={u as string} style={{ display: "inline-flex", alignItems: "baseline", gap: 2, padding: "3px 6px", borderRadius: 8, background: "rgba(0,0,0,0.45)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)", fontFamily: MONO, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                              {pad2(v as number)}<span style={{ fontSize: 11, color: "#FF8A4A" }}>{u}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: 14, color: "#C8C6D0" }}>Checking your results…</span>
                      )}
                    </div>
                    <span aria-hidden style={{ flex: "none", alignSelf: "center", fontWeight: 800, fontSize: 24, color: "#FF8A4A" }}>›</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setChanceOpen(true)} style={{ position: "relative", width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px", borderRadius: 20, border: "1px solid rgba(255,138,74,0.45)", background: "#16120f", color: "#F2EFE8", textAlign: "left" }}>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.15 }}>$1 for a shot at $200K</span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "#9A98A3", lineHeight: 1.2 }}>Today&apos;s draw. Paid straight to your balance.</span>
                    </span>
                    <span aria-hidden style={{ flex: "none", fontWeight: 800, fontSize: 20, color: "#FF8A4A" }}>→</span>
                  </button>
                )}
              </div>
            )}
            {authenticated && (
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 18, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{questDone ? "Quest complete" : "Weekly quest: win up to $200K"}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: "#9A98A3", fontVariantNumeric: "tabular-nums" }}>{money(Math.min(weeklyShown, questTarget))} / {money(questTarget)}</span>
                </div>
                <div style={{ height: 14, borderRadius: 999, background: "rgba(0,0,0,0.4)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(questPct, weeklyShown > 0 ? 4 : 0)}%`, height: "100%", borderRadius: 999, background: questDone ? "linear-gradient(90deg,#3CC878,#9BE564)" : "linear-gradient(90deg,#FF4A26,#FF7A2A,#EAB308)", boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.22)", transition: "width .7s ease" }} />
                </div>
                <span style={{ fontSize: 14, color: "#9A98A3", lineHeight: 1.35 }}>
                  {questDone
                    ? `You are on track for ${quest.data?.projectedTickets ?? 1} free ${(quest.data?.projectedTickets ?? 1) === 1 ? "entry" : "entries"}, paid automatically when the week ends.${daysLeft !== null ? ` New quest in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.` : ""}`
                    : `${money(Math.max(0, questTarget - weeklyShown))} more sent or withdrawn this week earns you free entries, paid when the week ends.${daysLeft !== null ? ` New quest in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.` : ""}`}
                </span>
                <button type="button" onClick={() => setHistoryOpen(true)} style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, cursor: "pointer", color: "#FF8A4A", fontWeight: 700, fontSize: 14 }}>Past rewards{(quest.data?.history?.length ?? 0) > 0 ? ` (${quest.data?.history?.length})` : ""}</button>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, position: "relative", marginTop: "auto" }}>
              <button type="button" onClick={goDeposit} style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "14px 4px", minWidth: 0, textAlign: "center", lineHeight: 1.15, borderRadius: 16, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontWeight: 700, fontSize: 15, boxShadow: "0 10px 30px rgba(255,70,10,0.3)" }}>+ Deposit</button>
              <button type="button" onClick={goWithdraw} className="lh-4" style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "14px 4px", minWidth: 0, textAlign: "center", lineHeight: 1.15, borderRadius: 16, background: "#22222A", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", fontWeight: 700, fontSize: 15 }}>↑ Withdraw</button>
              <button type="button" onClick={goSend} className="lh-5" style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "14px 4px", minWidth: 0, textAlign: "center", lineHeight: 1.15, borderRadius: 16, background: "#22222A", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", fontWeight: 700, fontSize: 15 }}>↗ Send</button>
            </div>
          </div>

          <div style={{ minWidth: 0, overflow: "hidden", padding: "26px 26px 18px", borderRadius: 30, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: SORA, fontWeight: 600, fontSize: 17 }}>Recent activity</span>
              <Link href="/app/history" style={{ fontSize: 14, fontWeight: 700, color: "#FF7A2A" }}>See all →</Link>
            </div>
            {!authenticated && <p style={{ fontSize: 15, color: "#9A98A3", padding: "12px 8px" }}>Sign in to see payments you sent and received.</p>}
            {authenticated && (history.isLoading || history.isPending) && recent.length === 0 && <p style={{ fontSize: 15, color: "#9A98A3", padding: "12px 8px" }}>Loading…</p>}
            {authenticated && history.isError && <p style={{ fontSize: 15, color: "#9A98A3", padding: "12px 8px" }}>Could not load recent activity.</p>}
            {authenticated && history.isSuccess && recent.length === 0 && <p style={{ fontSize: 15, color: "#9A98A3", padding: "12px 8px" }}>No payments yet. Send the first one.</p>}
            {recent.map((h) => (
              <Link key={h.key} href={h.href} className="lh-6" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 8px", borderRadius: 14, color: "inherit", minWidth: 0 }}>
                <div style={{ flex: "none", width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 18, background: h.sent ? "rgba(245,150,12,0.14)" : "rgba(60,200,120,0.14)", color: h.sent ? "#F5A623" : "#5FD38E" }}>{h.sent ? "↑" : "↓"}</div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ display: "block", minWidth: 0, fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
                  <span style={{ display: "block", minWidth: 0, fontSize: 13, color: "#77757F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{new Date(h.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {h.sub}</span>
                </div>
                <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: SORA, fontWeight: 600, fontSize: 15, fontVariantNumeric: "tabular-nums", color: h.sent ? "#F2EFE8" : "#5FD38E" }}>{h.sent ? "−" : "+"}{money(h.amount)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.2em", color: "#77757F" }}>START SOMETHING</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20 }}>
            <Link href="/app/megapot" className="lh-7" style={{ color: "inherit", display: "flex", gap: 22, alignItems: "center", padding: 28, borderRadius: 30, background: "linear-gradient(135deg,#2A1A0C,#16110D 60%)", border: "1px solid rgba(245,183,12,0.22)" }}>
              <div style={{ flex: "none", width: 96, height: 96, borderRadius: 30, transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.55), inset 0 -8px 14px rgba(120,60,0,0.3), 0 8px 0 #8E5202, 0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
                  <path d="M14 5v14" strokeDasharray="2 3" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>Buy a Megapot ticket</span>
                <span style={{ fontSize: 15, lineHeight: 1.5, color: "#B9B3A6" }}>$200K jackpot to win every day from a $1.1M prize pool.</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#F5B70C" }}>Buy a ticket →</span>
              </div>
            </Link>
            {SHOW_GIVEAWAY_CARD && (
            <Link href="/rewards-rail" className="lh-7" style={{ color: "inherit", display: "flex", gap: 22, alignItems: "center", padding: 28, borderRadius: 30, background: "linear-gradient(135deg,#2A1A0C,#16110D 60%)", border: "1px solid rgba(245,183,12,0.22)" }}>
              <div style={{ flex: "none", width: 96, height: 96, borderRadius: 30, transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.55), inset 0 -8px 14px rgba(120,60,0,0.3), 0 8px 0 #8E5202, 0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3.5" y="9" width="17" height="11.5" rx="2" />
                  <path d="M2.5 9h19M12 9v11.5M12 9c-1.5-3.5-6-4-6-1.2C6 9 9 9 12 9zm0 0c1.5-3.5 6-4 6-1.2C18 9 15 9 12 9z" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>Launch giveaway</span>
                <span style={{ fontSize: 15, lineHeight: 1.5, color: "#B9B3A6" }}>Fund a prize, share one link, a winner gets picked fairly.</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#F5B70C" }}>Create giveaway →</span>
              </div>
            </Link>
            )}
            <Link href="/app/card" className="lh-8" style={{ color: "inherit", display: "flex", gap: 22, alignItems: "center", padding: 28, borderRadius: 30, background: "linear-gradient(135deg,#2A120C,#160F0D 60%)", border: "1px solid rgba(255,90,26,0.22)" }}>
              <div style={{ flex: "none", width: 96, height: 96, borderRadius: 30, transform: "rotate(5deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.5), inset 0 -8px 14px rgba(0,0,0,0.22), 0 8px 0 #9C2802, 0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                  <path d="M2.5 9.5h19" />
                  <path d="M6 15h4" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>Get your Loofta card</span>
                <span style={{ fontSize: 15, lineHeight: 1.5, color: "#B9AFA8" }}>Spend privately from your balance.</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#FF7A2A" }}>Get your card →</span>
              </div>
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 20 }}>
            {actions.map((a) => (
              <button key={a.title} type="button" onClick={a.go} className="lh-9" style={{ cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 16, padding: 24, borderRadius: 26, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", color: "#F2EFE8" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ width: 62, height: 62, borderRadius: 20, background: a.tile, boxShadow: `inset 0 3px 6px rgba(255,255,255,0.5), inset 0 -6px 10px rgba(0,0,0,0.2), 0 5px 0 ${a.rim}, 0 16px 28px rgba(0,0,0,0.45)`, display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 28, color: a.ink }}>{a.glyph}</div>
                  <span style={{ fontSize: 20, color: "#5D5B66" }}>→</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 21, letterSpacing: "-0.03em" }}>{a.title}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#9A98A3" }}>{a.body}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <QuestHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} rewards={quest.data?.history ?? []} />
      <ChanceModal open={chanceOpen} onOpenChange={setChanceOpen} balanceUsd={balanceUSD ?? 0} getAccessToken={getAccessToken} entries={entries} drawTime={nextDrawAt} prizePool={draw.data?.prizePool ?? null} onBought={() => { void queryClient.invalidateQueries({ queryKey: ["draw-status"] }); void queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] }); }} />
      <RankProgressDialog open={rankOpen} onOpenChange={setRankOpen} volumeUsd={totalVolumeUsd} />
    </div>
  );
}
