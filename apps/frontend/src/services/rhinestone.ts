/**
 * Rhinestone Service
 * 
 * Implements the 1-Click Deposit flow from Rhinestone docs:
 * https://docs.rhinestone.dev/intents-api/1-click-deposit
 * 
 * Flow:
 * 1. Create companion smart account (app signer + user owner)
 * 2. User transfers tokens to companion account
 * 3. App executes swap+transfer intent using signer key
 */

import type { NearToken } from "@/services/nearIntents";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { assertNotDemoMode } from "@/config/demoMode";
import { encodeFunctionData, erc20Abi, type Chain, createWalletClient, custom, http } from "viem";
import { base, mainnet, optimism, arbitrum, polygon } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
	RHINESTONE_API_KEY,
	getRhinestoneChainId,
	isRhinestoneSupportedChain,
} from "@/config/rhinestone";

// Response types
export type RhinestoneIntentResponse = {
	id: string;
	to: string;
	data: string;
	value: string;
	chainId: number | string;
	gas?: string;
	meta?: any;
	// For 1-click deposit flow
	companionAddress?: string;
	fundingAmount?: string;
	fundingToken?: string;
	totalSourceAmount?: string; // Human-readable amount of source token used
};

export type RhinestoneStatusResponse = {
	id?: string;
	status: "PENDING" | "PRECONFIRMED" | "CLAIMED" | "FILLED" | "COMPLETED" | "FAILED" | "EXPIRED" | string;
	txHash?: string;
	error?: string;
};

// Constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Token addresses by chain
const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
	1: {
		USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
		WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
	},
	8453: {
		USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
		WETH: "0x4200000000000000000000000000000000000006",
	},
	10: {
		USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
		USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
		WETH: "0x4200000000000000000000000000000000000006",
	},
	42161: {
		USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
		USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
		WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
	},
	137: {
		USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
		USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
		WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
	},
};

// Chain ID to viem Chain mapping
const CHAIN_MAP: Record<number, Chain> = {
	1: mainnet,
	8453: base,
	10: optimism,
	42161: arbitrum,
	137: polygon,
};

function extractEvmAddress(token?: Partial<NearToken>): string | null {
	const cand = String(token?.address || token?.tokenId || "").trim();
	const m = cand.match(/0x[0-9a-fA-F]{40}/);
	return m ? m[0] : null;
}

function toWei(amountHuman: string, decimals: number): bigint {
	const [i, f = ""] = String(amountHuman).split(".");
	const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
	return BigInt((i.replace(/\D/g, "") || "0") + cleanF.padEnd(decimals, "0"));
}

function isNativeToken(symbol: string): boolean {
	const s = String(symbol || "").toUpperCase();
	return s === "ETH" || s === "WETH" || s === "0XEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
}

// Store SDK instance
let rhinestoneSDK: RhinestoneSDK | null = null;

export function getSDK(): RhinestoneSDK {
	if (!rhinestoneSDK) {
		rhinestoneSDK = new RhinestoneSDK({
			apiKey: RHINESTONE_API_KEY,
		});
	}
	return rhinestoneSDK;
}

// Persist signer keys to localStorage
const SIGNER_KEYS_STORAGE_KEY = "rhinestone_signer_keys";

function getSignerKeysFromStorage(): Record<string, `0x${string}`> {
	if (typeof window === "undefined") return {};
	try {
		const stored = localStorage.getItem(SIGNER_KEYS_STORAGE_KEY);
		return stored ? JSON.parse(stored) : {};
	} catch {
		return {};
	}
}

function saveSignerKeyToStorage(userAddress: string, pk: `0x${string}`): void {
	if (typeof window === "undefined") return;
	try {
		const keys = getSignerKeysFromStorage();
		keys[userAddress.toLowerCase()] = pk;
		localStorage.setItem(SIGNER_KEYS_STORAGE_KEY, JSON.stringify(keys));
		console.log("[Rhinestone] ✓ Signer key saved to localStorage");
		console.log("[Rhinestone] Storage key:", SIGNER_KEYS_STORAGE_KEY);
		console.log("[Rhinestone] User address:", userAddress);
		console.log("[Rhinestone] This key allows access to companion wallet");
	} catch (e) {
		console.warn("[Rhinestone] Could not save signer key:", e);
	}
}

