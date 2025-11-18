import { BICONOMY_API_BASE, BICONOMY_API_KEY } from "@/config/biconomy";
import type { NearToken } from "./nearIntents";

export type BiconomyQuoteRequest = {
	originAsset: string;
	destinationAsset: string;
	amount: string; // atomic of origin
	recipient: string; // destination chain address
	slippageBps?: number;
	dry?: boolean;
};

export type BiconomyQuoteResponse = {
	raw: any;
	depositAddress?: string;
	minAmountAtomic?: string;
	minAmountFormatted?: string;
	originNetwork?: string;
	deadline?: string;
	error?: {
		type: "client" | "server" | "network" | "unknown";
		status?: number;
		message?: string;
		correlationId?: string;
	};
};

function authHeaders() {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (BICONOMY_API_KEY) {
		headers["Authorization"] = `Bearer ${BICONOMY_API_KEY}`;
	}
	return headers;
}

export async function getBiconomyQuote(input: BiconomyQuoteRequest): Promise<BiconomyQuoteResponse> {
	const url = `${BICONOMY_API_BASE}/v0/intent-simple/quote`;
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				dry: input.dry ?? true,
				swapType: "EXACT_INPUT",
				slippageTolerance: input.slippageBps ?? 100,
				originAsset: input.originAsset,
				destinationAsset: input.destinationAsset,
				amount: input.amount,
				recipient: input.recipient,
				deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
			}),
		});
		if (!res.ok) {
			let data: any = undefined;
			try { data = await res.json(); } catch { /* ignore */ }
			return {
				raw: data,
				error: {
					type: res.status >= 500 ? "server" : "client",
					status: res.status,
					message: data?.message || res.statusText,
					correlationId: data?.correlationId,
				},
			};
		}
		const data = await res.json();
		const quote = data?.quote || data;
		return {
			raw: data,
			depositAddress: quote?.depositAddress || quote?.address,
			minAmountAtomic: quote?.minAmount ?? quote?.minimumAmount,
			minAmountFormatted: quote?.minAmountFormatted ?? quote?.minimumAmountFormatted,
			originNetwork: quote?.originNetwork ?? quote?.originChain,
			deadline: quote?.deadline,
		};
	} catch (_e: any) {
		const msg = _e?.message || "Network Error";
		return { raw: null, error: { type: "network", message: msg } };
	}
}

export function toAtomicAmount(human: string, decimals: number): string {
	const [i, f = ""] = String(human).split(".");
	const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
	const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
	return BigInt(padded).toString();
}

export function inferChainFamilyFromAssetId(assetId: string): "ethereum" | "solana" | "near" | "aptos" | "ton" | "cardano" {
	if (assetId?.startsWith("nep141:")) {
		const rest = assetId.slice("nep141:".length);
		const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
		const code = (head || "").toLowerCase();
		if (["eth","arb","base","op","optimism","bsc","avax","polygon","matic","fantom","ftm","gnosis","xdai","linea","scroll","zksync","zk","blast"].includes(code)) return "ethereum";
		if (code === "sol" || code === "solana") return "solana";
		if (code === "ton") return "ton";
		if (code === "aptos") return "aptos";
		if (code === "cardano" || code === "ada") return "cardano";
		if (code === "near" || (!rest.includes("-") && rest.includes(".near"))) return "near";
	}
	return "ethereum";
}

function parseOmftAssetId(assetId: string): { chainCode: string | null; tokenAddress: string | null } {
	if (!assetId?.startsWith("nep141:")) return { chainCode: null, tokenAddress: null };
	const rest = assetId.slice("nep141:".length);
	const [head, afterHead] = rest.split("-", 2);
	if (!afterHead) return { chainCode: null, tokenAddress: null };
	const tokenAddr = afterHead.split(".")[0];
	return { chainCode: (head || "").toLowerCase(), tokenAddress: tokenAddr?.toLowerCase() || null };
}

function evmChainIdFromCode(code: string): number | null {
	const c = code.toLowerCase();
	switch (c) {
		case "eth": return 1;
		case "arb": return 42161;
		case "op":
		case "optimism": return 10;
		case "base": return 8453;
		case "polygon":
		case "matic": return 137;
		case "bsc": return 56;
		case "avax": return 43114;
		case "fantom":
		case "ftm": return 250;
		case "gnosis":
		case "xdai": return 100;
		case "linea": return 59144;
		case "scroll": return 534352;
		case "zksync":
		case "zk": return 324;
		case "blast": return 81457;
		default: return null;
	}
}

