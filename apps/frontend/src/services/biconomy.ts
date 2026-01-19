import type { NearToken } from "@/services/nearIntents";
import { BICONOMY_API_BASE, BICONOMY_API_KEY } from "@/config/biconomy";
import { DEFAULT_SLIPPAGE_BPS } from "@/config/swaps";

export type BiconomyQuoteResponse = {
	id?: string;
	quote?: { hash?: string };
	payloadToSign?: Array<{ to: string; data: string; value: string; chainId: number }>;
	amountIn?: string;
	amountInFormatted?: string;
	amountOut?: string;
	amountOutFormatted?: string;
	to?: string;
	data?: string;
	value?: string;
	chainId?: number | string;
	routeSummary?: any;
	error?: { message: string };
};

export type BiconomyIntentResponse = {
	id: string;
	to: string;
	data: string;
	value: string;
	chainId: number | string;
	gas?: string;
	meta?: any;
};

export type BiconomyStatusResponse = {
	id?: string;
	status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELLED" | string;
	txHash?: string;
	error?: string;
	updatedAt?: string;
	routeSummary?: any;
};

// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ETH_FORWARDER = "0x000000Afe527A978Ecb761008Af475cfF04132a1";

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (BICONOMY_API_KEY) headers["x-api-key"] = BICONOMY_API_KEY;
	return headers;
}

function extractEvmAddress(token?: Partial<NearToken>): string | null {
	const cand = String(token?.address || token?.tokenId || "").trim();
	const m = cand.match(/0x[0-9a-fA-F]{40}/);
	return m ? m[0] : null;
}

function isNativeToken(addr: string | null): boolean {
	return !addr || addr === ZERO_ADDRESS || addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
}

