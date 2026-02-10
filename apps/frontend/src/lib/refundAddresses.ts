/**
 * Validate that an address matches the expected format for the given chain/network.
 * Use for destination addresses and refund addresses across the app.
 */
export function isValidAddressForChain(address: string, chain: string): boolean {
  const raw = (address || "").trim();
  if (!raw) return false;
  const ch = String(chain || "").toLowerCase();

  const evmChains = new Set([
    "eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism",
    "bsc", "berachain", "pol", "polygon", "avax", "avalanche", "gnosis",
    "fantom", "ftm", "linea", "scroll", "zksync", "zk", "blast", "matic",
  ]);
  if (evmChains.has(ch)) return /^0x[a-fA-F0-9]{40}$/.test(raw);

  if (ch === "solana" || ch === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw);
  if (ch === "near") return /^[a-z0-9_.-]+\.(near|testnet)$/i.test(raw) || /^[a-f0-9]{64}$/i.test(raw);
  if (ch === "btc" || ch === "bitcoin") return /^bc1[0-9a-zA-Z]{20,90}$/.test(raw) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(raw);
  if (ch === "ton") return /^[A-Za-z0-9_-]{48,66}$/.test(raw);
  if (ch === "sui") return /^0x[a-fA-F0-9]{64}$/.test(raw);
  if (ch === "ada" || ch === "cardano") return /^addr1[0-9a-z]+$/.test(raw);
  if (ch === "zec" || ch === "zcash") return /^t1[0-9A-Za-z]{33}$/.test(raw) || /^zs1[0-9a-zA-Z]{75}$/.test(raw);
  if (ch === "xlm" || ch === "stellar") return /^G[2-7A-Z]{55}$/.test(raw);
  if (ch === "trx" || ch === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw);
  if (ch === "xrp" || ch === "xrpledger") return /^r[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(raw);
  if (ch === "ltc" || ch === "litecoin") return /^ltc1[0-9a-z]{20,90}$/.test(raw) || /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(raw);
  if (ch === "doge" || ch === "dogecoin") return /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(raw);
  if (ch === "aptos") return /^0x[a-fA-F0-9]{64}$/.test(raw);

  return raw.length >= 20;
}

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