export function getOrCreateSignerKey(userAddress: string): `0x${string}` {
	const key = userAddress.toLowerCase();
	
	// First check localStorage
	const storedKeys = getSignerKeysFromStorage();
	console.log("[Rhinestone] =========================================");
	console.log("[Rhinestone] Looking up signer key for:", userAddress);
	console.log("[Rhinestone] Stored keys available for:", Object.keys(storedKeys));
	
	if (storedKeys[key]) {
		console.log("[Rhinestone] ✓ Found existing signer key for:", userAddress);
		console.log("[Rhinestone] Key hash (first 10 chars):", storedKeys[key].slice(0, 12) + "...");
		console.log("[Rhinestone] =========================================");
		return storedKeys[key];
	}

	// Generate new signer key
	console.log("[Rhinestone] ⚠️ NO existing key found - generating NEW signer key");
	console.log("[Rhinestone] ⚠️ This will create a NEW companion wallet!");
	const pk = generatePrivateKey();
	saveSignerKeyToStorage(userAddress, pk);
	console.log("[Rhinestone] New key hash (first 10 chars):", pk.slice(0, 12) + "...");
	console.log("[Rhinestone] =========================================");
	return pk;
}

/**
 * Get the best companion wallet (one with highest balance) from all cached wallets
 * Falls back to creating new one if no wallets have balance
 */
export async function getBestCompanionWallet(): Promise<{ address: string; userAddress: string; balance: string } | null> {
	if (typeof window === "undefined") return null;
	
	try {
		const wallets = await listAllCompanionWallets();
		if (wallets.length === 0) return null;
		
		// Sort by balance descending
		const sorted = wallets.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));
		const best = sorted[0];
		
		if (parseFloat(best.balance) > 0.0001) {
			console.log("[Rhinestone] Found best companion wallet with balance:", best.balance, "ETH");
			console.log("[Rhinestone] Companion address:", best.companionAddress);
			console.log("[Rhinestone] Original owner:", best.userAddress);
			return { address: best.companionAddress, userAddress: best.userAddress, balance: best.balance };
		}
		
		return null;
	} catch (e) {
		console.warn("[Rhinestone] Could not get best companion wallet:", e);
		return null;
	}
}

/**
 * Get the companion account address for a user (deterministic based on signer key)
 * Uses Zustand store to cache companion wallet addresses
 */
export async function getCompanionAddress(userAddress: string): Promise<string> {
	// Check Zustand cache first (only on client side)
	if (typeof window !== "undefined") {
		try {
			const { useCompanionWalletStore } = await import("@/store/companionWallet");
			const cached = useCompanionWalletStore.getState().getCompanionWallet(userAddress);
			if (cached?.address) {
				console.log("[Rhinestone] Using cached companion wallet:", cached.address);
				return cached.address;
			}
		} catch (e) {
			console.warn("[Rhinestone] Could not access companion wallet store:", e);
		}
	}

	// Generate companion wallet address (deterministic based on signer key)
	const signerPk = getOrCreateSignerKey(userAddress);
	const signerAccount = privateKeyToAccount(signerPk);
	const sdk = getSDK();
	
	const ownerAccount = {
		address: userAddress as `0x${string}`,
		type: "local" as const,
		publicKey: "0x" as `0x${string}`,
		source: "custom" as const,
		signMessage: async () => { throw new Error("Not needed"); },
		signTransaction: async () => { throw new Error("Not needed"); },
		signTypedData: async () => { throw new Error("Not needed"); },
	};
	
	const companionAccount = await sdk.createAccount({
		account: { type: "nexus" },
		owners: {
			type: "ecdsa",
			accounts: [ownerAccount as any, signerAccount],
			threshold: 1,
		},
	});
	
	const companionAddress = companionAccount.getAddress();
	
	// Cache in Zustand store (only on client side)
	if (typeof window !== "undefined") {
		try {
			const { useCompanionWalletStore } = await import("@/store/companionWallet");
			useCompanionWalletStore.getState().setCompanionWallet(userAddress, companionAddress);
		} catch (e) {
			console.warn("[Rhinestone] Could not cache companion wallet:", e);
		}
	}
	
	return companionAddress;
}

/**
 * List all cached companion wallets with their balances
 */
export async function listAllCompanionWallets(): Promise<Array<{
	userAddress: string;
	companionAddress: string;
	balance: string;
	createdAt: number;
}>> {
	if (typeof window === "undefined") return [];
	
	try {
		const { useCompanionWalletStore } = await import("@/store/companionWallet");
		const wallets = useCompanionWalletStore.getState().wallets;
		
		const results = [];
		for (const [key, wallet] of Object.entries(wallets)) {
			try {
				const balance = await getCompanionBalance(wallet.address, 8453);
				results.push({
					userAddress: wallet.userAddress,
					companionAddress: wallet.address,
					balance: balance.eth,
					createdAt: wallet.createdAt,
				});
			} catch (e) {
				results.push({
					userAddress: wallet.userAddress,
					companionAddress: wallet.address,
					balance: "0",
					createdAt: wallet.createdAt,
				});
			}
		}
		
		console.log("[Rhinestone] All companion wallets:", results);
		return results;
	} catch (e) {
		console.error("[Rhinestone] Could not list companion wallets:", e);
		return [];
	}
}

/**
 * Recover funds from a companion wallet to a destination address
 */
