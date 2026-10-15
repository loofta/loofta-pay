"use client";

import { useCallback, useState, type CSSProperties } from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { clientApiBase } from "@/services/api/client";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";

const BACKEND_URL = clientApiBase();
const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

export interface QuickCriteria {
  required_mentions: string[];
  required_hashtags: string[];
  required_text?: string;
  require_media?: boolean;
  announcement_url?: string;
  start_at: string;
}

interface QuickPost {
  entry_id: string;
  x_handle: string;
  avatar_url: string | null;
  post_url: string | null;
  post_text: string | null;
  post_created_at: string | null;
  post_media: Array<{ type: string; preview?: string }> | null;
  shortlisted: boolean;
  status: string;
}

interface Eligibility {
  eligible: boolean;
  checks: Array<{ label: string; ok: boolean }>;
  post_url?: string;
  reason?: string;
}

const card: CSSProperties = { padding: 22, borderRadius: 24, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 14 };
const eyebrow: CSSProperties = { fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", color: "#8A8893" };
const gradientBtn: CSSProperties = { cursor: "pointer", textAlign: "center", padding: 15, borderRadius: 16, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 16 };

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ruleLines(c: QuickCriteria, elig?: { min_account_age_days?: number; verified_only?: boolean }): string[] {
  return [
    ...c.required_mentions.map((m) => `Tag @${m}`),
    ...c.required_hashtags.map((h) => `Use #${h}`),
    ...(c.required_text ? [`Include "${c.required_text}"`] : []),
    ...(c.require_media ? ["Add an image or video"] : []),
    ...(elig?.min_account_age_days ? [`Your X account is ${elig.min_account_age_days}+ days old`] : []),
    ...(elig?.verified_only ? ["Your X account is verified"] : []),
  ];
}

/** Pre-filled X compose link so a participant can post the right thing in one tap. */
export function quickComposeUrl(c: QuickCriteria): string {
  const text = [...c.required_mentions.map((m) => `@${m}`), ...c.required_hashtags.map((h) => `#${h}`)].join(" ");
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text + " ")}`;
}

function Avatar({ url, handle, size = 34 }: { url: string | null; handle: string; size?: number }) {
  if (url) return <Image src={url} alt="" width={size} height={size} style={{ borderRadius: 999, flex: "none" }} unoptimized />;
  return (
    <div style={{ flex: "none", width: size, height: size, borderRadius: 999, background: "linear-gradient(135deg,#FF2D0A,#F5B70C)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14 }}>
      {handle[0]?.toUpperCase()}
    </div>
  );
}

function RulesAndCheck({ giveawayId, criteria, eligibility }: { giveawayId: string; criteria: QuickCriteria; eligibility?: { min_account_age_days?: number; verified_only?: boolean } }) {
  const lines = ruleLines(criteria, eligibility);
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Eligibility | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const clean = handle.replace(/^@/, "").trim();
    if (!clean) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${giveawayId}/eligibility?handle=${encodeURIComponent(clean)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || "Could not check right now");
      setResult(body as Eligibility);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [handle, giveawayId]);

  return (
    <div style={{ ...card, borderRadius: 28, gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={eyebrow}>YOUR POST NEEDS TO</span>
        {lines.map((l, i) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15, fontWeight: 600 }}>
            <span style={{ flex: "none", width: 22, height: 22, borderRadius: 999, background: "#26262E", display: "grid", placeItems: "center", color: "#B5B2BC", fontSize: 11, fontWeight: 800 }}>{i + 1}</span>
            {l}
          </div>
        ))}
        <a
          href={quickComposeUrl(criteria)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ alignSelf: "flex-start", marginTop: 4, padding: "10px 16px", borderRadius: 14, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontWeight: 800, fontSize: 14 }}
        >
          Post on X ↗
        </a>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17 }}>Check if your post counts</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder="@yourhandle"
            style={{ flex: 1, minWidth: 0, padding: "14px 16px", borderRadius: 16, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.1)", color: "#F2EFE8", fontFamily: "inherit", fontWeight: 700, fontSize: 15, outline: "none" }}
          />
          <button type="button" onClick={check} disabled={loading || !handle.trim()} style={{ ...gradientBtn, flex: "none", padding: "14px 20px", fontSize: 15, opacity: loading || !handle.trim() ? 0.6 : 1 }}>
            {loading ? "…" : "Check"}
          </button>
        </div>
        <span style={{ fontSize: 13, color: "#6E6C78" }}>No sign-up, no enter button. Post on X with the rules above and you are in.</span>
        {error && <span style={{ fontSize: 14, color: "#FF6B5B" }}>{error}</span>}
        {result && (
          <div style={{ padding: 16, borderRadius: 18, display: "flex", flexDirection: "column", gap: 8, background: result.eligible ? "rgba(60,179,113,0.1)" : "rgba(245,183,12,0.08)", border: `1px solid ${result.eligible ? "rgba(60,179,113,0.3)" : "rgba(245,183,12,0.28)"}` }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 16, color: result.eligible ? "#5FD08E" : "#F5B70C" }}>
              {result.eligible ? "You're in. Your post counts." : result.reason || "Almost there"}
            </span>
            {result.checks.map((c) => (
              <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                <span style={{ color: c.ok ? "#5FD08E" : "#FF6B5B" }}>{c.ok ? "✓" : "✗"}</span>
                {c.label}
              </div>
            ))}
            {result.post_url && (
              <a href={result.post_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#B5B2BC", textDecoration: "underline" }}>
                View post ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  giveawayId: string;
  title: string;
  status: string;
  winnerCount: number;
  prizePerWinner: number;
  tokenSymbol: string | null;
  criteria: QuickCriteria;
  eligibility?: { min_account_age_days?: number; verified_only?: boolean };
  isOwner: boolean;
  winners: Array<{ handle: string; rank: number | null }>;
  vrfRandomness: string | null;
  shareUrl: string;
}

export function QuickPostFeed({ giveawayId, title, status, winnerCount, prizePerWinner, tokenSymbol, criteria, eligibility, isOwner, winners, vrfRandomness, shareUrl }: Props) {
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "shortlist">("all");
  const [copied, setCopied] = useState(false);
  const open = status === "OPEN";

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["giveaway-quick-posts", giveawayId],
    queryFn: async (): Promise<{ posts: QuickPost[]; total: number; last_synced_at: string | null; draw_pool: "all" | "shortlist" }> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${giveawayId}/posts`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load posts");
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const authed = useCallback(async () => {
    const token = await getAccessToken().catch(() => null);
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, [getAccessToken]);

  const call = useCallback(
    async (path: string, method: "PUT" | "POST", body?: unknown) => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${giveawayId}/${path}`, { method, headers: await authed(), ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.message || "Something went wrong");
      }
      return res.json().catch(() => null);
    },
    [giveawayId, authed],
  );

  const posts = data?.posts ?? [];
  const shortlisted = posts.filter((p) => p.shortlisted);
  const pool = data?.draw_pool ?? "all";
  const drawCount = pool === "shortlist" ? shortlisted.length : posts.length;
  const list = filter === "shortlist" ? shortlisted : posts;
  const missing = Math.max(0, winnerCount - drawCount);
  const hasWinners = winners.length > 0;

  const toggleStar = async (p: QuickPost) => {
    try {
      await call(`posts/${p.entry_id}/${p.shortlisted ? "unshortlist" : "shortlist"}`, "PUT");
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not update the shortlist", description: e.message });
    }
  };

  const hide = async (p: QuickPost) => {
    try {
      await call(`posts/${p.entry_id}/exclude`, "PUT");
      await refetch();
      toast({
        title: "Post hidden",
        description: "It is out of the pool and the public feed.",
        action: (
          <ToastAction
            altText="Undo hiding this post"
            onClick={async () => {
              await call(`posts/${p.entry_id}/restore`, "PUT").catch(() => undefined);
              refetch();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not hide the post", description: e.message });
    }
  };

  const setPool = async (next: "all" | "shortlist") => {
    try {
      await call("draw-pool", "PUT", { pool: next });
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not change the draw pool", description: e.message });
    }
  };

  const refresh = async () => {
    setBusy("refresh");
    try {
      await call("posts/refresh", "POST");
      await refetch();
    } finally {
      setBusy(null);
    }
  };

  const runDraw = async () => {
    setBusy("draw");
    try {
      await call("force-run-draw", "PUT");
      toast({ title: "Winners drawn", description: "Prizes are sent by X username." });
      queryClient.invalidateQueries({ queryKey: ["giveaway-public", giveawayId] });
      queryClient.invalidateQueries({ queryKey: ["giveaway-public-entries"] });
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Draw failed", description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const prizeText = `$${prizePerWinner.toFixed(2).replace(/\.00$/, "")}${tokenSymbol ? ` in $${tokenSymbol}` : ""}`;
  const sortedWinners = [...winners].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const resultsPost = hasWinners
    ? `🎃 ${title} results!\n\n${sortedWinners.map((w, i) => `${i + 1}. @${w.handle} (${prizeText})`).join("\n")}\n\nDrawn with VRF from ${pool === "shortlist" ? "the shortlisted" : "all qualifying"} posts.\nProof: ${shareUrl}`
    : "";

  const copyResults = () => {
    try {
      navigator.clipboard.writeText(resultsPost);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  const chip = (on: boolean): CSSProperties => ({
    cursor: "pointer",
    padding: "9px 14px",
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 14,
    background: on ? "#F2EFE8" : "#141419",
    color: on ? "#0B0B0E" : "#B5B2BC",
    border: `1px solid ${on ? "#F2EFE8" : "rgba(255,255,255,0.08)"}`,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20, fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}>
      {open && <RulesAndCheck giveawayId={giveawayId} criteria={criteria} eligibility={eligibility} />}

      {isOwner && open && (
        <div style={{ ...card, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 30px 80px rgba(0,0,0,0.4)" }}>
          <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 19 }}>Draw {winnerCount} winner{winnerCount === 1 ? "" : "s"}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: "#8A8893" }}>DRAW FROM</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 14, background: "#0F0F13" }}>
              {([["shortlist", "★ My shortlist", shortlisted.length], ["all", "All qualifying", posts.length]] as const).map(([k, name, count]) => (
                <button key={k} type="button" onClick={() => setPool(k)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, padding: "10px 12px", borderRadius: 11, border: 0, textAlign: "left", background: pool === k ? "#26262E" : "transparent", color: "inherit" }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: pool === k ? "#F2EFE8" : "#8A8893" }}>{name}</span>
                  <span style={{ fontSize: 12, color: "#77757F" }}>{count} posts</span>
                </button>
              ))}
            </div>
          </div>
          {missing > 0 ? (
            <div style={{ textAlign: "center", padding: 15, borderRadius: 16, background: "#1B1B22", color: "#77757F", fontWeight: 800, fontSize: 14 }}>
              {pool === "shortlist" ? `Shortlist ${missing} more post${missing === 1 ? "" : "s"} to draw` : `Need ${missing} more qualifying post${missing === 1 ? "" : "s"} to draw`}
            </div>
          ) : (
            <button type="button" onClick={runDraw} disabled={busy === "draw"} style={{ ...gradientBtn, opacity: busy === "draw" ? 0.7 : 1 }}>
              {busy === "draw" ? "Requesting VRF randomness…" : `Draw ${winnerCount} with VRF`}
            </button>
          )}
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "#77757F" }}>
            {pool === "shortlist"
              ? "Star your favourites, then VRF picks the winners among them. The shortlist and the proof are public. Entries close for good when you draw."
              : "VRF picks winners among every qualifying post. Entries close for good when you draw."}
          </span>
        </div>
      )}

      {hasWinners && (
        <div style={{ ...card, gap: 12 }}>
          <span style={eyebrow}>WINNERS</span>
          {sortedWinners.map((w, i) => (
            <div key={w.handle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "#1B1B22" }}>
              <span style={{ flex: "none", width: 26, height: 26, borderRadius: 999, background: "linear-gradient(135deg,#FF2D0A,#F5B70C)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 15 }}>@{w.handle}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#5FD08E" }}>{prizeText}</span>
            </div>
          ))}
          {vrfRandomness && (
            <div style={{ padding: "10px 12px", borderRadius: 12, background: "#0F0F13", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", color: "#8A8893" }}>VRF PROOF · VERIFIABLE BY ANYONE</span>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#B5B2BC", wordBreak: "break-all" }}>0x{vrfRandomness}</span>
            </div>
          )}
          {isOwner && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 6 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 16 }}>Results post for X</span>
                <button type="button" onClick={copyResults} style={{ cursor: "pointer", background: "transparent", border: 0, fontSize: 14, fontWeight: 800, color: "#FF8A4A" }}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: "#0F0F13", fontSize: 14, lineHeight: 1.55, color: "#D8D5DD", whiteSpace: "pre-wrap" }}>{resultsPost}</div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={chip(filter === "all")} onClick={() => setFilter("all")}>
            Qualifies · {posts.length}
          </button>
          <button type="button" style={chip(filter === "shortlist")} onClick={() => setFilter("shortlist")}>
            ★ Shortlist · {shortlisted.length}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {data?.last_synced_at && <span style={{ fontSize: 13, color: "#6E6C78" }}>updated {timeAgo(data.last_synced_at)}</span>}
          {isOwner && open && (
            <button type="button" onClick={refresh} disabled={busy === "refresh" || isFetching} style={{ cursor: "pointer", padding: "8px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#B5B2BC", fontWeight: 700, fontSize: 13, opacity: busy === "refresh" ? 0.6 : 1 }}>
              {busy === "refresh" ? "Looking…" : "Look for new posts"}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div style={{ height: 96, borderRadius: 20, background: "rgba(255,255,255,0.05)" }} />
      ) : list.length === 0 ? (
        <div style={{ padding: 40, borderRadius: 20, border: "1px dashed rgba(255,255,255,0.12)", textAlign: "center", color: "#8A8893", fontSize: 14 }}>
          {filter === "shortlist" ? "Tap ★ on the posts you like best. They land here." : "No qualifying posts yet. Be the first. They show up here within a few minutes."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))", gap: 12 }}>
          {list.map((p) => {
            const isWinner = p.status === "winner";
            const media = p.post_media?.find((m) => m.preview)?.preview;
            return (
              <div key={p.entry_id} style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: 20, background: "#141419", border: `1.5px solid ${isWinner ? "rgba(60,179,113,0.6)" : p.shortlisted ? "rgba(245,183,12,0.6)" : "rgba(255,255,255,0.07)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar url={p.avatar_url} handle={p.x_handle} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
                    <a href={`https://x.com/${p.x_handle}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#F2EFE8" }}>
                      @{p.x_handle}
                    </a>
                    <span style={{ fontSize: 12, color: "#77757F" }}>{timeAgo(p.post_created_at)}</span>
                  </div>
                  {isWinner && <span style={{ flex: "none", padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: "rgba(60,179,113,0.14)", color: "#5FD08E" }}>Winner</span>}
                  {isOwner && open && (
                    <button type="button" title="Shortlist" onClick={() => toggleStar(p)} style={{ cursor: "pointer", flex: "none", width: 34, height: 34, borderRadius: 11, border: 0, display: "grid", placeItems: "center", fontSize: 17, background: p.shortlisted ? "rgba(245,183,12,0.16)" : "#1B1B22", color: p.shortlisted ? "#F5B70C" : "#5D5B66" }}>
                      ★
                    </button>
                  )}
                  {!isOwner && p.shortlisted && <span style={{ flex: "none", color: "#F5B70C", fontSize: 17 }}>★</span>}
                </div>
                {media && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)" }} />
                )}
                {p.post_text && <span style={{ fontSize: 14, lineHeight: 1.5, color: "#D8D5DD", wordBreak: "break-word" }}>{p.post_text}</span>}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto" }}>
                  {p.post_url && (
                    <a href={p.post_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3" }}>
                      Open on X ↗
                    </a>
                  )}
                  {isOwner && open && (
                    <button type="button" onClick={() => hide(p)} style={{ cursor: "pointer", marginLeft: "auto", background: "transparent", border: 0, fontSize: 13, color: "#77757F" }}>
                      Hide
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
