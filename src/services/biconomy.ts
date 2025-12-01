import type { NearToken } from "@/services/nearIntents";
import { BICONOMY_API_BASE, BICONOMY_API_KEY } from "@/config/biconomy";
import { DEFAULT_DEADLINE_SECONDS, DEFAULT_SLIPPAGE_BPS, SWAP_PREFERS_EXACT_OUTPUT } from "@/config/swaps";

export type BiconomyQuoteResponse = {
	id?: string;
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

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (BICONOMY_API_KEY) headers["x-api-key"] = BICONOMY_API_KEY;
	// Forward Origin to satisfy Biconomy allowed-origin checks (use env override if set)
	const ORIGIN_OVERRIDE =
		(process as any)?.env?.BICONOMY_ORIGIN ||
		(process as any)?.env?.NEXT_PUBLIC_ORIGIN ||
		((process as any)?.env?.VERCEL_URL ? `https://${(process as any).env.VERCEL_URL}` : undefined);
  if (ORIGIN_OVERRIDE) headers["Origin"] = ORIGIN_OVERRIDE;
  console.log("headers", headers);
  return headers;
}

function extractEvmAddress(token?: Partial<NearToken>): string | null {
	const cand = String(token?.address || token?.tokenId || "").trim();
	// Direct 0x address
	const m = cand.match(/0x[0-9a-fA-F]{40}/);
	return m ? m[0] : null;
}

