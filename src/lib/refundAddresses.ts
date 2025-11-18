export function getRefundToForChain(chain: string): string {
	const key = String(chain || "").toLowerCase();
	// EVM family
	const evmSet = new Set([
		"eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism",
		"bsc", "berachain", "pol", "polygon", "avax", "avalanche", "gnosis",
		"fantom", "ftm", "linea", "scroll", "zksync", "zk", "blast"
	]);
	if (evmSet.has(key)) return "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11";
	if (key === "ton") return "UQAdFe6F7DRQMQhJI2dUjKiMhU-oa5G9LNP8OAoWZ1LX2ILj";
	if (key === "btc" || key === "bitcoin") return "bc1qjkp923x8x7g2zs5fvulg2rj0j03kqlvmhvrr86";
	if (key === "sui") return "0xec3b73a81f4ff354d459193a37f5b44dfe5c390985a026f58a95f20f5765bd1d";
	if (key === "sol" || key === "solana") return "Fj6wgB92stPhFBdEmz1TD9sH32KtboXYj69uxBbSvXTX";
	if (key === "ada" || key === "cardano") return "addr1q95tlmezyr5fndggm8xjsfutcym56sn52hek96clwl6ks8q44edaanr3wd72e2gr469uhr77qvtdptv54gqgmhfqkaws6d0t6m";
	if (key === "zec" || key === "zcash") return "t1P8MtsWo2NUPJg35WqSNXwVWTagfBAaytP";
	if (key === "xlm" || key === "stellar") return "GCKPJM6FVUBLGGD3U3YCESP5MU36N5NOBPOVI3ZXAHD62ENYIH7V27JJ";
	if (key === "trx" || key === "tron") return "TRa9fBTbhg9Z3jp9SqWUQBWKVAK8MF7kn5";
	if (key === "xrp" || key === "xrpledger") return "rnA7DEyXpf8o5ekn6RHA1VCaDQNu8ikGCx";
	if (key === "ltc" || key === "litecoin") return "ltc1qz430lm4r5xv53nwumy7p255s6jpw2hgz6r0dxv";
	if (key === "near") return "lisabey.near";
	if (key === "doge" || key === "dogecoin") return "DCxSRmSvJ5mRvgitj6DjXtptCvNLG2Kxkw";
	// Default to EVM fallback
	return "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11";
}

export function getRefundToForAssetId(assetId: string, fallbackChain?: string): string {
	const id = String(assetId || "");
	if (id.startsWith("nep141:")) {
		const rest = id.slice("nep141:".length);
		const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
		return getRefundToForChain(head || fallbackChain || "");
	}
	return getRefundToForChain(fallbackChain || "");
}
