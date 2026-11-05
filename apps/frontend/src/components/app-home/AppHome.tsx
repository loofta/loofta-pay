"use client";

import { useDashboardStore } from "@/store/dashboard";
import { WeeklyQuestCard } from "@/components/app-home/WeeklyQuestCard";
import { RankBadge } from "@/components/RankBadge";
import { RankProgressDialog } from "@/components/RankProgressDialog";
import { TIERS } from "@/lib/tiers";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { useAuthStore } from "@/store/auth";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "./loofta-app.css";

// Giveaway card is hidden for now. Flip to true to restore it.
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
      const name = platform === "venmo" ? "Venmo" : platform === "cashapp" ? "Cash App" : platform === "revolut" ? "Revolut" : platform === "xmoney" ? "X Money" : platform === "chime" ? "Chime" : platform === "monzo" ? "Monzo" : platform === "upi" ? "UPI" : "";
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

  // Last known values (persisted) fill the gaps while live data loads, so nothing flashes $0 / empty.
  const cache = useDashboardStore();
  const cached = cache.userId === userId;
  const historyLive = history.isSuccess;
  const recent: Activity[] = historyLive ? liveRecent : cached ? cache.recent : [];
  const balanceLive = authenticated && !isLoading;
  const balanceShown = balanceLive ? balanceUSD : cached && cache.balanceUsd !== null ? cache.balanceUsd : null;

  useEffect(() => {
    if (!authenticated || !userId) return;
    cache.update(userId, {
      ...(balanceLive ? { balanceUsd: balanceUSD } : {}),
      ...(historyLive ? { recent: liveRecent } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userId, balanceLive, balanceUSD, historyLive, history.dataUpdatedAt, moves.dataUpdatedAt]);

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
            {authenticated && <WeeklyQuestCard userId={userId} getAccessToken={getAccessToken} />}
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
            <div className="lh-7" style={{ color: "inherit", display: "flex", gap: 22, alignItems: "center", padding: 28, borderRadius: 30, background: "linear-gradient(135deg,#2A1A0C,#16110D 60%)", border: "1px solid rgba(245,183,12,0.22)" }}>
              <div style={{ flex: "none", width: 96, height: 96, borderRadius: 30, transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.55), inset 0 -8px 14px rgba(120,60,0,0.3), 0 8px 0 #8E5202, 0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M12 8.5V6M12 18v-2.5M8.5 12H6M18 12h-2.5" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>Stake to win</span>
                <span style={{ fontSize: 15, lineHeight: 1.5, color: "#B9B3A6" }}>Stake your USDC and get a shot at weekly rewards, without risking your deposit.</span>
                <span style={{ alignSelf: "flex-start", padding: "4px 12px", borderRadius: 999, background: "rgba(245,183,12,0.14)", border: "1px solid rgba(245,183,12,0.35)", fontWeight: 700, fontSize: 14, color: "#F5B70C" }}>Coming soon</span>
              </div>
            </div>
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
            <a href="https://play.loofta.com/?utm_source=loofta&utm_medium=app_home&utm_campaign=poolrip_tile" target="_blank" rel="noopener noreferrer" onClick={() => posthog.capture("poolrip_tile_clicked", { source: "app_home" })} className="lh-8" style={{ color: "inherit", display: "flex", gap: 22, alignItems: "center", padding: 28, borderRadius: 30, background: "linear-gradient(135deg,#2A200C,#16130D 60%)", border: "1px solid rgba(245,183,12,0.22)" }}>
              <div style={{ flex: "none", width: 96, height: 96, borderRadius: 30, transform: "rotate(5deg)", background: "radial-gradient(120% 120% at 28% 18%,#3A3A44 0%,#1B1B22 55%,#0A0A0D 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.18), inset 0 -8px 14px rgba(0,0,0,0.5), 0 8px 0 #050507, 0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/poolrip-icon.svg" alt="" width={62} height={62} style={{ width: 62, height: 62, objectFit: "contain" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>Rip a pack. Win big.</span>
                <span style={{ fontSize: 15, lineHeight: 1.5, color: "#B9B3A6" }}>Join a pool, rip a pack together. Packs from just $0.50.</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#F5B70C" }}>Play PoolRip now →</span>
              </div>
            </a>
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
      <RankProgressDialog open={rankOpen} onOpenChange={setRankOpen} volumeUsd={totalVolumeUsd} />
    </div>
  );
}
