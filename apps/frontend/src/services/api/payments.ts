/**
 * Payments API Service
 * 
 * Handles payment flow operations:
 * - Deposit requests
 * - Quotes for swaps
 * - Transaction status tracking
 * - Rhinestone eligibility
 */

import { fetchApi } from './client';

// ===========================================
// Types - Deposit
// ===========================================

export interface DepositToken {
  tokenId: string;
  symbol: string;
  chain: string;
  decimals: number;
  address?: string;
}

export interface DepositRequest {
  claimId: string;
  fromToken: DepositToken;
  amount: string;
  userAddress?: string;
  orgReferral?: string;
}

export interface DepositResult {
  success: boolean;
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  timeEstimate?: number;
  quoteId?: string;
  minAmountIn?: string;
  minAmountInFormatted?: string;
  directTransfer?: boolean;
  depositToken?: string;
  depositChain?: string;
  amount?: string;
  twoHop?: boolean;
  companionAddress?: string;
  message?: string;
  error?: string;
  code?: string;
}

// ===========================================
// Types - Quote
// ===========================================

export interface QuoteRequest {
  fromTokenId: string;
  fromChain: string;
  fromDecimals: number;
  toTokenId: string;
  toChain: string;
  toDecimals: number;
  amount: string;
  slippageBps?: number;
}

export interface QuoteResult {
  amountOut?: string;
  amountOutFormatted?: string;
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  timeEstimate?: number;
  quoteId?: string;
  minAmountIn?: string;
  minAmountInFormatted?: string;
  raw?: unknown;
  error?: {
    type: 'client' | 'server' | 'network' | 'unknown';
    status?: number;
    message?: string;
  };
}

// ===========================================
// Types - Status
// ===========================================

export type NormalizedStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';

export interface IntentStatus {
  provider: 'near-intents' | 'rhinestone' | 'unknown';
  status: string;
  normalizedStatus: NormalizedStatus;
  txHash?: string;
  error?: string;
  raw?: unknown;
}

export interface StatusRequest {
  depositAddress?: string;
  rhinestoneId?: string;
  claimId?: string;
}

// ===========================================
// Types - Rhinestone
// ===========================================

export interface RhinestoneEligibility {
  eligible: boolean;
  reason?: string;
}

export interface RhinestoneChain {
  chainId: number;
  name: string;
  supported: boolean;
}

// ===========================================
// API Functions - Deposit
// ===========================================

/**
 * Request a deposit address for a claim
 * This initiates the payment flow
 */
export async function requestDeposit(data: DepositRequest): Promise<DepositResult> {
  console.log('data here??', data);
  return fetchApi<DepositResult>('/claims/deposit', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ===========================================
// API Functions - Quote
// ===========================================

/**
 * Get a quote for a swap/transfer
 */
export async function getQuote(params: QuoteRequest): Promise<QuoteResult> {
  const query = new URLSearchParams({
    fromTokenId: params.fromTokenId,
    fromChain: params.fromChain,
    fromDecimals: params.fromDecimals.toString(),
    toTokenId: params.toTokenId,
    toChain: params.toChain,
    toDecimals: params.toDecimals.toString(),
    amount: params.amount,
    ...(params.slippageBps && { slippageBps: params.slippageBps.toString() }),
  });
  return fetchApi<QuoteResult>(`/intents/quote?${query}`);
}

// ===========================================
// API Functions - Status
// ===========================================

/**
 * Get the status of a transaction/intent
 */
export async function getStatus(params: StatusRequest): Promise<IntentStatus> {
  const query = new URLSearchParams();
  if (params.depositAddress) query.set('depositAddress', params.depositAddress);
  if (params.rhinestoneId) query.set('rhinestoneId', params.rhinestoneId);
  if (params.claimId) query.set('claimId', params.claimId);
  return fetchApi<IntentStatus>(`/intents/status?${query}`);
}

/**
 * Poll status until completion or timeout
 */
export async function pollStatus(
  params: StatusRequest,
  options: {
    interval?: number;
    timeout?: number;
    onUpdate?: (status: IntentStatus) => void;
  } = {}
): Promise<IntentStatus> {
  const { interval = 3000, timeout = 300000, onUpdate } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getStatus(params);
    onUpdate?.(status);

    if (['completed', 'failed'].includes(status.normalizedStatus)) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Status polling timed out');
}

// ===========================================
// API Functions - Rhinestone
// ===========================================

/**
 * Check if a route is eligible for Rhinestone 1-click
 */
export async function checkRhinestoneEligibility(params: {
  fromChain: string;
  toChain: string;
  fromSymbol?: string;
  toSymbol?: string;
}): Promise<RhinestoneEligibility> {
  const query = new URLSearchParams({
    fromChain: params.fromChain,
    toChain: params.toChain,
    ...(params.fromSymbol && { fromSymbol: params.fromSymbol }),
    ...(params.toSymbol && { toSymbol: params.toSymbol }),
  });
  return fetchApi<RhinestoneEligibility>(`/intents/rhinestone/eligibility?${query}`);
}

/**
 * Get supported Rhinestone chains
 */
export async function getRhinestoneChains(): Promise<{ chains: RhinestoneChain[] }> {
  return fetchApi<{ chains: RhinestoneChain[] }>('/intents/rhinestone/chains');
}

// ===========================================
// Default export
// ===========================================

export const paymentsApi = {
  // Deposit
  requestDeposit,
  // Quote
  getQuote,
  // Status
  getStatus,
  pollStatus,
  // Rhinestone
  checkRhinestoneEligibility,
  getRhinestoneChains,
};