export async function recoverFundsFromCompanion(input: {
	companionOwnerAddress: string; // The user address that owns this companion wallet
	destinationAddress: string; // Where to send the funds
	leaveForGas?: string; // Amount to leave for gas (default: 0.00001)
}): Promise<{ success: boolean; txHash?: string; amountSent?: string; error?: string }> {
	const { companionOwnerAddress, destinationAddress, leaveForGas = "0.00001" } = input;
	
	console.log("[Rhinestone] =========================================");
	console.log("[Rhinestone] Recovering funds from companion wallet");
	console.log("[Rhinestone] Owner address:", companionOwnerAddress);
	console.log("[Rhinestone] Destination:", destinationAddress);
	
	try {
		// Get the signer key for this owner
		const signerPk = getOrCreateSignerKey(companionOwnerAddress);
		const signerAccount = privateKeyToAccount(signerPk);
		
		// Get companion address
		const companionAddress = await getCompanionAddress(companionOwnerAddress);
		console.log("[Rhinestone] Companion address:", companionAddress);
		
		// Check balance
		const balance = await getCompanionBalance(companionAddress, 8453);
		console.log("[Rhinestone] Current balance:", balance.eth, "ETH");
		
		const balanceFloat = parseFloat(balance.eth);
		const gasReserve = parseFloat(leaveForGas);
		const amountToSend = balanceFloat - gasReserve;
		
		if (amountToSend <= 0) {
			console.log("[Rhinestone] No funds to recover (balance too low)");
			return { success: false, error: "Balance too low to recover" };
		}
		
		console.log("[Rhinestone] Amount to send:", amountToSend.toFixed(8), "ETH");
		
		// Create companion account
		const sdk = getSDK();
		const ownerAccount = {
			address: companionOwnerAddress as `0x${string}`,
			type: "local" as const,
			publicKey: "0x" as `0x${string}`,
			source: "custom" as const,
			signMessage: async () => { throw new Error("Not needed"); },
			signTransaction: async () => { throw new Error("Not needed"); },
			signTypedData: async () => { throw new Error("Not needed"); },
		};
		
		const companionAccount = await sdk.createAccount({
			account: { type: "nexus" },
			owners: {
				type: "ecdsa",
				accounts: [ownerAccount as any, signerAccount],
				threshold: 1,
			},
		});
		
		// Send transaction
		const amountWei = BigInt(Math.floor(amountToSend * 1e18));
		
		const transaction = await companionAccount.sendTransaction({
			chain: base,
			calls: [{
				to: destinationAddress as `0x${string}`,
				value: amountWei,
				data: "0x" as `0x${string}`,
			}],
			signers: {
				type: "owner",
				kind: "ecdsa",
				accounts: [signerAccount as any],
			},
		});
		
		console.log("[Rhinestone] Transaction submitted");
		
		const result = await companionAccount.waitForExecution(transaction);
		const txHash = (result as any)?.transactionHash || "";
		
		console.log("[Rhinestone] ✓ Funds recovered successfully!");
		console.log("[Rhinestone] TX hash:", txHash);
		console.log("[Rhinestone] Amount sent:", amountToSend.toFixed(8), "ETH");
		console.log("[Rhinestone] Sent to:", destinationAddress);
		console.log("[Rhinestone] View on Basescan: https://basescan.org/tx/" + txHash);
		console.log("[Rhinestone] =========================================");
		
		return {
			success: true,
			txHash,
			amountSent: amountToSend.toFixed(8),
		};
	} catch (e: any) {
		console.error("[Rhinestone] Recovery failed:", e?.message);
		return { success: false, error: e?.message || "Recovery failed" };
	}
}

/**
 * Get companion account balance
 */
export async function getCompanionBalance(companionAddress: string, chainId: number = 8453): Promise<{
	eth: string;
	ethWei: string;
}> {
	const rpcUrl = chainId === 8453 ? "https://mainnet.base.org" : 
	               chainId === 1 ? "https://eth.llamarpc.com" :
	               chainId === 10 ? "https://mainnet.optimism.io" :
	               chainId === 42161 ? "https://arb1.arbitrum.io/rpc" :
	               "https://mainnet.base.org";
	
	const res = await fetch(rpcUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			method: "eth_getBalance",
			params: [companionAddress, "latest"],
			id: 1,
		}),
	});
	const data = await res.json();
	const balanceWei = BigInt(data?.result || "0x0");
	const balanceEth = Number(balanceWei) / 1e18;
	
	return {
		eth: balanceEth.toFixed(8),
		ethWei: balanceWei.toString(),
	};
}


/**
 * Wait for companion account balance to update
 */
