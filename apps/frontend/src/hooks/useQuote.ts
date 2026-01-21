import { useEffect, useMemo, useRef, useState } from "react";
import type { NearToken } from "@/services/nearIntents";
import { getAccurateQuote } from "@/services/nearIntents";
import type { TokenSelection } from "@/app/utils/types";
import { findTokenBySelection } from "@/lib/tokens";
import { ONECLICK_RECIPIENT, ONECLICK_REFUND_TO } from "@/config/oneClick";
import { getMockRecipient, getMockSender, getMockUserAuth, getKnownGoodAddressForFamily } from "@/lib/mockAddresses";

export function useQuote(tokens: NearToken[], fromSel: TokenSelection | null, toSel: TokenSelection | null, amount: string) {
	const fromToken = useMemo(() => findTokenBySelection(tokens, fromSel), [tokens, fromSel]);
	const toToken = useMemo(() => findTokenBySelection(tokens, toSel), [tokens, toSel]);
	const [loading, setLoading] = useState(false);
	const [amountOut, setAmountOut] = useState<string>("");
	const [error, setError] = useState<string | null>(null);
	const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

	function isLikelyEvmAddress(s: string | null | undefined) {
		if (!s) return false;
		return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
	}
	function isLikelyNearAccount(s: string | null | undefined) {
		if (!s) return false;
		const v = s.trim();
		if (v.endsWith(".near") || v.endsWith(".testnet")) return true;
		// implicit account id (64 hex chars)
		return /^[0-9a-f]{64}$/i.test(v);
	}
	function isLikelySolanaAddress(s: string | null | undefined) {
		if (!s) return false;
		const v = s.trim();
		return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
	}
	const ZERO = "0x0000000000000000000000000000000000000000";
	function validateRefundForOrigin(originAssetId: string, proposed: string | null | undefined, fromChain: string) {
		const val = (proposed || "").trim();
		// For OMFT (nep141) origin, deposit happens on NEAR
		if (originAssetId.startsWith("nep141:")) {
			return isLikelyNearAccount(val) ? val : getMockSender("near");
		}
		// Fallback per-chain checks
		if (isLikelyEvmAddress(val)) return val;
		if (isLikelySolanaAddress(val)) return val;
		if (isLikelyNearAccount(val)) return val;
		return getMockSender(fromChain);
	}
	function validateRecipientForDestination(destAssetId: string, proposed: string | null | undefined, destFamily: string) {
		const val = (proposed || "").trim();
		const id = String(destAssetId);
		// infer family from asset id if possible
		let fam = destFamily;
		if (id.startsWith("nep141:")) {
			const rest = id.slice("nep141:".length);
			const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
			const code = (head || "").toLowerCase();
			if (["eth","arb","base","op","optimism","bsc","avax","polygon","matic","fantom","ftm","gnosis","xdai","linea","scroll","zksync","zk","blast", "monad"].includes(code)) fam = "ethereum";
			else if (code === "sol" || code === "solana") fam = "solana";
			else if (code === "ton") fam = "ton";
			else if (code === "aptos") fam = "aptos";
			else if (code === "cardano" || code === "ada") fam = "cardano";
			else if (code === "near" || (!rest.includes("-") && rest.includes(".near"))) fam = "near";
			else fam = "ethereum";
		}
		// For Solana, always use a known-good 32-byte public key to satisfy strict validation
		if (fam === "solana") {
			return getKnownGoodAddressForFamily("solana", "recipient");
		}
		// Validate basic formats
		if (fam === "ethereum" && isLikelyEvmAddress(val)) return val;
		if (fam === "near" && isLikelyNearAccount(val)) return val;
		// Fallback to mock for family
		return getMockRecipient(fam);
	}
	function inferOriginFamily(originAssetId: string): string {
		if (!originAssetId) return "ethereum";
		if (originAssetId.startsWith("nep141:")) {
			const rest = originAssetId.slice("nep141:".length);
			const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
			const code = (head || "").toLowerCase();
			if (["eth","arb","base","op","optimism","bsc","avax","polygon","matic","fantom","ftm","gnosis","xdai","linea","scroll","zksync","zk","blast"].includes(code)) return "ethereum";
			if (code === "sol" || code === "solana") return "solana";
			if (code === "ton") return "ton";
			if (code === "aptos") return "aptos";
			if (code === "cardano" || code === "ada") return "cardano";
			if (code === "near" || (!rest.includes("-") && rest.includes(".near"))) return "near";
			return "ethereum";
		}
		return "ethereum";
	}

	useEffect(() => {
		if (deb.current) clearTimeout(deb.current);
		if (!fromToken || !toToken || !amount || Number(amount) <= 0) {
			setAmountOut("");
			return;
		}
		deb.current = setTimeout(async () => {
			setLoading(true);
			setError(null);
			try {
				let q = null;
				// ORIGIN_CHAIN quote using known-good addresses that pass validation
				const originAssetId = fromToken.tokenId || fromToken.address || "";
				const destAssetId = toToken.tokenId || toToken.address || "";
				
				// Infer origin and destination chain families
				const originFamily = inferOriginFamily(originAssetId);
				const destFamily = (() => {
					const id = String(destAssetId);
					if (id.startsWith("nep141:")) {
						const rest = id.slice("nep141:".length);
						const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
						const code = (head || "").toLowerCase();
						if (["eth","arb","base","op","optimism","bsc","avax","polygon","matic","fantom","ftm","gnosis","xdai","linea","scroll","zksync","zk","blast"].includes(code)) return "ethereum";
						if (code === "sol" || code === "solana") return "solana";
						if (code === "ton") return "ton";
						if (code === "aptos") return "aptos";
						if (code === "cardano" || code === "ada") return "cardano";
						if (code === "near" || (!rest.includes("-") && rest.includes(".near"))) return "near";
						return "ethereum";
					}
					// Fallback to chain name if available
					const chain = (toToken.chain || "").toLowerCase();
					if (chain.includes("sol")) return "solana";
					if (chain.includes("near")) return "near";
					if (chain.includes("ton")) return "ton";
					if (chain.includes("aptos")) return "aptos";
					if (chain.includes("cardano") || chain.includes("ada")) return "cardano";
					return "ethereum";
				})();
				
				// For dry run quotes, use known-good addresses that pass validation
				// Sender and refund address are on origin chain, recipient is on destination chain
				const sender = getKnownGoodAddressForFamily(originFamily, "sender");
				const refundAddress = getKnownGoodAddressForFamily(originFamily, "sender"); // Refund is also on origin chain
				const recipient = getKnownGoodAddressForFamily(destFamily, "recipient");
					q = await getAccurateQuote({
						fromToken,
						toToken,
						amount,
						dryRun: true,
						slippageBps: 100,
						sender,
						recipient,
						refundAddress,
					});
				// Handle errors from quote (usually doesn't happen for dry quotes)
				if (q && q.error) {
					setError(q.error.message || "Quote error");
				} else {
					setError(null);
				}
				if (q && q.amountOut) {
					setAmountOut(q.amountOut);
				} else {
					// fallback to price ratio if quote not available
					const pIn = typeof fromToken.price === "number" ? fromToken.price : null;
					const pOut = typeof toToken.price === "number" ? toToken.price : null;
					if (pIn && pOut && pOut > 0) {
						const est = (Number(amount) * pIn) / pOut;
						setAmountOut(Number.isFinite(est) ? est.toFixed(6) : "");
					} else {
						setAmountOut("");
					}
				}
			} catch (e: any) {
				setError(e?.message || "Failed to get quote");
			} finally {
				setLoading(false);
			}
		}, 400);
		return () => {
			if (deb.current) clearTimeout(deb.current);
		};
	}, [fromToken, toToken, amount]);

	return { fromToken, toToken, loading, amountOut, error };
}


