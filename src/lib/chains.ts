import { cmcLogoForSymbol } from "@/lib/tokenImages";
import tokenList from "@/config/tokenlist/production.json";

function getIconFromTokenListBySymbol(sym: string): string | undefined {
	const symUpper = String(sym).toUpperCase();
	const symLower = String(sym).toLowerCase();
	const list: any = (tokenList as any)?.tokens || [];
	const entry = list.find(
		(t: any) =>
			(String(t.unifiedAssetId || "").toLowerCase() === symLower) ||
			(String(t.symbol || "").toUpperCase() === symUpper)
	);
	if (!entry) return undefined;
	return entry.icon || entry.groupedTokens?.[0]?.icon;
}

export function getChainIcon(chain?: string): string | undefined {
	if (!chain) return undefined;
	const key = String(chain).toLowerCase();
	// Only map icons that exist in /public/static/icons/network to avoid broken images.
	const map: Record<string, string> = {
		ethereum: "/static/icons/network/ethereum.svg",
		eth: "/static/icons/network/ethereum.svg",
		base: "/static/icons/network/base.svg",
		arbitrum: "/static/icons/network/arbitrum.svg",
		polygon: "/static/icons/network/polygon.svg",
		near: "/static/icons/network/near.svg",
		solana: "/static/icons/network/solana.svg",
		optimism: "/static/icons/network/optimism.svg",
		bsc: "/static/icons/network/bsc.svg",
		avalanche: "/static/icons/network/avalanche.svg",
		gnosis: "/static/icons/network/gnosis.svg",
		cardano: "/static/icons/network/cardano.svg",
		ton: "/static/icons/network/ton.svg",
		aptos: "/static/icons/network/aptos.svg",
	};
	const local = map[key];
	if (local) return local;
	// Fallback to a coin icon from CoinMarketCap for common chains
	const chainToSymbol: Record<string, string> = {
		// EVM and L2s
		ethereum: "ETH",
		eth: "ETH",
		base: "ETH",
		arbitrum: "ARB",
		optimism: "OP",
		polygon: "POL", // fallback to MATIC if POL not available
		gnosis: "GNO",
		bsc: "BNB",
		avalanche: "AVAX",
		aurora: "ETH",
		// Non-EVM
		solana: "SOL",
		near: "NEAR",
		cardano: "ADA",
		ton: "TON",
		aptos: "APT",
		tron: "TRX",
		sui: "SUI",
		stellar: "XLM",
		bitcoin: "BTC",
		litecoin: "LTC",
		berachain: "BERA",
	};
	const sym = chainToSymbol[key];
	if (sym) {
		// Prefer icon defined in our production.json token list
		const fromList = getIconFromTokenListBySymbol(sym);
		if (fromList) return fromList;
		// Try primary symbol, with a couple of graceful fallbacks
		const primary = cmcLogoForSymbol(sym);
		if (primary) return primary;
		if (sym === "POL") return cmcLogoForSymbol("MATIC");
		if (sym === "ETH" && (key === "arbitrum" || key === "optimism")) {
			// Prefer ARB/OP logos when ETH isn't desired
			const alt = cmcLogoForSymbol(key === "arbitrum" ? "ARB" : "OP");
			if (alt) return alt;
		}
	}
	return undefined;
}