async function waitForBalanceUpdate(
	companionAddress: string,
	token: string,
	minAmount: bigint,
	chainId: number
): Promise<boolean> {
	console.log(`[Rhinestone] Checking companion balance: ${companionAddress}`);
	console.log(`[Rhinestone] Token: ${token}, Min required: ${minAmount.toString()} wei`);
	
	const isNative = isNativeToken(token);
	const rpcUrl = chainId === 8453 ? "https://mainnet.base.org" : 
	               chainId === 1 ? "https://eth.llamarpc.com" :
	               chainId === 10 ? "https://mainnet.optimism.io" :
	               chainId === 42161 ? "https://arb1.arbitrum.io/rpc" :
	               "https://mainnet.base.org";

	// Try up to 15 times (30 seconds total)
	for (let i = 0; i < 15; i++) {
		try {
			let balance = BigInt(0);
			
			if (isNative) {
				const res = await fetch(rpcUrl, {
		method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						method: "eth_getBalance",
						params: [companionAddress, "latest"],
						id: 1,
					}),
				});
				const data = await res.json();
				balance = BigInt(data?.result || "0x0");
			} else {
				// TODO: Add ERC20 check logic if needed
			}

			if (balance >= minAmount) {
				console.log(`[Rhinestone] ✅ Balance confirmed: ${Number(balance) / 1e18} ETH`);
				return true;
			}
			
			console.log(`[Rhinestone] ⏳ Balance: ${Number(balance) / 1e18} ETH, waiting... (${i+1}/15)`);
		} catch (e) {
			console.warn("[Rhinestone] Balance check error:", e);
		}
		
		await new Promise(r => setTimeout(r, 2000)); // Wait 2s
	}
	
	console.warn("[Rhinestone] ❌ Balance check timed out after 30s");
	return false;
}

/**
 * Creates a Rhinestone 1-Click Deposit transaction.
 */
