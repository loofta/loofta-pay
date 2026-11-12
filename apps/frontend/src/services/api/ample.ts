/**
 * Stake to win, powered by Ample (https://api.ample.money). Backend: apps/backend/src/modules/ample.
 * Ample returns unsigned transactions; the user's own wallet signs them.
 */
import { fetchApi, type RequestOptions } from './client';

export interface AmpleVault {
  id: string;
  network: string;
  name?: string;
  symbol?: string;
  apy?: number | string | null;
  token?: { symbol?: string; decimals?: number; address?: string };
  [k: string]: unknown;
}

export interface AmpleStatus {
  enabled: boolean;
  canTransact: boolean;
  linked: boolean;
  walletAddress?: string;
  vaults: AmpleVault[];
}

export interface AmpleSolanaTx {
  vaultId?: string;
  network: string;
  transaction: { chainId: number; encoding: 'base64'; unsigned: string };
  expiresAt: string | null;
  estimate?: Record<string, unknown>;
  payoutIds?: string[];
  withdrawnBase?: string;
  diag?: { sol: number; usdc: string; plainErr: string | null; finalErr: string | null; sponsored: boolean; requested: string };
}

export interface AmpleOverview {
  tickets: {
    totalTickets?: number | string;
    sharePercent?: number | string | null;
    twabUsd?: number | string;
    [k: string]: unknown;
  };
  balances: Array<{ vaultId?: string; tokenMint?: string | null; usdMicro?: string | null; depositsToken: string; depositsUsd: number | string | null; token?: { symbol?: string; decimals?: number }; [k: string]: unknown }>;
  streak: Record<string, any>;
  boosts?: unknown;
  claimable: Array<{ payoutId: string; payoutAmount: string; vaultId?: string; usdMicro?: string | null; [k: string]: unknown }>;
  /** Sum of every payout ever won, in token base units. null when Ample returned no history. */
  totalWonBase?: string | null;
  /** Withdrawal fee on the USDC vault in basis points (0.10% = 10, capped at $25). */
  withdrawFeeBps?: number;
  /** Personal APY from the earnings ledger, percent. null until a week of history agrees with the real balance. */
  yourApy?: number | null;
  trackedSince?: string | null;
}

const post = <T>(path: string, body: unknown, o: RequestOptions) =>
  fetchApi<T>(path, { method: 'POST', body: JSON.stringify(body), ...o });

export const getAmpleStatus = (o: RequestOptions) => fetchApi<AmpleStatus>('/ample/status', o);
export const getAmpleOverview = (o: RequestOptions) => fetchApi<AmpleOverview>('/ample/overview', o);
export const ampleChallenge = (walletAddress: string, o: RequestOptions) =>
  post<{ message: string; nonce: string; expiresAt: string }>('/ample/link/challenge', { walletAddress }, o);
export const ampleLink = (b: { walletAddress: string; message: string; signature: string }, o: RequestOptions) =>
  post<{ walletAddress: string }>('/ample/link', b, o);
export const ampleBuildDeposit = (vaultId: string, amount: string, o: RequestOptions, plain?: boolean) => post<AmpleSolanaTx>('/ample/deposit', { vaultId, amount, plain }, o);
export const ampleSetupFee = (o: RequestOptions) => fetchApi<{ needed: boolean; feeUsd?: number }>('/ample/setup-fee', o);
export const ampleBuildSetup = (vaultId: string, amount: string, o: RequestOptions) =>
  post<{ needed: false } | (AmpleSolanaTx & { needed: true; feeUsd: number })>('/ample/setup', { vaultId, amount }, o);
export const ampleBuildWithdraw = (vaultId: string, amount: string, o: RequestOptions, plain?: boolean) => post<AmpleSolanaTx>('/ample/withdraw', { vaultId, amount, plain }, o);
export const ampleBuildClaim = (payoutId: string, o: RequestOptions, plain?: boolean) => post<AmpleSolanaTx>('/ample/claim', { payoutId, plain }, o);
export const ampleRecordEvent = (
  b: { kind: 'deposit' | 'withdraw' | 'claim'; vaultId: string; amountBase: string; txSignature: string; payoutId?: string },
  o: RequestOptions,
) => post<{ recorded: boolean; reason?: string }>('/ample/events', b, o);
export const ampleTxStatus = (hash: string, o: RequestOptions) =>
  fetchApi<{ status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'PARTIAL'; detail?: string }>(`/ample/tx/${encodeURIComponent(hash)}/status`, o);

