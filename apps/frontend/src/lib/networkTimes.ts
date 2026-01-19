/**
 * Network-specific transaction confirmation times (in seconds)
 * These are typical confirmation times for transactions on each network
 */
export const NETWORK_CONFIRMATION_TIMES: Record<string, number> = {
  // EVM chains - typical confirmation time (1-2 blocks)
  'eth': 12,        // Ethereum: ~12s per block, usually 1-2 blocks = 12-24s
  'ethereum': 12,
  'base': 2,       // Base: ~2s per block, usually 1-2 blocks = 2-4s
  'arb': 0.25,     // Arbitrum: ~0.25s per block, usually 1 block = ~0.25s
  'arbitrum': 0.25,
  'op': 2,         // Optimism: ~2s per block, usually 1-2 blocks = 2-4s
  'optimism': 2,
  'polygon': 2,    // Polygon: ~2s per block, usually 1-2 blocks = 2-4s
  'pol': 2,
  'bsc': 3,        // BSC: ~3s per block, usually 1-2 blocks = 3-6s
  'bnb': 3,
  'avax': 2,       // Avalanche: ~2s per block
  'avalanche': 2,
  'gnosis': 5,     // Gnosis: ~5s per block
  'zksync': 1,     // zkSync: ~1s per block
  'zksync-era': 1,
  
  // Non-EVM chains
  'sol': 0.4,      // Solana: ~0.4s per slot
  'solana': 0.4,
  'near': 1.2,     // NEAR: ~1.2s finality
  'btc': 600,      // Bitcoin: ~10 minutes average
  'bitcoin': 600,
  'ton': 5,        // TON: ~5s per block
  'xrp': 4,        // XRP: ~4s per ledger
  'xlm': 5,        // Stellar: ~5s per ledger
  'stellar': 5,
  'zec': 150,      // Zcash: ~2.5 minutes
  'zcash': 150,
};

/**
 * Get network-specific transaction confirmation time
 */
export function getNetworkConfirmationTime(chain: string | null | undefined): number {
  if (!chain) return 30; // Default fallback
  
  const chainLower = String(chain).toLowerCase();
  return NETWORK_CONFIRMATION_TIMES[chainLower] || 30; // Default 30s if unknown
}

/**
 * Get estimated processing time for same-chain transaction
 * Includes: deposit confirmation + swap execution + transfer confirmation
 */
export function getSameChainProcessingTime(chain: string | null | undefined): number {
  const confirmationTime = getNetworkConfirmationTime(chain);
  
  // Same-chain: deposit confirmation + swap (~10-20s) + transfer confirmation
  return confirmationTime + 15 + confirmationTime; // ~30-50s total for most chains
}

