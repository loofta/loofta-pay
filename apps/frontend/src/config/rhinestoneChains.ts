/**
 * Rhinestone SDK supported chains and tokens
 * 
 * These are the chains/tokens that support swap and transfer via Rhinestone companion wallet
 */

// Chain IDs mapped to short names
export const RHINESTONE_CHAIN_IDS: Record<string, number> = {
  eth: 1,
  ethereum: 1,
  base: 8453,
  op: 10,
  optimism: 10,
  arb: 42161,
  arbitrum: 42161,
  polygon: 137,
  matic: 137,
  zksync: 324,
};

export const RHINESTONE_CHAIN_NAMES: Record<number, string> = {
  1: "eth",
  8453: "base",
  10: "op",
  42161: "arb",
  137: "polygon",
  324: "zksync",
};

// Supported tokens per chain
export const RHINESTONE_SUPPORTED_TOKENS: Record<number, string[]> = {
  1: ["ETH", "WETH", "USDC", "USDT"],      // Ethereum
  8453: ["ETH", "WETH", "USDC", "USDT"],   // Base
  10: ["ETH", "WETH", "USDC", "USDT"],     // Optimism
  42161: ["ETH", "WETH", "USDC", "USDT"],  // Arbitrum One
  137: ["WETH", "USDC", "USDT"],           // Polygon (no native ETH)
  324: ["ETH", "WETH", "USDC", "USDT"],    // zkSync
};

// RPC URLs per chain
export const RHINESTONE_RPC_URLS: Record<number, string> = {
  1: "https://eth.llamarpc.com",
  8453: "https://mainnet.base.org",
  10: "https://mainnet.optimism.io",
  42161: "https://arb1.arbitrum.io/rpc",
  137: "https://polygon-rpc.com",
  324: "https://mainnet.era.zksync.io",
};

// Loofta treasury addresses per chain (for receiving fees)
export const LOOFTA_TREASURY_ADDRESSES: Record<number, string> = {
  1: process.env.LOOFTA_TREASURY_ETH || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
  8453: process.env.LOOFTA_TREASURY_BASE || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
  10: process.env.LOOFTA_TREASURY_OP || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
  42161: process.env.LOOFTA_TREASURY_ARB || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
  137: process.env.LOOFTA_TREASURY_POLYGON || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
  324: process.env.LOOFTA_TREASURY_ZKSYNC || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
};

// Fee percentage (taken from deposit for gas/fees)
export const LOOFTA_FEE_PERCENT = 0.01; // 1%

/**
 * Check if a chain is supported by Rhinestone
 */
export function isRhinestoneChainSupported(chain: string | number): boolean {
  if (typeof chain === "number") {
    return chain in RHINESTONE_SUPPORTED_TOKENS;
  }
  const chainLower = String(chain).toLowerCase();
  return chainLower in RHINESTONE_CHAIN_IDS;
}

/**
 * Get chain ID from chain name
 */
export function getRhinestoneChainId(chain: string | number): number | null {
  if (typeof chain === "number") {
    return chain in RHINESTONE_SUPPORTED_TOKENS ? chain : null;
  }
  const chainLower = String(chain).toLowerCase();
  return RHINESTONE_CHAIN_IDS[chainLower] || null;
}

/**
 * Check if a token is supported on a chain
 */
export function isRhinestoneTokenSupported(token: string, chain: string | number): boolean {
  const chainId = getRhinestoneChainId(chain);
  if (!chainId) return false;
  
  const supportedTokens = RHINESTONE_SUPPORTED_TOKENS[chainId];
  if (!supportedTokens) return false;
  
  const tokenUpper = String(token).toUpperCase();
  return supportedTokens.includes(tokenUpper);
}

/**
 * Check if a swap route is supported
 */
export function isRhinestoneSwapSupported(
  fromToken: string, 
  toToken: string, 
  chain: string | number
): boolean {
  const chainId = getRhinestoneChainId(chain);
  if (!chainId) return false;
  
  return isRhinestoneTokenSupported(fromToken, chainId) && 
         isRhinestoneTokenSupported(toToken, chainId);
}

/**
 * Get RPC URL for a chain
 */
export function getRhinestoneRpcUrl(chain: string | number): string | null {
  const chainId = getRhinestoneChainId(chain);
  if (!chainId) return null;
  return RHINESTONE_RPC_URLS[chainId] || null;
}

/**
 * Get Loofta treasury address for a chain
 */
export function getLooftaTreasury(chain: string | number): string | null {
  const chainId = getRhinestoneChainId(chain);
  if (!chainId) return null;
  return LOOFTA_TREASURY_ADDRESSES[chainId] || null;
}

/**
 * Get supported tokens for a chain (for filtering in UI)
 */
export function getSupportedTokensForChain(chain: string | number): string[] {
  const chainId = getRhinestoneChainId(chain);
  if (!chainId) return [];
  return RHINESTONE_SUPPORTED_TOKENS[chainId] || [];
}

/**
 * Get all supported chain names
 */
export function getAllSupportedChains(): string[] {
  return Object.keys(RHINESTONE_CHAIN_IDS);
}