export async function createRhinestoneTransaction(input: {
	fromToken: NearToken;
	toToken: NearToken;
	amountHuman: string;
	destinationAmountHuman?: string;
	recipient: string;
	userAddress: string;
	slippageBps?: number;
	ethereumProvider?: any;
}): Promise<RhinestoneIntentResponse> {
	// Block Rhinestone transactions in demo mode
	assertNotDemoMode("Rhinestone transactions");

	const { fromToken, toToken, destinationAmountHuman, recipient, userAddress, ethereumProvider } = input;

	const chainId = getRhinestoneChainId(toToken.chain);
	const toAddr = extractEvmAddress(toToken);
	const fromAddr = extractEvmAddress(fromToken);

	if (!chainId) throw new Error(`Unsupported chain: ${toToken.chain}`);
	if (!isRhinestoneSupportedChain(toToken.chain)) {
		throw new Error(`Chain ${toToken.chain} is not actively supported by Rhinestone`);
	}
	if (!userAddress) throw new Error("Missing userAddress");
	if (!recipient) throw new Error("Missing recipient");
	if (!toAddr) throw new Error("Missing destination token address");

	const destAmountHuman = destinationAmountHuman || input.amountHuman;
	const destAmountWei = toWei(destAmountHuman, toToken.decimals || 18);
	
	if (destAmountWei === BigInt(0)) throw new Error("Invalid destination amount (0)");

	const chain = CHAIN_MAP[chainId];
	if (!chain) throw new Error(`Chain ${chainId} not configured`);

	console.log("[Rhinestone] Creating 1-Click Deposit flow:", {
		from: fromToken.symbol,
		to: toToken.symbol,
		destinationAmount: destAmountHuman,
		chain: toToken.chain,
		recipient: `${recipient.slice(0, 6)}...${recipient.slice(-4)}`,
	});

	try {
		const sdk = getSDK();

		// Get or create signer key for this user (app-controlled)
		const signerPk = getOrCreateSignerKey(userAddress);
		const signerAccount = privateKeyToAccount(signerPk);

		// Create read-only owner account (user's EOA)
		// User can recover funds but doesn't sign normal operations
		const ownerAccount = {
			address: userAddress as `0x${string}`,
			type: "local" as const,
			publicKey: "0x" as `0x${string}`,
			source: "custom" as const,
			signMessage: async () => { throw new Error("User signing not needed for deposit flow"); },
			signTransaction: async () => { throw new Error("User signing not needed for deposit flow"); },
			signTypedData: async () => { throw new Error("User signing not needed for deposit flow"); },
		};

		// Create companion account (1-of-2 multisig: user + app signer)
		const companionAccount = await sdk.createAccount({
			account: { type: "nexus" },
			owners: {
				type: "ecdsa",
				accounts: [ownerAccount as any, signerAccount],
				threshold: 1, // 1-of-2 multisig
			},
		});

		const companionAddress = companionAccount.getAddress();
		console.log("[Rhinestone] Companion account address:", companionAddress);

		// Calculate funding amount based on token prices
		// We need to figure out how much source token (ETH) to send to get destAmount of target token (USDC)
		const fromPrice = typeof fromToken.price === "number" ? fromToken.price : 0;
		const toPrice = typeof toToken.price === "number" ? toToken.price : 1;
		
		// Smart account deployment costs ~0.0003-0.0005 ETH on Base/mainnet
		// Add this as a fixed buffer on top of the swap amount
		const DEPLOYMENT_COST_WEI = BigInt("500000000000000"); // 0.0005 ETH buffer for deployment
		
		let sourceAmountHuman: string;
		let swapAmountWei: bigint;
		
		if (fromPrice > 0 && toPrice > 0) {
			// Calculate: (destAmount * destPrice) / sourcePrice * 1.15 (15% buffer for slippage + fees)
			const destValue = parseFloat(destAmountHuman) * toPrice;
			sourceAmountHuman = (destValue / fromPrice * 1.15).toFixed(fromToken.decimals || 18);
			swapAmountWei = toWei(sourceAmountHuman, fromToken.decimals || 18);
		} else {
			// Fallback: use the input amount
			sourceAmountHuman = input.amountHuman;
			swapAmountWei = toWei(sourceAmountHuman, fromToken.decimals || 18);
		}
		
		// Total funding = swap amount + deployment buffer (only for native token)
		const sourceAmountWei = isNativeToken(fromToken.symbol) 
			? swapAmountWei + DEPLOYMENT_COST_WEI 
			: swapAmountWei;
		
		console.log("[Rhinestone] Funding breakdown:", {
			swapAmount: swapAmountWei.toString(),
			deploymentBuffer: DEPLOYMENT_COST_WEI.toString(),
			totalFunding: sourceAmountWei.toString(),
		});
		
		// Check if companion account already has enough funds
		let companionBalance = BigInt(0);
		const isFromNative = isNativeToken(fromToken.symbol);
		
		try {
			const rpcUrl = chainId === 8453 ? "https://mainnet.base.org" : 
			               chainId === 1 ? "https://eth.llamarpc.com" :
			               chainId === 10 ? "https://mainnet.optimism.io" :
			               chainId === 42161 ? "https://arb1.arbitrum.io/rpc" :
			               "https://mainnet.base.org";
			
			if (isFromNative) {
				// Check ETH balance
				const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "eth_getBalance",
						params: [companionAddress, "latest"],
						id: 1,
					}),
				});
				const data = await res.json();
				companionBalance = BigInt(data?.result || "0x0");
			} else {
				// Check ERC20 balance
				const balanceOfData = encodeFunctionData({
					abi: erc20Abi,
					functionName: "balanceOf",
					args: [companionAddress as `0x${string}`],
				});
				const res = await fetch(rpcUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						method: "eth_call",
						params: [{ to: fromAddr, data: balanceOfData }, "latest"],
				id: 1,
			}),
		});
				const data = await res.json();
				companionBalance = BigInt(data?.result || "0x0");
			}
			
			console.log("[Rhinestone] Companion balance check:", {
				companionAddress,
				balance: companionBalance.toString(),
				required: sourceAmountWei.toString(),
				hasEnough: companionBalance >= sourceAmountWei,
			});
	} catch (e) {
			console.warn("[Rhinestone] Could not check companion balance:", e);
	}

		// Calculate how much more funding is needed (if any)
		const additionalFundingNeeded = companionBalance >= sourceAmountWei 
			? BigInt(0) 
			: sourceAmountWei - companionBalance;
		
		console.log("[Rhinestone] Funding calculation:", {
			destAmount: destAmountHuman,
			destToken: toToken.symbol,
			sourceAmount: sourceAmountHuman,
			sourceToken: fromToken.symbol,
			sourceAmountWei: sourceAmountWei.toString(),
			companionBalance: companionBalance.toString(),
			additionalFundingNeeded: additionalFundingNeeded.toString(),
			fromPrice,
			toPrice,
		});

		// Store companion account info for later intent execution
		const intentData = {
			companionAccount,
			signerAccount,
			destAmountWei,
			toAddr,
			recipient,
			chainId,
			chain,
			fromToken,
			toToken,
			userAddress, // Needed for owners config during execution
		};

		// Store for executeRhinestoneIntent
		(globalThis as any).__rhinestoneIntents = (globalThis as any).__rhinestoneIntents || {};
		(globalThis as any).__rhinestoneIntents[companionAddress] = intentData;
	
		// Calculate total source amount used (for display purposes)
		const totalSourceAmountHuman = (Number(swapAmountWei) / Math.pow(10, fromToken.decimals || 18)).toFixed(6);

		// If companion already has enough funds, skip funding step
		if (additionalFundingNeeded === BigInt(0)) {
			console.log("[Rhinestone] Companion has enough funds, skipping funding step");
			return {
				id: `rhinestone-${Date.now()}`,
				to: companionAddress,
				data: "0x",
				value: "0", // No funding needed
				chainId,
				companionAddress,
				fundingAmount: "0",
				fundingToken: fromToken.symbol,
				totalSourceAmount: totalSourceAmountHuman, // Amount of source token used for swap
				meta: {
					type: "1-click-deposit",
					step: "skip-funding", // Signal to execute intent directly
					companionAddress,
					signerPk,
				},
			};
		}

		// Need to fund the companion account
		if (isFromNative) {
			// Native ETH transfer to companion account
			return {
				id: `rhinestone-${Date.now()}`,
				to: companionAddress,
				data: "0x",
				value: additionalFundingNeeded.toString(),
				chainId,
				companionAddress,
				fundingAmount: additionalFundingNeeded.toString(),
				fundingToken: fromToken.symbol,
				totalSourceAmount: totalSourceAmountHuman, // Amount of source token used for swap
				meta: {
					type: "1-click-deposit",
					step: "fund-companion",
					companionAddress,
					signerPk,
				},
			};
		} else {
			// ERC20 transfer to companion account
			const transferData = encodeFunctionData({
				abi: erc20Abi,
				functionName: "transfer",
				args: [companionAddress as `0x${string}`, additionalFundingNeeded],
			});

			return {
				id: `rhinestone-${Date.now()}`,
				to: fromAddr || ZERO_ADDRESS,
				data: transferData,
				value: "0",
		chainId,
				companionAddress,
				fundingAmount: additionalFundingNeeded.toString(),
				fundingToken: fromToken.symbol,
				totalSourceAmount: totalSourceAmountHuman, // Amount of source token used for swap
				meta: {
					type: "1-click-deposit",
					step: "fund-companion",
					companionAddress,
					signerPk,
				},
			};
		}
	} catch (e: any) {
		console.error("[Rhinestone] Error creating transaction:", e);
		throw new Error(`Rhinestone error: ${e?.message || "Unknown error"}`);
	}
}