function chainIdFor(chain?: string): number | undefined {
	const key = String(chain || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
	const exact: Record<string, number> = {
		"ethereum": 1, "eth": 1, "mainnet": 1,
		"sepolia": 11155111,
		"polygon": 137, "matic": 137, "pol": 137,
		"arbitrum": 42161, "arb": 42161,
		"optimism": 10, "op": 10,
		"base": 8453,
		"bsc": 56, "bnb": 56,
		"gnosis": 100, "xdai": 100,
		"avalanche": 43114, "avax": 43114,
		"scroll": 534352,
		"linea": 59144,
		"blast": 81457,
	};
	if (exact[key] != null) return exact[key];
	if (key.includes("base")) return 8453;
	if (key.includes("polygon") || key.includes("matic")) return 137;
	if (key.includes("arbitrum") || key.includes("arb")) return 42161;
	if (key.includes("optimism") || key === "op") return 10;
	return undefined;
}

function toWei(amountHuman: string, decimals: number): string {
	const [i, f = ""] = String(amountHuman).split(".");
	const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
	return BigInt((i.replace(/\D/g, "") || "0") + cleanF.padEnd(decimals, "0")).toString();
}

/**
 * Creates a Biconomy Supertransaction for same-chain operations.
 * 
 * Scenarios:
 * 1. DIRECT TRANSFER: Same token & chain → Just transfer to recipient
 * 2. SWAP + TRANSFER: Same chain, different token → Swap then transfer
 * 
 * Uses Biconomy sponsorship (gasless) by omitting feeToken.
 */
export async function createSupertransaction(input: {
	fromToken: NearToken;
	toToken: NearToken;
	amountHuman: string;
	recipient: string;
	userAddress: string;
	slippageBps?: number;
}): Promise<BiconomyIntentResponse> {
	const { fromToken, toToken, amountHuman, recipient, userAddress, slippageBps = DEFAULT_SLIPPAGE_BPS } = input;

	const chainId = chainIdFor(fromToken.chain);
	const fromAddr = extractEvmAddress(fromToken);
	const toAddr = extractEvmAddress(toToken);

	if (!chainId) throw new Error(`Unsupported chain: ${fromToken.chain}`);
	if (!toAddr) throw new Error("Destination token missing EVM address");
	if (!userAddress) throw new Error("Missing userAddress");
	if (!recipient) throw new Error("Missing recipient");

	const amountWei = toWei(amountHuman, fromToken.decimals || 18);
	if (amountWei === "0") throw new Error("Invalid amount (0)");

	const slippage = Math.max(0, Math.min(1, slippageBps / 10000));
	const fromIsNative = isNativeToken(fromAddr);
	const toIsNative = isNativeToken(toAddr);
	
	// Check if it's a direct transfer (same token) or swap
	const isSameToken = fromAddr?.toLowerCase() === toAddr?.toLowerCase() || (fromIsNative && toIsNative);
	
	const composeFlows: any[] = [];

	if (isSameToken) {
		// ==========================================
		// SCENARIO 1: DIRECT TRANSFER (Same Token)
		// ==========================================
		console.log("[Biconomy] Direct Transfer:", { fromAddr, toAddr, amount: amountWei, recipient });

		if (fromIsNative) {
			// Native token transfer via ETH Forwarder
			composeFlows.push({
				type: "/instructions/build",
				data: {
					functionSignature: "function forward(address recipient)",
					args: [recipient],
					to: ETH_FORWARDER,
					chainId,
					value: amountWei,
				}
			});
		} else {
			// ERC20 transfer
			composeFlows.push({
				type: "/instructions/build",
				data: {
					functionSignature: "function transfer(address to, uint256 value)",
					args: [recipient, amountWei],
					to: fromAddr,
					chainId,
				}
			});
		}
	} else {
		// ==========================================
		// SCENARIO 2: SWAP + TRANSFER (Different Token)
		// ==========================================
		console.log("[Biconomy] Swap + Transfer:", { 
			from: fromAddr || "NATIVE", 
			to: toAddr, 
			amount: amountWei, 
			recipient 
		});

		// Step 1: Swap via intent-simple
		composeFlows.push({
			type: "/instructions/intent-simple",
			data: {
				srcChainId: chainId,
				dstChainId: chainId,
				srcToken: fromIsNative ? ZERO_ADDRESS : fromAddr,
				dstToken: toAddr,
				amount: amountWei,
				slippage,
			}
		});

		// Step 2: Transfer swapped tokens to recipient
		if (toIsNative) {
			// Native token withdrawal via ETH Forwarder with runtime balance
			composeFlows.push({
				type: "/instructions/build",
				data: {
					functionSignature: "function forward(address recipient)",
					args: [recipient],
					to: ETH_FORWARDER,
					chainId,
					value: {
						type: "runtimeNativeBalance",
						constraints: { gte: "1" }
					}
				}
			});
		} else {
			// ERC20 transfer with runtime balance
			composeFlows.push({
				type: "/instructions/build",
				data: {
					functionSignature: "function transfer(address to, uint256 value)",
					args: [
						recipient,
						{
							type: "runtimeErc20Balance",
							tokenAddress: toAddr,
							constraints: { gte: "1" }
						}
					],
					to: toAddr,
					chainId,
				}
			});
		}
	}

	// For swaps, add a small buffer (0.5%) to fundingTokens to satisfy Solver simulation
	// This ensures fundingTokens > intent amount (covers any overhead)
	const fundingAmountWei = isSameToken 
		? amountWei  // Direct transfer: no buffer needed
		: (BigInt(amountWei) * BigInt(1005) / BigInt(1000)).toString();  // Swap: +0.5% buffer

	// Build the quote request
	// NOTE: feeToken is OMITTED to enable sponsorship (gasless)
	const body: any = {
		mode: "eoa",
		ownerAddress: userAddress,
		fundingTokens: [{
			tokenAddress: fromIsNative ? ZERO_ADDRESS : fromAddr,
			chainId,
			amount: fundingAmountWei,
		}],
		// feeToken is intentionally omitted for sponsorship
		composeFlows,
	};

	console.log("[Biconomy] Amounts:", { 
		intentAmount: amountWei, 
		fundingAmount: fundingAmountWei, 
		buffer: isSameToken ? "0%" : "0.5%" 
	});

	console.log("[Biconomy] Quote Request:", JSON.stringify(body, null, 2));

	// Call Biconomy Quote API
	const res = await fetch(`${BICONOMY_API_BASE}/v1/quote`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => "unknown");
		throw new Error(`Quote failed (${res.status}): ${errText}`);
	}

	const quote = await res.json();
	
	if (quote?.error?.message) {
		throw new Error(quote.error.message);
	}

	const payload = quote.payloadToSign?.[0];
	if (!payload?.to || !payload?.data) {
		throw new Error("Quote did not return executable payload");
	}

	console.log("[Biconomy] Quote Success:", { 
		quoteType: quote.quoteType,
		hash: quote.quote?.hash 
	});

	return {
		id: quote.quote?.hash || quote.id || "",
		to: payload.to,
		data: payload.data,
		value: String(payload.value ?? "0"),
		chainId,
		gas: quote.routeSummary?.gas,
		meta: quote.routeSummary,
	};
}

