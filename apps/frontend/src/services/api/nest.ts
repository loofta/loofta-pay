/**
 * "Our Nest" — auto-invest robo-portfolio.
 * Backend: apps/backend/src/modules/nest/*
 */

import { fetchApi } from './client';

export interface NestConfig {
  liveTrading: boolean;
}

export interface NestUniverseAsset {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  tags: string[];
}

export type NestRiskTolerance = 'conservative' | 'balanced' | 'aggressive';

export interface NestProfile {
  displayName: string | null;
  riskTolerance: NestRiskTolerance;
  interestTags: string[];
  goalUsd: number | null;
}

export interface NestDepositView {
  amountUsdc: number;
  network: 'mainnet' | 'devnet';
  txHash: string;
  createdAt: string;
}

export interface NestStreak {
  weeks: number;
  alive: boolean;
  freezeUsed: boolean;
  depositedThisWeek: boolean;
}

export interface NestHoldingView {
  symbol: string;
  name: string;
  units: number;
  avgCostUsd: number;
  currentPrice: number | null;
  valueUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
}

export interface NestPortfolio {
  holdings: NestHoldingView[];
  totalValueUsd: number;
  totalCostUsd: number;
  pnlUsd: number;
  pnlPct: number;
  navHistory: Array<{ date: string; totalValueUsd: number; totalCostUsd: number }>;
  /** False when every price is a last-known quote (markets closed / issuer feed down). */
  quotesLive: boolean;
}

export interface NestTradeView {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  units: number;
  priceUsd: number;
  usdValue: number;
  reason: string | null;
  txSignature: string | null;
  createdAt: string;
}

export interface NestElfaPost {
  link: string;
  username: string;
  likeCount: number;
  mentionedAt: string;
}

export interface NestLedgerEvent {
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  usdValue: number;
  reason: string | null;
  createdAt: string;
  post: NestElfaPost | null;
}

interface AuthOpts {
  userId?: string;
  accessToken?: string | null;
}

export async function getNestConfig(): Promise<NestConfig> {
  return fetchApi<NestConfig>('/nest/config');
}

export async function getNestUniverse(): Promise<NestUniverseAsset[]> {
  return fetchApi<NestUniverseAsset[]>('/nest/universe');
}

export interface NestBacktestStats {
  grossReturn: number;
  netReturn: number;
  annualizedVol: number;
  maxDrawdown: number;
  avgWeeklyTurnover: number;
}

/** Historical simulation of the engine over a past window — never a forecast. */
export interface NestBacktestSummary {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  weeks: number;
  universeSize: number;
  startingUsd: number;
  /** What the live engine actually runs: equal-weight across the tag-filtered universe. */
  liveStrategy: NestBacktestStats;
  /** Attention-tilt + turnover hysteresis — tested, lost to liveStrategy, not shipped. */
  rejectedTilt: NestBacktestStats;
  /** Attention-tilt with no hysteresis — the pre-fix allocator, kept for context only. */
  rejectedTiltNoHysteresis: NestBacktestStats;
  /** Percentile refers to rejectedTilt vs. 200 shuffles of the same signal, not liveStrategy. */
  placebo: { shuffles: number; netReturnP05: number; netReturnP50: number; netReturnP95: number; realPercentile: number };
  verdict: string;
  caveats: string[];
}

/** Public; resolves null (not an error) until a backtest has been committed. */
export async function getNestBacktest(): Promise<NestBacktestSummary | null> {
  try {
    return await fetchApi<NestBacktestSummary>('/nest/backtest');
  } catch {
    return null;
  }
}

/** `demo: true` reads/writes the free devnet-USDC demo ledger instead of the real one — a
 *  completely separate identity server-side (see nest-ledger-id.ts), never mixed with real money. */
export async function getNestProfile(opts: AuthOpts, demo = false): Promise<NestProfile | null> {
  return fetchApi<NestProfile | null>(`/nest/profile${demo ? '?demo=true' : ''}`, opts);
}

/** `goalUsd` is only sent when explicitly passed — an undefined goal leaves the stored one alone. */
export async function upsertNestProfile(riskTolerance: NestRiskTolerance, interestTags: string[], displayName: string | null, opts: AuthOpts, demo = false, goalUsd?: number | null): Promise<NestProfile> {
  return fetchApi<NestProfile>('/nest/profile', { method: 'POST', body: JSON.stringify({ riskTolerance, interestTags, displayName: displayName ?? undefined, demo, ...(goalUsd !== undefined ? { goalUsd } : {}) }), ...opts });
}

