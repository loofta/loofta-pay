'use client'

import * as React from "react";
import type { NearToken } from "@/services/nearIntents";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { useSwapStore } from "@/store/swap";
import { findTokenBySelection } from "@/lib/tokens";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getBiconomyEoaQuote, inferChainFamilyFromAssetId, toAtomicAmount, validateRecipientForFamily } from "@/services/biconomy";
import { getKnownGoodAddressForFamily } from "@/lib/mockAddresses";
import { ArrowRight } from "lucide-react";

export function BiconomySwapWidget({
	tokens,
	loadingTokens,
}: {
	tokens: NearToken[];
	loadingTokens: boolean;
}) {
	const { fromSel, toSel, amount, setFromSel, setToSel, setAmount } = useSwapStore();
	const [recipient, setRecipient] = React.useState("");
	const [quoteLoading, setQuoteLoading] = React.useState(false);
	const [quoteError, setQuoteError] = React.useState<string | null>(null);
	const [quoteResult, setQuoteResult] = React.useState<{
		feeAmount?: string;
		quoteType?: string;
		minOutputAmount?: string;
		outputAmount?: string;
		routeSummary?: string;
	} | null>(null);

	// Only EVM tokens are supported by Biconomy. Filter visible tokens accordingly.
	const evmTokens = React.useMemo(() => {
		return (tokens || []).filter((t) => {
			const id = t.tokenId || t.address || "";
			return inferChainFamilyFromAssetId(id) === "ethereum";
		});
	}, [tokens]);

	const selectedFrom = React.useMemo(() => findTokenBySelection(evmTokens, fromSel), [evmTokens, fromSel]);
	const selectedTo = React.useMemo(() => findTokenBySelection(evmTokens, toSel), [evmTokens, toSel]);

	const destFamily = React.useMemo(() => {
		// Biconomy supports EVM; infer to "ethereum" for EVM assets, else fallback "ethereum"
		const id = selectedTo?.tokenId || selectedTo?.address || "";
		const fam = inferChainFamilyFromAssetId(id || "");
		return fam === "ethereum" ? "ethereum" : "ethereum";
	}, [selectedTo]);

	const recipientValid = React.useMemo(() => {
		return validateRecipientForFamily(recipient, "ethereum");
	}, [recipient]);

	const amountNum = React.useMemo(() => {
		const n = parseFloat(amount);
		return Number.isFinite(n) ? n : 0;
	}, [amount]);

	const nonEvmSelection = React.useMemo(() => {
		const fromId = selectedFrom?.tokenId || selectedFrom?.address || "";
		const toId = selectedTo?.tokenId || selectedTo?.address || "";
		return (fromId && inferChainFamilyFromAssetId(fromId) !== "ethereum") || (toId && inferChainFamilyFromAssetId(toId) !== "ethereum");
	}, [selectedFrom, selectedTo]);

	const disableGetQuote = nonEvmSelection || !selectedFrom || !selectedTo || !(amountNum > 0) || !recipientValid;

	async function onGetQuote() {
		if (!selectedFrom || !selectedTo || !(amountNum > 0) || !recipientValid) return;
		setQuoteLoading(true);
		setQuoteError(null);
		setQuoteResult(null);
		try {
			const originAssetId = selectedFrom.tokenId || selectedFrom.address || "";
			const destinationAssetId = selectedTo.tokenId || selectedTo.address || "";
			const amountAtomic = toAtomicAmount(amount, selectedFrom.decimals || 0);
			const r = await getBiconomyEoaQuote({
				originAssetId,
				destinationAssetId,
				amountAtomic,
				ownerAddress: recipient,
				slippage: 0.01,
			});
			if (r.error) {
				setQuoteError(r.error.message || "Failed to get quote");
			} else {
				setQuoteResult(r.summary || null);
			}
		} catch (e: any) {
			setQuoteError(e?.message || "Failed to get quote");
		} finally {
			setQuoteLoading(false);
		}
	}

	return (
		<div className="group relative bg-white rounded-3xl p-0 overflow-hidden shadow-md border border-gray-100">
			<div className="px-6 pt-5">
				<div className="flex items-center justify-between">
					<div className="relative pb-3">
						<div className="text-2xl font-extrabold text-gray-900 tracking-tight">Biconomy</div>
						<div
							className="absolute left-0 right-0 -bottom-0.5 h-[3px] rounded"
							style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
						/>
					</div>
				</div>
			</div>
			<div className="px-6 pb-6">
				<div className="mt-5 rounded-2xl bg-gray-50 border border-gray-200 px-4 py-5">
					<div className="flex items-center justify-between">
						<div className="text-base font-semibold text-gray-700">Sell</div>
						<div className="w-44">
							<TokenCombobox
								tokens={evmTokens}
								value={fromSel || undefined}
								onChange={(sel: TokenSelection) => setFromSel(sel)}
								placeholder="From"
								className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50"
							/>
						</div>
					</div>
					<div className="mt-3 flex items-end justify-between">
						<Input
							inputMode="decimal"
							placeholder="0"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							className="text-5xl md:text-6xl font-semibold border-none bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-auto"
						/>
					</div>
				</div>

				<div className="rounded-2xl bg-gray-50 border border-gray-200 px-4 py-5 mt-4">
					<div className="flex items-center justify-between">
						<div className="text-base font-semibold text-gray-700">Buy</div>
						<div className="w-44">
							<TokenCombobox
								tokens={evmTokens}
								value={toSel || undefined}
								onChange={(sel: TokenSelection) => setToSel(sel)}
								placeholder="To"
								className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50"
							/>
						</div>
					</div>
					<div className="mt-3">
						<label className="text-sm font-medium text-gray-700">Destination address (EVM)</label>
						<Input
							placeholder="0x..."
							value={recipient}
							onChange={(e) => setRecipient(e.target.value)}
							className="mt-1"
						/>
						{recipient && !recipientValid ? (
							<div className="text-xs text-red-600 mt-1">Invalid EVM address format.</div>
						) : null}
						<div className="mt-2">
							<button
								type="button"
								onClick={async () => {
									try {
										const text = await navigator.clipboard.readText();
										if (text) setRecipient(text.trim());
									} catch {
										// ignore clipboard errors
									}
								}}
								className="text-xs underline text-gray-600 hover:text-gray-900"
							>
								Paste from clipboard
							</button>
						</div>
					</div>
				</div>

				{nonEvmSelection ? (
					<div className="mt-3 text-sm text-red-600">
						Biconomy supports EVM chains only. Please select EVM tokens (e.g., Base, Arbitrum, Optimism, Polygon).
					</div>
				) : null}

				<div className="mt-4 flex items-center gap-3">
					<Button onClick={onGetQuote} disabled={disableGetQuote || quoteLoading} className="px-6">
						{quoteLoading ? "Getting quote…" : "Get Quote"}
					</Button>
					{quoteError ? <span className="text-sm text-red-600">{quoteError}</span> : null}
				</div>

				{quoteResult ? (
					<div className="mt-4 rounded-2xl border border-gray-200 p-4 bg-white">
						<div className="text-sm text-gray-700 space-y-1.5">
							<div><span className="font-semibold">Quote type:</span> {quoteResult.quoteType || "-"}</div>
							<div><span className="font-semibold">Expected output:</span> {quoteResult.outputAmount || "-"}</div>
							<div><span className="font-semibold">Min output:</span> {quoteResult.minOutputAmount || "-"}</div>
							<div><span className="font-semibold">Fee:</span> {quoteResult.feeAmount || "-"}</div>
							{quoteResult.routeSummary ? (
								<div className="text-xs text-gray-600 break-words"><span className="font-semibold">Route:</span> {quoteResult.routeSummary}</div>
							) : null}
						</div>
						<div className="mt-3 text-xs text-gray-600">
							After confirming the quote, you will sign and execute on Biconomy (EOA mode).
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}