/**
 * Execute the swap+transfer intent after user has funded the companion account.
 * This is called automatically after the funding transaction confirms.
 */
export async function executeRhinestoneIntent(input: {
	companionAddress: string;
	signerPk: `0x${string}`;
}): Promise<{ txHash: string; status: string }> {
	const { companionAddress, signerPk } = input;
	
	// Retrieve stored intent data
	const intentData = (globalThis as any).__rhinestoneIntents?.[companionAddress];
	if (!intentData) {
		throw new Error("Intent data not found. Please restart the transaction.");
	}

	const { destAmountWei, toAddr, recipient, chain, fromToken, chainId, toToken } = intentData;
	const signerAccount = privateKeyToAccount(signerPk);

	// Calculate minimum required balance for the swap
	const fromPrice = typeof fromToken.price === "number" ? fromToken.price : 0;
	const toPrice = typeof toToken?.price === "number" ? toToken.price : 1;
	
	let minBalanceRequired = BigInt("100000000000000"); // 0.0001 ETH minimum fallback
	if (fromPrice > 0 && toPrice > 0) {
		// Calculate swap amount + 20% buffer
		const destAmountHuman = Number(destAmountWei) / Math.pow(10, toToken?.decimals || 6);
		const destValue = destAmountHuman * toPrice;
		const sourceAmount = destValue / fromPrice * 1.20;
		minBalanceRequired = BigInt(Math.floor(sourceAmount * Math.pow(10, fromToken.decimals || 18)));
	}

	console.log("[Rhinestone] Executing intent from companion:", companionAddress);
	console.log("[Rhinestone] Intent details:", {
		destToken: toAddr,
		destAmount: destAmountWei.toString(),
		recipient,
		chain: chain.name,
		minBalanceRequired: minBalanceRequired.toString(),
	});

	// Wait for balance to be reflected on-chain
	const balanceOk = await waitForBalanceUpdate(companionAddress, fromToken.symbol, minBalanceRequired, chainId);
	if (!balanceOk) {
		throw new Error(
			`Companion account needs at least ${Number(minBalanceRequired) / 1e18} ETH. ` +
			`Please fund more and try again.`
		);
	}

	// Get stored data (but recreate the account fresh to ensure owners config is present)
	const { userAddress } = intentData;

	// Create read-only owner account (for owners config)
	const ownerAccount = {
		address: userAddress as `0x${string}`,
		type: "local" as const,
		publicKey: "0x" as `0x${string}`,
		source: "custom" as const,
		signMessage: async () => { throw new Error("Not used"); },
		signTransaction: async () => { throw new Error("Not used"); },
		signTypedData: async () => { throw new Error("Not used"); },
	};

	// Recreate companion account with proper owners config
	// (The stored companionAccount may lose configuration)
	const sdk = getSDK();
	const companionAccount = await sdk.createAccount({
		account: { type: "nexus" },
		owners: {
			type: "ecdsa",
			accounts: [ownerAccount as any, signerAccount],
			threshold: 1,
		},
	});

	// Verify we got the same address
	const recreatedAddress = companionAccount.getAddress();
	console.log("[Rhinestone] Recreated companion address:", recreatedAddress);
	if (recreatedAddress.toLowerCase() !== companionAddress.toLowerCase()) {
		throw new Error(`Address mismatch! Expected ${companionAddress}, got ${recreatedAddress}`);
	}

	console.log("[Rhinestone] Submitting swap+transfer intent...");
	console.log("[Rhinestone] Config:", {
		sourceChain: chain.name,
		targetChain: chain.name,
		destToken: toAddr,
		destAmount: destAmountWei.toString(),
		recipient,
	});

	// Execute the swap + transfer intent
	// Per docs: use sourceChains to specify where funds are, targetChain for destination
	const transaction = await companionAccount.sendTransaction({
		// Same chain for swap (no bridge needed)
		sourceChains: [chain],
		targetChain: chain,
		// Transfer the destination tokens to recipient
		calls: [],
		// Request the destination tokens (USDC) - Rhinestone will swap from ETH
		tokenRequests: [
			{
				address: toAddr as `0x${string}`,
				amount: destAmountWei,
			},
		],
		// Recipient gets the swapped tokens (simple address for EOA)
		recipient: recipient as `0x${string}`,
		// Signers for the companion account (app signer signs)
		signers: {
			type: "owner",
			kind: "ecdsa",
			accounts: [signerAccount],
		},
		// Sponsor all fees!
		sponsored: {
			gas: true,
			bridging: true,
			swaps: true,
			},
	});

	console.log("[Rhinestone] Intent submitted:", transaction);

	// Wait for execution
	const result = await companionAccount.waitForExecution(transaction);

	console.log("[Rhinestone] Intent executed:", result);

	// Clean up stored data
	delete (globalThis as any).__rhinestoneIntents?.[companionAddress];

	return {
		txHash: (result as any)?.transactionHash || "",
		status: "COMPLETED",
	};
}

