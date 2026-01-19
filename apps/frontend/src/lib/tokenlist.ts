// Utilities to look up token metadata from local/embedded Defuse production tokenlist
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import tokenlist from "@/config/tokenlist/production.json";

type TokenList = {
	tokens: any[];
};

const list: TokenList = tokenlist as TokenList;

const CHAIN_NORMALIZE: Record<string, string> = {
	ethereum: "eth",
	eth: "eth",
	base: "base",
	arbitrum: "arbitrum",
	arb: "arbitrum",
	near: "near",
	solana: "solana",
	sol: "solana",
	bnb: "bsc",
	bsc: "bsc",
	polygon: "polygon",
	gnosis: "gnosis",
	bitcoin: "bitcoin",
	btc: "bitcoin",
	xrp: "xrpledger",
	xrpledger: "xrpledger",
	ton: "ton",
	sui: "sui",
	stellar: "stellar",
	xlm: "stellar",
	cardano: "cardano",
	ada: "cardano",
	avalanche: "avalanche",
	avax: "avalanche",
	optimism: "optimism",
	op: "optimism",
	doge: "dogecoin",
	dogecoin: "dogecoin",
	ltc: "litecoin",
	litecoin: "litecoin",
	zec: "zcash",
	zcash: "zcash",
};

export function getIconForSymbol(symbol?: string): string | undefined {
	if (!symbol) return undefined;
	const sym = symbol.toUpperCase();
	const t = list.tokens.find((t) => (t.symbol || "").toUpperCase() === sym);
	if (t?.icon) return t.icon as string;
	return undefined;
}

export function getIconForAssetId(assetId?: string): string | undefined {
	if (!assetId) return undefined;
	for (const t of list.tokens) {
		if (typeof (t as any).defuseAssetId === "string" && (t as any).defuseAssetId === assetId && t.icon) {
			return t.icon as string;
		}
		const grouped: any[] = Array.isArray((t as any).groupedTokens) ? (t as any).groupedTokens : [];
		for (const g of grouped) {
			if (typeof g?.defuseAssetId === "string" && g.defuseAssetId === assetId && g.icon) {
				return g.icon as string;
			}
		}
	}
	return undefined;
}

export function getDefuseAssetIdFor(symbol?: string, chain?: string): string | undefined {
	if (!symbol || !chain) return undefined;
	const sym = symbol.toUpperCase();
	const norm = CHAIN_NORMALIZE[String(chain).toLowerCase()];
	if (!norm) return undefined;
	for (const t of list.tokens) {
		if ((t.symbol || "").toUpperCase() !== sym) continue;
		const grouped: any[] = Array.isArray(t.groupedTokens) ? t.groupedTokens : [];
		const hit = grouped.find((g) => (g?.originChainName || g?.chainName) === norm || (g?.deployments || []).some((d: any) => d?.chainName === norm));
		if (hit?.defuseAssetId) return String(hit.defuseAssetId);
	}
	return undefined;
}


