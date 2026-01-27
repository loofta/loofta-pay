'use client'

import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Shield } from "lucide-react";
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
import { upsertLocal } from "@/lib/history";
import { getClientGeo } from "@/lib/geo";
import { Switch } from "@/components/ui/switch";
import { isValidZcashShielded } from "@/lib/zcash";

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
	const [refundAddress, setRefundAddress] = useState<string>("");
	const [refundAddressError, setRefundAddressError] = useState<string | null>(null);
	const [currentStep, setCurrentStep] = useState<"recipient" | "refund">("recipient");
	const [useShielded, setUseShielded] = useState<boolean>(false);
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
	// Check if same network (cross-chain only)
	const isSameNetwork = fromSel?.chain && toSel?.chain && String(fromSel.chain).toLowerCase() === String(toSel.chain).toLowerCase();
	// Filter out recipient/address-related errors from quoteError for button enablement
	// (recipient validation errors should only block via recipientError, not quoteError)
	const isQuoteError = quoteError && !quoteError.toLowerCase().includes("recipient") && !quoteError.toLowerCase().includes("address");
	const swapDisabled = !(amountNum > 0) || !selectedFrom || !selectedTo || !!isQuoteError || !recipient || !!recipientError || isSameNetwork;
	
	// Reset step when tokens change
	useEffect(() => {
		setCurrentStep("recipient");
		setRefundAddress("");
		setRefundAddressError(null);
	}, [fromSel, toSel]);
	function flip() {
		const prevFrom = fromSel;
		setFromSel(toSel);
		setToSel(prevFrom);
	}
	// Manual deposit: require a valid recipient wallet for destination chain
	function inferFamilyFromChain(chain: string | undefined): "ethereum" | "solana" | "near" | "cardano" | "aptos" | "ton" | "bitcoin" | "sui" | "zcash" | "stellar" | "tron" | "xrp" | "litecoin" | "dogecoin" {
		const c = String(chain || "").toLowerCase();
		const evm = new Set(["eth", "ethereum", "arb", "arbitrum", "base", "op", "optimism", "bsc", "avax", "avalanche", "polygon", "matic", "fantom", "ftm", "gnosis", "linea", "scroll", "zksync", "zk", "blast", "pol"]);
		if (c.includes("sol")) return "solana";
		if (c.includes("ton")) return "ton";
		if (c.includes("near")) return "near";
		if (c.includes("cardano") || c.includes("ada")) return "cardano";
		if (c.includes("aptos")) return "aptos";
		if (c.includes("btc") || c.includes("bitcoin")) return "bitcoin";
		if (c.includes("sui")) return "sui";
		if (c.includes("zec") || c.includes("zcash")) return "zcash";
		if (c.includes("xlm") || c.includes("stellar")) return "stellar";
		if (c.includes("trx") || c.includes("tron")) return "tron";
		if (c.includes("xrp") || c.includes("xrpl") || c.includes("xrpledger")) return "xrp";
		if (c.includes("ltc") || c.includes("litecoin")) return "litecoin";
		if (c.includes("doge") || c.includes("dogecoin")) return "dogecoin";
		if (evm.has(c)) return "ethereum";
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
		if (fam === "bitcoin") {
			if (/^bc1[0-9a-zA-Z]{20,90}$/.test(v)) return true;
			if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v)) return true;
			return false;
		}
		if (fam === "sui") return /^0x[0-9a-fA-F]{64}$/.test(v);
		if (fam === "zcash") return /^t1[0-9A-Za-z]{33}$/.test(v);
		if (fam === "stellar") return /^G[2-7A-Z]{55}$/.test(v);
		if (fam === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);
		if (fam === "xrp") return /^r[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(v);
		if (fam === "litecoin") {
			if (/^ltc1[0-9a-z]{20,90}$/.test(v)) return true;
			if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(v)) return true;
			return false;
		}
		if (fam === "dogecoin") return /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(v);
		return false;
	}
	// Validate refund address based on origin chain family
	function validateRefundAddress(addr: string, originFamily: string): boolean {
		return isValidRecipientByFamily(addr, originFamily);
	}
	// Reset shielded toggle if destination stops being ZEC
	useEffect(() => {
		const isZec = (selectedTo?.symbol || "").toUpperCase() === "ZEC" || inferFamilyFromChain(selectedTo?.chain) === "zcash";
		if (!isZec && useShielded) {
			setUseShielded(false);
		}
	}, [selectedTo, useShielded]);
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
	const [speedUpOpen, setSpeedUpOpen] = useState(false);
	const [speedUpTx, setSpeedUpTx] = useState("");
	const [speedUpLoading, setSpeedUpLoading] = useState(false);
	const statusQuery = useIntentStatus(deposit?.depositAddress);
	const currentStatus = statusQuery.data?.status;
	const isSuccess = currentStatus === "SUCCESS";

	// Validate recipient and clear deposit on input changes; do NOT auto-create deposit
	useEffect(() => {
		// Always clear error if no destination token is selected OR recipient is empty
		if (!selectedTo || !recipient || recipient.trim() === "") {
			setRecipientError(null);
			setDeposit(null);
			setExpired(false);
			setTimeLeft(null);
			setDepositLoading(false);
			return;
		}
		
		const destFamily = inferFamilyFromChain(selectedTo?.chain);
		const trimmedRecipient = recipient.trim();
		
		// Special case: ZEC shielded toggle requires shielded formats
		const isZecDest = destFamily === "zcash" && ((selectedTo?.symbol || "").toUpperCase() === "ZEC");
		if (isZecDest && useShielded) {
			if (!isValidZcashShielded(trimmedRecipient)) {
				setRecipientError("Invalid zcash shielded address format");
				setDeposit(null);
				setExpired(false);
				setTimeLeft(null);
				setDepositLoading(false);
				return;
			}
		} else {
			if (!isValidRecipientByFamily(trimmedRecipient, destFamily)) {
				setRecipientError(`Invalid ${destFamily} address format`);
				setDeposit(null);
				setExpired(false);
				setTimeLeft(null);
				setDepositLoading(false);
				return;
			}
		}
		setRecipientError(null);
		setExpired(false);
		setTimeLeft(null);
	}, [recipient, selectedTo, useShielded]);

	// Validate refund address
	useEffect(() => {
		if (!selectedFrom || !refundAddress || refundAddress.trim() === "") {
			setRefundAddressError(null);
			return;
		}
		const originFamily = inferFamilyFromChain(selectedFrom?.chain);
		const trimmedRefund = refundAddress.trim();
		if (!validateRefundAddress(trimmedRefund, originFamily)) {
			setRefundAddressError(`Invalid ${originFamily} address format`);
		} else {
			setRefundAddressError(null);
		}
	}, [refundAddress, selectedFrom]);

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
			// remote disabled
		} catch { }
	}, [statusQuery.data?.status, deposit, toast]);

	async function handleSpeedUp() {
		if (!speedUpTx.trim() || !deposit?.depositAddress) return;
		setSpeedUpLoading(true);
		try {
			// Submit tx hash to Near Intents for faster processing
			const resp = await fetch("https://1click.chaindefuser.com/v0/submit-deposit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ 
					txHash: speedUpTx.trim(),
					depositAddress: deposit.depositAddress,
					...(deposit.quoteId ? { quoteId: deposit.quoteId } : {}),
				}),
			});
			if (!resp.ok) {
				const errorData = await resp.json().catch(() => ({}));
				throw new Error(errorData?.error || errorData?.message || "Failed to submit transaction");
			}
			toast({
				title: "Transaction submitted",
				description: "Your deposit is being processed. Check the status in a few moments.",
			});
			setSpeedUpOpen(false);
			setSpeedUpTx("");
		} catch (e: any) {
			toast({
				variant: "destructive",
				title: "Speed up failed",
				description: e?.message || "Failed to submit transaction",
			});
		} finally {
			setSpeedUpLoading(false);
		}
	}

	async function handleStartTransfer() {
		if (!selectedFrom || !selectedTo || !(amountNum > 0) || !recipient || recipientError) return;
		
		// If on recipient step and recipient is valid, move to refund step
		if (currentStep === "recipient") {
			setCurrentStep("refund");
			return;
		}
		
		// If on refund step, validate and create deposit
		if (currentStep === "refund") {
			if (!refundAddress || refundAddress.trim() === "") {
				setRefundAddressError("Refund address is required");
				toast({
					variant: "destructive",
					title: "Refund address required",
					description: "Please enter a refund address where funds will be returned if the swap fails.",
				});
				return;
			}
			if (refundAddressError) {
				toast({
					variant: "destructive",
					title: "Invalid refund address",
					description: refundAddressError,
				});
				return;
			}
		}
		
		setDepositLoading(true);
		setDepositError(null);
		setExpired(false);
		try {
			const FALLBACK_EVM_REFUND = (process as any)?.env?.NEXT_PUBLIC_FALLBACK_EVM_REFUND || "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11";
			const FALLBACK_NEAR_REFUND = (process as any)?.env?.NEXT_PUBLIC_FALLBACK_NEAR_REFUND || "system.near";
			const originFamily = inferFamilyFromChain(selectedFrom?.chain);
			const fallbackSender = originFamily === "near" ? FALLBACK_NEAR_REFUND : FALLBACK_EVM_REFUND;
			const info = await getDepositInfo({
				fromToken: selectedFrom,
				toToken: selectedTo,
				amount,
				sender: fallbackSender,
				recipient,
				refundAddress: refundAddress.trim(),
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
					// remote disabled
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
			const rawMsg = (e?.message || "").toLowerCase();
			// Simplify "amount too low" messages
			let errorMsg: string;
			if (rawMsg.includes("amount") && rawMsg.includes("too low")) {
				errorMsg = "Amount is too low";
			} else {
				errorMsg = e?.message || "Failed to get deposit address";
			}
			setDepositError(errorMsg);
			toast({
				variant: "destructive",
				title: "Transfer failed",
				description: errorMsg,
			});
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

	function formatRemaining(seconds?: number | null): string {
		if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
		const total = Math.max(0, Math.floor(seconds));
		const d = Math.floor(total / 86400);
		const h = Math.floor((total % 86400) / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		if (m > 0) return `${m}m ${s}s`;
		return `${s}s`;
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
				{isSameNetwork && (
					<div className="mb-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3 flex items-center gap-2">
						<svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
							<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
						</svg>
						<span><strong>Cross-chain only:</strong> Sell and Buy tokens must be on different networks. Select a different chain for one of them.</span>
					</div>
				)}
				{deposit ? (
					<div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
						<div className="text-center text-lg font-semibold text-gray-800">{isSuccess ? "Swap completed" : "Deposit"}</div>
						{!isSuccess && expired ? (
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
									<div className="text-base font-semibold uppercase text-gray-900">{selectedFrom?.chain || "-"}</div>
								</div>
							</div>
						</div>
						{isSuccess ? (
							<div className="mt-5 space-y-3">
								<div className="text-center text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">Funds were delivered to the destination.</div>
								<div className="text-sm text-gray-800">
									<span className="font-semibold">Recipient:</span> {recipient ? short(recipient) : "—"}
								</div>
								<div className="grid grid-cols-2 gap-3 text-sm">
									{deposit.quoteId ? (
										<div className="col-span-2"><span className="font-semibold text-gray-900">Quote ID:</span> <span className="text-gray-800">{deposit.quoteId}</span></div>
									) : null}
									<div className="col-span-2 flex items-center justify-between">
										<div>
											<span className="font-semibold text-gray-900">Status:</span> <span className="text-gray-800">SUCCESS</span>
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
									<Button variant="outline" onClick={handleCancelDeposit}>Close</Button>
								</div>
							</div>
						) : (
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
									if (!Number.isFinite(bps) || bps < 0) return null;
									if (bps === 0) {
										return (
											<div className="mt-2 flex items-center justify-between text-sm">
												<div className="text-gray-600">App fee</div>
												<div className="inline-flex items-center gap-2">
													<span
														className="px-2 py-0.5 rounded-md text-xs font-semibold text-white shadow-sm"
														style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
													>
														FREE
													</span>
												</div>
											</div>
										);
									}
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
											onClick={async () => {
												try {
													await navigator.clipboard.writeText(deposit.depositAddress || "");
													toast({ title: "Copied", description: "Deposit address copied to clipboard." });
												} catch {
													toast({ variant: "destructive", title: "Copy failed", description: "Could not copy address. Please try again." });
												}
											}}
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
										<div><span className="font-semibold text-gray-900">Deadline:</span> <span className="text-gray-800">{new Date(deposit.deadline).toLocaleString()}</span>{typeof timeLeft === "number" ? <span className="text-gray-500"> ({formatRemaining(timeLeft)} left)</span> : null}</div>
									) : null}
									{typeof deposit.timeEstimate === "number" ? (
										<div className="text-right"><span className="font-semibold text-gray-900">ETA:</span> <span className="text-gray-800">{formatRemaining(deposit.timeEstimate)}</span></div>
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
								<div className="mt-4 flex items-center justify-between">
									<div>
										{!speedUpOpen && (
											<button
												type="button"
												onClick={() => setSpeedUpOpen(true)}
												className="text-sm text-orange-600 hover:text-orange-700 underline"
											>
												Already deposited? Speed up processing
											</button>
										)}
									</div>
									<Button variant="outline" onClick={handleCancelDeposit}>Cancel</Button>
								</div>

								{/* Speed Up Form */}
								{speedUpOpen && (
									<div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
										<div className="text-sm font-semibold text-gray-900 mb-1">Speed up processing</div>
										<div className="text-xs text-gray-600 mb-3">
											If you've already deposited, enter your transaction hash to speed up processing.
										</div>
										<Input
											placeholder="Enter transaction hash"
											value={speedUpTx}
											onChange={(e) => setSpeedUpTx(e.target.value)}
											className="text-sm mb-3"
										/>
										<div className="flex items-center gap-2">
											<Button
												size="sm"
												onClick={handleSpeedUp}
												disabled={!speedUpTx.trim() || speedUpLoading}
												style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
												className="text-white"
											>
												{speedUpLoading ? "Submitting..." : "Submit"}
											</Button>
											<Button
												size="sm"
												variant="outline"
												onClick={() => { setSpeedUpOpen(false); setSpeedUpTx(""); }}
											>
												Cancel
											</Button>
										</div>
									</div>
								)}
							</div>
						)}
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
									onClick={() => {
										const n = Number(amount || 0);
										if (!n) return;
										setAmount((n * 0.25).toString());
									}}
									className="rounded-xl border mx-2 border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-100"
								>
									25%
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
								{quoteError && !quoteError.toLowerCase().includes("recipient") && !quoteError.toLowerCase().includes("address") ? (
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
										{/* ZEC shielded toggle */}
										{(() => {
											const isZec = ((selectedTo?.symbol || "").toUpperCase() === "ZEC") || inferFamilyFromChain(selectedTo?.chain) === "zcash";
											if (!isZec) return null;
											return (
												<div className="mt-3 flex items-center justify-between">
													<div className="flex items-center gap-2">
														<Shield className="h-4 w-4 text-emerald-600" />
														<div className="text-sm text-gray-800 font-semibold">Private payment (shielded)</div>
													</div>
													<Switch checked={useShielded} onCheckedChange={setUseShielded} aria-label="Private payment (shielded)" />
												</div>
											);
										})()}
										{(() => {
											const isZec = ((selectedTo?.symbol || "").toUpperCase() === "ZEC") || inferFamilyFromChain(selectedTo?.chain) === "zcash";
											if (!isZec) return null;
											return (
												<div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs px-3 py-2">
													<div className="font-medium">Privacy tip</div>
													<div>Payment will only be private if you use a shielded address as the recipient.</div>
												</div>
											);
										})()}
										{/* Manual recipient input */}
										<div className="mt-4">
											<label className="text-sm font-medium text-gray-700">
												{(() => {
													const isZec = ((selectedTo?.symbol || "").toUpperCase() === "ZEC") || inferFamilyFromChain(selectedTo?.chain) === "zcash";
													return isZec && useShielded ? "Recipient shielded address" : "Recipient address";
												})()}
											</label>
											<input
												type="text"
												value={recipient}
												onChange={(e) => setRecipient(e.target.value)}
												placeholder={(() => {
													const isZec = ((selectedTo?.symbol || "").toUpperCase() === "ZEC") || inferFamilyFromChain(selectedTo?.chain) === "zcash";
													if (isZec && useShielded) {
														return "Enter Zcash shielded address (Unified or Sapling)";
													}
													return "Enter destination wallet address";
												})()}
												className="mt-1 w-full rounded-xl border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
											/>
											{recipientError ? <div className="text-xs text-red-600 mt-1">{recipientError}</div> : null}
										</div>
										{/* Refund Address Step */}
										{currentStep === "refund" && (
											<div className="mt-4">
												<label className="text-sm font-medium text-gray-700">
													Refund Address ({inferFamilyFromChain(selectedFrom?.chain).toUpperCase()}) *
												</label>
												<p className="text-xs text-gray-500 mt-1 mb-2">
													Funds will be refunded to this address if the swap fails or expires
												</p>
												<input
													type="text"
													value={refundAddress}
													onChange={(e) => {
														setRefundAddress(e.target.value);
														setRefundAddressError(null);
													}}
													placeholder={`Enter your ${inferFamilyFromChain(selectedFrom?.chain).toUpperCase()} refund address`}
													className="mt-1 w-full rounded-xl border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
													autoFocus
												/>
												{refundAddressError ? <div className="text-xs text-red-600 mt-1">{refundAddressError}</div> : null}
											</div>
										)}
										<div className="mt-4 flex justify-end gap-2">
											{currentStep === "refund" && (
												<Button
													type="button"
													variant="outline"
													onClick={() => setCurrentStep("recipient")}
													className="flex-1 h-11 rounded-2xl border-gray-300"
												>
													Back
												</Button>
											)}
											<Button
												type="button"
												onClick={handleStartTransfer}
												disabled={
													currentStep === "recipient" 
														? (swapDisabled || quoteLoading || depositLoading)
														: (!refundAddress || !!refundAddressError || depositLoading)
												}
												className={`${currentStep === "refund" ? "flex-1" : "w-full"} h-11 rounded-2xl text-white font-semibold shadow-md disabled:opacity-60 disabled:cursor-not-allowed`}
												style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
											>
												{depositLoading ? "Preparing…" : currentStep === "recipient" ? "Continue" : "Start transfer"}
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