/**
 * Withdraw funds from a companion account back to the user
 * User's EOA is one of the owners (1-of-2 multisig), so they can sign withdrawals
 */
export async function withdrawFromCompanion(input: {
	companionAddress: string;
	signerPk?: `0x${string}`; // Optional: stored signer key (not needed - user can sign)
	userAddress: string;      // Required: user's EOA (owner of companion)
	ethereumProvider: any;    // Required: for signing
	tokenAddress?: string;
	recipient: string;
	chainId: number;
}): Promise<{ txHash: string; status: string }> {
	const { companionAddress, userAddress, ethereumProvider, tokenAddress, recipient, chainId } = input;
	
	const sdk = getSDK();
	const chain = CHAIN_MAP[chainId];
	if (!chain) throw new Error(`Chain ${chainId} not supported`);

	// Create wallet client from user's EOA (Privy wallet)
	const walletClient = createWalletClient({
		chain,
		transport: custom(ethereumProvider),
		account: userAddress as `0x${string}`,
	});

	// User's EOA as signer - they are one of the owners!
	let userSignerAccount: any = {
		address: userAddress as `0x${string}`,
		type: "local" as const,
		publicKey: "0x" as `0x${string}`,
		source: "custom" as const,
		signMessage: async ({ message }: { message: any }) => {
			console.log("[Rhinestone] User signing message...");
			return await walletClient.signMessage({ 
				account: userAddress as `0x${string}`,
				message 
			});
		},
		signTransaction: async (tx: any) => {
			console.log("[Rhinestone] User signing transaction...");
			return await walletClient.signTransaction(tx);
		},
		signTypedData: async (typedData: any) => {
			console.log("[Rhinestone] User signing typed data...");
			return await walletClient.signTypedData({
				account: userAddress as `0x${string}`,
				...typedData,
			});
		},
	};

	console.log("[Rhinestone] Connecting to companion at:", companionAddress);
	console.log("[Rhinestone] User EOA (owner):", userAddress);

	// Try to get the stored signer key - we need BOTH owners to recreate same address
	const storedKeys = getSignerKeysFromStorage();
	const storedSignerPk = storedKeys[userAddress.toLowerCase()];
	
	let companionAccount;
	
	if (storedSignerPk) {
		// We have the signer key - recreate with exact same config
		const appSignerAccount = privateKeyToAccount(storedSignerPk);
		
		// Read-only user account (for address generation only)
		const readOnlyUserAccount = {
			address: userAddress as `0x${string}`,
			type: "local" as const,
			publicKey: "0x" as `0x${string}`,
			source: "custom" as const,
			signMessage: async () => { throw new Error("Use app signer"); },
			signTransaction: async () => { throw new Error("Use app signer"); },
			signTypedData: async () => { throw new Error("Use app signer"); },
		};
		
		companionAccount = await sdk.createAccount({
			account: { type: "nexus" },
			owners: {
				type: "ecdsa",
				accounts: [readOnlyUserAccount as any, appSignerAccount],
				threshold: 1,
			},
		});
		
		const generatedAddr = companionAccount.getAddress();
		console.log("[Rhinestone] Generated address with stored key:", generatedAddr);
		
		if (generatedAddr.toLowerCase() !== companionAddress.toLowerCase()) {
			throw new Error(
				`Address mismatch: generated ${generatedAddr} but target is ${companionAddress}. ` +
				`The stored key doesn't match the one used to create this companion.`
			);
		}
		
		// Use the app signer for the actual transaction
		userSignerAccount = appSignerAccount as any;
	} else {
		// No stored key - try direct approach (user as sole owner)
		// This will generate a DIFFERENT address but let's try anyway
		companionAccount = await sdk.createAccount({
			account: { type: "nexus" },
			owners: {
				type: "ecdsa",
				accounts: [userSignerAccount as any],
				threshold: 1,
			},
		});
		
		const generatedAddr = companionAccount.getAddress();
		console.log("[Rhinestone] Generated address (user only):", generatedAddr);
		
		if (generatedAddr.toLowerCase() !== companionAddress.toLowerCase()) {
		throw new Error(
				`Cannot withdraw from ${companionAddress}. ` +
				`No stored signer key found, and user-only config generates different address (${generatedAddr}). ` +
				`The funds at ${companionAddress} may be unrecoverable without the original signer key. ` +
				`Contact Rhinestone support for assistance.`
			);
		}
	}

	console.log("[Rhinestone] Withdrawing from:", companionAddress);

	let call;
	if (!tokenAddress || isNativeToken(tokenAddress)) {
		// Withdraw native ETH
		// Check balance first
		const rpcUrl = chainId === 8453 ? "https://mainnet.base.org" : 
		               chainId === 1 ? "https://eth.llamarpc.com" :
		               chainId === 10 ? "https://mainnet.optimism.io" :
		               chainId === 42161 ? "https://arb1.arbitrum.io/rpc" :
		               "https://mainnet.base.org";
		
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "eth_getBalance",
				params: [companionAddress, "latest"],
				id: 1,
			}),
		});
		const data = await res.json();
		const balance = BigInt(data?.result || "0x0");
		// Leave ~0.0001 ETH just in case, but try to send max
		const amount = balance > BigInt(100000000000000) ? balance - BigInt(100000000000000) : balance; 

		call = {
			to: recipient as `0x${string}`,
			value: amount,
			data: "0x" as `0x${string}`,
		};
	} else {
		// Withdraw ERC20
		// For now, withdraw 0 as placeholder (would need balance check)
		call = {
			to: tokenAddress as `0x${string}`,
			value: BigInt(0),
			data: encodeFunctionData({
				abi: erc20Abi,
				functionName: "transfer",
				args: [recipient as `0x${string}`, BigInt(0)], // Placeholder
			}),
		};
	}

	console.log("[Rhinestone] Withdrawal call:", call);
	console.log("[Rhinestone] Balance to withdraw:", call.value?.toString());

	// Execute withdrawal - user signs with their EOA (they are an owner)
	const transaction = await companionAccount.sendTransaction({
		chain, // Same-chain transaction
		calls: [call],
		signers: {
			type: "owner",
			kind: "ecdsa",
			accounts: [userSignerAccount as any], // User signs as owner
		},
		sponsored: {
			gas: true,
			bridging: true,
			swaps: true,
		},
	});

	console.log("[Rhinestone] Withdrawal submitted:", transaction);
	const result = await companionAccount.waitForExecution(transaction);
	
	return {
		txHash: (result as any)?.transactionHash || "",
		status: "COMPLETED",
	};
}

/**
 * Get status of a Rhinestone intent operation
 */
export async function getRhinestoneStatus(idOrHash: string): Promise<RhinestoneStatusResponse> {
	return {
		id: idOrHash,
		status: "PENDING",
	};
}

/**
 * Check if swap can use Rhinestone
 */
export function canUseRhinestone(input: {
	fromToken: NearToken;
	toToken: NearToken;
}): { eligible: boolean; reason?: string } {
	const { fromToken, toToken } = input;
	
	const fromChain = String(fromToken.chain || "").toLowerCase();
	const toChain = String(toToken.chain || "").toLowerCase();
	
	if (fromChain !== toChain) {
		return { eligible: false, reason: "Cross-chain not supported in this flow yet" };
	}

	if (!isRhinestoneSupportedChain(fromChain)) {
		return { eligible: false, reason: `Chain ${fromChain} not supported by Rhinestone` };
	}

	return { eligible: true };
}
