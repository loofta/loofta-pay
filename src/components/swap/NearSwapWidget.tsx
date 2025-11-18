'use client'

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TokenCombobox } from "@/components/TokenCombobox";
import { Skeleton } from "@/components/ui/skeleton";
import type { NearToken } from "@/services/nearIntents";
import { useMemo, useState } from "react";
import { useSwapStore } from "@/store/swap";
import { useQuote } from "@/hooks/useQuote";
import { findTokenBySelection } from "@/lib/tokens";
import { searchTokens, createTestIntent, getDepositInfo } from "@/services/nearIntents";
import { getKnownGoodAddressForFamily } from "@/lib/mockAddresses";
import { trimDecimals } from "@/lib/format";

export function NearSwapWidget({
	tokens,
	loadingTokens,
}: {
	tokens: NearToken[];
	loadingTokens: boolean;
}) {
	const { fromSel, toSel, amount, setFromSel, setToSel, setAmount } = useSwapStore();
	const [recipient, setRecipient] = useState<string>("");
	const [recipientError, setRecipientError] = useState<string | null>(null);
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
	// Manual deposit: require a valid recipient wallet for destination chain
	function inferDestFamily(destAssetId: string): "ethereum" | "solana" | "near" | "cardano" | "aptos" | "ton" {
		const id = String(destAssetId || "");
		if (id.startsWith("nep141:")) {
			const rest = id.slice("nep141:".length);
			const head = rest.includes("-") ? rest.split("-")[0] : rest.split(".")[0];
			const code = (head || "").toLowerCase();
			if (["eth", "arb", "base", "op", "optimism", "bsc", "avax", "polygon", "matic", "fantom", "ftm", "gnosis", "xdai", "linea", "scroll", "zksync", "zk", "blast"].includes(code)) return "ethereum";
			if (code === "sol" || code === "solana") return "solana";
			if (code === "near" || (!rest.includes("-") && rest.includes(".near"))) return "near";
			if (code === "cardano" || code === "ada") return "cardano";
			if (code === "aptos") return "aptos";
			if (code === "ton") return "ton";
			return "ethereum";
		}
		return "ethereum";
	}
	function isValidRecipientByFamily(addr: string, fam: string): boolean {
		const v = (addr || "").trim();
		if (!v) return false;
		if (fam === "ethereum") return /^0x[0-9a-fA-F]{40}$/.test(v);
		if (fam === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
		if (fam === "near") return v.endsWith(".near") || v.endsWith(".testnet") || /^[0-9a-f]{64}$/i.test(v);
		if (fam === "cardano") return /^addr1[0-9a-z]+$/.test(v);
		if (fam === "aptos") return /^0x[0-9a-fA-F]{64}$/.test(v);
		if (fam === "ton") return /^[A-Za-z0-9_\-]{48,66}$/.test(v);
		return false;
	}
	// Deposit info (non-dry)
	const [depositLoading, setDepositLoading] = useState(false);
	const [depositError, setDepositError] = useState<string | null>(null);
	const [deposit, setDeposit] = useState<{
		depositAddress?: string;
		memo?: string | null;
		deadline?: string;
		timeEstimate?: number;
		quoteId?: string;
	} | null>(null);
	async function onGetDeposit() {
		if (!selectedFrom || !selectedTo || !(amountNum > 0)) return;
		setDepositLoading(true);
		setDepositError(null);
		setDeposit(null);
		try {
			const originAssetId = selectedFrom.tokenId || selectedFrom.address || "";
			const destAssetId = selectedTo.tokenId || selectedTo.address || "";
			const destFamily = inferDestFamily(destAssetId);
			// Validate manual recipient; if invalid, block and show error
			if (!isValidRecipientByFamily(recipient, destFamily)) {
				setRecipientError(`Invalid ${destFamily} address format`);
				return;
			}
			setRecipientError(null);
			// Use zero address placeholders for refundTo in deposit request as per widget
			const ZERO = "0x0000000000000000000000000000000000000000";
			const info = await getDepositInfo({
				fromToken: selectedFrom,
				toToken: selectedTo,
				amount,
				sender: ZERO,
				recipient: recipient || getKnownGoodAddressForFamily(destFamily, "recipient"),
				slippageBps: 100,
			});
			if (!info?.depositAddress) {
				setDepositError("Failed to obtain deposit address");
			} else {
				setDeposit({
					depositAddress: info.depositAddress,
					memo: info.memo ?? null,
					deadline: info.deadline,
					timeEstimate: info.timeEstimate,
					quoteId: info.quoteId,
				});
			}
		} catch (e: any) {
			setDepositError(e?.message || "Failed to get deposit address");
		} finally {
			setDepositLoading(false);
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
							{quoteLoading ? <span className="inline-block"><Skeleton className="h-8 w-24 rounded-md" /></span> : trimDecimals(rate || "0", 5)}
						</div>
					</div>
					<div className="mt-3 text-sm text-gray-500 min-h-4">
						{quoteError ? (
							<span className="text-red-600">{quoteError}</span>
						) : (loadingTokens || !selectedTo ? (
							<Skeleton className="h-4 w-20" />
						) : (usdTo ?? "-"))}
					</div>
					{/* Manual recipient input */}
					<div className="mt-4">
						<label className="text-sm font-medium text-gray-700">Recipient address</label>
						<input
							type="text"
							value={recipient}
							onChange={(e) => setRecipient(e.target.value)}
							placeholder="Enter destination wallet address"
							className="mt-1 w-full rounded-xl border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
						/>
						{recipientError ? <div className="text-xs text-red-600 mt-1">{recipientError}</div> : null}
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
				<div className="mt-3">
					<Button onClick={onGetDeposit} disabled={depositLoading || swapDisabled || !!recipientError} variant="outline" className="w-full">
						{depositLoading ? "Preparing deposit..." : "Get deposit address"}
					</Button>
					{depositError ? <div className="text-sm text-red-600 mt-2">{depositError}</div> : null}
					{deposit ? (
						<div className="mt-3 rounded-2xl border border-gray-200 p-4 bg-white text-sm text-gray-800 space-y-1.5">
							<div><span className="font-semibold">Deposit address:</span> <span className="break-all">{deposit.depositAddress}</span></div>
							{deposit.memo ? <div><span className="font-semibold">Memo:</span> <span className="break-all">{deposit.memo}</span></div> : null}
							{deposit.deadline ? <div><span className="font-semibold">Deadline:</span> {new Date(deposit.deadline).toLocaleString()}</div> : null}
							{typeof deposit.timeEstimate === "number" ? <div><span className="font-semibold">ETA (s):</span> {deposit.timeEstimate}</div> : null}
							{deposit.quoteId ? <div><span className="font-semibold">Quote ID:</span> {deposit.quoteId}</div> : null}
							<div className="flex gap-2 mt-2">
								<button
									type="button"
									className="text-xs underline text-gray-600 hover:text-gray-900"
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(deposit.depositAddress || "");
										} catch { }
									}}
								>
									Copy address
								</button>
								{deposit.memo ? (
									<button
										type="button"
										className="text-xs underline text-gray-600 hover:text-gray-900"
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(deposit.memo || "");
											} catch { }
										}}
									>
										Copy memo
									</button>
								) : null}
							</div>
						</div>
					) : null}
				</div>
			</div>
		</motion.div>
	);
}


