import { fetchApi } from './client';

export type JupiterSwapParams = {
  inputMint: string;
  outputMint: string;
  /** Human-readable amount of the input token. */
  amount: string;
  slippageBps?: number;
};

export type JupiterSwapQuote = {
  inAmount: string;
  /** Base units, already net of Loofta's 0.80% fee. */
  outAmount: string;
  minOutAmount: string;
  feeBps: number;
  /** Fee in base units of the output token. */
  feeAmount: string;
  priceImpactPct: number;
  /** Estimated network cost in lamports (signature, priority fee, and one-time account rent if needed). */
  networkFeeLamports: number;
  needsAccountRent: boolean;
  inDecimals: number;
  outDecimals: number;
};

export type JupiterSwapBuild = {
  /** Unsigned versioned transaction, base64. The user signs and pays the network fee. */
  swapTransaction: string;
  lastValidBlockHeight: number | null;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  feeBps: number;
  feeAmount: string;
  outDecimals: number;
};

export function quoteJupiterSwap(params: JupiterSwapParams, userId: string, accessToken?: string | null, signal?: AbortSignal): Promise<JupiterSwapQuote> {
  return fetchApi('/jupiter/swap/quote', { method: 'POST', body: JSON.stringify(params), userId, accessToken, signal });
}

export function buildJupiterSwap(params: JupiterSwapParams, userId: string, accessToken?: string | null): Promise<JupiterSwapBuild> {
  return fetchApi('/jupiter/swap/build', { method: 'POST', body: JSON.stringify(params), userId, accessToken });
}
