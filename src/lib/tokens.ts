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

export function findTokenBySelection(
	tokens: NearToken[],
	selection: { symbol: string; chain: string } | undefined | null
): NearToken | undefined {
	if (!selection) return undefined;
	return tokens.find((t) => t.symbol === selection.symbol && t.chain === selection.chain)
		|| tokens.find((t) => t.symbol === selection.symbol);
}

const CHAIN_LABELS: Record<string, string> = {
	ethereum: "Ethereum",
	arbitrum: "Arbitrum",
	base: "Base",
	polygon: "Polygon",
	gnosis: "Gnosis",
	bnb: "BNB Smart Chain",
	solana: "Solana",
	near: "NEAR",
	bitcoin: "Bitcoin",
	tron: "Tron",
	ton: "TON",
	sui: "Sui",
	stellar: "Stellar",
	cardano: "Cardano",
	xrp: "XRP",
	zcash: "ZCash",
};

export function formatChainLabel(chain: string | undefined): string {
	if (!chain) return "";
	const key = String(chain).toLowerCase();
	const label = CHAIN_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
	return label.length < 4 ? label.toUpperCase() : label;
}


