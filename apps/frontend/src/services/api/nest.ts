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

/** `demo: true` reads/writes the free devnet-USDC demo ledger instead of the real one — a
 *  completely separate identity server-side (see nest-ledger-id.ts), never mixed with real money. */
export async function getNestProfile(opts: AuthOpts, demo = false): Promise<NestProfile | null> {
  return fetchApi<NestProfile | null>(`/nest/profile${demo ? '?demo=true' : ''}`, opts);
}

export async function upsertNestProfile(riskTolerance: NestRiskTolerance, interestTags: string[], displayName: string | null, opts: AuthOpts, demo = false): Promise<NestProfile> {
  return fetchApi<NestProfile>('/nest/profile', { method: 'POST', body: JSON.stringify({ riskTolerance, interestTags, displayName: displayName ?? undefined, demo }), ...opts });
}

export async function getNestPortfolio(opts: AuthOpts, demo = false): Promise<NestPortfolio> {
  return fetchApi<NestPortfolio>(`/nest/portfolio${demo ? '?demo=true' : ''}`, opts);
}

export async function getNestHistory(opts: AuthOpts, demo = false): Promise<NestTradeView[]> {
  return fetchApi<NestTradeView[]>(`/nest/history${demo ? '?demo=true' : ''}`, opts);
}

export async function buildNestDepositTx(userSolanaAddress: string, amountUsdc: number, opts: AuthOpts): Promise<{ txBase64: string }> {
  return fetchApi<{ txBase64: string }>('/nest/deposit/pay-tx', { method: 'POST', body: JSON.stringify({ userSolanaAddress, amountUsdc }), ...opts });
}

export async function confirmNestDeposit(userSolanaAddress: string, txHash: string, amountUsdc: number, opts: AuthOpts): Promise<{ creditedUsd: number }> {
  return fetchApi<{ creditedUsd: number }>('/nest/deposit/confirm', { method: 'POST', body: JSON.stringify({ userSolanaAddress, txHash, amountUsdc }), ...opts });
}

/** Free devnet USDC (no real value) — same on-chain-verify pattern as the real deposit, just
 *  pointed at devnet, and always lands in the devnet-demo ledger server-side. */
export async function buildNestDevnetDepositTx(userSolanaAddress: string, amountUsdc: number, opts: AuthOpts): Promise<{ txBase64: string }> {
  return fetchApi<{ txBase64: string }>('/nest/deposit/devnet/pay-tx', { method: 'POST', body: JSON.stringify({ userSolanaAddress, amountUsdc }), ...opts });
}

export async function confirmNestDevnetDeposit(userSolanaAddress: string, txHash: string, amountUsdc: number, opts: AuthOpts): Promise<{ creditedUsd: number }> {
  return fetchApi<{ creditedUsd: number }>('/nest/deposit/devnet/confirm', { method: 'POST', body: JSON.stringify({ userSolanaAddress, txHash, amountUsdc }), ...opts });
}
