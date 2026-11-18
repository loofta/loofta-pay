/**
 * Prediction markets through Jupiter's Prediction API (beta), which pools Polymarket and Kalshi liquidity.
 * Called straight from the browser: it allows cross-origin calls, works without a key at a lower rate limit,
 * and blocks US and South Korea by the caller's own IP, so those users are turned away by Jupiter, not by us.
 * Money is in micro USD everywhere: 1,000,000 = $1.00. A price of 740000 means 74 cents, or a 74% chance.
 */
const BASE = "https://api.jup.ag/prediction/v1";
const KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";

export const MIN_BET_USD = 5;

export interface PredictMarket {
  marketId: string;
  provider?: string;
  status: string;
  result?: string | null;
  title: string;
  closeTime?: number;
  imageUrl?: string | null;
  rulesPrimary?: string;
  pricing?: { buyYesPriceUsd: number; buyNoPriceUsd: number; sellYesPriceUsd: number; sellNoPriceUsd: number; volume?: number };
  /** Sports events come as many markets: the winner, totals at several lines, and yes/no questions. */
  sportsMarketType?: string | null;
  sportsLine?: string | null;
  isTeamMarket?: boolean;
  team?: { name: string; imageUrl?: string | null; color?: string; abbreviation?: string } | null;
  marketOptions?: Array<{ label: string; buyYes: boolean }>;
  conditionId?: string;
}

export interface PredictEvent {
  eventId: string;
  category: string;
  metadata: { title: string; subtitle?: string; imageUrl?: string; closeTime?: string; isLive?: boolean };
  volumeUsd?: string;
  volume24hr?: string;
  beginAt?: string;
  markets?: PredictMarket[];
}

/** The picture for an event: its own, or the first team's when the event has none. */
export const eventImage = (e: PredictEvent): string | null => e.metadata.imageUrl || (e.markets ?? []).find((m) => m.team?.imageUrl)?.team?.imageUrl || null;

/** "O 2.5" becomes "Over 2.5", "U 2.5" becomes "Under 2.5". Everything else is kept. */
export const optionLabel = (m: PredictMarket): string => {
  const raw = m.marketOptions?.[0]?.label ?? m.title;
  return raw.replace(/^O\s/, "Over ").replace(/^U\s/, "Under ");
};

export type TotalsLine = { line: string; over?: PredictMarket; under?: PredictMarket };
export type MarketGroups = { winner: PredictMarket[]; totals: TotalsLine[]; other: PredictMarket[] };

/** Splits an event's open markets the way a sports page lays them out: who wins, over/under per line, then everything else. */
export function groupMarkets(markets: PredictMarket[]): MarketGroups {
  const winner: PredictMarket[] = [];
  const lines = new Map<string, TotalsLine>();
  const other: PredictMarket[] = [];
  for (const m of markets) {
    if (m.sportsMarketType === "moneyline" && m.team) winner.push(m);
    else if (m.sportsMarketType === "totals" && m.sportsLine) {
      const t = lines.get(m.sportsLine) ?? { line: m.sportsLine };
      if (/^O\s/.test(m.marketOptions?.[0]?.label ?? "") || m.title === "Over") t.over = m;
      else t.under = m;
      lines.set(m.sportsLine, t);
    } else other.push(m);
  }
  const totals = [...lines.values()].sort((a, b) => Number(a.line) - Number(b.line));
  return { winner, totals, other: other.sort((a, b) => (b.pricing?.volume ?? 0) - (a.pricing?.volume ?? 0)) };
}

export type PredictTrade = { id: string; side: "BUY" | "SELL"; outcome: string; price: number; usd: number; at: number; who: string };