export function validateRecipientForFamily(addr: string, family: string): boolean {
	const v = (addr || "").trim();
	if (!v) return false;
	if (family === "ethereum") return /^0x[0-9a-fA-F]{40}$/.test(v);
	if (family === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
	if (family === "near") return v.endsWith(".near") || v.endsWith(".testnet") || /^[0-9a-f]{64}$/i.test(v);
	if (family === "cardano") return /^addr1[0-9a-z]+$/.test(v);
	if (family === "aptos") return /^0x[0-9a-fA-F]{64}$/.test(v);
	if (family === "ton") return /^[A-Za-z0-9_-]{48,}$/.test(v);
	return false;
}

export type BiconomyEoaQuoteInput = {
	originAssetId: string; // nep141:chain-0x...omft.near
	destinationAssetId: string; // nep141:chain-0x...omft.near
	amountAtomic: string;
	ownerAddress: string; // destination EOA on destination chain
	slippage?: number; // 0.01 for 1%
};

export async function getBiconomyEoaQuote(input: BiconomyEoaQuoteInput): Promise<{
	raw: any;
	error?: { type: "client" | "server" | "network" | "unknown"; status?: number; message?: string; correlationId?: string };
	summary?: {
		feeAmount?: string;
		quoteType?: string;
		minOutputAmount?: string;
		outputAmount?: string;
		routeSummary?: string;
	};
}> {
	// Parse OMFT asset ids into EVM chainId + token address
	const src = parseOmftAssetId(input.originAssetId);
	const dst = parseOmftAssetId(input.destinationAssetId);
	if (!src.chainCode || !src.tokenAddress || !dst.chainCode || !dst.tokenAddress) {
		return { raw: null, error: { type: "client", message: "Unsupported token format for Biconomy" } };
	}
	const srcChainId = evmChainIdFromCode(src.chainCode);
	const dstChainId = evmChainIdFromCode(dst.chainCode);
	if (!srcChainId || !dstChainId) {
		return { raw: null, error: { type: "client", message: "Biconomy supports EVM chains only" } };
	}
	if (!/^0x[0-9a-fA-F]{40}$/.test(input.ownerAddress)) {
		return { raw: null, error: { type: "client", message: "Destination must be an EVM address for Biconomy" } };
	}
	const body = {
		mode: "eoa",
		ownerAddress: input.ownerAddress,
		fundingTokens: [{
			tokenAddress: src.tokenAddress,
			chainId: srcChainId,
			amount: input.amountAtomic,
		}],
		feeToken: {
			address: src.tokenAddress,
			chainId: srcChainId,
		},
		composeFlows: [
			{
				type: "/instructions/intent-simple",
				data: {
					srcChainId,
					dstChainId,
					srcToken: src.tokenAddress,
					dstToken: dst.tokenAddress,
					amount: input.amountAtomic,
					slippage: input.slippage ?? 0.01,
				},
			},
			{
				type: "/instructions/build",
				data: {
					functionSignature: "function transfer(address to, uint256 value)",
					args: [
						input.ownerAddress,
						{
							type: "runtimeErc20Balance",
							tokenAddress: dst.tokenAddress,
							constraints: { gte: "1" },
						},
					],
					to: dst.tokenAddress,
					chainId: dstChainId,
				},
			},
		],
	};
	try {
		const res = await fetch(`https://api.biconomy.io/v1/quote`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return {
				raw: data,
				error: {
					type: res.status >= 500 ? "server" : "client",
					status: res.status,
					message: data?.message || res.statusText,
					correlationId: data?.correlationId,
				},
			};
		}
		const returned = Array.isArray(data?.returnedData) ? data.returnedData[0] : undefined;
		return {
			raw: data,
			summary: {
				feeAmount: data?.fee?.amount,
				quoteType: data?.quoteType,
				minOutputAmount: returned?.minOutputAmount,
				outputAmount: returned?.outputAmount,
				routeSummary: returned?.route?.summary,
			},
		};
	} catch (_e: any) {
		return { raw: null, error: { type: "network", message: _e?.message || "Network error" } };
	}
}


