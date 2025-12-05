/**
 * Unified Swap Provider Service
 * 
 * Provides a single interface for swap + transfer operations,
 * routing to either Biconomy or Rhinestone based on configuration.
 */

import type { NearToken } from "@/services/nearIntents";
import { ACTIVE_SWAP_PROVIDER, type SwapProvider } from "@/config/swapProvider";
import { isDemoMode, assertNotDemoMode } from "@/config/demoMode";

// Re-export SwapProvider type for convenience
export type { SwapProvider } from "@/config/swapProvider";

// Import both providers
import {
	createSupertransaction as biconomyCreateTransaction,
	getBiconomyStatus,
	type BiconomyIntentResponse,
	type BiconomyStatusResponse,
} from "@/services/biconomy";
import { isBiconomySupportedChain, isEvmChainId } from "@/config/biconomy";

import {
	createRhinestoneTransaction,
	getRhinestoneStatus,
	canUseRhinestone,
	type RhinestoneIntentResponse,
	type RhinestoneStatusResponse,
} from "@/services/rhinestone";
import { isRhinestoneSupportedChain, isRhinestoneSupportedToken } from "@/config/rhinestone";

// Unified response type
export type SwapTransactionResponse = {
	id: string;
	to: string;
	data: string;
	value: string;
	chainId: number | string;
	gas?: string;
	meta?: any;
	provider: SwapProvider;
};

export type SwapStatusResponse = {
	id?: string;
	status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELLED" | "UNKNOWN" | string;
	txHash?: string;
	error?: string;
	updatedAt?: string;
	provider: SwapProvider;
};

export type EligibilityResult = {
	eligible: boolean;
	provider: SwapProvider | null;
	reason?: string;
};

/**
 * Check if a swap can be executed and which provider to use
 */
export function checkSwapEligibility(input: {
	fromToken: NearToken;
	toToken: NearToken;
}): EligibilityResult {
	const { fromToken, toToken } = input;
	
	const fromChain = String(fromToken.chain || "").toLowerCase();
	const toChain = String(toToken.chain || "").toLowerCase();
	
	// Must be same chain for this flow
	if (fromChain !== toChain) {
		return { eligible: false, provider: null, reason: "Cross-chain not supported" };
	}

	// Must be EVM chain
	if (!isEvmChainId(fromChain)) {
		return { eligible: false, provider: null, reason: "Not an EVM chain" };
	}

	// Check active provider first
	if (ACTIVE_SWAP_PROVIDER === "rhinestone") {
		// Check Rhinestone eligibility
		if (isRhinestoneSupportedChain(fromChain)) {
			const fromSupported = isRhinestoneSupportedToken(fromChain, fromToken.symbol);
			const toSupported = isRhinestoneSupportedToken(toChain, toToken.symbol);
			
			if (fromSupported && toSupported) {
				return { eligible: true, provider: "rhinestone" };
			}
			
			// If tokens not supported by Rhinestone, fallback to Biconomy
			if (isBiconomySupportedChain(fromChain)) {
				return { eligible: true, provider: "biconomy" };
			}
			
			return { 
				eligible: false, 
				provider: null, 
				reason: `Tokens ${fromToken.symbol}/${toToken.symbol} not supported on ${fromChain}` 
			};
		}
		
		// Chain not supported by Rhinestone, try Biconomy
		if (isBiconomySupportedChain(fromChain)) {
			return { eligible: true, provider: "biconomy" };
		}
		
		return { eligible: false, provider: null, reason: `Chain ${fromChain} not supported` };
	}

	// Biconomy is active provider
	if (isBiconomySupportedChain(fromChain)) {
		return { eligible: true, provider: "biconomy" };
	}

	// Fallback to Rhinestone if Biconomy doesn't support
	if (isRhinestoneSupportedChain(fromChain)) {
		const fromSupported = isRhinestoneSupportedToken(fromChain, fromToken.symbol);
		const toSupported = isRhinestoneSupportedToken(toChain, toToken.symbol);
		
		if (fromSupported && toSupported) {
			return { eligible: true, provider: "rhinestone" };
		}
	}

	return { eligible: false, provider: null, reason: `Chain ${fromChain} not supported` };
}

/**
 * Create a swap + transfer transaction using the appropriate provider
 */
export async function createSwapTransaction(input: {
	fromToken: NearToken;
	toToken: NearToken;
	amountHuman: string;
	destinationAmountHuman?: string; // Amount recipient should receive (in toToken)
	recipient: string;
	userAddress: string;
	slippageBps?: number;
	forceProvider?: SwapProvider;
	ethereumProvider?: any; // Privy/wallet provider for Rhinestone
}): Promise<SwapTransactionResponse> {
	// Block all swap transactions in demo mode
	assertNotDemoMode("Swap transactions");

	const { fromToken, toToken, amountHuman, destinationAmountHuman, recipient, userAddress, slippageBps, forceProvider, ethereumProvider } = input;

	// Determine which provider to use
	let provider: SwapProvider;
	
	if (forceProvider) {
		provider = forceProvider;
	} else {
		const eligibility = checkSwapEligibility({ fromToken, toToken });
		if (!eligibility.eligible || !eligibility.provider) {
			throw new Error(eligibility.reason || "No provider available for this swap");
		}
		provider = eligibility.provider;
	}

	console.log(`[SwapProvider] Using ${provider} for swap:`, {
		from: `${fromToken.symbol} on ${fromToken.chain}`,
		to: `${toToken.symbol} on ${toToken.chain}`,
		amount: amountHuman,
		destinationAmount: destinationAmountHuman,
	});

	if (provider === "rhinestone") {
		const result = await createRhinestoneTransaction({
			fromToken,
			toToken,
			amountHuman,
			destinationAmountHuman,
			recipient,
			userAddress,
			slippageBps,
			ethereumProvider,
		});
		
		return {
			...result,
			chainId: result.chainId,
			provider: "rhinestone",
		};
	}

	// Default to Biconomy
	const result = await biconomyCreateTransaction({
		fromToken,
		toToken,
		amountHuman,
		recipient,
		userAddress,
		slippageBps,
	});

	return {
		...result,
		chainId: result.chainId,
		provider: "biconomy",
	};
}

/**
 * Get status of a swap transaction
 */
export async function getSwapStatus(
	idOrHash: string, 
	provider?: SwapProvider
): Promise<SwapStatusResponse> {
	const p = provider || ACTIVE_SWAP_PROVIDER;

	if (p === "rhinestone") {
		const result = await getRhinestoneStatus(idOrHash);
		return { ...result, provider: "rhinestone" };
	}

	const result = await getBiconomyStatus(idOrHash);
	return { ...result, provider: "biconomy" };
}

/**
 * Check if the active provider supports a specific chain
 */
export function isChainSupportedByActiveProvider(chain?: string): boolean {
	if (ACTIVE_SWAP_PROVIDER === "rhinestone") {
		return isRhinestoneSupportedChain(chain);
	}
	return isBiconomySupportedChain(chain);
}

/**
 * Get all supported chains for the active provider
 */
export function getActiveProviderSupportedChains(): string[] {
	if (ACTIVE_SWAP_PROVIDER === "rhinestone") {
		return ["ethereum", "base", "optimism", "arbitrum", "polygon", "zksync", "soneium"];
	}
	// Biconomy supported chains
	return [
		"ethereum", "base", "polygon", "arbitrum", "optimism",
		"bsc", "gnosis", "avalanche", "scroll", "linea", "blast"
	];
}

