import type { NearToken } from "@/services/nearIntents";
import { getIconForAssetId } from "@/lib/tokenlist";
// Optional local copy of Defuse production tokenlist (trimmed or full)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import tokenlist from "@/config/tokenlist/production.json";

// Expanded set of common CMC IDs to improve logo coverage
const CMC_IDS: Record<string, number> = {
	BTC: 1,
	ETH: 1027,
	USDT: 825,
	USDC: 3408,
	BNB: 1839,
	SOL: 5426,
	ADA: 2010,
	XRP: 52,
	DOGE: 74,
	TON: 11419,
	TRX: 1958,
	MATIC: 3890,
	WBTC: 3717,
	DAI: 4943,
	AVAX: 5805,
	ARB: 11841,
	OP: 11840,
	NEAR: 6535,
};

export function cmcLogoForSymbol(symbol?: string): string | undefined {
	const id = symbol ? CMC_IDS[symbol.toUpperCase()] : undefined;
	return id ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png` : `/static/icons/network/${symbol?.toLowerCase()}.svg`;
}

const LOCAL_FALLBACKS: Record<string, string> = {};

export function resolveTokenLogo(meta: Partial<NearToken> & Record<string, any>): string | undefined {
	// 1) Exact match by defuse asset id (assetId/tokenId)
	const assetId = (meta as any)?.tokenId || (meta as any)?.address || (meta as any)?.assetId;
	if (typeof assetId === "string") {
		const iconByAsset = getIconForAssetId(assetId);
		if (iconByAsset) return iconByAsset;
	}
	// 2) Prefer explicit icon from backend (defuse tokenlists use "icon")
	const ordered = [meta.icon, meta.logo, meta.logoURI] as Array<unknown>;
	for (const candidate of ordered) {
		const s = typeof candidate === "string" ? candidate : undefined;
		if (!s) continue;
		// Guard against obvious mismatches in defaults (e.g. USDC pointing to usdt.svg)
		const sym = (meta.symbol || "").toUpperCase();
		const lower = s.toLowerCase();
		if (sym && sym !== "USDT" && lower.includes("usdt")) {
			continue;
		}
		return s;
	}
	// 3) Fallback to known CMC ids by symbol
	const cmc = cmcLogoForSymbol(meta.symbol);
	if (cmc) return cmc;
	// 4) Local tokenlist mapping (by symbol)
	try {
		const tokens: any[] = (tokenlist?.tokens as any[]) || [];
		const sym = (meta.symbol || "").toUpperCase();
		if (sym) {
			const t = tokens.find((t) => (t?.symbol || "").toUpperCase() === sym && typeof t?.icon === "string");
			if (t?.icon) return t.icon as string;
		}
	} catch {
		// noop
	}
	// 5) Local fallback assets
	if (meta.symbol) {
		const local = LOCAL_FALLBACKS[meta.symbol.toUpperCase()];
		if (local) return local;
	}
	return undefined;
}


