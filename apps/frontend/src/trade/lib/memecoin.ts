const clientApiBase = () => "/api/backend";

// Mirrors apps/backend/src/modules/memecoin-terminal (MemecoinItem / MemecoinDetail).
export type RiskLevel = "low" | "med" | "high";
export type StageKey = "new" | "final" | "grad";
export type CheckStatus = "good" | "warn" | "bad";

export interface MemecoinItem {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  status: "launchpad" | "migrated";
  stage: { key: StageKey; percent: number };
  ageMinutes: number | null;
  /** When the coin was created, in milliseconds since epoch. Lets the app show seconds and keep them ticking. */
  createdAt?: number | null;
  /** Market cap at launch, in dollars. Null once the coin has graduated. */
  startMcapUsd?: number | null;
  fresh: boolean;
  mcapUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  priceChange1h: number | null;
  dexPaid: boolean;
  liquidityLocked: boolean;
  risk: RiskLevel;
  passes: boolean;
  hiddenReason: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  /** Only the live feed fills these. null means the provider has not told us yet. */
  bundlerPct?: number | null;
  devPct?: number | null;
  proTraders?: number | null;
  /** Lifetime buy and sell trades, and the market cap at which the first batch is full. */
  buys?: number | null;
  sells?: number | null;
  goalMcapUsd?: number | null;
}

export interface MemecoinCheck {
  status: CheckStatus;
  title: string;
  why: string;
}

export interface MemecoinDetail extends MemecoinItem {
  checks: MemecoinCheck[];
  riskSummary: string;
  bundlerPct: number | null;
  devPct: number | null;
}

export interface MemecoinFeed {
  items: MemecoinItem[];
  meta: { shown: number; passedTotal: number; launches24h: number; hiddenToday: number; generatedAt: string };
}

export interface FeedParams {
  safe: boolean;
  lowRiskOnly: boolean;
  stage: StageKey | null;
  story?: string | null;
  /** Ask for pro trader counts too. Costs extra provider calls, so only when a filter needs it. */
  pro?: boolean;
}

export interface StoryCard {
  key: string;
  label: string;
  kind: "theme" | "emerging";
  coinCount: number;
  passingCount: number;
  recentCount: number;
  momentum: number;
  volumeUsd: number;
  heat: number;
  explain: string;
  topCoins: Array<{ mint: string; name: string | null; imageUrl: string | null }>;
}

