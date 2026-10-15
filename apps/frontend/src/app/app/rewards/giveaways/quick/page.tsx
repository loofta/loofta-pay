"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { clientApiBase } from "@/services/api/client";
import { useToast } from "@/components/ui/use-toast";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import "@/components/app-home/loofta-app.css";

const BACKEND_URL = clientApiBase();
const MIN_POOL = 20;
const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

interface PrizeToken {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  usdPrice: number | null;
}

type RuleKind = "media" | "mention" | "hashtag" | "phrase";
interface Rule {
  id: string;
  kind: RuleKind;
  v: string;
  on: boolean;
}

interface ParsedRules {
  title: string | null;
  mentions: string[];
  hashtags: string[];
  phrase: string | null;
  require_media: boolean;
  prize_usd: number | null;
  winner_count: number | null;
  token_symbol: string | null;
  source: "ai" | "basic";
}

const END_OPTIONS: Array<[number, string]> = [
  [6, "6 hours"],
  [24, "24 hours"],
  [48, "48 hours"],
  [72, "3 days"],
];
const AGE_OPTIONS: Array<[string, string]> = [
  ["", "Any"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "1 year"],
];

const card: CSSProperties = { padding: 22, borderRadius: 24, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 14 };
const label: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: "#8A8893" };
const field: CSSProperties = { padding: "12px 14px", borderRadius: 14, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", fontFamily: SORA, fontWeight: 700, fontSize: 16, outline: "none", width: "100%", boxSizing: "border-box" };

function toLocalNow(): number {
  return Date.now();
}

/** Instant, free read of the pasted post. The AI read refines it a moment later. */
function basicRules(text: string): { rules: Rule[]; pool: number | null; winners: number | null } {
  const rules: Rule[] = [];
  let n = 0;
  const id = () => `r${n++}`;
  if (/\b(meme|image|video|photo|gif|art|pic)\b/i.test(text)) rules.push({ id: id(), kind: "media", v: "", on: true });
  for (const m of new Set((text.match(/@([A-Za-z0-9_]{1,15})/g) ?? []).map((x) => x.slice(1).toLowerCase()))) rules.push({ id: id(), kind: "mention", v: m, on: true });
  for (const h of new Set((text.match(/#([A-Za-z0-9_]{1,60})/g) ?? []).map((x) => x.slice(1).toLowerCase()))) rules.push({ id: id(), kind: "hashtag", v: h, on: true });
  const money = text.match(/\$\s?(\d+(?:\.\d+)?)(?![A-Za-z])|(\d+(?:\.\d+)?)\s?\$/);
  const winners = text.match(/(\d+)\s+(?:best|winners?|lucky)/i);
  return { rules, pool: money ? Number(money[1] ?? money[2]) : null, winners: winners ? Number(winners[1]) : null };
}

function rulesFromParsed(p: ParsedRules): Rule[] {
  const out: Rule[] = [];
  let n = 0;
  const id = () => `a${n++}`;
  if (p.require_media) out.push({ id: id(), kind: "media", v: "", on: true });
  p.mentions.forEach((v) => out.push({ id: id(), kind: "mention", v, on: true }));
  p.hashtags.forEach((v) => out.push({ id: id(), kind: "hashtag", v, on: true }));
  if (p.phrase) out.push({ id: id(), kind: "phrase", v: p.phrase, on: true });
  return out;
}

function ruleText(r: Rule): { label: string; detail: string } {
  if (r.kind === "media") return { label: "Includes an image or video", detail: "Text-only posts don't count" };
  if (r.kind === "mention") return { label: `Tags @${r.v}`, detail: "Mention anywhere in the post" };
  if (r.kind === "hashtag") return { label: `Uses #${r.v}`, detail: "Not case-sensitive" };
  return { label: `Contains "${r.v}"`, detail: "Not case-sensitive" };
}

export default function QuickGiveawayPage() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getAccessToken, authenticated, login } = usePrivy();

  const [raw, setRaw] = useState("");
  const [announcementUrl, setAnnouncementUrl] = useState("");
  const [title, setTitle] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [newRule, setNewRule] = useState("");
  const [pool, setPool] = useState("50");
  const [winners, setWinners] = useState("3");
  const [hours, setHours] = useState(48);
  const [token, setToken] = useState<PrizeToken | null>(null);
  const [tokenSymbolHint, setTokenSymbolHint] = useState<string | null>(null);
  const [tokenQuery, setTokenQuery] = useState("");
  const [tokenHits, setTokenHits] = useState<PrizeToken[]>([]);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [ageDays, setAgeDays] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [reading, setReading] = useState(false);
  const [readBy, setReadBy] = useState<"ai" | "basic" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);

  // Read the pasted post: patterns right away, then the AI read replaces them when it lands.
  useEffect(() => {
    const text = raw.trim();
    if (!text) {
      setRules([]);
      setReadBy(null);
      return;
    }
    const basic = basicRules(text);
    setRules(basic.rules);
    if (basic.pool && basic.pool > 0) setPool(String(basic.pool));
    if (basic.winners && basic.winners > 0) setWinners(String(basic.winners));
    setReadBy("basic");
    if (!authenticated || text.length < 20) return;

    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      setReading(true);
      try {
        const accessToken = await getAccessToken().catch(() => null);
        const res = await fetch(`${BACKEND_URL}/giveaways/quick/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({ text }),
        });
        if (!res.ok || mine !== seq.current) return;
        const p = (await res.json()) as ParsedRules;
        if (mine !== seq.current) return;
        setRules(rulesFromParsed(p));
        if (p.prize_usd) setPool(String(p.prize_usd));
        if (p.winner_count) setWinners(String(p.winner_count));
        if (p.title) setTitle((cur) => cur || p.title!);
        setTokenSymbolHint(p.token_symbol);
        setReadBy(p.source);
      } catch {
        /* keep the pattern read */
      } finally {
        if (mine === seq.current) setReading(false);
      }
    }, 1100);
    return () => window.clearTimeout(t);
  }, [raw, authenticated, getAccessToken]);

  // The post named a token ($TIPANSEM): pre-fill the search so it is one click to confirm.
  useEffect(() => {
    if (tokenSymbolHint && !token) setTokenQuery(tokenSymbolHint);
  }, [tokenSymbolHint, token]);

  useEffect(() => {
    const q = tokenQuery.trim();
    if (q.length < 2) {
      setTokenHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      fetch(`${BACKEND_URL}/giveaways/public/tokens?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((b: { tokens?: PrizeToken[] }) => setTokenHits(Array.isArray(b.tokens) ? b.tokens : []))
        .catch(() => setTokenHits([]));
    }, 280);
    return () => window.clearTimeout(t);
  }, [tokenQuery]);

  const active = rules.filter((r) => r.on);
  const poolNum = Number(pool);
  const winnersNum = Math.floor(Number(winners));
  const perWinner = winnersNum > 0 ? poolNum / winnersNum : 0;
  const fee = poolNum > 0 ? Math.min(80, Math.max(5, Math.round(poolNum * 10) / 100)) : 0;

  const problem = useMemo(() => {
    if (!raw.trim() && !active.length) return "Paste your post first";
    if (!active.length) return "Add at least one rule so we know which posts qualify";
    if (!(poolNum >= MIN_POOL)) return `Prize pool must be at least $${MIN_POOL}`;
    if (!(winnersNum >= 1)) return "Add at least one winner";
    if (perWinner < 1) return "Each winner needs at least $1";
    return null;
  }, [raw, active.length, poolNum, winnersNum, perWinner]);

  const addRule = () => {
    const m = newRule.trim().match(/^([@#])([A-Za-z0-9_]+)$/);
    if (!m) return;
    const kind: RuleKind = m[1] === "@" ? "mention" : "hashtag";
    const v = m[2].toLowerCase();
    setRules((cur) => (cur.some((r) => r.kind === kind && r.v === v) ? cur : [...cur, { id: `m${toLocalNow()}`, kind, v, on: true }]));
    setNewRule("");
  };

  const submit = async () => {
    if (!authenticated) {
      login();
      return;
    }
    if (problem) {
      toast({ variant: "destructive", title: problem });
      return;
    }
    setSubmitting(true);
    try {
      const accessToken = await getAccessToken().catch(() => null);
      const phrase = active.find((r) => r.kind === "phrase")?.v;
      const mentions = active.filter((r) => r.kind === "mention").map((r) => r.v);
      const hashtags = active.filter((r) => r.kind === "hashtag").map((r) => r.v);
      const autoTitle = hashtags[0] ? `#${hashtags[0]} giveaway` : mentions[0] ? `@${mentions[0]} giveaway` : "X giveaway";
      const res = await fetch(`${BACKEND_URL}/giveaways`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          giveaway_type: "quick_post",
          title: (title.trim() || autoTitle).slice(0, 120),
          description: raw.trim() || undefined,
          winner_count: winnersNum,
          selection_mode: "random",
          prize_amount_usd: Math.round(perWinner * 100) / 100,
          reward_type: "usdc",
          prize_mint: token?.mint ?? null,
          entries_close_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
          quick_duration_hours: hours,
          quick_criteria: {
            required_mentions: mentions,
            required_hashtags: hashtags,
            ...(phrase ? { required_text: phrase } : {}),
            ...(active.some((r) => r.kind === "media") ? { require_media: true } : {}),
            ...(announcementUrl.trim() ? { announcement_url: announcementUrl.trim() } : {}),
            start_at: new Date(Date.now() - 3_600_000).toISOString(),
          },
          eligibility: {
            ...(Number(ageDays) > 0 ? { min_account_age_days: Number(ageDays) } : {}),
            ...(verifiedOnly ? { verified_only: true } : {}),
          },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(", ") : body?.message || "Could not create the giveaway");
      queryClient.invalidateQueries({ queryKey: ["giveaways-mine"] });
      const g = body?.giveaway;
      router.push(`/app/rewards/giveaways/${g?.short_id ?? g?.id}`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not create the giveaway", description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const pill = (on: boolean): CSSProperties => ({
    cursor: "pointer",
    padding: "8px 13px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 14,
    background: on ? "rgba(255,90,26,0.12)" : "#0F0F13",
    color: on ? "#F2EFE8" : "#9A98A3",
    border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}`,
  });

  return (
    <div className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8", minHeight: "calc(100vh - var(--header-h, 0px))" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(20px, 4vw, 48px) clamp(16px, 4vw, 40px) 96px", display: "flex", flexDirection: "column", gap: 28 }}>
        <Link href="/app/rewards/giveaways" style={{ fontSize: 15, color: "#8A8893" }}>
          ← Back to giveaways
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.2em", color: "#FF8A4A" }}>QUICK GIVEAWAY · PASTE YOUR POST</span>
          <h1 style={{ margin: 0, fontFamily: SORA, fontWeight: 700, fontSize: "clamp(34px, 5vw, 58px)", letterSpacing: "-0.05em", lineHeight: 1 }}>Turn your X post into a giveaway.</h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#9A98A3" }}>
            Paste the post you are publishing. We read the rules, find every post that follows them, and draw winners with VRF. Nobody has to click enter.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 20, alignItems: "start" }}>
          <div style={card}>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={13}
              placeholder={"Paste the text of your X post here.\n\nWe pick out the @accounts, #hashtags, the prize and how many winners."}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 14, borderRadius: 16, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", fontFamily: "inherit", fontSize: 15, lineHeight: 1.55, outline: "none" }}
            />
            <input
              value={announcementUrl}
              onChange={(e) => setAnnouncementUrl(e.target.value)}
              placeholder="Link to your post (optional, shown on the page)"
              style={{ ...field, fontFamily: "inherit", fontWeight: 600, fontSize: 15 }}
            />
            <span style={{ fontSize: 13, color: "#6E6C78" }}>
              {reading ? "Reading your post…" : readBy === "ai" ? "Rules read by AI. Check them on the right." : readBy === "basic" ? "Rules found from the text. Check them on the right." : "Rules update as you type."}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 18 }}>Rules we found</span>
                <span style={{ fontSize: 13, color: "#8A8893" }}>{active.length} checked automatically</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rules.length === 0 && <span style={{ fontSize: 14, color: "#6E6C78" }}>Paste your post to see the rules, or add one below.</span>}
                {rules.map((r) => {
                  const t = ruleText(r);
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "#1B1B22", opacity: r.on ? 1 : 0.45 }}>
                      <button
                        type="button"
                        aria-label={r.on ? "Turn rule off" : "Turn rule on"}
                        onClick={() => setRules((cur) => cur.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))}
                        style={{ cursor: "pointer", flex: "none", width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: r.on ? "#3CB371" : "transparent", border: `1.5px solid ${r.on ? "#3CB371" : "rgba(255,255,255,0.2)"}`, color: "#fff", fontSize: 12, fontWeight: 800 }}
                      >
                        {r.on ? "✓" : ""}
                      </button>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{t.label}</span>
                        <span style={{ fontSize: 13, color: "#77757F" }}>{t.detail}</span>
                      </div>
                      <button type="button" aria-label="Remove rule" onClick={() => setRules((cur) => cur.filter((x) => x.id !== r.id))} style={{ cursor: "pointer", flex: "none", fontSize: 20, color: "#5D5B66", padding: "0 4px", background: "transparent", border: 0 }}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
              <input
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRule()}
                placeholder="Add a rule: @handle or #hashtag, then Enter"
                style={{ padding: "12px 14px", borderRadius: 14, background: "#0F0F13", border: "1px dashed rgba(255,255,255,0.12)", color: "#F2EFE8", fontFamily: "inherit", fontSize: 15, outline: "none" }}
              />
            </div>

            <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>PRIZE POOL ($)</span>
                <input value={pool} onChange={(e) => setPool(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" style={field} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>WINNERS</span>
                <input value={winners} onChange={(e) => setWinners(e.target.value.replace(/\D/g, ""))} inputMode="numeric" style={field} />
              </label>

              <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>PAID IN · USDC OR ANY SOLANA TOKEN</span>
                {token ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 14px", borderRadius: 14, background: "#0F0F13", border: "1px solid rgba(255,122,42,0.6)" }}>
                    {token.logo && <Image src={token.logo} alt="" width={26} height={26} style={{ borderRadius: 999 }} unoptimized />}
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>
                      {token.symbol} <span style={{ color: "#77757F", fontWeight: 500 }}>{token.name}</span>
                    </span>
                    <button type="button" onClick={() => setToken(null)} style={{ cursor: "pointer", padding: "6px 12px", borderRadius: 999, background: "#22222A", color: "#B5B2BC", fontWeight: 700, fontSize: 13, border: 0 }}>
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px 4px 14px", borderRadius: 14, background: "#0F0F13", border: `1px solid ${tokenOpen ? "rgba(255,122,42,0.6)" : "rgba(255,255,255,0.08)"}` }}>
                      <input
                        value={tokenQuery}
                        onChange={(e) => {
                          setTokenQuery(e.target.value);
                          setTokenOpen(true);
                        }}
                        onFocus={() => setTokenOpen(true)}
                        placeholder="Search a token or paste its mint address"
                        style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontFamily: "inherit", fontSize: 15, padding: "10px 0" }}
                      />
                      <span style={{ flex: "none", padding: "6px 12px", borderRadius: 999, background: "#22222A", fontWeight: 700, fontSize: 13.5 }}>USDC</span>
                    </div>
                    {tokenOpen && tokenHits.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRadius: 16, background: "#1B1B22", border: "1px solid rgba(255,255,255,0.08)", maxHeight: 248, overflow: "auto" }}>
                        {tokenHits.map((t) => (
                          <button
                            key={t.mint}
                            type="button"
                            onClick={() => {
                              setToken(t);
                              setTokenOpen(false);
                              setTokenHits([]);
                            }}
                            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: 10, borderRadius: 12, background: "transparent", border: 0, color: "inherit", textAlign: "left" }}
                          >
                            {t.logo ? <Image src={t.logo} alt="" width={30} height={30} style={{ borderRadius: 999 }} unoptimized /> : <span style={{ width: 30, height: 30, borderRadius: 999, background: "#3A3A44" }} />}
                            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{t.symbol}</span>
                              <span style={{ fontSize: 13, color: "#8A8893", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <span style={{ fontSize: 13, color: "#8A8893" }}>
                  {token ? `You fund the pool in USDC. It is swapped into ${token.symbol} on Solana when funding lands.` : tokenSymbolHint ? `Your post mentions $${tokenSymbolHint}. Pick it above to pay in it, or leave USDC.` : "Leave empty to pay winners in USDC."}
                </span>
              </div>

              <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>RUNS FOR · MAX 3 DAYS</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 14, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {END_OPTIONS.map(([h, name]) => (
                    <button key={h} type="button" onClick={() => setHours(h)} style={{ cursor: "pointer", textAlign: "center", padding: "10px 4px", borderRadius: 10, fontWeight: 800, fontSize: 14, border: 0, background: hours === h ? "#26262E" : "transparent", color: hours === h ? "#F2EFE8" : "#8A8893" }}>
                      {name}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 13, color: "#8A8893" }}>The clock starts when your giveaway goes live, not when you create it.</span>
              </div>
              <span style={{ gridColumn: "1 / -1", fontSize: 13, color: "#8A8893" }}>
                {winnersNum > 0 && poolNum > 0 ? `${winnersNum} winners · $${perWinner.toFixed(2).replace(/\.00$/, "")} each. ` : ""}Winners are paid by X username and can claim without a Loofta account.
              </span>
            </div>

            <div style={{ ...card, padding: 0, gap: 0 }}>
              <button type="button" onClick={() => setAdvOpen((o) => !o)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", background: "transparent", border: 0, color: "inherit", textAlign: "left" }}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 17 }}>Who can win</span>
                    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, background: "rgba(245,183,12,0.14)", color: "#F5B70C" }}>Advanced</span>
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: "#8A8893" }}>
                    {Number(ageDays) > 0 || verifiedOnly ? [Number(ageDays) > 0 ? `Account ${ageDays}+ days old` : null, verifiedOnly ? "Verified only" : null].filter(Boolean).join(" · ") : "Anyone on X. Add an account age or verified filter."}
                  </span>
                </span>
                <span style={{ flex: "none", fontSize: 20, color: "#8A8893", transform: `rotate(${advOpen ? 180 : 0}deg)`, transition: "transform .2s" }}>⌄</span>
              </button>
              {advOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "4px 22px 22px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={label}>MIN X ACCOUNT AGE</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {AGE_OPTIONS.map(([k, name]) => (
                        <button key={k} type="button" onClick={() => setAgeDays(k)} style={{ ...pill(ageDays === k) }}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 14px", borderRadius: 16, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>Verified X accounts only</span>
                      <span style={{ fontSize: 13, color: "#8A8893" }}>Posts need X&apos;s verified badge</span>
                    </div>
                    <button type="button" aria-label="Toggle verified only" onClick={() => setVerifiedOnly((v) => !v)} style={{ cursor: "pointer", position: "relative", flex: "none", width: 48, height: 28, borderRadius: 999, border: 0, background: verifiedOnly ? "linear-gradient(90deg,#FF2D0A,#F5B70C)" : "#3A3A44" }}>
                      <span style={{ position: "absolute", top: 3, left: verifiedOnly ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: "#fff", transition: "left .2s" }} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: "18px 22px", borderRadius: 20, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                <span style={{ color: "#B5B2BC" }}>Publish fee</span>
                <span style={{ fontWeight: 700 }}>${fee.toFixed(2).replace(/\.00$/, "")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
                <span style={{ color: "#B5B2BC" }}>Prize pool</span>
                <span style={{ fontWeight: 700, textAlign: "right" }}>${poolNum || 0} {token ? `in ${token.symbol}` : "USDC"} · funded before it goes live</span>
              </div>
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              style={{ cursor: submitting ? "default" : "pointer", textAlign: "center", padding: "17px 26px", borderRadius: 18, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: 600, fontSize: 17, boxShadow: "0 14px 40px rgba(255,70,10,0.3)", opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Creating…" : authenticated ? `Create giveaway · $${fee.toFixed(2).replace(/\.00$/, "")} fee` : "Sign in to create"}
            </button>
            <span style={{ fontSize: 13, color: "#6E6C78", textAlign: "center" }}>
              Next you fund the pool. It goes live once approved. Scanning, eligibility checks and the VRF draw are included.
            </span>

            <div style={{ padding: 18, borderRadius: 20, border: "1px dashed rgba(255,255,255,0.14)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 16 }}>Want to do more?</span>
                <span style={{ fontSize: 14, lineHeight: 1.5, color: "#9A98A3" }}>
                  Follow, repost and join tasks, Telegram and Discord steps, region filters and more. Use our Rewards Rail.
                </span>
              </div>
              <Link href="/rewards-rail" style={{ flex: "none", padding: "11px 18px", borderRadius: 14, border: "1px solid rgba(255,122,42,0.45)", color: "#FF8A4A", fontWeight: 800, fontSize: 14 }}>
                Open Rewards Rail →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
