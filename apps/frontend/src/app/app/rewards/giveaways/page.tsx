"use client";
import { clientApiBase } from "@/services/api/client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "@/components/app-home/loofta-app.css";

const BACKEND_URL = clientApiBase();

interface PublicGiveawayListItem {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  logo_url: string | null;
  project_name: string | null;
  winner_count: number;
  selection_mode: "random" | "first_come" | "manual";
  prize_amount_usd: string;
  reward_type?: "usdc" | "megapot_ticket";
  prize_token_symbol?: string | null;
  prize_token_logo?: string | null;
  entries_close_at: string;
  status: string;
  is_official: boolean;
  admin_reviewed_at?: string | null;
  entries_count?: number;
  entries_last_hour?: number;
  entry_avatars?: string[];
}

/** Big headline figure for a list card's prize pool — dollars for a usdc giveaway, ticket count
 *  for a megapot_ticket one (tickets are $1 each, so total pool === total ticket count). */
function poolLabel(g: Pick<PublicGiveawayListItem, "reward_type" | "prize_token_symbol">, total: number): string {
  const formatted = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (g.prize_token_symbol) return `$${formatted} in ${g.prize_token_symbol}`;
  return g.reward_type === "megapot_ticket" ? `${formatted} ticket${total === 1 ? "" : "s"}` : `$${formatted}`;
}

interface GiveawayStats {
  winners_this_month: number;
  avg_approval_hours: number | null;
}

async function fetchOpenGiveaways(): Promise<PublicGiveawayListItem[]> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public`);
  if (!res.ok) throw new Error("Failed to load giveaways");
  const data = await res.json();
  return data.giveaways ?? [];
}

async function fetchEndedGiveaways(): Promise<PublicGiveawayListItem[]> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public/ended`);
  if (!res.ok) throw new Error("Failed to load past giveaways");
  const data = await res.json();
  return data.giveaways ?? [];
}