export function storyMood(momentum: number): { text: string; color: string } {
  if (momentum >= 1.5) return { text: "Heating up", color: "#FF7A2A" };
  if (momentum <= 0.67) return { text: "Cooling off", color: "#77757F" };
  return { text: "Steady", color: "#3CB371" };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${clientApiBase()}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** Local sample data: dev builds only, opted into with ?fixture=1. */
function fixtureEnabled(): boolean {
  return process.env.NODE_ENV === "development" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fixture") === "1";
}

/**
 * The live feed (newest Pump launches, graduates, holder and risk data) comes from our own /api/backend/mini/pump
 * route. Only a story chip goes to the terminal backend, because stories are grouped there.
 */
const feedCache = new Map<string, { at: number; data: MemecoinFeed }>();
const feedInflight = new Map<string, Promise<MemecoinFeed>>();
const FEED_FRESH_MS = 3_000;

/**
 * One request per feed at a time, and a short memory of the last answer. Switching chips, remounting the tab or two
 * effects asking at once all share the same call instead of each hitting the backend.
 */
export function fetchMemecoinFeed(p: FeedParams): Promise<MemecoinFeed> {
  const key = JSON.stringify([p.safe, p.stage ?? "", p.story ?? "", !!p.pro]);
  const hit = feedCache.get(key);
  if (hit && Date.now() - hit.at < FEED_FRESH_MS) return Promise.resolve(hit.data);
  const running = feedInflight.get(key);
  if (running) return running;
  const req = loadMemecoinFeed(p)
    .then((data) => {
      feedCache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => feedInflight.delete(key));
  feedInflight.set(key, req);
  return req;
}

async function loadMemecoinFeed(p: FeedParams): Promise<MemecoinFeed> {
  if (fixtureEnabled()) return (await import("./memecoinDevFixture")).fixtureFeed(p);
  if (p.story) {
    const q = new URLSearchParams({ safe: String(p.safe), limit: "100", story: p.story });
    if (p.stage) q.set("stage", p.stage);
    return getJson<MemecoinFeed>(`/memecoin/feed?${q}`);
  }
  const qs = new URLSearchParams();
  if (p.pro) qs.set("pro", "1");
  if (p.stage) qs.set("stage", p.stage);
  const res = await fetch(`/api/backend/mini/pump${qs.size ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Feed unavailable");
  return (await res.json()) as MemecoinFeed;
}

/** Live numbers for coins on screen. Any field can be null when the provider does not know it yet. */
export interface LiveBits {
  mcapUsd: number | null;
  price: number | null;
  change5m: number | null;
  change1h: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  buys: number | null;
  sells: number | null;
}

export async function fetchLive(mints: string[]): Promise<Record<string, LiveBits>> {
  if (mints.length === 0) return {};
  const res = await fetch(`/api/backend/mini/live?mints=${mints.join(",")}`, { cache: "no-store" });
  if (!res.ok) return {};
  return ((await res.json()) as { live?: Record<string, LiveBits> }).live ?? {};
}

export async function fetchMemecoinStories(): Promise<{ stories: StoryCard[]; generatedAt: string }> {
  if (fixtureEnabled()) return (await import("./memecoinDevFixture")).fixtureStories();
  return getJson("/memecoin/stories");
}

export async function fetchMemecoinDetail(mint: string): Promise<MemecoinDetail> {
  if (fixtureEnabled()) return (await import("./memecoinDevFixture")).fixtureDetail(mint);
  return getJson<MemecoinDetail>(`/memecoin/token/${encodeURIComponent(mint)}`);
}

// ---- presentation helpers -------------------------------------------------

export const RISK_STYLE: Record<RiskLevel, { label: string; color: string; bg: string; border: string }> = {
  low: { label: "Lower risk", color: "#3CB371", bg: "rgba(60,179,113,0.14)", border: "rgba(60,179,113,0.35)" },
  med: { label: "Some risk", color: "#F5B70C", bg: "rgba(245,183,12,0.13)", border: "rgba(245,183,12,0.35)" },
  high: { label: "High risk", color: "#FF5A4A", bg: "rgba(255,90,74,0.13)", border: "rgba(255,90,74,0.35)" },
};

export const STAGE_STYLE: Record<StageKey, { title: string; short: string; color: string; why: string }> = {
  new: {
    title: "Just launched",
    short: "New",
    color: "#FF8A4A",
    why: "A brand new coin. Every coin starts with a first batch that buyers fill up, and the price rises a little with each buy. Very early, so it can jump fast or drop to zero.",
  },
  final: {
    title: "Almost full",
    short: "Almost full",
    color: "#F5B70C",
    why: "Its first batch is nearly sold out. At 100% it graduates to the open market, where anyone can trade it. Many coins stall before they get there.",
  },
  grad: {
    title: "Graduated",
    short: "Graduated",
    color: "#3CB371",
    why: "It filled its first batch and now trades on the open market, so it is easier to buy and sell. It passed the first test, but it can still fall.",
  },
};

/** "34% full", "Graduated". The plain-language label for where a coin is in its life. */
export function fillText(item: Pick<MemecoinItem, "stage">): string {
  return item.stage.key === "grad" ? "Graduated" : `${item.stage.percent}% full`;
}

export const CHECK_DOT: Record<CheckStatus, string> = { good: "#3CB371", warn: "#F5B70C", bad: "#FF5A4A" };

const AVATAR_GRADIENTS = [
  "#9CC8FF 0%,#2775CA 48%,#1A55A0 100%",
  "#FFB4AE 0%,#F23B3B 45%,#B3141C 100%",
  "#C49BFF 0%,#6D1ED4 50%,#4A0FA0 100%",
  "#8DF5A6 0%,#00D632 45%,#00A326 100%",
  "#FFC79A 0%,#FF5A1A 45%,#D23806 100%",
  "#FFF0B8 0%,#F5B70C 42%,#D17A04 100%",
];

export function avatarBackground(mint: string): string {
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) >>> 0;
  return `radial-gradient(120% 120% at 28% 18%,${AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]})`;
}

export function initials(item: Pick<MemecoinItem, "symbol" | "name" | "mint">): string {
  return (item.symbol || item.name || item.mint).slice(0, 2).toUpperCase();
}

export function displayName(item: Pick<MemecoinItem, "name" | "symbol" | "mint">): string {
  return item.name || item.symbol || `${item.mint.slice(0, 4)}…${item.mint.slice(-4)}`;
}

export function formatUsd(n: number | null): string {
  if (n == null) return "n/a";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** "12s", "5m", "3h", "2d" from a creation time. Ticks live when `now` is passed in every second. */
export function formatAgeAt(createdAt: number | null | undefined, now: number): string | null {
  if (!createdAt) return null;
  const s = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function formatAge(minutes: number | null): string {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function formatChange(n: number | null): { text: string; color: string } {
  if (n == null) return { text: "n/a", color: "#77757F" };
  const text = `${n >= 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
  return { text, color: n >= 0 ? "#3CB371" : "#FF5A4A" };
}

export const SAFE_RULES: Array<{ title: string; why: string }> = [
  { title: "At least $500 traded today", why: "So it isn't a ghost town you can't sell out of." },
  { title: "At least 12 holders", why: "Real people own it, not just the creator." },
  { title: "Max 20% bundled", why: "Insiders didn't grab the supply in the first second." },
  { title: "Creator holds max 15%", why: "The creator can't crash the price alone." },
];