/**
 * Creates a Biconomy Supertransaction for lottery ticket purchase.
 * Swaps to ETH, then calls ticketAutomator contract with recipient address.
 * This replicates what Across Protocol does - sends ETH to contract with calldata.
 */
export async function createLotteryTransaction(input: {
	fromToken: NearToken;
	amountHuman: string;
	contractAddress: string;
	contractCalldata: string; // Encoded function call with recipient address
	userAddress: string;
	slippageBps?: number;
}): Promise<BiconomyIntentResponse> {
	const { fromToken, amountHuman, contractAddress, contractCalldata, userAddress, slippageBps = DEFAULT_SLIPPAGE_BPS } = input;

	const chainId = chainIdFor(fromToken.chain);
	const fromAddr = extractEvmAddress(fromToken);

	if (!chainId) throw new Error(`Unsupported chain: ${fromToken.chain}`);
	if (!userAddress) throw new Error("Missing userAddress");
	if (!contractAddress) throw new Error("Missing contractAddress");

	const amountWei = toWei(amountHuman, fromToken.decimals || 18);
	if (amountWei === "0") throw new Error("Invalid amount (0)");

	const slippage = Math.max(0, Math.min(1, slippageBps / 10000));
	const fromIsNative = isNativeToken(fromAddr);
	
	const composeFlows: any[] = [];

	// Step 1: Swap to ETH (if not already ETH)
	if (!fromIsNative) {
		composeFlows.push({
			type: "/instructions/intent-simple",
			data: {
				srcChainId: chainId,
				dstChainId: chainId,
				srcToken: fromAddr,
				dstToken: ZERO_ADDRESS, // Native ETH
				amount: amountWei,
				slippage,
			}
		});
	}

	// Step 2: Call ticketAutomator contract with ETH + calldata
	// This replicates Across Protocol's behavior - contract receives ETH and calldata with recipient
	composeFlows.push({
		type: "/instructions/build",
		data: {
			functionSignature: "function()", // Fallback/receive function
			args: [],
			to: contractAddress,
			chainId,
			value: {
				type: "runtimeNativeBalance",
				constraints: { gte: "1" }
			},
			// Note: Biconomy might need the calldata in a different format
			// This is a placeholder - actual implementation depends on Biconomy API
		}
	});

	// Add calldata if Biconomy supports it (might need to check API docs)
	// For now, we'll need to encode it differently or use a different approach

	const fundingAmountWei = fromIsNative 
		? amountWei
		: (BigInt(amountWei) * BigInt(1005) / BigInt(1000)).toString(); // +0.5% buffer for swap

	const body: any = {
		mode: "eoa",
		ownerAddress: userAddress,
		fundingTokens: [{
			tokenAddress: fromIsNative ? ZERO_ADDRESS : fromAddr,
			chainId,
			amount: fundingAmountWei,
		}],
		composeFlows,
	};

	console.log("[Biconomy] Lottery transaction request:", body);

	const res = await fetch(`${BICONOMY_API_BASE}/intents/quote`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(BICONOMY_API_KEY ? { "x-api-key": BICONOMY_API_KEY } : {}),
		},
		body: JSON.stringify(body),
	});

	const data = await res.json();

	if (!res.ok || data?.error) {
		throw new Error(data?.error?.message || `Biconomy error: ${res.statusText}`);
	}

	if (!data?.to || !data?.data) {
		throw new Error("Invalid response from Biconomy");
	}

	return {
		id: data.id || `biconomy-${Date.now()}`,
		to: data.to,
		data: contractCalldata || data.data, // Use our calldata if provided
		value: data.value || "0",
		chainId: data.chainId || chainId,
		meta: data,
	};
}

export async function getBiconomyStatus(idOrHash: string): Promise<BiconomyStatusResponse> {
	const res = await fetch(`https://network.biconomy.io/v1/explorer/${idOrHash}`, {
		headers: authHeaders()
	});

	if (!res.ok) {
		return { 
			status: "UNKNOWN", 
			id: idOrHash, 
			error: `Status error (${res.status})` 
		};
	}

	const data = await res.json();
	return {
		status: data?.status || "UNKNOWN",
		id: idOrHash,
		routeSummary: data?.summary,
		txHash: data?.transactionHash
	};
}
