/**
 * Unified Swap Provider Configuration
 * 
 * Allows switching between different swap providers (Biconomy, Rhinestone).
 * Change the value below to switch providers.
 */

export type SwapProvider = "biconomy" | "rhinestone";

// ========================================
// 🔧 CHANGE THIS VALUE TO SWITCH PROVIDER
// ========================================
export const ACTIVE_SWAP_PROVIDER: SwapProvider = "rhinestone";

// Check if a specific provider is active
export function isProviderActive(provider: SwapProvider): boolean {
	return ACTIVE_SWAP_PROVIDER === provider;
}

// Get provider display name
export function getProviderDisplayName(provider?: SwapProvider): string {
	const p = provider || ACTIVE_SWAP_PROVIDER;
	switch (p) {
		case "biconomy":
			return "Biconomy";
		case "rhinestone":
			return "Rhinestone";
		default:
			return p;
	}
}

// Get provider docs URL
export function getProviderDocsUrl(provider?: SwapProvider): string {
	const p = provider || ACTIVE_SWAP_PROVIDER;
	switch (p) {
		case "biconomy":
			return "https://docs.biconomy.io";
		case "rhinestone":
			return "https://docs.rhinestone.dev";
		default:
			return "";
	}
}

console.log(`[SwapProvider] Active provider: ${ACTIVE_SWAP_PROVIDER}`);

