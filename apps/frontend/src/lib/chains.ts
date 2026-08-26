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

const EVM_CHAINS = new Set([
	"eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism",
	"bsc", "berachain", "pol", "polygon", "avax", "avalanche", "gnosis",
	"fantom", "ftm", "linea", "scroll", "zksync", "zk", "blast", "matic",
]);

/**
 * Groups a raw chain identifier (as returned by NEAR Intents' token list) into the wallet-connect
 * family it belongs to, so callers can route to the matching connect flow (EVM via wagmi/RainbowKit,
 * TON via TonConnect, Bitcoin via a bvm wallet) instead of a manual refund address.
 */
export function getChainFamily(chain: string): "evm" | "ton" | "bitcoin" | "other" {
	const ch = String(chain || "").toLowerCase();
	if (EVM_CHAINS.has(ch)) return "evm";
	if (ch === "ton") return "ton";
	if (ch === "btc" || ch === "bitcoin") return "bitcoin";
	return "other";
}

export function getChainIcon(chain?: string): string | undefined {
	if (!chain) return undefined;
	let key = String(chain).toLowerCase();
	// Normalize common aliases used in asset ids/symbols
	const alias: Record<string, string> = {
		arb: "arbitrum",
		op: "optimism",
		avax: "avalanche",
		pol: "polygon",
		matic: "polygon",
		sol: "solana",
		xdai: "gnosis",
		btc: "bitcoin",
		doge: "dogecoin",
		ltc: "litecoin",
		xrp: "xrpledger",
		zec: "zcash",
		bera: "berachain",
		hyperliquid: "hypercore",
		abs: "abstract",
	};
	if (alias[key]) key = alias[key];
	// Only map icons that exist in /public/static/icons/network to avoid broken images.
	const map: Record<string, string> = {
		ethereum: "/static/icons/network/ethereum.svg",
		eth: "/static/icons/network/ethereum.svg",
		base: "/static/icons/network/base.svg",
		berachain: "/static/icons/network/berachain.svg",
		bera: "/static/icons/network/berachain.svg",
		arbitrum: "/static/icons/network/arbitrum.svg",
		polygon: "/static/icons/network/polygon.svg",
		near: "/static/icons/network/near_dark.svg",
		solana: "/static/icons/network/solana.svg",
		optimism: "/static/icons/network/optimism.svg",
		bsc: "/static/icons/network/bsc.svg",
		avalanche: "/static/icons/network/avalanche.svg",
		gnosis: "/static/icons/network/gnosis.svg",
		cardano: "/static/icons/network/cardano.svg",
		ton: "/static/icons/network/ton.svg",
		aptos: "/static/icons/network/aptos.svg",
		monad: "/static/icons/network/monad.svg",
		starknet: "/static/icons/network/starknet.svg",
		bch: "/static/icons/network/bitcoincash.svg",
		xlayer: "/static/icons/network/layerx.svg",
		adi: "/static/icons/network/adi.svg",
		scroll: "/static/icons/network/scroll.svg",
		plasma: "/static/icons/network/plasma.svg",
		aleo: "/static/icons/network/aleo-white.svg",
		// HyperCore is Hyperliquid's native chain; reuse the existing Hyperliquid mark.
		hypercore: "/static/icons/network/hyperliquid.svg",
		// Abstract has no CoinMarketCap-listed native token — saved locally from DefiLlama's chain
		// icon CDN rather than hotlinked, since the CSP's img-src doesn't allow arbitrary hosts.
		abstract: "/static/icons/network/abstract.webp",
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
		monad: "MON",
		aurora: "ETH",
		// Non-EVM
		solana: "SOL",
		near: "NEAR",
		cardano: "ADA",
		xrpledger: "XRP",
		ton: "TON",
		aptos: "APT",
		tron: "TRX",
		sui: "SUI",
		stellar: "XLM",
		bitcoin: "BTC",
		dogecoin: "DOGE",
		litecoin: "LTC",
		zcash: "ZEC",
		berachain: "BERA",
		starknet: "STRK",
		bch: "BCH",
		xlayer: "XLAYER",
		movement: "MOVE",
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