export interface AmpleStats {
  vaultId: string;
  symbol: string;
  decimals: number;
  tvlUsd: number;
  monthlyPayoutsUsd: number;
  totalPaidUsd: number;
  /** Everything the whole network's vaults paid last month. One fourth-ish of it is a typical weekly prize pool. */
  poolMonthlyUsd?: number;
  /** Last month's payouts annualised over TVL, in percent. */
  avgApr: number | null;
  /** Best-case APR ceiling, in percent. */
  maxApr: number | null;
  /** ISO time entries close and the next draw runs (from Ample). */
  nextDrawAt: string | null;
  /** Size of the next prize in dollars, when Ample provides it. */
  drawIntervalSeconds: number | null;
  /** PROCESSING while winners are worked out, SETTLED once payouts can be claimed. */
  lastDrawStatus: string | null;
  /** Ample's own estimate of the coming draw's total prize pool, in dollars. */
  estimatedPayoutPoolUsd?: number | null;
  /** How many savers are in the coming draw. */
  depositors?: number | null;
  /** Winners and estimated prize per winner for each prize group. */
  tiers?: Array<{ tier: number; winners: number; poolPercent: number; poolUsd: number; perWinnerUsd: number }>;
  /** The most recent settled draw: what was really paid, to how many, out of how many savers. */
  lastDraw?: { drawnAt: string; payoutPoolUsd: number; participants: number; winners: number; grandPrizeUsd: number | null } | null;
}
export const getAmpleStats = () => fetchApi<AmpleStats | null>('/ample/stats');

export interface AmpleRecentPayout { amountUsd: number; wallet: string; at: string }
export const ampleRecentPayouts = () => fetchApi<AmpleRecentPayout[]>('/ample/payouts/recent');


// ---- Base (EVM) pool: the larger one. Same Ample account model, signed by the user's own embedded EVM wallet. ----

export interface AmpleEvmStatus {
  enabled: boolean;
  canTransact: boolean;
  linked: boolean;
  walletAddress?: string;
  vault: AmpleVault | null;
}

export interface AmpleEvmOverview extends Omit<AmpleOverview, 'totalWonBase' | 'withdrawFeeBps' | 'yourApy' | 'trackedSince'> {
  boosts?: unknown;
}

export const getAmpleEvmStatus = (o: RequestOptions) => fetchApi<AmpleEvmStatus>('/ample/evm/status', o);
export const getAmpleEvmOverview = (o: RequestOptions) => fetchApi<AmpleEvmOverview>('/ample/evm/overview', o);
export const getAmpleEvmStats = () => fetchApi<AmpleStats | null>('/ample/evm/stats');
export const ampleEvmWithdraw = (b: { amount: string; solanaAddress: string }, o: RequestOptions) => post<{ id: string }>('/ample/evm/withdraw', b, o);
export const ampleEvmClaim = (payoutIds: string[], o: RequestOptions) => post<{ hash: string }>('/ample/evm/claim', { payoutIds }, o);

// Fund the Base pool from Solana USDC: the backend stores a Relay quote, builds the transaction from it and only broadcasts that exact one.
export const ampleFundPrepare = (b: { solanaAddress: string; outputUnits: string; maxTotalUnits?: string }, o: RequestOptions) =>
  post<{ id: string; outUnits: string; feeUnits: string; totalUnits: string }>('/ample/evm/fund/prepare', b, o);
export const ampleFundTx = (id: string, o: RequestOptions) => post<{ transaction: string }>(`/ample/evm/fund/${encodeURIComponent(id)}/tx`, {}, o);
export const ampleFundBroadcast = (id: string, transaction: string, o: RequestOptions) =>
  post<{ signature: string }>(`/ample/evm/fund/${encodeURIComponent(id)}/broadcast`, { transaction }, o);
export const ampleFundStatus = (id: string, o: RequestOptions) =>
  fetchApi<{ status: 'PENDING' | 'SUCCESS' | 'FAILED'; detail?: string }>(`/ample/evm/fund/${encodeURIComponent(id)}/status`, o);
