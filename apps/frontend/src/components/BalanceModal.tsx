"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenIcon } from "@/components/TokenIcon";
import { findTokenBySelection } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { TokenCombobox } from "@/components/TokenCombobox";
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink, Copy, ArrowRight } from "lucide-react";
import { usePrivy, useDepositAddress } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction, useFundWallet, useSolanaFundingPlugin } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { sendUsdcWithPrivyEmbeddedWallet } from "@/services/privyEmbeddedUsdcSend";
import { getDepositInfo, getAccurateQuote, getExecutionStatus } from "@/services/nearIntents";
import type { NearToken } from "@/services/nearIntents";
import { isValidAddressForChain } from "@/lib/refundAddresses";
import {
  addWithdrawal,
  getWithdrawalHistory,
  updateWithdrawalStatus,
  type WithdrawalHistoryItem,
} from "@/lib/withdrawalHistory";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { cn } from "@/lib/utils";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";

const LOG_PREFIX = "[BalanceModal]";

// BETA: flip to false to re-enable Near Intents cross-chain withdrawals
const BETA_SOLANA_ONLY = true;

type WithdrawalStep = "idle" | "submitting" | "sent" | "bridging" | "complete" | "failed";

const TERMINAL_BRIDGE_STATUSES = new Set(["SUCCESS", "COMPLETED", "REFUNDED", "FAILED", "EXPIRED"]);
const SUCCESS_BRIDGE_STATUSES = new Set(["SUCCESS", "COMPLETED"]);

function stepLabel(step: WithdrawalStep, isNearIntents: boolean): string {
  if (step === "submitting") return isNearIntents ? "Getting bridge quote…" : "Building transaction…";
  if (step === "sent") return "Sending USDC…";
  if (step === "bridging") return "Bridge routing…";
  if (step === "complete") return isNearIntents ? "Bridge complete!" : "Sent!";
  if (step === "failed") return "Transaction failed";
  return "";
}

function bridgeStatusLabel(status: string | null | undefined): string {
  if (!status) return "Waiting for bridge…";
  const s = status.toUpperCase();
  if (s === "PENDING") return "Bridge received deposit, processing…";
  if (s === "PROCESSING") return "Bridge is routing to destination…";
  if (s === "SUCCESS" || s === "COMPLETED") return "Bridge complete!";
  if (s === "REFUNDED") return "Bridge refunded — check your Solana wallet";
  if (s === "FAILED") return "Bridge failed";
  if (s === "EXPIRED") return "Bridge quote expired — funds refunded";
  return status;
}

interface ProgressStepsProps {
  step: WithdrawalStep;
  isNearIntents: boolean;
  txSignature?: string;
  bridgeStatus?: string | null;
  destinationToken?: string;
  destinationChain?: string;
  estimatedOut?: string;
  amountUSDC?: number;
  dark: boolean;
  onDone: () => void;
}