async function fetchStats(): Promise<GiveawayStats | null> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public/stats`);
  if (!res.ok) return null;
  return res.json();
}

const ENDED_STATUS_LABELS: Record<string, string> = {
  ENTRIES_CLOSED: "Closing",
  DRAWING: "Drawing winners",
  WINNERS_SELECTED: "Winners selected",
  PAYOUT_IN_PROGRESS: "Paying out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  UNDERFUNDED_EXPIRED: "Underfunded",
  REFUNDED: "Refunded",
};

function formatApprovalTime(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 1) return "<1h";
  if (hours < 48) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ padding: 18, borderRadius: 20, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>{value}</span>
      <span style={{ fontSize: 13, color: "#8A8893" }}>{label}</span>
    </div>
  );
}

function GiveawayMark({ g }: { g: PublicGiveawayListItem }) {
  if (g.logo_url) {
    return (
      <img
        src={g.logo_url}
        alt=""
        style={{ flex: "none", width: 52, height: 52, borderRadius: 17, objectFit: "cover", background: "#0E0E12" }}
      />
    );
  }
  const look = prizeGlyph(g);
  return (
    <div style={{ flex: "none", width: 52, height: 52, borderRadius: 17, display: "grid", placeItems: "center", fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 800, fontSize: 20, color: look.ink, background: look.tile, boxShadow: `inset 0 2px 4px rgba(255,255,255,0.45),0 4px 0 ${look.rim}` }}>{look.glyph}</div>
  );
}

function prizeGlyph(g: PublicGiveawayListItem) {
  if (g.reward_type === "megapot_ticket") {
    return { glyph: "M", tile: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", rim: "#8E5202", ink: "#6A3500" };
  }
  if (g.is_official) {
    return { glyph: "L", tile: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", rim: "#9C2802", ink: "#fff" };
  }
  const letter = (g.project_name || g.title || "?").trim().charAt(0).toUpperCase() || "?";
  return { glyph: letter, tile: "radial-gradient(120% 120% at 28% 18%,#9CC8FF 0%,#2775CA 48%,#1A55A0 100%)", rim: "#123E78", ink: "#fff" };
}

export default function GiveawaysListPage() {
  const { authenticated } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["giveaways-open"],
    queryFn: fetchOpenGiveaways,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: endedData } = useQuery({
    queryKey: ["giveaways-ended"],
    queryFn: fetchEndedGiveaways,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: stats } = useQuery({
    queryKey: ["giveaways-stats"],
    queryFn: fetchStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Real total across currently-open pools — free from data already on the page, no extra call.
  const openPoolUsd = (data ?? []).reduce((sum, g) => sum + parseFloat(g.prize_amount_usd || "0") * g.winner_count, 0);

  const SORA = "var(--font-home-sora), Sora, sans-serif";
  const MONO = "var(--font-home-mono), ui-monospace, monospace";

  return (
    <div className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8", minHeight: "calc(100vh - var(--header-h, 0px))" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22, padding: "clamp(20px, 4vw, 36px) clamp(16px, 4vw, 28px) 96px" }}>
        <div style={{ position: "relative", overflow: "hidden", padding: 30, borderRadius: 30, background: "linear-gradient(135deg,#2A1A0C,#141016 65%)", border: "1px solid rgba(245,183,12,0.2)", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "none", width: 92, height: 92, borderRadius: 28, transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.55),inset 0 -8px 14px rgba(120,60,0,0.3),0 8px 0 #8E5202,0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#6A3500" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3.5" y="9" width="17" height="11.5" rx="2" />
              <path d="M2.5 9h19M12 9v11.5M12 9c-1.5-3.5-6-4-6-1.2C6 9 9 9 12 9zm0 0c1.5-3.5 6-4 6-1.2C18 9 15 9 12 9z" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: "clamp(30px,5vw,42px)", letterSpacing: "-0.05em", lineHeight: 1 }}>Giveaways</span>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: "#B9B3A6" }}>
              Enter an open giveaway, or launch your own in USDC or Megapot tickets.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "none" }}>
            <Link href="/app/rewards/giveaways/quick" style={{ padding: "15px 22px", borderRadius: 16, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 15, boxShadow: "0 12px 34px rgba(255,70,10,0.3)", textAlign: "center" }}>
              Launch a giveaway
            </Link>
            {authenticated && (
              <Link href="/rewards-rail#yours" style={{ fontSize: 13, fontWeight: 700, color: "#C9C6CF", textAlign: "center" }}>
                My giveaways →
              </Link>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
          <StatTile value={`$${Math.round(openPoolUsd).toLocaleString()}`} label="up for grabs now" />
          <StatTile value={String(stats?.winners_this_month ?? 0)} label="winners this month" />
          <StatTile value={formatApprovalTime(stats?.avg_approval_hours)} label="avg. approval time" />
        </div>

        {isLoading ? (
          <div style={{ padding: 26, borderRadius: 22, border: "1.5px dashed rgba(255,255,255,0.12)", textAlign: "center", fontSize: 15, color: "#9A98A3" }}>Loading giveaways…</div>
        ) : error ? (
          <div style={{ padding: 26, borderRadius: 22, border: "1.5px dashed rgba(255,80,80,0.35)", textAlign: "center", fontSize: 15, color: "#F87171" }}>
            {(error as Error)?.message ?? "Failed to load giveaways"}
            <button type="button" onClick={() => refetch()} style={{ display: "block", margin: "12px auto 0", background: "transparent", border: 0, color: "#F2EFE8", fontWeight: 700, cursor: "pointer" }}>Try again</button>
          </div>
        ) : !data || data.length === 0 ? (
          <div style={{ padding: 26, borderRadius: 22, border: "1.5px dashed rgba(255,255,255,0.12)", textAlign: "center", fontSize: 15, color: "#9A98A3" }}>
            No giveaways are open right now. Check back soon.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.2em", color: "#5FD38E" }}>OPEN</span>
            {data.map((g) => {
              const total = parseFloat(String(g.prize_amount_usd)) * g.winner_count;
              const by = g.is_official ? "Loofta" : g.project_name || "Community";
              return (
                <Link key={g.id} href={`/app/rewards/giveaways/${g.short_id ?? g.id}`} className="lh-gw" style={{ display: "flex", gap: 18, alignItems: "center", padding: "18px 20px", borderRadius: 22, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", flexWrap: "wrap", color: "inherit" }}>
                  <GiveawayMark g={g} />
                  <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#8A8893" }}>{by}</span>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>{g.title}</span>
                    <span style={{ fontSize: 13, color: "#6E6C78" }}>
                      {g.winner_count} winner{g.winner_count === 1 ? "" : "s"} · {(g.entries_count ?? 0).toLocaleString()} entries
                    </span>
                  </div>
                  <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>{poolLabel(g, total)}</span>
                    <span style={{ padding: "3px 10px", borderRadius: 999, background: "rgba(95,211,142,0.12)", fontSize: 13, fontWeight: 700, color: "#5FD38E" }}>Open</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {endedData && endedData.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.2em", color: "#77757F" }}>ENDED</span>
            {endedData.map((g) => {
              const total = parseFloat(String(g.prize_amount_usd)) * g.winner_count;
              const by = g.is_official ? "Loofta" : g.project_name || "Community";
              return (
                <Link key={g.id} href={`/app/rewards/giveaways/${g.short_id ?? g.id}`} className="lh-gw" style={{ display: "flex", gap: 18, alignItems: "center", padding: "18px 20px", borderRadius: 22, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", flexWrap: "wrap", color: "inherit" }}>
                  <GiveawayMark g={g} />
                  <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#8A8893" }}>{by}</span>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>{g.title}</span>
                    <span style={{ fontSize: 13, color: "#6E6C78" }}>
                      {g.winner_count} winner{g.winner_count === 1 ? "" : "s"} · {(g.entries_count ?? 0).toLocaleString()} entries · Ended {new Date(g.entries_close_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em", color: "#C9C6CF" }}>{poolLabel(g, total)}</span>
                    <span style={{ padding: "3px 10px", borderRadius: 999, background: "#22222A", fontSize: 13, fontWeight: 700, color: "#8A8893" }}>{ENDED_STATUS_LABELS[g.status] ?? "Completed"}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
