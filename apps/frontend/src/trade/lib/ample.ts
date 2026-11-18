import { api } from "@/trade/lib/api";

/**
 * The vault ("Earn" in the main app), powered by Ample. Same backend routes as apps/frontend: the
 * backend holds the person's vault account and pays the gas, money moves in from their Solana
 * USDC wallet and back to it. Everything signed here is a Solana transaction, signed by the
 * person's own wallet.
 */

export interface AmpleStats {
  tvlUsd: number;
  /** What savers have won over the last month, as a yearly percentage of what is saved. An average, not a rate. */
  avgApr: number | null;
  nextDrawAt: string | null;
  depositors?: number | null;
  /** Ample's estimate of the coming draw's prize pool, in dollars. */
  estimatedPayoutPoolUsd?: number | null;
  /** Winners and estimated prize per winner for each prize group, from Ample. */
  tiers?: Array<{ tier: number; winners: number; poolPercent: number; poolUsd: number; perWinnerUsd: number }>;
  lastDraw?: { drawnAt: string; payoutPoolUsd: number; participants: number; winners: number; grandPrizeUsd: number | null } | null;
}

export interface AmpleStatus {
  enabled: boolean;
  canTransact: boolean;
  linked: boolean;
  vault: { id: string; token?: { symbol?: string; decimals?: number } } | null;
}

export interface AmpleOverview {
  tickets: { totalTickets?: number | string; sharePercent?: number | string | null };
  balances: Array<{ vaultId?: string; depositsToken: string; depositsUsd: number | string | null; token?: { symbol?: string; decimals?: number } }>;
  claimable: Array<{ payoutId: string; payoutAmount: string; usdMicro?: string | null; vaultId?: string }>;
}

export const getStats = () => api<AmpleStats | null>("/ample/evm/stats");
export const getStatus = (token: string | null) => api<AmpleStatus>("/ample/evm/status", { token });
export const getOverview = (token: string | null) => api<AmpleOverview>("/ample/evm/overview", { token });

export const fundPrepare = (b: { solanaAddress: string; outputUnits: string; maxTotalUnits?: string }, token: string | null) =>
  api<{ id: string; outUnits: string; feeUnits: string; totalUnits: string }>("/ample/evm/fund/prepare", { body: b, token });
export const fundTx = (id: string, token: string | null) => api<{ transaction: string }>(`/ample/evm/fund/${encodeURIComponent(id)}/tx`, { method: "POST", body: {}, token });
export const fundBroadcast = (id: string, transaction: string, token: string | null) =>
  api<{ signature: string }>(`/ample/evm/fund/${encodeURIComponent(id)}/broadcast`, { body: { transaction }, token });
export const orderStatus = (id: string, token: string | null) =>
  api<{ status: "PENDING" | "SUCCESS" | "FAILED"; detail?: string }>(`/ample/evm/fund/${encodeURIComponent(id)}/status`, { token });
export const withdraw = (b: { amount: string; solanaAddress: string }, token: string | null) => api<{ id: string }>("/ample/evm/withdraw", { body: b, token });
export const claim = (payoutIds: string[], token: string | null) => api<{ hash: string }>("/ample/evm/claim", { body: { payoutIds }, token });

/** Dollars from a base-unit string. USDC has 6 decimals. */
export const usd = (base: string | number | null | undefined): number => (base == null ? 0 : Number(base) / 1e6);
