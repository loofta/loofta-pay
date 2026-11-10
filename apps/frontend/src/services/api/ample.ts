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
}

export interface AmpleOverview {
  tickets: {
    totalTickets?: number | string;
    sharePercent?: number | string | null;
    twabUsd?: number | string;
    [k: string]: unknown;
  };
  balances: Array<{ vaultId?: string; depositsToken: string; depositsUsd: number | string | null; token?: { symbol?: string; decimals?: number }; [k: string]: unknown }>;
  streak: Record<string, any>;
  claimable: Array<{ payoutId: string; payoutAmount: string; vaultId?: string; [k: string]: unknown }>;
  /** Sum of every payout ever won, in token base units. null when Ample returned no history. */
  totalWonBase?: string | null;
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
export const ampleBuildDeposit = (vaultId: string, amount: string, o: RequestOptions) => post<AmpleSolanaTx>('/ample/deposit', { vaultId, amount }, o);
export const ampleBuildWithdraw = (vaultId: string, amount: string, o: RequestOptions) => post<AmpleSolanaTx>('/ample/withdraw', { vaultId, amount }, o);
export const ampleBuildClaim = (payoutId: string, o: RequestOptions) => post<AmpleSolanaTx>('/ample/claim', { payoutId }, o);
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
  /** Last month's payouts annualised over TVL, in percent. */
  avgApr: number | null;
  /** Best-case APR ceiling, in percent. */
  maxApr: number | null;
  /** ISO time entries close and the next draw runs (from Ample). */
  nextDrawAt: string | null;
  drawIntervalSeconds: number | null;
  /** PROCESSING while winners are worked out, SETTLED once payouts can be claimed. */
  lastDrawStatus: string | null;
}
export const getAmpleStats = () => fetchApi<AmpleStats | null>('/ample/stats');