/** Recent trades on an event, from Polymarket's public trade feed (it allows calls from the browser). Quiet on any failure. */
export async function getEventTrades(conditionIds: string[]): Promise<PredictTrade[]> {
  const ids = [...new Set(conditionIds.filter(Boolean))].slice(0, 4);
  const lists = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`https://data-api.polymarket.com/v2/trades?conditionId=${encodeURIComponent(id)}&limit=12`);
        if (!r.ok) return [];
        const j = (await r.json()) as { data?: Array<{ side: "BUY" | "SELL"; outcome?: string; price: number; size: number; timestamp: number; pseudonym?: string; proxy_wallet?: string; transaction_hash?: string }> };
        return (j.data ?? []).map((t) => ({
          id: `${t.transaction_hash ?? ""}${t.timestamp}${t.size}`,
          side: t.side,
          outcome: t.outcome ?? "",
          price: t.price,
          usd: t.price * t.size,
          at: t.timestamp,
          who: t.pseudonym || (t.proxy_wallet ? `${t.proxy_wallet.slice(0, 6)}...${t.proxy_wallet.slice(-4)}` : "Someone"),
        }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().sort((a, b) => b.at - a.at).slice(0, 10);
}

export interface PredictScore {
  homeTeam?: string;
  awayTeam?: string;
  score?: string;
  period?: string;
  elapsed?: string;
  status?: string;
  live?: boolean;
  ended?: boolean;
}

export interface PredictPosition {
  pubkey: string;
  marketId: string;
  isYes: boolean;
  contracts?: string;
  contractsDecimal?: string;
  totalCostUsd?: string;
  avgPriceUsd?: string;
  payoutUsd?: string;
  valueUsd?: string;
  pnlUsd?: string | null;
  claimable?: boolean;
  claimed?: boolean;
  claimedUsd?: string;
  openedAt?: number;
  updatedAt?: number;
  realizedPnlUsd?: number | string | null;
  eventMetadata?: { eventId?: string; title?: string; imageUrl?: string };
  marketMetadata?: { title?: string; status?: string; result?: string | null };
}

export const POSITIONS_PAGE = 20;

/** One page of positions, open and settled alike. Settled ones stay in the list: that is the history. */
export async function getPositionsPage(owner: string, start: number): Promise<{ items: PredictPosition[]; hasNext: boolean }> {
  const r = await call<{ data?: PredictPosition[]; pagination?: { hasNext?: boolean } }>(`/positions?ownerPubkey=${encodeURIComponent(owner)}&start=${start}&end=${start + POSITIONS_PAGE}`);
  const items = r.data ?? [];
  return { items, hasNext: r.pagination?.hasNext ?? items.length >= POSITIONS_PAGE };
}

/** A settled bet, from Jupiter's history feed. Open positions come from /positions, but that list drops a bet the moment it settles. */
export type SettledBet = { id: string; kind: "won" | "lost" | "sold"; title: string; sub: string | null; isYes: boolean; at: number; stakeUsd: number | null; resultUsd: number | null };

type HistoryEvent = {
  id: number | string;
  eventType: string;
  timestamp: number;
  isBuy?: boolean;
  isYes?: boolean;
  payoutAmountUsd?: string | null;
  netProceedsUsd?: string | null;
  realizedPnl?: string | number | null;
  marketMetadata?: { title?: string };
  eventMetadata?: { title?: string };
};

const HISTORY_CHUNK = 50;

/**
 * The next chunk of someone's history, reduced to what has ended: lost, won (payout claimed) and sold before the end.
 * Created, filled and cancelled orders are skipped. `next` is where to continue, or null when that was the last chunk.
 */
export async function getSettledChunk(owner: string, start: number): Promise<{ items: SettledBet[]; next: number | null }> {
  const r = await call<{ data?: HistoryEvent[]; pagination?: { hasNext?: boolean } }>(`/history?ownerPubkey=${encodeURIComponent(owner)}&start=${start}&end=${start + HISTORY_CHUNK}`);
  const rows = r.data ?? [];
  const items: SettledBet[] = [];
  for (const e of rows) {
    const kind = e.eventType === "position_lost" ? "lost" : e.eventType === "payout_claimed" ? "won" : e.eventType === "order_filled" && e.isBuy === false ? "sold" : null;
    if (!kind) continue;
    const pnl = e.realizedPnl == null ? null : usd(Number(e.realizedPnl));
    const payout = kind === "won" ? usd(e.payoutAmountUsd) : kind === "sold" ? usd(e.netProceedsUsd) : 0;
    items.push({
      id: String(e.id),
      kind,
      title: e.eventMetadata?.title ?? e.marketMetadata?.title ?? "Bet",
      sub: e.marketMetadata?.title && e.marketMetadata.title !== e.eventMetadata?.title ? e.marketMetadata.title : null,
      isYes: e.isYes !== false,
      at: e.timestamp,
      stakeUsd: pnl != null ? Math.max(0, payout - pnl) : null,
      // What it left them with: the profit or loss, which for a loss is the whole stake.
      resultUsd: pnl,
    });
  }
  return { items, next: r.pagination?.hasNext || rows.length >= HISTORY_CHUNK ? start + HISTORY_CHUNK : null };
}

export type BetState = "active" | "won" | "lost" | "sold";
/** Where a bet stands. Won and lost are settled, active is still running, sold was closed by the person before it settled. */
export function betState(p: PredictPosition): BetState {
  const held = Number(p.contractsDecimal ?? p.contracts ?? 1);
  const status = (p.marketMetadata?.status ?? "").toLowerCase();
  if (p.claimable || p.claimed || Number(p.claimedUsd ?? 0) > 0) return "won";
  if (status === "open" || status === "") return held > 0 ? "active" : "sold";
  const result = (p.marketMetadata?.result ?? "").toLowerCase();
  if (result === "yes" || result === "no") return (result === "yes") === p.isYes ? "won" : "lost";
  return held > 0 ? "lost" : "sold";
}

export interface OrderTx {
  transaction: string;
  order?: { orderPubkey?: string; positionPubkey?: string; contractsDecimal?: string };
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(KEY ? { "x-api-key": KEY } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error("Could not reach the market. Check your connection and try again.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 451) throw new Error("Prediction markets are not available in your country.");
    const msg = (json as { message?: string; error?: string } | null)?.message || (json as { error?: string } | null)?.error;
    throw new Error(msg || `Request failed (${res.status}).`);
  }
  return json as T;
}

/** Biggest markets first, so the ones with millions of volume lead the list. */
const byVolume = (list: PredictEvent[]) => [...list].sort((a, b) => Number(b.volumeUsd ?? 0) - Number(a.volumeUsd ?? 0));

export type PredictCategory = "trending" | "crypto" | "sports" | "politics" | "culture" | "economics" | "tech";

export async function listEvents(category: PredictCategory, signal?: AbortSignal): Promise<PredictEvent[]> {
  const q = new URLSearchParams({ includeMarkets: "true", provider: "polymarket" });
  if (category === "trending") q.set("filter", "trending");
  else q.set("category", category);
  const r = await call<{ data?: PredictEvent[] }>(`/events?${q}`);
  void signal;
  return byVolume(r.data ?? []);
}

export async function searchEvents(query: string): Promise<PredictEvent[]> {
  const r = await call<{ data?: PredictEvent[] }>(`/events/search?query=${encodeURIComponent(query)}&limit=20`);
  return byVolume(r.data ?? []);
}

export async function getEvent(id: string): Promise<PredictEvent> {
  const r = await call<PredictEvent | { data?: PredictEvent }>(`/events/${encodeURIComponent(id)}?includeAllMarkets=true`);
  return (r as { data?: PredictEvent }).data ?? (r as PredictEvent);
}

/** Live score for a sports event. Null when there is none. */
export async function getScore(id: string): Promise<PredictScore | null> {
  try {
    const r = await call<{ data?: PredictScore | null } | PredictScore | null>(`/events/${encodeURIComponent(id)}/score`);
    const s = (r && "data" in (r as object) ? (r as { data?: PredictScore | null }).data : (r as PredictScore | null)) ?? null;
    return s && (s.score || s.homeTeam) ? s : null;
  } catch {
    return null;
  }
}

export async function getMarket(id: string): Promise<PredictMarket> {
  const r = await call<PredictMarket | { data?: PredictMarket }>(`/markets/${encodeURIComponent(id)}`);
  return (r as { data?: PredictMarket }).data ?? (r as PredictMarket);
}

export const createBuyOrder = (b: { owner: string; marketId: string; isYes: boolean; usd: number; mint: string }) =>
  call<OrderTx>("/orders", { method: "POST", body: { ownerPubkey: b.owner, marketId: b.marketId, isYes: b.isYes, isBuy: true, depositAmount: String(Math.round(b.usd * 1_000_000)), depositMint: b.mint } });

export const orderStatus = (orderPubkey: string) => call<{ status?: string; data?: { status?: string } }>(`/orders/status/${encodeURIComponent(orderPubkey)}`);

export async function getPositions(owner: string): Promise<PredictPosition[]> {
  const r = await call<{ data?: PredictPosition[] }>(`/positions?ownerPubkey=${encodeURIComponent(owner)}`);
  return r.data ?? [];
}

export const closePosition = (pubkey: string, owner: string) => call<OrderTx>(`/positions/${encodeURIComponent(pubkey)}`, { method: "DELETE", body: { ownerPubkey: owner } });

export const claimPosition = (pubkey: string, owner: string) => call<OrderTx>(`/positions/${encodeURIComponent(pubkey)}/claim`, { method: "POST", body: { ownerPubkey: owner } });

/** micro USD to dollars */
export const usd = (micro: number | string | null | undefined) => (micro == null ? 0 : Number(micro) / 1_000_000);
/** a price in micro USD as whole cents, for the buttons: 740000 becomes 74 */
export const cents = (micro: number | undefined) => Math.round(((micro ?? 0) / 1_000_000) * 100);

/** One pick in a combo: a side of a market. The label and event are for showing it, only marketId and side go to Jupiter. */
export type ComboLeg = { marketId: string; side: "yes" | "no"; label: string; event: string; cents: number };

export interface ComboOrder {
  id: string;
  /** Unsigned funding transaction. The person signs it and Jupiter places the combo. */
  transaction: string;
  quote?: { netReceiveE6?: string; totalRequiredE6?: string; quoteExpiresAt?: string };
}

/** Prices a combo and builds the transaction to fund it. All picks must win for it to pay. */
export async function createCombo(b: { owner: string; legs: ComboLeg[]; usd: number; mint: string }): Promise<ComboOrder> {
  const r = await call<{ data?: ComboOrder }>("/combos/orders", {
    method: "POST",
    body: { ownerPubkey: b.owner, depositMint: b.mint, depositAmount: String(Math.round(b.usd * 1_000_000)), legs: b.legs.map((l) => ({ marketId: l.marketId, side: l.side })) },
  });
  if (!r.data?.transaction) throw new Error("Could not price this combo. Try again.");
  return r.data;
}

export const executeCombo = (signedTransaction: string, orderId: string) =>
  call<unknown>("/combos/execute", { method: "POST", body: { signedTransaction, context: { orderId } } });

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 text of bytes, used to read a transaction's signature out of the signed bytes. */
export function toBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b === 0) out += "1";
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/** The open market of an event that is most likely to be Yes, for showing one number on a card. */
export const leadOpenMarket = (e: PredictEvent): PredictMarket | undefined =>
  [...(e.markets ?? [])].filter((m) => m.status === "open" && m.pricing).sort((a, b) => (b.pricing?.buyYesPriceUsd ?? 0) - (a.pricing?.buyYesPriceUsd ?? 0))[0];

/** The hottest events: most 24h volume first, falling back to total volume. */
export const hottest = (list: PredictEvent[], n: number): PredictEvent[] =>
  [...list].filter((e) => leadOpenMarket(e)).sort((a, b) => Number(b.volume24hr ?? b.volumeUsd ?? 0) - Number(a.volume24hr ?? a.volumeUsd ?? 0)).slice(0, n);
