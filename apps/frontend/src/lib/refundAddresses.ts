/**
 * Get default placeholder refund address for a given chain.
 * Used for quotes (dry runs) when user hasn't provided a refund address yet.
 * These are placeholder addresses (not real addresses) - only used for quote estimation.
 * 
 * @TODO: This is STRICTLY FOR MVP - TO BE REMOVED LATER when wallet connect is implemented
 */
export function getRefundToForChain(chain: string): string {
	const key = String(chain || "").toLowerCase();
	
	// EVM family chains - all use the same placeholder address
	const evmChains = new Set([
		"eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism",
		"bsc", "berachain", "pol", "polygon", "avax", "avalanche", "gnosis",
		"fantom", "ftm", "linea", "scroll", "zksync", "zk", "blast"
	]);
	if (evmChains.has(key)) {
		return "0x0000000000000000000000000000000000000000";
	}
	
	// Chain-specific placeholder addresses (format-specific but not real addresses)
	const chainAddressMap: Record<string, string> = {
		ton: "UQ0000000000000000000000000000000000000000000000000000000000000000",
		btc: "bc1q000000000000000000000000000000000000000000000000000000000000",
		bitcoin: "bc1q000000000000000000000000000000000000000000000000000000000000",
		sui: "0x0000000000000000000000000000000000000000000000000000000000000000",
		sol: "00000000000000000000000000000000000000000000",
		solana: "00000000000000000000000000000000000000000000",
		ada: "addr1q000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
		cardano: "addr1q000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
		zec: "t100000000000000000000000000000000000000000",
		zcash: "t100000000000000000000000000000000000000000",
		xlm: "G000000000000000000000000000000000000000000000000000000000000000",
		stellar: "G000000000000000000000000000000000000000000000000000000000000000",
		trx: "T0000000000000000000000000000000000000000",
		tron: "T0000000000000000000000000000000000000000",
		xrp: "r0000000000000000000000000000000000000000",
		xrpledger: "r0000000000000000000000000000000000000000",
		ltc: "ltc1q000000000000000000000000000000000000000000000000000000000000",
		litecoin: "ltc1q000000000000000000000000000000000000000000000000000000000000",
		near: "0000000000000000000000000000000000000000000000000000000000000000.near",
		doge: "D0000000000000000000000000000000000000000",
		dogecoin: "D0000000000000000000000000000000000000000",
	};
	
	// Return chain-specific placeholder address if found, otherwise default to EVM placeholder
	return chainAddressMap[key] || "0x0000000000000000000000000000000000000000";
}

export function getRefundToForAssetId(assetId: string, fallbackChain?: string): string {
	const id = String(assetId || "");
	// Parse nep141:<head>-... to infer underlying chain family
	if (id.startsWith("nep141:")) {
		const rest = id.slice("nep141:".length);
		const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
		return getRefundToForChain(head || fallbackChain || "");
	}
	return getRefundToForChain(fallbackChain || "");
}
