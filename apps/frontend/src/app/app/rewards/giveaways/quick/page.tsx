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

type RuleKind = "media" | "mention" | "hashtag" | "phrase" | "follow" | "like" | "repost";
const ENTRY_KINDS: RuleKind[] = ["follow", "like", "repost"];
interface Rule {
  id: string;
  kind: RuleKind;
  v: string;
  on: boolean;
}

interface ParsedRules {
  title: string | null;
  mentions: string[];
  follows?: string[];
  like?: boolean;
  repost?: boolean;
  hashtags: string[];
  phrase: string | null;
  require_media: boolean;
  prize_usd: number | null;
  winner_count: number | null;
  token_symbol: string | null;
  custom_prize: string | null;
  text?: string;
  author?: string | null;
  source: "ai" | "basic";
}

const TIERS: Array<[string, string, string, string]> = [
  ["", "1", "Unknown", "Anyone, including accounts with no notable crypto followers."],
  ["noted", "2", "Noted", "On the radar of real crypto accounts."],
  ["credible", "3", "Credible", "Followed by a solid crypto circle."],
  ["significant", "4", "Significant", "Followed by top KOLs, projects and funds."],
  ["supreme", "5", "Supreme", "The top of crypto X."],
];

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

const X_LINK = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S+\/status(?:es)?\/\d+/i;
const LISTING_FEE = 5;

function toLocalNow(): number {
  return Date.now();
}

