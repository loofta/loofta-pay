/**
 * Tokens API Service
 * 
 * Handles token-related operations:
 * - Listing available tokens
 * - Searching tokens
 * - Fetching token prices
 */

import { fetchApi } from './client';

// ===========================================
// Types
// ===========================================

export interface Token {
  symbol: string;
  name: string;
  chain: string;
  address: string;
  tokenId?: string;
  decimals: number;
  logoURI?: string;
  price?: number;
  priceUpdatedAt?: string;
  defuseAssetId?: string;
}

export interface TokenPrice {
  symbol: string;
  chain: string;
  price: number | null;
  updatedAt: string;
}

// ===========================================
// API Functions
// ===========================================

/**
 * Get all available tokens
 */
export async function listTokens(): Promise<{ tokens: Token[] }> {
  return fetchApi<{ tokens: Token[] }>('/tokens');
}

/**
 * Search tokens by query (symbol or name)
 */
export async function searchTokens(query: string): Promise<{ tokens: Token[] }> {
  return fetchApi<{ tokens: Token[] }>(`/tokens/search?q=${encodeURIComponent(query)}`);
}

/**
 * Get tokens by chain
 */
export async function getTokensByChain(chain: string): Promise<{ tokens: Token[] }> {
  return fetchApi<{ tokens: Token[] }>(`/tokens/by-chain?chain=${encodeURIComponent(chain)}`);
}

/**
 * Get popular/featured tokens
 */
export async function getPopularTokens(): Promise<{ tokens: Token[] }> {
  return fetchApi<{ tokens: Token[] }>('/tokens/popular');
}

/**
 * Get stablecoins
 */
export async function getStablecoins(): Promise<{ tokens: Token[] }> {
  return fetchApi<{ tokens: Token[] }>('/tokens/stablecoins');
}

/**
 * Get token price
 */
export async function getTokenPrice(symbol: string, chain: string): Promise<TokenPrice> {
  return fetchApi<TokenPrice>(`/tokens/price?symbol=${symbol}&chain=${chain}`);
}

/**
 * Get prices for multiple tokens
 */
export async function getTokenPrices(
  tokens: Array<{ symbol: string; chain: string }>
): Promise<{ prices: TokenPrice[] }> {
  return fetchApi<{ prices: TokenPrice[] }>('/tokens/prices', {
    method: 'POST',
    body: JSON.stringify({ tokens }),
  });
}

// ===========================================
// Default export
// ===========================================

export const tokensApi = {
  list: listTokens,
  search: searchTokens,
  byChain: getTokensByChain,
  popular: getPopularTokens,
  stablecoins: getStablecoins,
  getPrice: getTokenPrice,
  getPrices: getTokenPrices,
};