function ProgressSteps({
  step,
  isNearIntents,
  txSignature,
  bridgeStatus,
  destinationToken,
  destinationChain,
  estimatedOut,
  amountUSDC,
  dark,
  onDone,
}: ProgressStepsProps) {
  const isDone = step === "complete" || step === "failed";
  const isSuccess = step === "complete";

  type StepDef = { label: string; sublabel?: string; status: "done" | "active" | "pending" | "failed" };

  const steps: StepDef[] = useMemo(() => {
    if (isNearIntents) {
      const s1Status =
        step === "submitting" ? "active" :
          ["sent", "bridging", "complete", "failed"].includes(step) ? "done" : "pending";
      const s2Status =
        step === "sent" ? "active" :
          ["bridging", "complete", "failed"].includes(step) ? "done" : "pending";
      const s3Status =
        step === "bridging" ? "active" :
          step === "complete" ? "done" :
            step === "failed" ? "failed" : "pending";
      return [
        { label: "Get bridge quote", sublabel: "Calculating best route via Near Intents", status: s1Status },
        { label: "Send USDC", sublabel: amountUSDC ? `Sending $${amountUSDC.toFixed(2)} USDC to bridge` : "Sending USDC to bridge", status: s2Status },
        {
          label: step === "complete" ? "Bridge complete" : step === "failed" ? "Bridge failed" : "Bridge routing",
          sublabel: bridgeStatusLabel(bridgeStatus),
          status: s3Status,
        },
      ];
    }
    const s1Status = step === "submitting" ? "active" : ["sent", "complete"].includes(step) ? "done" : "pending";
    const s2Status = step === "sent" ? "active" : step === "complete" ? "done" : "pending";
    return [
      { label: "Build transaction", sublabel: "Preparing USDC transfer", status: s1Status },
      { label: "Send USDC", sublabel: amountUSDC ? `Sending $${amountUSDC.toFixed(2)} USDC to destination` : "Sending to destination", status: s2Status },
    ];
  }, [step, isNearIntents, bridgeStatus, amountUSDC]);

  const textBase = dark ? "text-white" : "text-gray-900";
  const textSub = dark ? "text-slate-400" : "text-gray-500";
  const borderBase = dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white";

  return (
    <div className="py-2 space-y-4">
      {/* Step list */}
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className={`flex items-start gap-3 rounded-xl border p-3 ${borderBase}`}>
            <div className="mt-0.5 shrink-0 w-6 h-6 flex items-center justify-center">
              {s.status === "done" && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
              {s.status === "active" && <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />}
              {s.status === "failed" && <AlertTriangle className="h-5 w-5 text-red-400" />}
              {s.status === "pending" && (
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-sm md:text-xs font-bold ${dark ? "border-white/20 text-slate-500" : "border-gray-300 text-gray-400"}`}>
                  {i + 1}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-base md:text-sm font-medium ${textBase}`}>{s.label}</p>
              {s.sublabel && <p className={`text-base md:text-sm mt-0.5 ${textSub}`}>{s.sublabel}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Estimate / result */}
      {isNearIntents && estimatedOut && destinationToken && destinationChain && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${borderBase}`}>
          <ArrowRight className={`h-4 w-4 shrink-0 ${dark ? "text-slate-400" : "text-gray-400"}`} />
          <div>
            <p className={`text-base md:text-sm ${textSub}`}>You receive (estimated)</p>
            <p className={`text-base md:text-sm font-semibold ${textBase}`}>
              ~{Number(estimatedOut).toLocaleString(undefined, { maximumFractionDigits: 6 })} {destinationToken}
              <span className={`font-normal ml-1 ${textSub}`}>on {destinationChain}</span>
            </p>
          </div>
        </div>
      )}

      {/* Solana TX link */}
      {txSignature && (
        <a
          href={getExplorerTxUrl("solana", txSignature)}
          target="_blank"
          rel="noreferrer"
          className={`flex items-center gap-2 text-base md:text-sm rounded-lg border px-3 py-2 transition-colors ${dark ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          View Solana transaction
        </a>
      )}

      {/* Done / retry buttons */}
      {isDone && (
        <Button
          onClick={onDone}
          className={cn(
            "w-full",
            isSuccess
              ? "bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white"
              : "bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white"
          )}
        >
          {isSuccess ? "Done" : "Close"}
        </Button>
      )}
    </div>
  );
}

function shortAddr(addr: string, h = 6, t = 4) {
  return addr.length > h + t ? `${addr.slice(0, h)}…${addr.slice(-t)}` : addr;
}

export interface BalanceModalProps {
  open: boolean;
  onClose: () => void;
  balanceUSD: string;
  /** Precise balance number (unrounded). Used for withdrawal amount; balanceUSD is display-only. */
  balanceExact?: number;
  loadingBalance: boolean;
  solanaAddress: string | null;
  onRefresh: () => void;
  dark?: boolean;
  devnetMode?: boolean;
}

export function BalanceModal({
  open,
  onClose,
  balanceUSD,
  balanceExact,
  loadingBalance,
  solanaAddress,
  onRefresh,
  dark = false,
  devnetMode = false,
}: BalanceModalProps) {
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();

  const [tab, setTab] = useState<"topup" | "withdraw" | "history">("topup");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [addressRiskStatus, setAddressRiskStatus] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");
  const [recentWithdrawals, setRecentWithdrawals] = useState<WithdrawalHistoryItem[]>([]);

  // Quote estimation for cross-chain
  const [quoteAmount, setQuoteAmount] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false); // eslint-disable-line @typescript-eslint/no-unused-vars

  // Withdrawal progress tracking
  const [withdrawStep, setWithdrawStep] = useState<WithdrawalStep>("idle");
  const [activeWithdrawal, setActiveWithdrawal] = useState<WithdrawalHistoryItem | null>(null);
  const [depositAddressForPolling, setDepositAddressForPolling] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null);

  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [bankLoading, setBankLoading] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { user, getAccessToken } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  useSolanaFundingPlugin();
  const { fundWallet } = useFundWallet();
  const { createDepositAddress } = useDepositAddress();
  const mode = devnetMode ? "devnet" : "mainnet";
  const solanaChain = getPrivySolanaChainForMode(mode);
  const solanaDestChain = mode === "mainnet"
    ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  const usdcMint = mode === "mainnet"
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

  // Direct Solana USDC receive — opens Privy's QR/address screen, no cross-chain routing
  const handleReceiveUsdc = async () => {
    if (!solanaAddress) return;
    setReceiveLoading(true);
    try {
      await fundWallet({ address: solanaAddress, options: { chain: solanaChain, asset: "USDC", defaultFundingMethod: "manual" } });
      onRefresh();
    } finally {
      setReceiveLoading(false);
    }
  };

  // Cross-chain deposit — opens Privy's token/network picker (EVM → Solana via Relay)
  const handleCrossChainDeposit = async () => {
    if (!solanaAddress) return;
    setCryptoLoading(true);
    try {
      await createDepositAddress({
        destinationChain: solanaDestChain,
        destinationCurrency: usdcMint,
        destinationAddress: solanaAddress,
      });
      onRefresh();
    } finally {
      setCryptoLoading(false);
    }
  };

  const handleBankDeposit = async () => {
    if (!solanaAddress) return;
    setBankLoading(true);
    try {
      await fundWallet({ address: solanaAddress, options: { chain: solanaChain, asset: "USDC", defaultFundingMethod: "card" } });
      onRefresh();
    } finally {
      setBankLoading(false);
    }
  };

  const wallet = useMemo(
    () => (solanaAddress ? solanaWallets?.find((w) => w.address === solanaAddress) : undefined),
    [solanaAddress, solanaWallets]
  );

  const usdcSolanaToken = useMemo(
    () =>
      tokens.find(
        (t) =>
          t.symbol?.toUpperCase() === "USDC" &&
          (t.chain?.toLowerCase() === "solana" || t.chain?.toLowerCase() === "sol")
      ),
    [tokens]
  );

  const withdrawTokens = useMemo(() => {
    const solLower = (c: string | undefined) => (c || "").toLowerCase() === "solana" || (c || "").toLowerCase() === "sol";
    const usdcSol = usdcSolanaToken ? [usdcSolanaToken] : [];
    const otherChains = tokens.filter((t) => !solLower(t.chain));
    return [...usdcSol, ...otherChains];
  }, [tokens, usdcSolanaToken]);

  const selectedFrom = useMemo(
    () => findTokenBySelection(withdrawTokens, fromSel ?? (usdcSolanaToken ? { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain } : undefined)),
    [withdrawTokens, fromSel, usdcSolanaToken]
  );

  const effectiveToken = selectedFrom || usdcSolanaToken;
  const isUSDCOnSolana =
    effectiveToken?.symbol === "USDC" &&
    (effectiveToken?.chain === "solana" || effectiveToken?.chain === "sol");
  const payFromBalanceNum = parseFloat(balanceUSD) || 0; // display only
  // Exact spendable balance truncated to USDC precision (6 dp) — never rounds up
  const spendableBalance = Math.floor((balanceExact ?? payFromBalanceNum) * 1_000_000) / 1_000_000;
  const destChain = effectiveToken?.chain || "";
  const isNearIntentsWithdraw = !BETA_SOLANA_ONLY && !isUSDCOnSolana && effectiveToken && usdcSolanaToken;
  const destinationAddressValid = isValidAddressForChain(withdrawAddress, isUSDCOnSolana ? "solana" : destChain);

  // On open: load history and resume any in-progress Near Intents withdrawal
  useEffect(() => {
    if (!open) return;
    const history = getWithdrawalHistory();
    setRecentWithdrawals(history);

    const latest = history[0];
    if (
      latest &&
      latest.isNearIntents &&
      !latest.nearIntentsComplete &&
      latest.depositAddress
    ) {
      setActiveWithdrawal(latest);
      setBridgeStatus(latest.nearIntentsStatus ?? null);
      setWithdrawStep("bridging");
      setDepositAddressForPolling(latest.depositAddress);
    } else {
      // Clean state for fresh form
      if (withdrawStep === "idle") return;
      setWithdrawStep("idle");
      setActiveWithdrawal(null);
      setDepositAddressForPolling(null);
      setBridgeStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Near Intents polling via interval (mirrors useIntentStatus logic but imperative)
  useEffect(() => {
    if (!depositAddressForPolling || withdrawStep !== "bridging") {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await getExecutionStatus(depositAddressForPolling);
        if (cancelled) return;
        const raw = result?.status || result?.executionStatus || result?.state || "PENDING";
        const s = String(raw).toUpperCase();
        setBridgeStatus(s);

        // Persist latest status to localStorage
        if (activeWithdrawal) {
          updateWithdrawalStatus(activeWithdrawal.id, s, SUCCESS_BRIDGE_STATUSES.has(s));
          // Also update DB (fire-and-forget)
          getAccessToken().then((token) => {
            if (!token || !activeWithdrawal) return;
            fetch(`/api/withdrawals`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ id: activeWithdrawal.id, nearIntentsStatus: s, nearIntentsComplete: SUCCESS_BRIDGE_STATUSES.has(s) }),
            }).catch(() => { });
          });

          if (SUCCESS_BRIDGE_STATUSES.has(s)) {
            if (!cancelled) {
              setWithdrawStep("complete");
              setDepositAddressForPolling(null);
              onRefresh();
            }
          } else if (TERMINAL_BRIDGE_STATUSES.has(s)) {
            if (!cancelled) {
              setWithdrawStep("failed");
              setDepositAddressForPolling(null);
            }
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositAddressForPolling, withdrawStep]);

  // Initialise amount to full spendable balance when modal opens or balance changes
  useEffect(() => {
    if (open && spendableBalance > 0) setWithdrawAmount(spendableBalance.toFixed(6).replace(/\.?0+$/, ""));
  }, [open, spendableBalance]);

  const withdrawAmountNum = parseFloat(withdrawAmount) || 0;

  // Quote estimation for cross-chain withdrawals (re-runs when amount changes)
  useEffect(() => {
    if (!isNearIntentsWithdraw || !usdcSolanaToken || !effectiveToken || !withdrawAmountNum) {
      setQuoteAmount(null);
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await getAccurateQuote({
          fromToken: usdcSolanaToken as NearToken,
          toToken: effectiveToken as NearToken,
          amount: withdrawAmountNum.toString(),
          slippageBps: 100,
          dryRun: true,
        });
        if (!cancelled && r.amountOut) setQuoteAmount(r.amountOut);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isNearIntentsWithdraw, effectiveToken?.tokenId, withdrawAmountNum, usdcSolanaToken]);

  // Address risk check for direct Solana withdrawals
  const checkAddressRisk = useCallback(async (address: string): Promise<{ safe: boolean }> => {
    const res = await fetch(`/api/risk/address?address=${encodeURIComponent(address)}&network=solana`);
    const data = await res.json().catch(() => ({}));
    return { safe: data.safe !== false };
  }, []);

  useEffect(() => {
    if (!isUSDCOnSolana) { setAddressRiskStatus("idle"); return; }
    const raw = withdrawAddress.trim();
    if (!raw || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) { setAddressRiskStatus("idle"); return; }
    setAddressRiskStatus("checking");
    const t = setTimeout(async () => {
      const { safe } = await checkAddressRisk(raw);
      setAddressRiskStatus(safe ? "safe" : "unsafe");
    }, 500);
    return () => clearTimeout(t);
  }, [withdrawAddress, checkAddressRisk, isUSDCOnSolana]);

  const saveWithdrawalToDB = useCallback(async (item: WithdrawalHistoryItem) => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...item, isDevnet: devnetMode }),
      });
    } catch {
      // non-fatal
    }
  }, [getAccessToken, devnetMode]);

  const handleWithdraw = async () => {
    const rawAddress = withdrawAddress.trim();
    const amount = withdrawAmountNum;

    if (!(amount >= 1)) {
      toast({ variant: "destructive", title: "Minimum $1", description: "Minimum withdrawal is $1.00 USDC." });
      return;
    }
    if (amount > spendableBalance) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `You have ${spendableBalance.toFixed(6).replace(/\.?0+$/, "")} USDC available.` });
      return;
    }
    if (!solanaAddress || !wallet) {
      toast({ variant: "destructive", title: "Wallet not ready", description: "Your Loofta wallet is not available. Try refreshing or logging out and back in." });
      return;
    }

    if (isUSDCOnSolana) {
      if (!rawAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawAddress)) {
        toast({ variant: "destructive", title: "Invalid address", description: "Enter a valid Solana wallet address." });
        return;
      }
      if (addressRiskStatus !== "safe") {
        toast({ variant: "destructive", title: "Address not approved", description: "Withdrawals are only allowed to addresses that pass our compliance check." });
        return;
      }
    } else {
      if (!rawAddress || !destinationAddressValid) {
        toast({ variant: "destructive", title: "Invalid address", description: `Enter a valid ${destChain || "destination"} address.` });
        return;
      }
      if (!usdcSolanaToken || !effectiveToken) {
        toast({ variant: "destructive", title: "Invalid token", description: "Select a token to withdraw to." });
        return;
      }
    }

    setWithdrawing(true);
    setWithdrawStep("submitting");

    try {
      const mode = devnetMode ? "devnet" : "mainnet";
      const connection = new Connection(getRpcForMode(mode), "confirmed");
      let recipientAddress: string;
      let memo: string | null = null;
      let depositAddr: string | undefined;

      if (isNearIntentsWithdraw && usdcSolanaToken && effectiveToken) {
        const depositInfo = await getDepositInfo({
          fromToken: usdcSolanaToken as NearToken,
          toToken: effectiveToken as NearToken,
          amount: amount.toString(),
          recipient: rawAddress,
          sender: solanaAddress,
          refundAddress: solanaAddress,
          slippageBps: 100,
        });
        recipientAddress = depositInfo.depositAddress ?? "";
        memo = depositInfo.memo ?? null;
        depositAddr = recipientAddress;

        if (!recipientAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipientAddress)) {
          throw new Error("Invalid deposit address from Near Intents. Please try again.");
        }
      } else {
        recipientAddress = rawAddress;
      }

      setWithdrawStep("sent");

      const sig = await sendUsdcWithPrivyEmbeddedWallet({
        senderAddress: solanaAddress,
        recipientAddress,
        amountUSDC: amount,
        connection,
        wallet,
        privyUserId: user?.id,
        signAndSendTransaction,
        memo: memo ?? undefined,
        usdcMint: getUsdcMintForMode(mode),
        chain: getPrivySolanaChainForMode(mode),
      });

      // Save to localStorage and DB
      const item = addWithdrawal({
        id: sig,
        amountUSDC: amount,
        txSignature: sig,
        destinationAddress: rawAddress,
        destinationChain: isNearIntentsWithdraw ? (effectiveToken?.chain ?? "solana") : "solana",
        destinationToken: isNearIntentsWithdraw ? (effectiveToken?.symbol ?? "USDC") : "USDC",
        isNearIntents: Boolean(isNearIntentsWithdraw),
        depositAddress: depositAddr,
        estimatedOut: quoteAmount ?? undefined,
        nearIntentsStatus: isNearIntentsWithdraw ? "PENDING" : undefined,
        nearIntentsComplete: !isNearIntentsWithdraw,
      });
      setActiveWithdrawal(item);
      setRecentWithdrawals(getWithdrawalHistory());
      saveWithdrawalToDB(item);

      setWithdrawAddress("");
      setAddressRiskStatus("idle");

      if (isNearIntentsWithdraw && depositAddr) {
        setWithdrawStep("bridging");
        setDepositAddressForPolling(depositAddr);
        setBridgeStatus("PENDING");
      } else {
        setWithdrawStep("complete");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Withdraw error`, { message: msg });
      setWithdrawStep("failed");
      if (msg.includes("user rejected") || msg.includes("denied") || msg.includes("User denied")) {
        toast({ variant: "destructive", title: "Cancelled", description: "You cancelled the transaction." });
      } else if (msg.includes("insufficient") || msg.includes("Insufficient")) {
        toast({ variant: "destructive", title: "Insufficient balance", description: "Not enough USDC." });
      } else {
        toast({ variant: "destructive", title: "Withdrawal failed", description: msg || "Please try again." });
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const contentCls = dark
    ? "sm:max-w-lg border-white/10 bg-[#0f0f12] text-white [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.text-gray-400]:!text-slate-500 [&_.bg-gray-100]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.bg-white]:!bg-white/10 [&_.border-gray-200]:!border-white/10 [&_.border-gray-300]:!border-white/20 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&>button]:!text-slate-400 [&>button:hover]:!text-white"
    : "sm:max-w-lg";

  return (
    <Dialog modal={false} open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          contentCls,
          "left-0 right-0 top-0 translate-x-0 translate-y-0 h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col",
          "sm:left-1/2 sm:right-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-lg sm:rounded-xl sm:border sm:p-7 sm:gap-4 sm:overflow-y-auto sm:flex-none sm:block"
        )}
      >
        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className={`w-10 h-1 rounded-full ${dark ? "bg-white/20" : "bg-gray-300"}`} />
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-y-auto sm:contents px-4 pb-4 sm:p-0 space-y-4">

          <DialogHeader className="pb-1 pt-2 sm:pt-0">
            <DialogTitle className={dark ? "text-white text-lg sm:text-xl" : undefined}>Balance</DialogTitle>
            <DialogDescription className={dark ? "text-slate-400 text-base md:text-sm" : undefined}>
              {loadingBalance ? "Loading…" : `$${balanceUSD} USDC available`}
            </DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className={`flex gap-1 p-1 rounded-lg ${dark ? "bg-white/10" : "bg-gray-100"}`}>
            <button
              type="button"
              onClick={() => setTab("topup")}
              className={`flex-1 rounded-md py-2 text-base md:text-sm font-medium ${tab === "topup" ? (dark ? "bg-white/20 text-white" : "bg-white text-gray-900 shadow-sm") : dark ? "text-slate-400 hover:text-white" : "text-gray-600 hover:text-gray-900"}`}
            >
              Top Up
            </button>
            <button
              type="button"
              onClick={() => setTab("withdraw")}
              className={`flex-1 rounded-md py-2 text-base md:text-sm font-medium ${tab === "withdraw" ? (dark ? "bg-white/20 text-white" : "bg-white text-gray-900 shadow-sm") : dark ? "text-slate-400 hover:text-white" : "text-gray-600 hover:text-gray-900"}`}
            >
              {withdrawStep !== "idle" && withdrawStep !== "complete" && withdrawStep !== "failed" ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  In Progress
                </span>
              ) : "Withdraw"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRecentWithdrawals(getWithdrawalHistory());
                setTab("history");
              }}
              className={`flex-1 rounded-md py-2 text-base md:text-sm font-medium ${tab === "history" ? (dark ? "bg-white/20 text-white" : "bg-white text-gray-900 shadow-sm") : dark ? "text-slate-400 hover:text-white" : "text-gray-600 hover:text-gray-900"}`}
            >
              Recent
            </button>
          </div>

          {/* Top Up tab */}
          {tab === "topup" && (
            <div className="py-2">
              {devnetMode ? (
                <div className={`rounded-xl border-2 p-4 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`}>
                  <p className={`text-base font-semibold mb-1 ${dark ? "text-white" : "text-gray-900"}`}>Deposit USDC (devnet)</p>
                  <p className={`text-base md:text-sm mb-3 ${dark ? "text-slate-400" : "text-gray-500"}`}>Send devnet USDC directly to your wallet address.</p>
                  {solanaAddress && (
                    <div className={`flex items-center gap-2 rounded-lg p-3 ${dark ? "bg-white/5" : "bg-white border border-gray-200"}`}>
                      <p className={`text-base md:text-sm font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{solanaAddress}</p>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(solanaAddress);
                          toast({ title: "Copied!", description: "Wallet address copied to clipboard." });
                        }}
                        className={`shrink-0 p-1.5 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Three deposit method cards — no custom picker */
                <div className="py-2 space-y-3">

                  {/* 1. Receive USDC on Solana — direct address/QR via Privy */}
                  <button
                    type="button"
                    disabled={!solanaAddress || receiveLoading || cryptoLoading || bankLoading}
                    onClick={handleReceiveUsdc}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {receiveLoading
                        ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                        : <img src="/images/icons/deposit-receive.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Receive USDC on Solana</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        QR code · wallet address
                      </p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* 2. Bridge from another chain — Privy cross-chain picker */}
                  <button
                    type="button"
                    disabled={!solanaAddress || receiveLoading || cryptoLoading || bankLoading}
                    onClick={handleCrossChainDeposit}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {cryptoLoading
                        ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                        : <img src="/images/icons/deposit-bridge.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Bridge from another chain</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        ETH · BTC · USDC · USDT — any chain
                      </p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* 3. Bank / onramp */}
                  <button
                    type="button"
                    disabled={!solanaAddress || receiveLoading || cryptoLoading || bankLoading}
                    onClick={handleBankDeposit}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {bankLoading
                        ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                        : <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Deposit from bank</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        Coinbase Pay · MoonPay
                      </p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                </div>
              )}
            </div>
          )}

          {/* History tab */}
          {tab === "history" && (
            <div className="py-2 min-h-0 overflow-y-auto sm:max-h-[60vh]">
              {recentWithdrawals.length === 0 ? (
                <p className={`text-base md:text-sm text-center py-6 ${dark ? "text-slate-400" : "text-gray-500"}`}>No recent withdrawals.</p>
              ) : (
                <ul className="space-y-2">
                  {recentWithdrawals.map((item) => {
                    const isInProgress = item.isNearIntents && !item.nearIntentsComplete;
                    return (
                      <li key={item.id}>
                        <div
                          className={`rounded-lg border p-3 transition-colors ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className={`font-semibold text-base md:text-sm ${dark ? "text-white" : "text-gray-900"}`}>
                                ${item.amountUSDC.toFixed(2)} → {item.destinationToken}
                                {item.estimatedOut && (
                                  <span className={`font-normal text-base md:text-sm ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                                    (~{Number(item.estimatedOut).toLocaleString(undefined, { maximumFractionDigits: 4 })} received)
                                  </span>
                                )}
                              </p>
                              <p className={`text-base md:text-sm font-mono mt-0.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                                To {shortAddr(item.destinationAddress)} · {item.destinationChain}
                              </p>
                              <p className={`text-base md:text-sm mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
                                {new Date(item.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              {isInProgress ? (
                                <span className="flex items-center gap-1 text-base md:text-sm font-medium text-blue-400">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Bridging
                                </span>
                              ) : item.nearIntentsComplete && item.nearIntentsStatus ? (
                                <span className={`text-base md:text-sm font-medium ${SUCCESS_BRIDGE_STATUSES.has(item.nearIntentsStatus.toUpperCase()) ? "text-emerald-400" : "text-amber-400"}`}>
                                  {SUCCESS_BRIDGE_STATUSES.has(item.nearIntentsStatus.toUpperCase()) ? "Completed" : item.nearIntentsStatus}
                                </span>
                              ) : !item.isNearIntents ? (
                                <span className="text-base md:text-sm font-medium text-emerald-400">Sent</span>
                              ) : null}
                              <a
                                href={getExplorerTxUrl("solana", item.txSignature)}
                                target="_blank"
                                rel="noreferrer"
                                className={`${dark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-600"}`}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </div>
                          </div>

                          {/* Bridge status for in-progress */}
                          {isInProgress && item.nearIntentsStatus && (
                            <p className={`text-base md:text-sm mt-2 pt-2 border-t ${dark ? "border-white/10 text-slate-400" : "border-gray-100 text-gray-500"}`}>
                              {bridgeStatusLabel(item.nearIntentsStatus)}
                            </p>
                          )}

                          {/* Track button for in-progress near intents */}
                          {isInProgress && item.depositAddress && withdrawStep !== "bridging" && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveWithdrawal(item);
                                setBridgeStatus(item.nearIntentsStatus ?? null);
                                setWithdrawStep("bridging");
                                setDepositAddressForPolling(item.depositAddress!);
                                setTab("withdraw");
                              }}
                              className={`mt-2 text-base md:text-sm font-medium underline underline-offset-2 ${dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}`}
                            >
                              Track progress →
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Withdraw tab — progress panel */}
          {tab === "withdraw" && withdrawStep !== "idle" && (
            <ProgressSteps
              step={withdrawStep}
              isNearIntents={Boolean(isNearIntentsWithdraw || activeWithdrawal?.isNearIntents)}
              txSignature={activeWithdrawal?.txSignature}
              bridgeStatus={bridgeStatus}
              destinationToken={activeWithdrawal?.destinationToken || effectiveToken?.symbol}
              destinationChain={activeWithdrawal?.destinationChain || effectiveToken?.chain}
              estimatedOut={activeWithdrawal?.estimatedOut || quoteAmount || undefined}
              amountUSDC={activeWithdrawal?.amountUSDC || withdrawAmountNum || payFromBalanceNum}
              dark={dark}
              onDone={() => {
                setWithdrawStep("idle");
                setActiveWithdrawal(null);
                setBridgeStatus(null);
                setDepositAddressForPolling(null);
                if (withdrawStep === "complete") onRefresh();
              }}
            />
          )}

          {/* Withdraw tab — form */}
          {tab === "withdraw" && withdrawStep === "idle" && (
            <div className="space-y-4 py-4">
              {/* Balance */}
              <div>
                <Label className={`text-base md:text-sm font-medium mb-2 block ${dark ? "text-slate-400" : "text-gray-500"}`}>
                  {isNearIntentsWithdraw ? "Paying from (USDC on Solana)" : "Available balance"}
                </Label>
                <div className={`p-4 rounded-xl border-2 flex items-center justify-between ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${dark ? "bg-white/10 border border-white/10" : "bg-white border border-gray-200"}`}>
                      {(isNearIntentsWithdraw ? usdcSolanaToken : effectiveToken) && (
                        <TokenIcon
                          token={(isNearIntentsWithdraw ? usdcSolanaToken : effectiveToken)!}
                          chain={isNearIntentsWithdraw ? "solana" : effectiveToken?.chain}
                          size={24}
                        />
                      )}
                    </div>
                    <div>
                      <p className={`text-base md:text-sm font-medium ${dark ? "text-slate-300" : "text-gray-600"}`}>
                        {isNearIntentsWithdraw ? "USDC / Solana" : `${effectiveToken?.symbol || "USDC"} / ${effectiveToken?.chain || "Solana"}`}
                      </p>
                      <p className={`text-xl font-semibold mt-0.5 ${dark ? "text-white" : "text-gray-900"}`}>
                        {loadingBalance ? "…" : `$${balanceUSD}`}
                      </p>
                    </div>
                  </div>
                </div>
                {!loadingBalance && payFromBalanceNum <= 0 && isUSDCOnSolana && (
                  <p className={`text-base md:text-sm mt-2 ${dark ? "text-amber-400" : "text-amber-600"}`}>No balance to withdraw.</p>
                )}
              </div>

              {/* Token selector */}
              <div>
                <Label className={`text-base md:text-sm font-medium mb-2 block ${dark ? "text-slate-300" : "text-gray-700"}`}>
                  Withdraw to
                </Label>
                <TokenCombobox
                  tokens={withdrawTokens}
                  value={fromSel ?? (usdcSolanaToken ? { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain } : undefined)}
                  onChange={setFromSel}
                  placeholder="USDC on Solana (free) or other token"
                  className={dark ? "w-full h-12 rounded-xl border-2 border-white/20 bg-white/10 text-white text-center placeholder:text-slate-400" : "w-full h-12 rounded-xl border-2 border-gray-200 bg-white text-center"}
                  defaultShowAllChains
                />
                {BETA_SOLANA_ONLY && !isUSDCOnSolana ? (
                  <p className={`text-base md:text-sm mt-1.5 font-medium ${dark ? "text-amber-400" : "text-amber-600"}`}>
                    Cross-chain withdrawals coming soon — only USDC on Solana is available in beta.
                  </p>
                ) : (
                  <p className={`text-base md:text-sm mt-1.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Free withdrawal to any Solana wallet.
                  </p>
                )}
              </div>

              {/* Amount input */}
              <div>
                <Label htmlFor="withdraw-amount" className={dark ? "text-slate-300" : undefined}>
                  Amount to send (USDC)
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="withdraw-amount"
                    type="number"
                    min="1"
                    step="0.01"
                    max={payFromBalanceNum}
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className={`flex-1 font-mono text-base md:text-sm ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWithdrawAmount(spendableBalance.toFixed(6).replace(/\.?0+$/, ""))}
                    className={`shrink-0 px-3 text-base md:text-sm ${dark ? "border-white/20 bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white" : ""}`}
                  >
                    Max
                  </Button>
                </div>
                {withdrawAmountNum > 0 && withdrawAmountNum < 1 && (
                  <p className="text-base md:text-sm text-red-400 mt-1">Minimum withdrawal is $1.00 USDC.</p>
                )}
                {withdrawAmountNum > spendableBalance && spendableBalance > 0 && (
                  <p className="text-base md:text-sm text-red-400 mt-1">Exceeds available balance of {spendableBalance.toFixed(6).replace(/\.?0+$/, "")} USDC.</p>
                )}
              </div>

              {/* Destination address */}
              <div>
                <Label htmlFor="withdraw-address" className={dark ? "text-slate-300" : undefined}>
                  {isUSDCOnSolana ? "Destination Solana wallet" : `Destination address (${effectiveToken?.chain || "recipient"})`}
                </Label>
                <Input
                  id="withdraw-address"
                  placeholder={isUSDCOnSolana ? "Enter Solana address" : `Enter ${effectiveToken?.chain || "destination"} address`}
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  className={`mt-1 font-mono text-base md:text-sm ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                />
                {isUSDCOnSolana && addressRiskStatus === "checking" && (
                  <p className={`text-base md:text-sm mt-1.5 flex items-center gap-1.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    Checking address with Range…
                  </p>
                )}
                {isUSDCOnSolana && addressRiskStatus === "safe" && (
                  <p className="text-base md:text-sm text-emerald-400 mt-1.5 flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Address compliant — safe to withdraw
                  </p>
                )}
                {isUSDCOnSolana && addressRiskStatus === "unsafe" && (
                  <p className="text-base md:text-sm text-red-400 mt-1.5 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Address flagged — withdrawal blocked
                  </p>
                )}
              </div>

              {devnetMode && (
                <p className={`text-base md:text-sm text-center ${dark ? "text-amber-400" : "text-amber-600"}`}>
                  Withdrawals are not available on devnet.
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={onClose} className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}>
                  Cancel
                </Button>
                <Button
                  onClick={handleWithdraw}
                  disabled={
                    devnetMode ||
                    withdrawing ||
                    (BETA_SOLANA_ONLY && !isUSDCOnSolana) ||
                    withdrawAmountNum < 1 ||
                    withdrawAmountNum > spendableBalance ||
                    !withdrawAddress.trim() ||
                    !wallet ||
                    (isUSDCOnSolana ? addressRiskStatus !== "safe" : !destinationAddressValid)
                  }
                  className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {withdrawing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {stepLabel(withdrawStep, Boolean(isNearIntentsWithdraw))}
                    </span>
                  ) : (
                    isNearIntentsWithdraw ? `Bridge to ${effectiveToken?.symbol}` : "Withdraw USDC"
                  )}
                </Button>
              </div>
              {!loadingBalance && payFromBalanceNum <= 0 && (
                <p className={`text-base md:text-sm text-center ${dark ? "text-slate-400" : "text-gray-500"}`}>Add funds to withdraw.</p>
              )}
            </div>
          )}

        </div>{/* end scrollable area */}

        {/* Large close button — mobile only, always visible at bottom */}
        <div className={`sm:hidden shrink-0 px-4 pt-3 pb-8 border-t ${dark ? "border-white/10 bg-[#0f0f12]" : "border-gray-100 bg-white"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`w-full py-4 rounded-2xl text-base md:text-sm font-semibold transition-colors ${dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-900 hover:bg-gray-200"}`}
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
