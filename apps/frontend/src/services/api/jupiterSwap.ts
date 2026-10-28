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
  /** Gasless swaps only: the network cost Loofta pays, taken from your USDC, in USDC base units (6 decimals). */
  networkCostUsdc?: string;
  /** Estimated network cost in lamports when you pay it yourself (not present on gasless swaps). */
  networkFeeLamports?: number;
  needsAccountRent: boolean;
  /** Only USDC to SOL: Loofta pays the network fee and prices it into feeBps. */
  gasless: boolean;
  inDecimals: number;
  outDecimals: number;
};

export type JupiterSwapBuild = {
  /** True for gasless swaps: send this id and the signed transaction to /swap/submit instead of broadcasting yourself. */
  gasless: boolean;
  id?: string;
  /** Versioned transaction, base64. The user signs it and Loofta pays the network fee. */
  swapTransaction: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  feeBps: number;
  feeAmount: string;
  networkCostUsdc?: string;
  outDecimals: number;
};

export function quoteJupiterSwap(params: JupiterSwapParams, userId: string, accessToken?: string | null, signal?: AbortSignal): Promise<JupiterSwapQuote> {
  return fetchApi('/jupiter/swap/quote', { method: 'POST', body: JSON.stringify(params), userId, accessToken, signal });
}

export function buildJupiterSwap(params: JupiterSwapParams, userId: string, accessToken?: string | null): Promise<JupiterSwapBuild> {
  return fetchApi('/jupiter/swap/build', { method: 'POST', body: JSON.stringify(params), userId, accessToken });
}

export function submitJupiterSwap(params: { id: string; signedTransaction: string }, userId: string, accessToken?: string | null): Promise<{ signature: string }> {
  return fetchApi('/jupiter/swap/submit', { method: 'POST', body: JSON.stringify(params), userId, accessToken });
}