export async function getNestDeposits(opts: AuthOpts, demo = false): Promise<NestDepositView[]> {
  return fetchApi<NestDepositView[]>(`/nest/deposits${demo ? '?demo=true' : ''}`, opts);
}

export async function getNestStreak(opts: AuthOpts, demo = false): Promise<NestStreak> {
  return fetchApi<NestStreak>(`/nest/streak${demo ? '?demo=true' : ''}`, opts);
}

// ---- Crumbs (round-ups) --------------------------------------------------------------------

export interface NestRoundups {
  enabled: boolean;
  unit: number | null;
  pendingUsd: number;
  paymentCount: number;
  since: string | null;
}

export async function getNestRoundups(opts: AuthOpts, demo = false): Promise<NestRoundups> {
  return fetchApi<NestRoundups>(`/nest/roundups${demo ? '?demo=true' : ''}`, opts);
}

/** `unit` null turns round-ups off; 1 or 5 rounds each sent payment up to the next $1 / $5. */
export async function setNestRoundups(unit: number | null, opts: AuthOpts, demo = false): Promise<NestRoundups> {
  return fetchApi<NestRoundups>('/nest/roundups', { method: 'POST', body: JSON.stringify({ unit, demo }), ...opts });
}

/** Call after a crumbs-prefilled deposit confirms — marks the pending crumbs as fed. */
export async function sweepNestRoundups(opts: AuthOpts, demo = false): Promise<NestRoundups> {
  return fetchApi<NestRoundups>('/nest/roundups/sweep', { method: 'POST', body: JSON.stringify({ demo }), ...opts });
}

// ---- Flock -----------------------------------------------------------------------------------

export interface FlockMember {
  username: string;
  displayName: string | null;
  level: string;
  streakWeeks: number;
  /** Category allocation as fractions of the nest — never dollar amounts, never returns. */
  categories: Array<{ label: string; weight: number }>;
  kudosSentToday: boolean;
  kudosReceived: number;
}

export interface NestFlock {
  isPublic: boolean;
  username: string | null;
  following: FlockMember[];
  followers: number;
  kudosReceived: number;
}

export async function getNestFlock(opts: AuthOpts, demo = false): Promise<NestFlock> {
  return fetchApi<NestFlock>(`/nest/flock${demo ? '?demo=true' : ''}`, opts);
}

export async function setNestFlockPublic(isPublic: boolean, opts: AuthOpts, demo = false): Promise<{ isPublic: boolean }> {
  return fetchApi<{ isPublic: boolean }>('/nest/flock/visibility', { method: 'POST', body: JSON.stringify({ isPublic, demo }), ...opts });
}

export async function followNest(username: string, opts: AuthOpts): Promise<{ ok: true }> {
  return fetchApi<{ ok: true }>('/nest/flock/follow', { method: 'POST', body: JSON.stringify({ username }), ...opts });
}

export async function unfollowNest(username: string, opts: AuthOpts): Promise<{ ok: true }> {
  return fetchApi<{ ok: true }>('/nest/flock/unfollow', { method: 'POST', body: JSON.stringify({ username }), ...opts });
}

export async function sendNestKudos(username: string, opts: AuthOpts): Promise<{ ok: true }> {
  return fetchApi<{ ok: true }>('/nest/flock/kudos', { method: 'POST', body: JSON.stringify({ username }), ...opts });
}

export interface NestSuggestion {
  id: string;
  symbol: string;
  action: 'trim' | 'buy_dip';
  deltaUsd: number;
  movePct: number;
  reason: string;
  sourceLinks: string[];
  createdAt: string;
  expiresAt: string;
}

/** Pending suggested actions from a real, large price move — never auto-executed; the user
 *  explicitly accepts or dismisses each one. */
export async function getNestSuggestions(opts: AuthOpts, demo = false): Promise<NestSuggestion[]> {
  return fetchApi<NestSuggestion[]>(`/nest/suggestions${demo ? '?demo=true' : ''}`, opts);
}

export async function acceptNestSuggestion(id: string, opts: AuthOpts, demo = false): Promise<{ executed: boolean }> {
  return fetchApi<{ executed: boolean }>(`/nest/suggestions/${id}/accept${demo ? '?demo=true' : ''}`, { method: 'POST', ...opts });
}

export async function dismissNestSuggestion(id: string, opts: AuthOpts, demo = false): Promise<{ ok: true }> {
  return fetchApi<{ ok: true }>(`/nest/suggestions/${id}/dismiss${demo ? '?demo=true' : ''}`, { method: 'POST', ...opts });
}