/** Instant, free read of the pasted post. The AI read refines it a moment later. */
function basicRules(text: string): { rules: Rule[]; pool: number | null; winners: number | null } {
  const rules: Rule[] = [];
  let n = 0;
  const id = () => `r${n++}`;
  const follows = Array.from(new Set(Array.from(text.matchAll(/\bfollow(?:ing)?\s+(?:us\s+)?(?:on\s+x\s+)?(?:\(?\s*)?@([A-Za-z0-9_]{1,15})/gi)).map((m) => m[1].toLowerCase())));
  if (/\bmemes?\b|\b(post|share|make|create|drop|submit|reply with)\b[^.\n]{0,25}\b(image|video|photo|gif|art|pic)\b/i.test(text)) rules.push({ id: id(), kind: "media", v: "", on: true });
  for (const f of follows) rules.push({ id: id(), kind: "follow", v: f, on: true });
  if (/\blike\b/i.test(text)) rules.push({ id: id(), kind: "like", v: "", on: true });
  if (/\b(rt|retweet|repost)\b/i.test(text)) rules.push({ id: id(), kind: "repost", v: "", on: true });
  for (const m of new Set((text.match(/@([A-Za-z0-9_]{1,15})/g) ?? []).map((x) => x.slice(1).toLowerCase()))) if (!follows.includes(m)) rules.push({ id: id(), kind: "mention", v: m, on: true });
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
  (p.follows ?? []).forEach((v) => out.push({ id: id(), kind: "follow", v, on: true }));
  if (p.like) out.push({ id: id(), kind: "like", v: "", on: true });
  if (p.repost) out.push({ id: id(), kind: "repost", v: "", on: true });
  p.mentions.forEach((v) => out.push({ id: id(), kind: "mention", v, on: true }));
  p.hashtags.forEach((v) => out.push({ id: id(), kind: "hashtag", v, on: true }));
  if (p.phrase) out.push({ id: id(), kind: "phrase", v: p.phrase, on: true });
  return out;
}

function ruleText(r: Rule): { label: string; detail: string } {
  if (r.kind === "media") return { label: "Includes an image or video", detail: "Text-only posts don't count" };
  if (r.kind === "follow") return { label: `Follows @${r.v}`, detail: "Checked when they enter" };
  if (r.kind === "like") return { label: "Likes the post", detail: "Checked when they enter" };
  if (r.kind === "repost") return { label: "Reposts the post", detail: "Checked when they enter" };
  if (r.kind === "mention") return { label: `Tags @${r.v}`, detail: "Mention anywhere in the post" };
  if (r.kind === "hashtag") return { label: `Uses #${r.v}`, detail: "Not case-sensitive" };
  return { label: `Contains "${r.v}"`, detail: "Not case-sensitive" };
}

export default function QuickGiveawayPage() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getAccessToken, authenticated, login, ready } = usePrivy();

  const [raw, setRaw] = useState("");
  const [postLink, setPostLink] = useState("");
  const [prizeKind, setPrizeKind] = useState<"money" | "custom">("money");
  const [customPrize, setCustomPrize] = useState("");
  const [fetchedText, setFetchedText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
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
  const [advOpen, setAdvOpen] = useState(true);
  const [ageDays, setAgeDays] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [minTier, setMinTier] = useState("");
  const [reading, setReading] = useState(false);
  const [readBy, setReadBy] = useState<"ai" | "basic" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);

  // Read the pasted post: patterns right away, then the AI read replaces them when it lands.
  useEffect(() => {
    // Pasted text wins over the link: it is the fallback when the link cannot be read.
    const link = raw.trim() ? "" : postLink.trim();
    const text = link || raw.trim();
    setReading(false);
    if (!text) {
      setRules([]);
      setReadBy(null);
      setReadError(null);
      setFetchedText(null);
      return;
    }
    const isLink = !!link;
    setReadError(null);
    if (isLink && !X_LINK.test(link)) {
      setReadError("That does not look like a link to a post on X (x.com/name/status/...).");
      return;
    }
    if (!isLink) setFetchedText(null);
    const basic = isLink ? { rules: [] as Rule[], pool: null, winners: null } : basicRules(text);
    if (!isLink) setRules(basic.rules);
    if (basic.pool && basic.pool > 0) setPool(String(basic.pool));
    if (basic.winners && basic.winners > 0) setWinners(String(basic.winners));
    if (!isLink) setReadBy("basic");
    if (!ready) return;
    if (isLink && !authenticated) {
      setReadError("Sign in to read your post from its link.");
      return;
    }
    if (!authenticated || (!isLink && text.length < 20)) return;

    const mine = ++seq.current;
    if (isLink) setReading(true);
    const t = window.setTimeout(async () => {
      setReading(true);
      try {
        const accessToken = await getAccessToken().catch(() => null);
        const res = await fetch(`${BACKEND_URL}/giveaways/quick/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify(isLink ? { url: text } : { text }),
        });
        if (mine !== seq.current) return;
        if (!res.ok) {
          if (isLink) setReadError((await res.json().catch(() => null))?.message || "Could not read that post. Paste its text instead.");
          return;
        }
        const p = (await res.json()) as ParsedRules;
        if (mine !== seq.current) return;
        setRules(rulesFromParsed(p));
        if (isLink) {
          setFetchedText(p.text ?? null);
        }
        if (p.custom_prize) {
          setPrizeKind("custom");
          setCustomPrize(p.custom_prize);
        } else if (isLink) {
          setPrizeKind("money");
        }
        if (p.prize_usd) setPool(String(p.prize_usd));
        if (p.winner_count) setWinners(String(p.winner_count));
        if (p.title) setTitle((cur) => cur || p.title!);
        setTokenSymbolHint(p.token_symbol);
        setReadBy(p.source);
      } catch {
        if (isLink && mine === seq.current) setReadError("Could not read that post. Paste its text instead.");
      } finally {
        if (mine === seq.current) setReading(false);
      }
    }, isLink ? 250 : 1100);
    return () => window.clearTimeout(t);
  }, [raw, postLink, authenticated, ready, getAccessToken]);

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
  const hasEntryTasks = active.some((r) => ENTRY_KINDS.includes(r.kind));
  const needsPostLink = active.some((r) => r.kind === "like" || r.kind === "repost");
  const isCustom = prizeKind === "custom";
  const fee = isCustom ? LISTING_FEE : poolNum > 0 ? Math.min(80, Math.max(5, Math.round(poolNum * 10) / 100)) : 0;

  const problem = useMemo(() => {
    if (!raw.trim() && !active.length) return "Paste your post first";
    if (!active.length) return "Add at least one rule so we know which posts qualify";
    if (needsPostLink && !X_LINK.test(postLink.trim())) return "Paste the link to your X post above so people can like and repost it";
    if (isCustom) {
      if (!customPrize.trim()) return "Say what the winners get";
      if (!(winnersNum >= 1)) return "Add at least one winner";
      return null;
    }
    if (!(poolNum >= MIN_POOL)) return `Prize pool must be at least $${MIN_POOL}`;
    if (!(winnersNum >= 1)) return "Add at least one winner";
    if (perWinner < 1) return "Each winner needs at least $1";
    return null;
  }, [raw, active.length, poolNum, winnersNum, perWinner, isCustom, customPrize, needsPostLink, postLink]);

  const addRule = () => {
    const input = newRule.trim();
    if (!input) return;
    const f = input.match(/^follow\s+@?([A-Za-z0-9_]{1,15})$/i);
    const m = input.match(/^([@#])([A-Za-z0-9_]+)$/);
    const kind: RuleKind = f ? "follow" : m ? (m[1] === "@" ? "mention" : "hashtag") : "phrase";
    const v = f ? f[1].toLowerCase() : m ? m[2].toLowerCase() : input.slice(0, 120);
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
      const link = postLink.trim();
      const postText = [...mentions.map((m) => `@${m}`), ...hashtags.map((h) => `#${h}`), ...(phrase ? [phrase] : [])].join(" ").slice(0, 280);
      const entryTasks = [
        ...active.filter((r) => r.kind === "follow" && r.v).map((r) => ({ task_type: "x_follow", config: { target: r.v } })),
        ...(active.some((r) => r.kind === "like") ? [{ task_type: "x_like", config: { target: link } }] : []),
        ...(active.some((r) => r.kind === "repost") ? [{ task_type: "x_retweet", config: { target: link } }] : []),
        ...(postText ? [{ task_type: "x_post", config: { required_text: postText } }] : []),
      ];
      const autoTitle = hashtags[0] ? `#${hashtags[0]} giveaway` : mentions[0] ? `@${mentions[0]} giveaway` : "X giveaway";
      const res = await fetch(`${BACKEND_URL}/giveaways`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          giveaway_type: hasEntryTasks ? "standard" : "quick_post",
          title: (title.trim() || autoTitle).slice(0, 120),
          description: (fetchedText ?? raw.trim()) || undefined,
          winner_count: winnersNum,
          selection_mode: "random",
          prize_amount_usd: isCustom ? 0 : Math.round(perWinner * 100) / 100,
          reward_type: isCustom ? "custom" : "usdc",
          ...(isCustom ? { custom_prize_text: customPrize.trim() } : { prize_mint: token?.mint ?? null }),
          entries_close_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
          ...(hasEntryTasks
            ? { tasks: entryTasks }
            : {
                quick_duration_hours: hours,
                quick_criteria: {
                  required_mentions: mentions,
                  required_hashtags: hashtags,
                  ...(phrase ? { required_text: phrase } : {}),
                  ...(active.some((r) => r.kind === "media") ? { require_media: true } : {}),
                  ...(X_LINK.test(postLink.trim()) ? { announcement_url: postLink.trim() } : {}),
                  start_at: new Date(Date.now() - 3_600_000).toISOString(),
                },
              }),
          eligibility: {
            ...(Number(ageDays) > 0 ? { min_account_age_days: Number(ageDays) } : {}),
            ...(verifiedOnly ? { verified_only: true } : {}),
            ...(minTier ? { min_tier: minTier } : {}),
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
            <style>{`@keyframes lf-spin{to{transform:rotate(360deg)}}`}</style>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>LINK TO YOUR X POST</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 14px", borderRadius: 14, background: "#0F0F13", border: `1px solid ${readError && postLink.trim() ? "rgba(255,138,74,0.7)" : reading && postLink.trim() ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                <input
                  value={postLink}
                  onChange={(e) => setPostLink(e.target.value)}
                  autoFocus
                  placeholder="https://x.com/yourname/status/123..."
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontFamily: "inherit", fontWeight: 600, fontSize: 16, padding: "12px 0" }}
                />
                {reading && postLink.trim() && <span aria-label="Reading" style={{ flex: "none", width: 18, height: 18, borderRadius: 999, border: "2.5px solid rgba(255,138,74,0.25)", borderTopColor: "#FF8A4A", animation: "lf-spin .7s linear infinite" }} />}
                {fetchedText && !reading && postLink.trim() && <span style={{ flex: "none", color: "#3CB371", fontWeight: 800 }}>✓</span>}
              </div>
            </label>
            {(!postLink.trim() || (readError && !fetchedText)) && (
              <>
                <span style={{ fontSize: 13, color: "#6E6C78" }}>{postLink.trim() ? "Could not read the link. Paste the text of your post instead." : "No link yet? Paste the text of your post instead."}</span>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  rows={8}
                  placeholder={"Paste the text of your X post here.\n\nWe pick out the @accounts, #hashtags, the prize and how many winners."}
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 14, borderRadius: 16, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.08)", color: "#F2EFE8", fontFamily: "inherit", fontSize: 15, lineHeight: 1.55, outline: "none" }}
                />
              </>
            )}
            {fetchedText && (
              <div style={{ padding: 14, borderRadius: 16, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.08)", fontSize: 14, lineHeight: 1.55, color: "#B5B2BC", whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{fetchedText}</div>
            )}
            <span style={{ fontSize: 13, color: readError ? "#FF8A4A" : "#6E6C78" }}>
              {readError ? readError : reading ? (postLink.trim() ? "Reading your post from X…" : "Reading your post…") : fetchedText ? "Post read from your link. Check the rules on the right." : readBy === "ai" ? "Rules read by AI. Check them on the right." : readBy === "basic" ? "Rules found from the text. Check them on the right." : "Rules update as you type."}
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
                        {r.kind === "media" || r.kind === "like" || r.kind === "repost" ? (
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{t.label}</span>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 15, color: "#8A8893" }}>{r.kind === "follow" ? "Follows @" : r.kind === "mention" ? "Tags @" : r.kind === "hashtag" ? "Uses #" : "Contains"}</span>
                            <input
                              value={r.v}
                              aria-label="Edit rule"
                              onChange={(e) => {
                                const raw = e.target.value;
                                const v = r.kind === "phrase" ? raw.slice(0, 120) : raw.replace(/^[@#]/, "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase().slice(0, r.kind === "mention" || r.kind === "follow" ? 15 : 60);
                                setRules((cur) => cur.map((x) => (x.id === r.id ? { ...x, v } : x)));
                              }}
                              style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, borderBottom: "1px dashed rgba(255,255,255,0.18)", outline: "none", color: "#F2EFE8", fontFamily: "inherit", fontWeight: 700, fontSize: 15, padding: "2px 0" }}
                            />
                          </div>
                        )}
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
                placeholder="Add a rule: follow @handle, @tag, #hashtag or a phrase, then Enter"
                style={{ padding: "12px 14px", borderRadius: 14, background: "#0F0F13", border: "1px dashed rgba(255,255,255,0.12)", color: "#F2EFE8", fontFamily: "inherit", fontSize: 15, outline: "none" }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {([["media", "+ Image or video"], ["like", "+ Like the post"], ["repost", "+ Repost the post"]] as const).map(([k, name]) =>
                  rules.some((r) => r.kind === k) ? null : (
                    <button key={k} type="button" onClick={() => setRules((cur) => [...cur, { id: `m${toLocalNow()}${k}`, kind: k, v: "", on: true }])} style={{ cursor: "pointer", padding: "8px 13px", borderRadius: 999, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.08)", color: "#B5B2BC", fontWeight: 700, fontSize: 14 }}>
                      {name}
                    </button>
                  ),
                )}
              </div>
              {hasEntryTasks && (
                <span style={{ fontSize: 13, lineHeight: 1.5, color: "#F5B70C" }}>
                  Follow, like and repost are checked when people enter, so this runs with an Enter button instead of automatic post scanning. Tags, hashtags and phrases become a "post this" task{active.some((r) => r.kind === "media") ? ". The image rule is not checked in this mode" : ""}.
                </span>
              )}
            </div>

            <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 14, background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)" }}>
                {([["money", "USDC or token"], ["custom", "Something else"]] as const).map(([k, name]) => (
                  <button key={k} type="button" onClick={() => setPrizeKind(k)} style={{ cursor: "pointer", textAlign: "center", padding: "10px 4px", borderRadius: 10, fontWeight: 800, fontSize: 14, border: 0, background: prizeKind === k ? "#26262E" : "transparent", color: prizeKind === k ? "#F2EFE8" : "#8A8893" }}>
                    {name}
                  </button>
                ))}
              </div>
              {isCustom ? (
                <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>PRIZE · WHAT DO WINNERS GET?</span>
                  <input value={customPrize} onChange={(e) => setCustomPrize(e.target.value.slice(0, 140))} placeholder="e.g. Breakpoint ticket (London)" style={{ ...field, fontFamily: "inherit", fontWeight: 600, fontSize: 15 }} />
                  <span style={{ fontSize: 13, color: "#8A8893" }}>Not money, so there is nothing to fund. You pay a flat ${LISTING_FEE} listing fee and hand the prize to the winners yourself.</span>
                </label>
              ) : (
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>PRIZE POOL ($)</span>
                <input value={pool} onChange={(e) => setPool(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" style={field} />
              </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>WINNERS</span>
                <input value={winners} onChange={(e) => setWinners(e.target.value.replace(/\D/g, ""))} inputMode="numeric" style={field} />
              </label>

              {!isCustom && (
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
              )}

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
                {isCustom ? `${winnersNum > 0 ? winnersNum : 0} winners. You contact them and deliver the prize. ` : `${winnersNum > 0 && poolNum > 0 ? `${winnersNum} winners · $${perWinner.toFixed(2).replace(/\.00$/, "")} each. ` : ""}Winners are paid by X username and can claim without a Loofta account.`}
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
                    {Number(ageDays) > 0 || verifiedOnly || minTier ? [Number(ageDays) > 0 ? `Account ${ageDays}+ days old` : null, verifiedOnly ? "Verified only" : null, minTier ? `${TIERS.find((t) => t[0] === minTier)?.[2]} tier and up` : null].filter(Boolean).join(" · ") : "Anyone on X. Add an account age or verified filter."}
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={label}>MINIMUM CRYPTO REPUTATION</span>
                    <span style={{ fontSize: 13, color: "#8A8893" }}>Based on how many known crypto accounts follow them on X.</span>
                    {TIERS.map(([k, n, name, blurb]) => (
                      <button key={k || "any"} type="button" onClick={() => setMinTier(k)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "11px 14px", borderRadius: 14, background: minTier === k ? "rgba(255,90,26,0.12)" : "#0F0F13", border: `1px solid ${minTier === k ? "rgba(255,122,42,0.85)" : "rgba(255,255,255,0.07)"}`, color: "inherit" }}>
                        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: minTier === k ? "#FF7A2A" : "#8A8893" }}>TIER {n}</span>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{name}{k ? " and up" : ""}</span>
                        <span style={{ fontSize: 13, color: "#8A8893" }}>{blurb}</span>
                      </button>
                    ))}
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
                <span style={{ color: "#B5B2BC" }}>{isCustom ? "Listing fee" : "Publish fee"}</span>
                <span style={{ fontWeight: 700 }}>${fee.toFixed(2).replace(/\.00$/, "")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
                <span style={{ color: "#B5B2BC" }}>{isCustom ? "Prize" : "Prize pool"}</span>
                <span style={{ fontWeight: 700, textAlign: "right" }}>{isCustom ? `${customPrize.trim() || "Your prize"} · you deliver it` : `$${poolNum || 0} ${token ? `in ${token.symbol}` : "USDC"} · funded before it goes live`}</span>
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
              {isCustom ? `Next you pay the $${LISTING_FEE} listing fee.` : "Next you fund the pool."} It goes live once approved. Scanning, eligibility checks and the VRF draw are included.
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
