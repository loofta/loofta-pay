'use client'

import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TokenCombobox } from "@/components/TokenCombobox";
import { Skeleton } from "@/components/ui/skeleton";
import type { NearToken } from "@/services/nearIntents";
import { useEffect, useMemo, useState } from "react";
import { useSwapStore } from "@/store/swap";
import { useQuote } from "@/hooks/useQuote";
import { findTokenBySelection } from "@/lib/tokens";
import { searchTokens, getDepositInfo } from "@/services/nearIntents";
import { getKnownGoodAddressForFamily } from "@/lib/mockAddresses";
import { trimDecimals } from "@/lib/format";
import { TokenIcon } from "@/components/TokenIcon";
import Image from "next/image";
import { getChainIcon } from "@/lib/chains";
import { useToast } from "@/components/ui/use-toast";
import { useIntentStatus } from "@/hooks/useIntentStatus";
import { useAuth } from "@/hooks/useAuth";
import { upsertLocal, upsertRemote } from "@/lib/history";
import { getClientGeo } from "@/lib/geo";

export function NearSwapWidget({
	tokens,
	loadingTokens,
}: {
	tokens: NearToken[];
	loadingTokens: boolean;
}) {
	const { fromSel, toSel, amount, setFromSel, setToSel, setAmount } = useSwapStore();
	const { toast } = useToast();
	const { authenticated, userId } = useAuth();
	const { email } = useAuth();
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
	const swapDisabled = !(amountNum > 0) || !selectedFrom || !selectedTo || !!quoteError || !recipient || !!recipientError || (
		fromSel?.symbol === toSel?.symbol && fromSel?.chain === toSel?.chain
	);
	function flip() {
		const prevFrom = fromSel;
		setFromSel(toSel);
		setToSel(prevFrom);
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
	function inferOriginFamily(originAssetId: string): "ethereum" | "solana" | "near" | "cardano" | "aptos" | "ton" {
		const id = String(originAssetId || "");
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
		minDepositFormatted?: string;
	} | null>(null);
	const [timeLeft, setTimeLeft] = useState<number | null>(null);
	const [expired, setExpired] = useState<boolean>(false);
	const statusQuery = useIntentStatus(deposit?.depositAddress);

	// Validate recipient and clear deposit on input changes; do NOT auto-create deposit
	useEffect(() => {
		const destAssetId = selectedTo?.tokenId || selectedTo?.address || "";
		const destFamily = destAssetId ? inferDestFamily(destAssetId) : "ethereum";
		if (!recipient) {
			setRecipientError(null);
			setDeposit(null);
			setExpired(false);
			setTimeLeft(null);
			setDepositLoading(false);
			return;
		}
		if (!isValidRecipientByFamily(recipient, destFamily)) {
			setRecipientError(`Invalid ${destFamily} address format`);
			setDeposit(null);
			setExpired(false);
			setTimeLeft(null);
			setDepositLoading(false);
			return;
		}
		setRecipientError(null);
		setExpired(false);
		setTimeLeft(null);
	}, [recipient, selectedTo]);

	// Toast when expired
	useEffect(() => {
		if (deposit && expired) {
			toast({
				variant: "destructive",
				title: "Deposit expired",
				description: "This deposit window has expired. If funds were sent, they will be refunded to your origin address.",
			});
		}
	}, [deposit, expired, toast]);

	// Toast on terminal status
	useEffect(() => {
		const s = statusQuery.data?.status;
		if (!deposit || !s) return;
		if (s === "SUCCESS") {
			toast({ title: "Swap completed", description: "Funds were delivered to the destination." });
		}
		if (s === "REFUNDED") {
			toast({ variant: "destructive", title: "Swap refunded", description: "Your deposit was refunded to the origin address." });
		}
		// persist status update
		try {
			upsertLocal({
				id: deposit.depositAddress || "",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				status: s,
			});
			if (authenticated && userId && deposit.depositAddress) {
				upsertRemote(userId, {
					id: deposit.depositAddress,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					status: s,
					userId,
				});
			}
		} catch { }
	}, [statusQuery.data?.status, deposit, toast]);

	async function handleStartTransfer() {
		if (!selectedFrom || !selectedTo || !(amountNum > 0) || !recipient || recipientError) return;
		setDepositLoading(true);
		setDepositError(null);
		setExpired(false);
		try {
			const originAssetId = selectedFrom.tokenId || selectedFrom.address || "";
			const FALLBACK_EVM_REFUND = (process as any)?.env?.NEXT_PUBLIC_FALLBACK_EVM_REFUND || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11";
			const FALLBACK_NEAR_REFUND = (process as any)?.env?.NEXT_PUBLIC_FALLBACK_NEAR_REFUND || "system.near";
			const originFamily = inferOriginFamily(originAssetId);
			const fallbackSender = originFamily === "near" ? FALLBACK_NEAR_REFUND : FALLBACK_EVM_REFUND;
			const info = await getDepositInfo({
				fromToken: selectedFrom,
				toToken: selectedTo,
				amount,
				sender: fallbackSender,
				recipient,
				slippageBps: 100,
			});
			if (!info?.depositAddress) {
				setDepositError("Failed to obtain deposit address");
				setDeposit(null);
			} else {
				setDeposit({
					depositAddress: info.depositAddress,
					memo: info.memo ?? null,
					deadline: info.deadline,
					timeEstimate: info.timeEstimate,
					quoteId: info.quoteId,
					minDepositFormatted: info.minDepositFormatted,
				});
				// Save history (local + remote if logged in)
				try {
					const geo = await getClientGeo();
					upsertLocal({
						id: info.depositAddress,
						createdAt: Date.now(),
						updatedAt: Date.now(),
						status: "PENDING_DEPOSIT",
						fromSymbol: selectedFrom?.symbol,
						fromChain: selectedFrom?.chain,
						toSymbol: selectedTo?.symbol,
						toChain: selectedTo?.chain,
						amount,
						recipient,
						quoteId: info.quoteId,
						deadline: info.deadline,
						userId,
						userEmail: email,
						ip: geo.ip,
						country: geo.country,
						countryCode: geo.countryCode,
					});
					if (authenticated && userId) {
						await upsertRemote(userId, {
							id: info.depositAddress,
							createdAt: Date.now(),
							updatedAt: Date.now(),
							status: "PENDING_DEPOSIT",
							fromSymbol: selectedFrom?.symbol,
							fromChain: selectedFrom?.chain,
							toSymbol: selectedTo?.symbol,
							toChain: selectedTo?.chain,
							amount,
							recipient,
							quoteId: info.quoteId,
							deadline: info.deadline,
							userId,
							userEmail: email,
							ip: geo.ip,
							country: geo.country,
							countryCode: geo.countryCode,
						});
					}
				} catch { }
				if (info.deadline) {
					const end = new Date(info.deadline).getTime();
					const tick = () => {
						const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
						setTimeLeft(diff);
						if (diff === 0) setExpired(true);
					};
					tick();
					const id = setInterval(tick, 1000);
					// @ts-ignore
					window.__depTimer && clearInterval(window.__depTimer);
					// @ts-ignore
					window.__depTimer = id;
				}
			}
		} catch (e: any) {
			setDeposit(null);
			setDepositError(e?.message || "Failed to get deposit address");
		} finally {
			setDepositLoading(false);
		}
	}

	function short(addr?: string) {
		if (!addr) return "";
		if (addr.length <= 12) return addr;
		return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
	}
	function handleCancelDeposit() {
		setDeposit(null);
		setDepositError(null);
		setDepositLoading(false);
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
			<div className="px-5 pt-4">
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
			<div className="px-5 pb-4">
				{deposit ? (
					<div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
						<div className="text-center text-lg font-semibold text-gray-800">Deposit</div>
						{expired ? (
							<div className="mt-3 rounded-md bg-red-50 text-red-700 text-sm p-3 text-center">Deposit window expired. If funds were sent, they will be refunded to your origin address.</div>
						) : null}
						<div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
							<div className="rounded-xl bg-white border border-gray-200 p-3 flex items-center gap-2">
								<TokenIcon token={selectedFrom ?? undefined} chain={selectedFrom?.chain} size={20} />
								<div>
									<div className="text-sm text-gray-600">Asset</div>
									<div className="text-base font-semibold text-gray-900">{selectedFrom?.symbol || "-"}</div>
								</div>
							</div>
							<div className="rounded-xl bg-white border border-gray-200 p-3 flex items-center gap-2">
								{(() => {
									const src = getChainIcon(selectedFrom?.chain);
									return src ? (
										<Image src={src} alt={`${selectedFrom?.chain || "chain"} icon`} width={20} height={20} sizes="20px" unoptimized={/^https?:\/\//.test(src)} />
									) : null;
								})()}
								<div>
									<div className="text-sm text-gray-600">Network</div>
									<div className="text-base font-semibold text-gray-900">{selectedFrom?.chain || "-"}</div>
								</div>
							</div>
						</div>
						<div className="mt-5">
							<div className="text-base font-semibold text-gray-900 text-center">Use this deposit address</div>
							<div className="text-sm text-gray-600 text-center">Always double‑check your deposit address — it may change without notice.</div>
							<div className="mt-4 flex items-center justify-center">
								<img
									src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deposit.depositAddress || "")}`}
									alt="Deposit QR"
									width={200}
									height={200}
									style={{ imageRendering: "pixelated" }}
								/>
							</div>
							<div className="mt-4 flex items-center justify-between text-sm">
								<div className="text-gray-600">Minimum deposit</div>
								<div className="font-semibold text-gray-900">
									{deposit.minDepositFormatted ? `${deposit.minDepositFormatted} ${selectedFrom?.symbol || ""}` : "-"}
								</div>
							</div>
							{(() => {
								const bps = Number((process as any)?.env?.NEXT_PUBLIC_APP_FEE_BPS || "");
								if (!Number.isFinite(bps) || bps <= 0) return null;
								const pct = (bps / 100).toFixed(2);
								const amtNum = Number(amount || "0");
								const feeEst = Number.isFinite(amtNum) ? (amtNum * (bps / 10000)) : undefined;
								return (
									<div className="mt-2 flex items-center justify-between text-sm">
										<div className="text-gray-600">App fee</div>
										<div className="text-gray-900">
											{pct}%{feeEst ? ` • ~${trimDecimals(String(feeEst), 5)} ${selectedFrom?.symbol || ""}` : ""}
										</div>
									</div>
								);
							})()}
							<div className="mt-2">
								<div className="rounded-xl bg-white border border-gray-200 px-3 py-2 flex items-center justify-between">
									<div className="font-mono text-sm text-gray-800">{short(deposit.depositAddress)}</div>
									<button
										type="button"
										className="text-xs underline text-gray-600 hover:text-gray-900"
										onClick={async () => { try { await navigator.clipboard.writeText(deposit.depositAddress || ""); } catch { } }}
									>
										Copy
									</button>
								</div>
							</div>
							<div className="mt-3 rounded-md bg-amber-50 text-amber-800 text-sm p-3 text-center">
								Only deposit {selectedFrom?.symbol} from the {selectedFrom?.chain} network. Depositing other assets or using a different network will result in loss of funds.
							</div>
							<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
								{deposit.deadline ? (
									<div><span className="font-semibold text-gray-900">Deadline:</span> <span className="text-gray-800">{new Date(deposit.deadline).toLocaleString()}</span>{typeof timeLeft === "number" ? <span className="text-gray-500"> ({timeLeft}s left)</span> : null}</div>
								) : null}
								{typeof deposit.timeEstimate === "number" ? (
									<div><span className="font-semibold text-gray-900">ETA (s):</span> <span className="text-gray-800">{deposit.timeEstimate}</span></div>
								) : null}
								{deposit.quoteId ? (
									<div className="col-span-2"><span className="font-semibold text-gray-900">Quote ID:</span> <span className="text-gray-800">{deposit.quoteId}</span></div>
								) : null}
								<div className="col-span-2 flex items-center justify-between">
									<div>
										<span className="font-semibold text-gray-900">Status:</span> <span className="text-gray-800">{statusQuery.data?.status || "PENDING"}</span>
									</div>
									{deposit.depositAddress ? (
										<a
											href={`https://explorer.near-intents.org/transactions/${deposit.depositAddress}`}
											target="_blank"
											rel="noreferrer"
											className="text-xs underline text-gray-600 hover:text-gray-900"
										>
											View on Explorer
										</a>
									) : null}
								</div>
							</div>
							<div className="mt-4 flex justify-end">
								<Button variant="outline" onClick={handleCancelDeposit}>Cancel</Button>
							</div>
						</div>
					</div>
				) : (
					<>
						<div className="mt-3 rounded-2xl bg-gray-50 border border-gray-200 px-3 py-3.5">
							<div className="flex items-center justify-between">
								<div className="text-base font-semibold text-gray-700">Sell</div>
								<div className="w-40">
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
									className="text-3xl md:text-4xl font-semibold border-none bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-auto"
								/>
							</div>
							<div className="mt-3 flex items-center justify_between text-sm">
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
								className="mt-2 mb-2 inline-flex items-center justify-center h-9 w-9 rounded-2xl text-white shadow"
								style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
								aria-label="Flip pair"
							>
								<ArrowUpDown className="h-5 w-5" />
							</button>
						</div>
						<div className="rounded-2xl bg-gray-50 border border-gray-200 px-3 py-3.5">
							<div className="flex items-center justify-between">
								<div className="text-base font-semibold text-gray-700">Buy</div>
								<div className="w-40">
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
								<div className="text-3xl md:text-4xl font-semibold text-gray-900 leading-none">
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
						</div>
						{rate ? (<>
							<AnimatePresence>
								{rate ? (
									<motion.div
										key="send-to"
										initial={{ opacity: 0, y: 8 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: 4 }}
										transition={{ duration: 0.25, ease: "easeOut" }}
										className="rounded-2xl mt-5 bg-gray-50 border border-gray-200 px-3 py-3.5"
									>
										<div className="flex items-center justify-between">
											<div className="text-base font-semibold text-gray-700">Send to</div>
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
										<div className="mt-4 flex justify-end">
											<Button
												type="button"
												onClick={handleStartTransfer}
												disabled={swapDisabled || quoteLoading || depositLoading}
												className="w-full h-11 rounded-2xl text-white font-semibold shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
												style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
											>
												{depositLoading ? "Preparing…" : "Start transfer"}
											</Button>
										</div>
									</motion.div>
								) : null}
							</AnimatePresence>
							{depositError ? <div className="text-sm text-red-600 mt-2">{depositError}</div> : null}
						</>
						) : null}
					</>
				)}
			</div>
		</motion.div>
	);
}


