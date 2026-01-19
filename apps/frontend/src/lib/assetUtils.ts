/**
 * Utility functions to extract chain information from asset IDs
 * Asset IDs follow formats like: nep141:eth.omft.near, nep141:sol.omft.near, etc.
 */

/**
 * Extract chain name from asset ID
 * @param assetId - Asset ID from 1-click API (e.g., "nep141:eth.omft.near", "nep141:sol.omft.near")
 * @returns Chain name in lowercase (e.g., "eth", "sol", "base")
 */
export function extractChainFromAssetId(assetId: string | null | undefined): string | null {
  if (!assetId || typeof assetId !== 'string') return null;
  
  // Handle nep141: format (e.g., nep141:eth.omft.near)
  if (assetId.startsWith('nep141:')) {
    const rest = assetId.slice('nep141:'.length);
    // Extract the chain identifier (before first dot or dash)
    const chainPart = rest.includes('.') 
      ? rest.split('.')[0] 
      : rest.includes('-') 
        ? rest.split('-')[0] 
        : rest;
    
    const chain = chainPart.toLowerCase();
    
    // Map common chain identifiers
    const chainMap: Record<string, string> = {
      'eth': 'eth',
      'ethereum': 'eth',
      'base': 'base',
      'arb': 'arb',
      'arbitrum': 'arb',
      'op': 'op',
      'optimism': 'op',
      'sol': 'sol',
      'solana': 'sol',
      'polygon': 'polygon',
      'pol': 'polygon',
      'matic': 'polygon',
      'bsc': 'bsc',
      'bnb': 'bsc',
      'avax': 'avax',
      'avalanche': 'avax',
      'gnosis': 'gnosis',
      'xdai': 'gnosis',
      'zksync': 'zksync',
      'zk': 'zksync',
      'ton': 'ton',
      'near': 'near',
      'btc': 'btc',
      'bitcoin': 'btc',
      'xrp': 'xrp',
      'xlm': 'xlm',
      'stellar': 'xlm',
      'zec': 'zec',
      'zcash': 'zec',
      'ada': 'ada',
      'cardano': 'ada',
      'doge': 'doge',
      'dogecoin': 'doge',
      'ltc': 'ltc',
      'litecoin': 'ltc',
      'sui': 'sui',
    };
    
    return chainMap[chain] || chain;
  }
  
  // Handle other formats (direct chain names, addresses, etc.)
  return assetId.toLowerCase();
}

/**
 * Extract chain from origin/destination asset IDs in 1-click API response
 */
export function extractChainsFromAssets(
  originAsset: string | null | undefined,
  destinationAsset: string | null | undefined
): { fromChain: string | null; toChain: string | null } {
  return {
    fromChain: extractChainFromAssetId(originAsset),
    toChain: extractChainFromAssetId(destinationAsset),
  };
}