/** Manual trigger — the real scan only runs hourly in production. Testing/dev convenience; safe
 *  to call any time (reads prices/news, never trades). */
export async function runNestSuggestionScan(opts: AuthOpts): Promise<{ ran: true }> {
  return fetchApi<{ ran: true }>('/nest/suggestions/scan', { method: 'POST', ...opts });
}

export type PredictionVenue = "kalshi" | "dflow" | "polymarket";

/** One prediction market, whichever venue it came from. `tradeable` is the only difference the
 *  UI acts on: true means a position can be taken in-app, false means we can only hand off to
 *  the venue (Kalshi needs the user's own regulated account; DFlow's tokenized version of the
 *  same markets would be tradeable). */
export interface PredictionMarket {
  id: string;
  venue: PredictionVenue;
  symbol: string | null;
  question: string;
  yesPrice: number | null;
  closeTime: string | null;
  tradeable: boolean;
  url: string;
}

/** Markets across every company the caller holds, across every venue. */
export async function getPredictionsForHoldings(opts: AuthOpts, demo = false): Promise<PredictionMarket[]> {
  try {
    return await fetchApi<PredictionMarket[]>(`/nest/predictions${demo ? "?demo=true" : ""}`, opts);
  } catch {
    return [];
  }
}

/** Markets for one company. Public, no auth. */
export async function getPredictionsForSymbol(symbol: string): Promise<PredictionMarket[]> {
  try {
    return await fetchApi<PredictionMarket[]>(`/nest/predictions/${symbol}`);
  } catch {
    return [];
  }
}

export async function getNestPortfolio(opts: AuthOpts, demo = false): Promise<NestPortfolio> {
  return fetchApi<NestPortfolio>(`/nest/portfolio${demo ? '?demo=true' : ''}`, opts);
}

export async function getNestHistory(opts: AuthOpts, demo = false): Promise<NestTradeView[]> {
  return fetchApi<NestTradeView[]>(`/nest/history${demo ? '?demo=true' : ''}`, opts);
}

export async function getNestLedger(opts: AuthOpts, demo = false): Promise<NestLedgerEvent[]> {
  return fetchApi<NestLedgerEvent[]>(`/nest/ledger${demo ? '?demo=true' : ''}`, opts);
}

export async function buildNestDepositTx(userSolanaAddress: string, amountUsdc: number, opts: AuthOpts): Promise<{ txBase64: string }> {
  return fetchApi<{ txBase64: string }>('/nest/deposit/pay-tx', { method: 'POST', body: JSON.stringify({ userSolanaAddress, amountUsdc }), ...opts });
}

export async function confirmNestDeposit(userSolanaAddress: string, txHash: string, amountUsdc: number, opts: AuthOpts): Promise<{ creditedUsd: number }> {
  return fetchApi<{ creditedUsd: number }>('/nest/deposit/confirm', { method: 'POST', body: JSON.stringify({ userSolanaAddress, txHash, amountUsdc }), ...opts });
}

/** One-time treasury-funded devnet-USDC grant to the caller's own wallet — a fresh embedded
 *  wallet holds none, so this is what the devnet deposit transfer actually moves. Real on-chain
 *  transfer, devnet only. Throws (message includes "already has devnet USDC") if already funded
 *  — callers should treat that as a no-op success, not an error. */
export async function faucetNestDevnetUsdc(userSolanaAddress: string, opts: AuthOpts): Promise<{ txHash: string; amountUsdc: number }> {
  return fetchApi<{ txHash: string; amountUsdc: number }>('/nest/deposit/devnet/faucet', { method: 'POST', body: JSON.stringify({ userSolanaAddress }), ...opts });
}

/** Free devnet USDC (no real value) — same on-chain-verify pattern as the real deposit, just
 *  pointed at devnet, and always lands in the devnet-demo ledger server-side. */
export async function buildNestDevnetDepositTx(userSolanaAddress: string, amountUsdc: number, opts: AuthOpts): Promise<{ txBase64: string }> {
  return fetchApi<{ txBase64: string }>('/nest/deposit/devnet/pay-tx', { method: 'POST', body: JSON.stringify({ userSolanaAddress, amountUsdc }), ...opts });
}

export async function confirmNestDevnetDeposit(userSolanaAddress: string, txHash: string, amountUsdc: number, opts: AuthOpts): Promise<{ creditedUsd: number }> {
  return fetchApi<{ creditedUsd: number }>('/nest/deposit/devnet/confirm', { method: 'POST', body: JSON.stringify({ userSolanaAddress, txHash, amountUsdc }), ...opts });
}