function chainIdFor(chain?: string): number | undefined {
	const keyRaw = String(chain || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
	const key = keyRaw;
	// direct exacts
	const exact: Record<string, number> = {
		"ethereum": 1, "eth": 1, "mainnet": 1,
		"sepolia": 11155111,
		"polygon": 137, "matic": 137,
		"amoy": 80002, "polygon-amoy": 80002,
		"arbitrum": 42161, "arb": 42161,
		"arbitrum-sepolia": 421614,
		"optimism": 10, "op": 10,
		"op-sepolia": 11155420,
		"base": 8453,
		"base-sepolia": 84532,
		"bsc": 56, "bnb": 56,
		"bsc-testnet": 97,
		"gnosis": 100, "xdai": 100,
		"avalanche": 43114, "avax": 43114,
		"fuji": 43113, "avalanche-fuji": 43113,
		"scroll": 534352,
		"scroll-sepolia": 534351,
		"linea": 59144,
		"blast": 81457,
		"blast-sepolia": 168587773,
	};
	if (exact[key] != null) return exact[key];
	// fuzzy contains
	if (key.includes("base") && key.includes("sepolia")) return 84532;
	if (key.includes("base")) return 8453;
	if ((key.includes("eth") || key.includes("ethereum")) && !key.includes("sepolia")) return 1;
	if (key.includes("sepolia")) return 11155111;
	if (key.includes("polygon") || key.includes("matic") || key.includes("pol")) {
		if (key.includes("amoy") || key.includes("test")) return 80002;
		return 137;
	}
	if (key.includes("arbitrum") || key.includes("arb")) {
		if (key.includes("sepolia") || key.includes("test")) return 421614;
		return 42161;
	}
	if (key.includes("optimism") || key === "op") {
		if (key.includes("sepolia") || key.includes("test")) return 11155420;
		return 10;
	}
	if (key.includes("bsc") || key.includes("binance") || key.includes("bnb")) {
		if (key.includes("test")) return 97;
		return 56;
	}
	if (key.includes("gnosis") || key.includes("xdai")) return 100;
	if (key.includes("avax") || key.includes("avalanche")) {
		if (key.includes("fuji") || key.includes("test")) return 43113;
		return 43114;
	}
	if (key.includes("scroll")) {
		if (key.includes("sepolia") || key.includes("test")) return 534351;
		return 534352;
	}
	if (key.includes("linea")) return 59144;
	if (key.includes("blast")) {
		if (key.includes("sepolia") || key.includes("test")) return 168587773;
		return 81457;
	}
	return undefined;
}

async function postWithFallback<T = any>(base: string, paths: string[], body: any): Promise<{ ok: boolean; status: number; json?: T; text?: string }> {
	const headers = authHeaders();
	for (const p of paths) {
		try {
			const res = await fetch(`${base}${p}`, { method: "POST", headers, body: JSON.stringify(body) });
			if (res.ok) {
				try { return { ok: true, status: res.status, json: await res.json() as T }; }
				catch { return { ok: true, status: res.status, text: await res.text() }; }
			}
			// If 404, try next path
			if (res.status === 404) {
				continue;
			}
			return { ok: false, status: res.status, text: await res.text() };
		} catch (e: any) {
			// Try next path on network error
			continue;
		}
	}
	return { ok: false, status: 404, text: "All endpoint fallbacks returned 404" };
}

async function getWithFallback<T = any>(base: string, paths: string[], qs: Record<string, string>): Promise<{ ok: boolean; status: number; json?: T; text?: string }> {
	const headers = authHeaders();
	const query = new URLSearchParams(qs).toString();
	for (const p of paths) {
		try {
			const url = `${base}${p}${query ? `?${query}` : ""}`;
			const res = await fetch(url, { headers });
			if (res.ok) {
				try { return { ok: true, status: res.status, json: await res.json() as T }; }
				catch { return { ok: true, status: res.status, text: await res.text() }; }
			}
			if (res.status === 404) continue;
			return { ok: false, status: res.status, text: await res.text() };
		} catch (e: any) {
			continue;
		}
	}
	return { ok: false, status: 404, text: "All endpoint fallbacks returned 404" };
}

export async function getQuoteExactOutput(input: {
	fromToken: NearToken;
	toToken: NearToken;
	amountOutHuman: string; // treated as amountInHuman for Biconomy v1/quote
	recipient?: string;
	slippageBps?: number;
	deadlineSeconds?: number;
	userAddress?: string;
}): Promise<BiconomyQuoteResponse> {
	const {
		fromToken,
		toToken,
		amountOutHuman,
		recipient,
		slippageBps = DEFAULT_SLIPPAGE_BPS,
		deadlineSeconds = DEFAULT_DEADLINE_SECONDS,
		userAddress,
	} = input;
	const chainId = chainIdFor(fromToken.chain);
	const fromAddr = extractEvmAddress(fromToken);
	const toAddr = extractEvmAddress(toToken);
	if (!chainId) return { error: { message: `Unsupported chain for Biconomy (${String(fromToken.chain || "")})` } };
	if (!toAddr) return { error: { message: "Destination token missing EVM address" } };
	if (!userAddress) return { error: { message: "Missing ownerAddress (userAddress)" } };
	// Treat amountOutHuman as input amount for Biconomy, and convert to wei
	const decimals = Number(fromToken.decimals || 18);
	const [i, f = ""] = String(amountOutHuman).split(".");
	const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
	const wei = BigInt((i.replace(/\D/g, "") || "0") + cleanF.padEnd(decimals, "0")).toString();
	const slippage = Math.max(0, Math.min(1, (slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 10000));
	const body: any = {
		mode: "eoa",
		ownerAddress: userAddress,
		fundingTokens: [
			{
				tokenAddress: fromAddr ?? "0x0000000000000000000000000000000000000000",
				chainId,
				amount: wei,
			},
		],
		feeToken: {
			address: fromAddr ?? "0x0000000000000000000000000000000000000000",
			chainId,
		},
		composeFlows: [
			{
				type: "/instructions/intent-simple",
				data: {
					srcChainId: chainId,
					dstChainId: chainId,
					srcToken: fromAddr ?? "0x0000000000000000000000000000000000000000",
					dstToken: toAddr,
					amount: wei,
					slippage,
				},
			},
		],
	};
	// Add withdrawal to recipient for EOA mode per docs (swap + send)
	if (recipient && toAddr) {
		(body.composeFlows as any[]).push({
			type: "/instructions/build",
			data: {
				functionSignature: "function transfer(address to, uint256 value)",
				args: [
					recipient,
					{
						type: "runtimeErc20Balance",
						tokenAddress: toAddr,
						constraints: { gte: "1" },
					},
				],
				to: toAddr,
				chainId,
			},
		});
	}
	const res = await fetch(`${BICONOMY_API_BASE}/v1/quote`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		return { error: { message: `Quote failed (${res.status}): ${await res.text().catch(() => "unknown")}` } };
	}
	return (await res.json()) as BiconomyQuoteResponse;
}

export async function createSupertransaction(input: {
	fromToken: NearToken;
	toToken: NearToken;
	amountOutHuman: string;
	recipient: string;
	userAddress?: string;
	slippageBps?: number;
	deadlineSeconds?: number;
	routeHint?: any;
}): Promise<BiconomyIntentResponse> {
	// Build payload by reusing the quote endpoint (which already returns to/data/value for execution)
	const chainId = chainIdFor(input.fromToken.chain);
	const toAddr = extractEvmAddress(input.toToken);
	if (!chainId) throw new Error("Unsupported chain for Biconomy");
	if (!toAddr) throw new Error("Destination token missing EVM address");
	const quote = await getQuoteExactOutput({
		fromToken: input.fromToken,
		toToken: input.toToken,
		amountOutHuman: input.amountOutHuman,
		recipient: input.recipient,
		slippageBps: input.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
		deadlineSeconds: input.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS,
		userAddress: input.userAddress,
	});
	if ((quote as any)?.error?.message) {
		throw new Error((quote as any).error.message);
	}
	const to = (quote as any)?.to;
	const data = (quote as any)?.data;
	const value = (quote as any)?.value ?? "0";
	if (!to || !data) {
		throw new Error("Quote did not return executable payload");
	}
	return {
		id: (quote as any)?.id || (quote as any)?.routeSummary?.id || "",
		to,
		data,
		value: String(value),
		chainId,
		gas: (quote as any)?.routeSummary?.gas ?? undefined,
		meta: (quote as any)?.routeSummary ?? undefined,
	};
}

export async function getBiconomyStatus(idOrHash: string): Promise<BiconomyStatusResponse> {
	const paths = [
		"/super/status",
		"/v1/super/status",
		"/api/v1/super/status",
	];
	const res = await getWithFallback<BiconomyStatusResponse>(BICONOMY_API_BASE, paths, { id: idOrHash });
	if (!res.ok) {
		return { status: "UNKNOWN", id: idOrHash, error: `Status error (${res.status}): ${res.text || "unknown"}` };
	}
	return (res.json as BiconomyStatusResponse);
}


