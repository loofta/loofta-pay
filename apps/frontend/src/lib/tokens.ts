import type { NearToken } from "@/services/nearIntents";

export type TokenGroup = {
	symbol: string;
	name: string;
	logoURI?: string;
	chains: Record<string, NearToken>;
	availableChains: string[];
};

export function groupTokensBySymbol(tokens: NearToken[]): TokenGroup[] {
	const bySymbol = new Map<string, TokenGroup>();
	for (const t of tokens) {
		const key = t.symbol;
		const existing = bySymbol.get(key);
		if (existing) {
			existing.chains[t.chain] = t;
			if (!existing.availableChains.includes(t.chain)) {
				existing.availableChains.push(t.chain);
			}
			// Prefer to keep the first non-empty logo/name we encounter
			if (!existing.logoURI && t.logoURI) existing.logoURI = t.logoURI;
			if (!existing.name && t.name) existing.name = t.name;
		} else {
			bySymbol.set(key, {
				symbol: t.symbol,
				name: t.name || t.symbol,
				logoURI: t.logoURI,
				chains: { [t.chain]: t },
				availableChains: [t.chain],
			});
		}
	}
	return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function uniqueChains(tokens: NearToken[]): string[] {
	const s = new Set<string>();
	for (const t of tokens) s.add(t.chain);
	return Array.from(s.values()).sort((a, b) => a.localeCompare(b));
}

export function findTokenBySelection<T extends { symbol: string; chain: string } = NearToken>(
	tokens: T[],
	selection: { symbol: string; chain: string } | undefined | null
): T | undefined {
	if (!selection) return undefined;
	return tokens.find((t) => t.symbol === selection.symbol && t.chain === selection.chain)
		|| tokens.find((t) => t.symbol === selection.symbol);
}

// Keyed by the raw `blockchain` code NEAR Intents actually returns (eth, arb, pol, btc, sol,
// zec, ...), not the full chain name — a prior version of this map used full names like
// "ethereum"/"zcash" which never matched live token data, so those chains fell through to the
// generic short-code fallback below and weren't findable by their full name in search.
const CHAIN_LABELS: Record<string, string> = {
	eth: "Ethereum",
	ethereum: "Ethereum",
	arb: "Arbitrum",
	arbitrum: "Arbitrum",
	base: "Base",
	pol: "Polygon",
	polygon: "Polygon",
	gnosis: "Gnosis",
	bnb: "BNB Smart Chain",
	bsc: "BNB Smart Chain",
	avax: "Avalanche",
	avalanche: "Avalanche",
	op: "Optimism",
	optimism: "Optimism",
	sol: "Solana",
	solana: "Solana",
	near: "NEAR",
	btc: "Bitcoin",
	bitcoin: "Bitcoin",
	bch: "Bitcoin Cash",
	ltc: "Litecoin",
	doge: "Dogecoin",
	dash: "Dash",
	tron: "Tron",
	ton: "TON",
	sui: "Sui",
	stellar: "Stellar",
	cardano: "Cardano",
	xrp: "XRP",
	zec: "Zcash",
	zcash: "Zcash",
	bera: "Berachain",
	berachain: "Berachain",
	monad: "Monad",
	starknet: "Starknet",
	aptos: "Aptos",
	scroll: "Scroll",
	plasma: "Plasma",
	aleo: "Aleo",
	movement: "Movement",
	hypercore: "HyperCore",
	abs: "Abstract",
	abstract: "Abstract",
	fogo: "Fogo",
	xlayer: "X Layer",
};

export function formatChainLabel(chain: string | undefined): string {
	if (!chain) return "";
	const key = String(chain).toLowerCase();
	const label = CHAIN_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
	return label.length < 4 ? label.toUpperCase() : label;
}


