export const BICONOMY_API_BASE: string =
	(process as any)?.env?.BICONOMY_API_BASE ||
	(process as any)?.env?.NEXT_PUBLIC_BICONOMY_API_BASE ||
	"https://api.biconomy.io";

export const BICONOMY_API_KEY: string | undefined =
	(process as any)?.env?.BICONOMY_API_KEY ||
	(process as any)?.env?.NEXT_PUBLIC_BICONOMY_API_KEY ||
	undefined;

// Chains that we consider EVM for Biconomy routing
export const EVM_CHAIN_SET = new Set([
	"eth","ethereum","arb","arbitrum","base","op","optimism","bsc","avax","avalanche","polygon","matic","fantom","ftm","gnosis","linea","scroll","zksync","zk","blast","pol"
]);

export function isEvmChainId(chain?: string): boolean {
	return EVM_CHAIN_SET.has(String(chain || "").toLowerCase());
}

// Canonical Biconomy-supported chains (subset aligned to our token chain labels)
// Source: Biconomy Supported Chains
// https://docs.biconomy.io/contracts-and-audits/supported-chains#supported-chains
const BICONOMY_SUPPORTED_CHAINS = new Set<string>([
	"ethereum","sepolia",
	"base","base-sepolia",
	"polygon","amoy","polygon-amoy",
	"arbitrum","arbitrum-sepolia",
	"optimism","op","op-sepolia",
	"bsc","bsc-testnet",
	"gnosis","chiado",
	"avalanche","avalanche-fuji","avax","fuji",
	"scroll","scroll-sepolia",
	"linea",
	"blast","blast-sepolia",
	"sonic","sonic-testnet",
	"worldchain",
	"monad","monad-testnet",
	"plasma","plasma-testnet",
	"unichain","unichain-testnet",
	"lisk",
]);

function normalizeChainKey(chain?: string): string {
	const c = String(chain || "").toLowerCase();
	if (c === "eth") return "ethereum";
	if (c.includes("sepolia")) return c.includes("base") ? "base-sepolia" : "sepolia";
	if (c === "op" || c === "optimism") return "optimism";
	if (c === "arb" || c === "arbitrum") return "arbitrum";
	if (c === "pol" || c === "polygon" || c === "matic") return "polygon";
	if (c === "avax" || c === "avalanche") return "avalanche";
	if (c === "gnosis" || c === "xdai") return "gnosis";
	return c;
}

export function isBiconomySupportedChain(chain?: string): boolean {
	const key = normalizeChainKey(chain);
	return BICONOMY_SUPPORTED_CHAINS.has(key);
}


