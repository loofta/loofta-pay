'use client'

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TokenCombobox } from "@/components/TokenCombobox";
import { Skeleton } from "@/components/ui/skeleton";
import type { NearToken } from "@/services/nearIntents";
import { useMemo } from "react";
import { useSwapStore } from "@/store/swap";
import { useQuote } from "@/hooks/useQuote";
import { findTokenBySelection } from "@/lib/tokens";
import { searchTokens, createTestIntent } from "@/services/nearIntents";

export function NearSwapWidget({
	tokens,
	loadingTokens,
}: {
	tokens: NearToken[];
	loadingTokens: boolean;
}) {
	const { fromSel, toSel, amount, setFromSel, setToSel, setAmount } = useSwapStore();
	const selectedFrom = useMemo(() => findTokenBySelection(tokens, fromSel), [tokens, fromSel]);
	const selectedTo = useMemo(() => findTokenBySelection(tokens, toSel), [tokens, toSel]);
	const { loading: quoteLoading, amountOut, error: quoteError } = useQuote(tokens, fromSel, toSel, amount);
	const usdFormatter = useMemo(() => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }), []);
	const usdFrom = useMemo(() => {
		if (!selectedFrom) return null;
		const p = typeof selectedFrom.price === "number" ? selectedFrom.price : null;
		const amt = parseFloat(amount || "0");
		if (!p || !Number.isFinite(amt)) return null;
		return usdFormatter.format(amt * p);
	}, [selectedFrom, amount, usdFormatter]);
	const rate = amountOut;
	const usdTo = useMemo(() => {
		if (!selectedTo) return null;
		const p = typeof selectedTo.price === "number" ? selectedTo.price : null;
		const amt = parseFloat(rate || "0");
		if (!p || !Number.isFinite(amt)) return null;
		return usdFormatter.format(amt * p);
	}, [selectedTo, rate, usdFormatter]);
	const amountNum = useMemo(() => {
		const n = parseFloat(amount);
		return Number.isFinite(n) ? n : 0;
	}, [amount]);
	const swapDisabled = !(amountNum > 0) || !selectedFrom || !selectedTo || !!quoteError || (
		fromSel?.symbol === toSel?.symbol && fromSel?.chain === toSel?.chain
	);
	function flip() {
		const prevFrom = fromSel;
		setFromSel(toSel);
		setToSel(prevFrom);
	}
	async function onSwap() {
		if (!selectedFrom || !selectedTo || !amount) return;
		try {
			const intent = await createTestIntent({
				fromToken: selectedFrom,
				toToken: selectedTo,
				amount,
			});
			console.log("Created test intent:", intent);
		} catch (err) {
			console.error("Intent creation failed", err);
		}
	}
	return (
		<motion.div
			className="group relative bg-white rounded-3xl p-0 cursor-pointer overflow-hidden shadow-md border border-gray-100"
			initial={{ opacity: 0, y: 30 }}
			whileInView={{ opacity: 1, y: 0 }}
			transition={{ delay: 0.05, type: "spring", stiffness: 100 }}
			whileHover={{
				y: -8,
				boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
				transition: { duration: 0.2, ease: "easeOut" }
			}}
			viewport={{ once: true }}
		>
			<div className="px-6 pt-5">
				<div className="flex items-center justify-between">
					<div className="relative pb-3">
						<div className="text-2xl font-extrabold text-gray-900 tracking-tight">Near Intents</div>
						<div
							className="absolute left-0 right-0 -bottom-0.5 h-[3px] rounded"
							style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
						/>
					</div>
				</div>
			</div>
			<div className="px-6 pt-5">
				<div className="flex items-center justify-between">
					<div className="relative pb-3">
						<div className="text-2xl font-extrabold text-gray-900 tracking-tight"></div>
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
								tokens={tokens}
								value={fromSel || undefined}
								onChange={(sel) => setFromSel(sel)}
								placeholder="From"
								onQuery={searchTokens}
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
					<div className="mt-3 flex items-center justify-between text-sm">
						<span className="text-gray-500 min-h-4">
							{loadingTokens || !selectedFrom ? (
								<Skeleton className="h-4 w-20" />
							) : (usdFrom ?? "-")}
						</span>
						<button
							type="button"
							onClick={() => setAmount("0")}
							className="rounded-xl border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-100"
						>
							Max
						</button>
						<button
							type="button"
							onClick={() => {
								const n = Number(amount || 0);
								if (!n) return;
								setAmount((n * 0.5).toString());
							}}
							className="rounded-xl border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-100"
						>
							50%
						</button>
					</div>
				</div>
				<div className="flex justify-center -my-1">
					<button
						type="button"
						onClick={flip}
						className="mt-2 mb-2 inline-flex items-center justify-center h-10 w-10 rounded-2xl text-white shadow"
						style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
						aria-label="Flip pair"
					>
						<ArrowUpDown className="h-5 w-5" />
					</button>
				</div>
				<div className="rounded-2xl bg-gray-50 border border-gray-200 px-4 py-5">
					<div className="flex items-center justify-between">
						<div className="text-base font-semibold text-gray-700">Buy</div>
						<div className="w-44">
							<TokenCombobox
								tokens={tokens}
								value={toSel || undefined}
								onChange={(sel) => setToSel(sel)}
								placeholder="To"
								onQuery={searchTokens}
								className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50"
							/>
						</div>
					</div>
					<div className="mt-3 flex items-end justify-between">
						<div className="text-5xl md:text-6xl font-semibold text-gray-900 leading-none">
							{quoteLoading ? <span className="inline-block"><Skeleton className="h-8 w-24 rounded-md" /></span> : (rate || "0")}
						</div>
					</div>
					<div className="mt-3 text-sm text-gray-500 min-h-4">
						{quoteError ? (
							<span className="text-red-600">{quoteError}</span>
						) : (loadingTokens || !selectedTo ? (
							<Skeleton className="h-4 w-20" />
						) : (usdTo ?? "-"))}
					</div>
				</div>
				<Button
					onClick={onSwap}
					disabled={swapDisabled}
					className="w-full mt-5 text-white font-semibold rounded-2xl border-0 py-5"
					style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
				>
					Swap Now
				</Button>
			</div>
		</motion.div>
	);
}


