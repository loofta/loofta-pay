/**
 * Rhinestone Configuration
 * 
 * Rhinestone is a smart wallet and crosschain liquidity platform providing
 * intent-based transaction infrastructure for seamless cross-chain swaps.
 * 
 * Docs: https://docs.rhinestone.dev/
 */

export const RHINESTONE_API_BASE: string =
	process.env.RHINESTONE_API_BASE ||
	process.env.NEXT_PUBLIC_RHINESTONE_API_BASE ||
	"https://v1.orchestrator.rhinestone.dev";

export const RHINESTONE_API_KEY: string | undefined =
	process.env.RHINESTONE_API_KEY ||
	process.env.NEXT_PUBLIC_RHINESTONE_API_KEY ||
  undefined;
  
// Log API key status (first 8 chars only for security)
if (typeof window === "undefined") {
  // Server-side only
  if (RHINESTONE_API_KEY) {
    console.log("[Rhinestone Config] ✓ API key loaded:", RHINESTONE_API_KEY.substring(0, 8) + "...");
  } else {
    console.warn("[Rhinestone Config] ⚠️ RHINESTONE_API_KEY is not set!");
  }
  console.log("[Rhinestone Config] API Base:", RHINESTONE_API_BASE);
}

// Rhinestone supported chains with their chain IDs and supported tokens
// Source: https://docs.rhinestone.dev/
export type RhinestoneChainConfig = {
	chainId: number;
	name: string;
	tokens: string[];
	active: boolean;
};

export const RHINESTONE_CHAINS: Record<string, RhinestoneChainConfig> = {
	ethereum: { chainId: 1, name: "Ethereum", tokens: ["ETH", "WETH", "USDC", "USDT"], active: true },
	base: { chainId: 8453, name: "Base", tokens: ["ETH", "WETH", "USDC", "USDT"], active: true },
	optimism: { chainId: 10, name: "Optimism", tokens: ["ETH", "WETH", "USDC", "USDT"], active: true },
	arbitrum: { chainId: 42161, name: "Arbitrum One", tokens: ["ETH", "WETH", "USDC", "USDT"], active: true },
	polygon: { chainId: 137, name: "Polygon", tokens: ["WETH", "USDC", "USDT"], active: true },
	zksync: { chainId: 324, name: "zkSync", tokens: ["ETH", "WETH", "USDC", "USDT"], active: true },
	soneium: { chainId: 1868, name: "Soneium", tokens: ["ETH", "WETH", "USDC"], active: true },
	// Upon request chains (not active by default)
	"aleph-zero": { chainId: 2039, name: "Aleph Zero", tokens: ["ETH", "WETH", "USDC"], active: false },
	blast: { chainId: 81457, name: "Blast", tokens: ["ETH", "WETH", "USDC"], active: false },
	ink: { chainId: 57073, name: "Ink", tokens: ["ETH", "WETH", "USDC"], active: false },
	lens: { chainId: 232, name: "Lens", tokens: ["ETH", "WETH", "USDC"], active: false },
	linea: { chainId: 59144, name: "Linea", tokens: ["ETH", "WETH", "USDC"], active: false },
	lisk: { chainId: 1135, name: "Lisk", tokens: ["ETH", "WETH", "USDC"], active: false },
	mode: { chainId: 34443, name: "Mode", tokens: ["ETH", "WETH", "USDC"], active: false },
	redstone: { chainId: 690, name: "Redstone", tokens: ["ETH", "WETH", "USDC"], active: false },
	scroll: { chainId: 534352, name: "Scroll", tokens: ["ETH", "WETH", "USDC"], active: false },
	unichain: { chainId: 130, name: "Unichain", tokens: ["ETH", "WETH", "USDC"], active: false },
	worldchain: { chainId: 480, name: "World Chain", tokens: ["ETH", "WETH", "USDC"], active: false },
	zora: { chainId: 7777777, name: "Zora", tokens: ["ETH", "WETH", "USDC"], active: false },
};

// Chain ID to key mapping
export const RHINESTONE_CHAIN_ID_MAP: Record<number, string> = Object.fromEntries(
	Object.entries(RHINESTONE_CHAINS).map(([key, config]) => [config.chainId, key])
);

// Normalize chain name to Rhinestone key
function normalizeChainKey(chain?: string): string {
	const c = String(chain || "").toLowerCase().trim().replace(/[\s_]+/g, "-");
	
	// Direct matches
	if (RHINESTONE_CHAINS[c]) return c;
	
	// Aliases
	const aliases: Record<string, string> = {
		"eth": "ethereum",
		"mainnet": "ethereum",
		"op": "optimism",
		"arb": "arbitrum",
		"matic": "polygon",
		"pol": "polygon",
		"zk": "zksync",
		"zksync-era": "zksync",
	};
	
	if (aliases[c]) return aliases[c];
	
	// Partial matches
	if (c.includes("base")) return "base";
	if (c.includes("polygon") || c.includes("matic")) return "polygon";
	if (c.includes("arbitrum") || c.includes("arb")) return "arbitrum";
	if (c.includes("optimism")) return "optimism";
	if (c.includes("zksync") || c.includes("zk-sync")) return "zksync";
	
	return c;
}

// Check if chain is supported by Rhinestone
export function isRhinestoneSupportedChain(chain?: string): boolean {
	const key = normalizeChainKey(chain);
	const config = RHINESTONE_CHAINS[key];
	return config?.active === true;
}

// Check if chain is supported (including upon-request chains)
export function isRhinestoneAvailableChain(chain?: string): boolean {
	const key = normalizeChainKey(chain);
	return !!RHINESTONE_CHAINS[key];
}

// Get chain ID for a chain name
export function getRhinestoneChainId(chain?: string): number | undefined {
	const key = normalizeChainKey(chain);
	return RHINESTONE_CHAINS[key]?.chainId;
}

// Get chain config
export function getRhinestoneChainConfig(chain?: string): RhinestoneChainConfig | undefined {
	const key = normalizeChainKey(chain);
	return RHINESTONE_CHAINS[key];
}

// Check if a token is supported on a chain
export function isRhinestoneSupportedToken(chain?: string, tokenSymbol?: string): boolean {
	const config = getRhinestoneChainConfig(chain);
	if (!config?.active) return false;
	
	const symbol = String(tokenSymbol || "").toUpperCase();
	return config.tokens.includes(symbol);
}

// Get all active chain IDs
export function getRhinestoneActiveChainIds(): number[] {
	return Object.values(RHINESTONE_CHAINS)
		.filter(c => c.active)
		.map(c => c.chainId);
}

// Auth headers for Rhinestone API
export function rhinestoneAuthHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (RHINESTONE_API_KEY) headers["x-api-key"] = RHINESTONE_API_KEY;
	return headers;
}

