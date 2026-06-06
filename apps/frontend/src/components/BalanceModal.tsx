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
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink, Copy, ArrowRight, ArrowDown, ArrowUp, Clock, ChevronLeft } from "lucide-react";
import type { Deposit as BlinkDeposit } from "@swype-org/deposit";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
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
import { QRCodeSVG } from "qrcode.react";

const LOG_PREFIX = "[BalanceModal]";

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

function IconBubble({ active, dark, children }: { active: boolean; dark: boolean; children: React.ReactNode }) {
  return (
    <span className="relative shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full">
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          active
            ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_10px_24px_rgba(255,122,42,0.25)] scale-[1.02]"
            : dark
              ? "bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              : "bg-gray-100"
        )}
      />
      {active && (
        <span
          aria-hidden="true"
          className="absolute -inset-1 rounded-full blur-md opacity-60 bg-[radial-gradient(circle,rgba(255,122,42,0.55),transparent_60%)]"
        />
      )}
      <span className={cn(
        "relative z-10 shrink-0 flex items-center justify-center",
        "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:stroke-[2.25]",
        "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active ? "translate-y-[-0.5px] text-white" : dark ? "text-slate-400" : "text-gray-500"
      )}>
        {children}
      </span>
    </span>
  );
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

  // Blink crypto deposit
  const [blinkDepositing, setBlinkDepositing] = useState(false);
  const [blinkError, setBlinkError] = useState<string | null>(null);
  const blinkDepositRef = useRef<BlinkDeposit | null>(null);
  const [coinbaseLoading, setCoinbaseLoading] = useState(false);
  const [withdrawMethod, setWithdrawMethod] = useState<"usdc-sol" | "near-intents" | null>(null);
  const [coinbaseOfframpLoading, setCoinbaseOfframpLoading] = useState(false);

  // Near Intents top-up deposit
  const [topUpView, setTopUpView] = useState<"near-intents-deposit" | null>(null);
  const [depositFromSel, setDepositFromSel] = useState<TokenSelection | undefined>(undefined);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositRefundAddr, setDepositRefundAddr] = useState("");
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositAddr, setDepositAddr] = useState<string | null>(null);
  const [depositMemo, setDepositMemo] = useState<string | null>(null);
  const [depositBridgeStatus, setDepositBridgeStatus] = useState<string | null>(null);
  const [depositPollAddr, setDepositPollAddr] = useState<string | null>(null);
  const [depositQuoteOut, setDepositQuoteOut] = useState<string | null>(null);
  const depositPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { user, getAccessToken } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Blink signer: called by the SDK to sign each request server-side
  const getBlinkSigner = useCallback(async (data: unknown) => {
    const token = await getAccessToken();
    const res = await fetch("/api/blink/sign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? "Signer request failed");
    }
    return res.json();
  }, [getAccessToken]);

  // Blink: open the SDK's own deposit modal (no iframe in our UI)
  const handleBlinkDeposit = async () => {
    if (!solanaAddress) return;
    setBlinkDepositing(true);
    setBlinkError(null);
    try {
      if (!blinkDepositRef.current) {
        const { Deposit } = await import("@swype-org/deposit");
        blinkDepositRef.current = new Deposit({ signer: getBlinkSigner, debug: true });
      }
      await blinkDepositRef.current.requestDeposit({
        amount: null,
        chainId: 792703809,
        address: solanaAddress,
        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      });
      toast({ title: "Deposit complete!", description: "USDC will appear in your balance shortly." });
      onRefresh();
    } catch (err: unknown) {
      const { DepositError, getDisplayMessage } = await import("@swype-org/deposit");
      const msg = err instanceof DepositError ? getDisplayMessage(err) : "Deposit failed. Please try again.";
      setBlinkError(msg);
    } finally {
      setBlinkDepositing(false);
    }
  };

  // Coinbase Onramp: fetch a session token then open pay.coinbase.com in a popup (460×730)
  const handleCoinbaseOnramp = async () => {
    if (!solanaAddress) return;
    setCoinbaseLoading(true);
    try {
      const accessToken = await getAccessToken();
      const sessionRes = await fetch("/api/coinbase/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ walletAddress: solanaAddress, blockchains: ["solana"] }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({})) as { error?: string; detail?: string };
        const msg = err.detail || err.error || `Session error ${sessionRes.status}`;
        toast({ variant: "destructive", title: "Could not start Coinbase session", description: msg });
        return;
      }

      const sessionData = await sessionRes.json();
      const sessionToken: string | undefined = sessionData.token;
      if (!sessionToken) {
        toast({ variant: "destructive", title: "Could not start Coinbase session", description: "No session token returned." });
        return;
      }

      const params = new URLSearchParams();
      params.set("appId", "68e3c83a-3d5a-49aa-a8fa-7ef26d824de1");
      params.set("defaultNetwork", "solana");
      params.set("defaultAsset", "USDC");
      params.set("addresses", JSON.stringify({ [solanaAddress]: ["solana"] }));
      params.set("assets", JSON.stringify(["USDC"]));
      params.set("sessionToken", sessionToken);

      const onrampUrl = `https://pay.coinbase.com/buy/select-asset?${params.toString()}`;

      // Open in Coinbase's recommended popup size
      const popup = window.open(
        onrampUrl,
        "coinbase-onramp",
        "width=460,height=730,left=200,top=100,resizable=yes,scrollbars=yes"
      );
      // Fallback: if popup blocked, navigate directly
      if (!popup) window.open(onrampUrl, "_blank");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open Coinbase Onramp.";
      toast({ variant: "destructive", title: "Onramp error", description: msg });
    } finally {
      setCoinbaseLoading(false);
    }
  };

  // Coinbase Off-ramp: fetch offramp session token then open sell popup
  const handleCoinbaseOfframp = async () => {
    if (!solanaAddress) return;
    setCoinbaseOfframpLoading(true);
    try {
      const accessToken = await getAccessToken();
      const sessionRes = await fetch("/api/coinbase/offramp-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ walletAddress: solanaAddress, blockchains: ["solana"] }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({})) as { error?: string; detail?: string };
        toast({ variant: "destructive", title: "Could not start Coinbase session", description: err.detail || err.error || `Session error ${sessionRes.status}` });
        return;
      }

      const { token: sessionToken } = await sessionRes.json();
      if (!sessionToken) {
        toast({ variant: "destructive", title: "Could not start Coinbase session", description: "No session token returned." });
        return;
      }

      const params = new URLSearchParams();
      params.set("appId", "68e3c83a-3d5a-49aa-a8fa-7ef26d824de1");
      params.set("sessionToken", sessionToken);
      params.set("defaultNetwork", "solana");
      params.set("defaultAsset", "USDC");
      params.set("redirectUrl", window.location.origin);
      // partnerUserRef: required, max 50 chars
      if (user?.id) params.set("partnerUserRef", user.id.slice(0, 50));

      const offrampUrl = `https://pay.coinbase.com/v3/sell/input?${params.toString()}`;
      const popup = window.open(offrampUrl, "coinbase-offramp", "width=460,height=730,left=200,top=100,resizable=yes,scrollbars=yes");
      if (!popup) window.open(offrampUrl, "_blank");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open Coinbase Off-ramp.";
      toast({ variant: "destructive", title: "Off-ramp error", description: msg });
    } finally {
      setCoinbaseOfframpLoading(false);
    }
  };

  // Near Intents top-up: get deposit address
  const handleGetDepositAddress = async () => {
    if (!selectedDepositToken || !usdcSolanaToken || !solanaAddress || !depositAmountNum) return;
    setDepositSubmitting(true);
    try {
      const info = await getDepositInfo({
        fromToken: selectedDepositToken as NearToken,
        toToken: usdcSolanaToken as NearToken,
        amount: depositAmountNum.toString(),
        recipient: solanaAddress,
        sender: depositRefundAddr || solanaAddress,
        refundAddress: depositRefundAddr || solanaAddress,
        slippageBps: 100,
      });
      if (!info.depositAddress) throw new Error("No deposit address returned");
      setDepositAddr(info.depositAddress);
      setDepositMemo(info.memo ?? null);
      setDepositPollAddr(info.depositAddress);
      setDepositBridgeStatus("PENDING");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not get deposit address";
      toast({ variant: "destructive", title: "Failed to get deposit address", description: msg });
    } finally {
      setDepositSubmitting(false);
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

  // Near Intents deposit (top-up) — tokens and selected token
  const depositTokens = useMemo(() => {
    const isSol = (c: string | undefined) => (c || "").toLowerCase() === "solana" || (c || "").toLowerCase() === "sol";
    return tokens.filter((t) => !isSol(t.chain));
  }, [tokens]);
  const selectedDepositToken = useMemo(
    () => findTokenBySelection(depositTokens, depositFromSel),
    [depositTokens, depositFromSel]
  );
  const depositAmountNum = parseFloat(depositAmount) || 0;
  const depositChain = selectedDepositToken?.chain || "";
  const depositRefundAddrValid = !depositRefundAddr || isValidAddressForChain(depositRefundAddr, depositChain);

  const withdrawTokens = useMemo(() => {
    const solLower = (c: string | undefined) => (c || "").toLowerCase() === "solana" || (c || "").toLowerCase() === "sol";
    if (withdrawMethod === "near-intents") {
      return tokens.filter((t) => !solLower(t.chain));
    }
    const usdcSol = usdcSolanaToken ? [usdcSolanaToken] : [];
    const otherChains = tokens.filter((t) => !solLower(t.chain));
    return [...usdcSol, ...otherChains];
  }, [tokens, usdcSolanaToken, withdrawMethod]);

  const selectedFrom = useMemo(
    () => findTokenBySelection(withdrawTokens, fromSel ?? (usdcSolanaToken ? { symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain } : undefined)),
    [withdrawTokens, fromSel, usdcSolanaToken]
  );

  const effectiveToken = withdrawMethod === "usdc-sol"
    ? usdcSolanaToken
    : (selectedFrom || usdcSolanaToken);
  const isUSDCOnSolana = withdrawMethod === "usdc-sol";
  const payFromBalanceNum = parseFloat(balanceUSD) || 0; // display only
  // Exact spendable balance truncated to USDC precision (6 dp) — never rounds up
  const spendableBalance = Math.floor((balanceExact ?? payFromBalanceNum) * 1_000_000) / 1_000_000;
  const destChain = effectiveToken?.chain || "";
  const isNearIntentsWithdraw = withdrawMethod === "near-intents" && !!selectedFrom && !!usdcSolanaToken;
  const destinationAddressValid = isValidAddressForChain(withdrawAddress, isUSDCOnSolana ? "solana" : destChain);

  // Clear Blink error and reset states when modal closes
  useEffect(() => {
    if (!open) {
      setBlinkError(null);
      setWithdrawMethod(null);
      // Keep deposit state alive while a deposit is still pending
      if (!depositAddr || TERMINAL_BRIDGE_STATUSES.has(depositBridgeStatus || "")) {
        setTopUpView(null);
        setDepositFromSel(undefined);
        setDepositAmount("");
        setDepositRefundAddr("");
        setDepositAddr(null);
        setDepositMemo(null);
        setDepositBridgeStatus(null);
        setDepositPollAddr(null);
        setDepositQuoteOut(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Deposit quote estimation (Near Intents top-up)
  useEffect(() => {
    if (!selectedDepositToken || !usdcSolanaToken || !depositAmountNum) {
      setDepositQuoteOut(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await getAccurateQuote({
          fromToken: selectedDepositToken as NearToken,
          toToken: usdcSolanaToken as NearToken,
          amount: depositAmountNum.toString(),
          slippageBps: 100,
          dryRun: true,
        });
        if (!cancelled && r.amountOut) setDepositQuoteOut(r.amountOut);
      } catch { /* non-fatal */ }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepositToken?.tokenId, depositAmountNum, usdcSolanaToken]);

  // Deposit bridge polling (Near Intents top-up)
  useEffect(() => {
    if (!depositPollAddr || TERMINAL_BRIDGE_STATUSES.has(depositBridgeStatus || "")) {
      if (depositPollingRef.current) clearInterval(depositPollingRef.current);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await getExecutionStatus(depositPollAddr);
        if (cancelled) return;
        const s = String(result?.status || result?.executionStatus || result?.state || "PENDING").toUpperCase();
        setDepositBridgeStatus(s);
        if (TERMINAL_BRIDGE_STATUSES.has(s)) {
          setDepositPollAddr(null);
          if (SUCCESS_BRIDGE_STATUSES.has(s)) onRefresh();
        }
      } catch { /* ignore */ }
    };
    poll();
    depositPollingRef.current = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (depositPollingRef.current) clearInterval(depositPollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositPollAddr]);

  // Reset token selection and address when withdraw method changes
  useEffect(() => {
    setFromSel(undefined);
    setWithdrawAddress("");
    setAddressRiskStatus("idle");
  }, [withdrawMethod]);

  // On open: load history and resume any in-progress Near Intents withdrawal
  useEffect(() => {
    if (!open) return;
    const history = getWithdrawalHistory();
    setRecentWithdrawals(history);

    // Restore deposit view if a Near Intents top-up is still pending
    if (depositAddr && !TERMINAL_BRIDGE_STATUSES.has(depositBridgeStatus || "")) {
      setTab("topup");
      setTopUpView("near-intents-deposit");
    }

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
    ? "sm:max-w-xl border-white/10 bg-[#0f0f12] text-white [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.text-gray-400]:!text-slate-500 [&_.bg-gray-100]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.bg-white]:!bg-white/10 [&_.border-gray-200]:!border-white/10 [&_.border-gray-300]:!border-white/20 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&>button]:!text-slate-400 [&>button:hover]:!text-white"
    : "sm:max-w-xl";

  return (
    <Dialog modal={false} open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          contentCls,
          "left-0 right-0 top-0 translate-x-0 translate-y-0 h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col",
          "sm:left-1/2 sm:right-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-xl sm:rounded-2xl sm:border sm:p-7 sm:gap-4 sm:overflow-y-auto sm:flex-none sm:block",
          "[&>button]:h-12 [&>button]:w-12 [&>button]:rounded-full [&>button_svg]:h-5 [&>button_svg]:w-5"
        )}
      >
        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-5 pb-2 shrink-0">
          <div className={`w-10 h-1 rounded-full ${dark ? "bg-white/20" : "bg-gray-300"}`} />
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-y-auto sm:contents px-6 pb-6 sm:p-0 space-y-5 sm:space-y-4">

          <DialogHeader className="pb-0 pt-2 sm:pt-0">
            <DialogTitle className={cn("text-3xl sm:text-4xl font-bold tracking-tight", dark ? "text-white" : "text-gray-900")}>
              Balance
            </DialogTitle>
            <DialogDescription className={cn("text-base font-medium mt-0.5", dark ? "text-slate-400" : "text-gray-500")}>
              {loadingBalance ? "Loading…" : `$${balanceUSD} USDC available`}
            </DialogDescription>
          </DialogHeader>

          {/* Tabs — SendReceiveTabs style with sliding indicator */}
          <div className={cn(
            "relative flex rounded-2xl p-1 overflow-hidden",
            dark
              ? "bg-white/[0.05] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              : "bg-gray-100 border border-gray-200"
          )}>
            {/* Sliding pill */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1 left-1 rounded-xl w-[calc(33.333%-0.167rem)]",
                "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                dark
                  ? "bg-gradient-to-b from-white/[0.08] to-white/[0.03] shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] border border-white/[0.08]"
                  : "bg-white shadow-sm border border-gray-200",
                tab === "topup" ? "translate-x-0" : tab === "withdraw" ? "translate-x-full" : "translate-x-[200%]"
              )}
            />
            {/* Orange glow — dark mode only */}
            {dark && (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-1 left-1 rounded-xl w-[calc(33.333%-0.167rem)] opacity-40",
                  "bg-[radial-gradient(80%_140%_at_50%_0%,rgba(255,122,42,0.35),transparent_60%)]",
                  "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  tab === "topup" ? "translate-x-0" : tab === "withdraw" ? "translate-x-full" : "translate-x-[200%]"
                )}
              />
            )}

            {/* Top Up */}
            <button
              type="button"
              onClick={() => setTab("topup")}
              className="group relative z-10 flex-1 inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]"
            >
              <IconBubble active={tab === "topup"} dark={dark}><ArrowDown /></IconBubble>
              <span className={cn("relative z-10 font-semibold text-sm transition-colors duration-300",
                tab === "topup" ? (dark ? "text-slate-100" : "text-gray-900") : (dark ? "text-slate-400" : "text-gray-500")
              )}>Top Up</span>
            </button>

            {/* Withdraw */}
            <button
              type="button"
              onClick={() => setTab("withdraw")}
              className="group relative z-10 flex-1 inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]"
            >
              <IconBubble active={tab === "withdraw"} dark={dark}>
                {withdrawStep !== "idle" && withdrawStep !== "complete" && withdrawStep !== "failed"
                  ? <Loader2 className="animate-spin" />
                  : <ArrowUp />
                }
              </IconBubble>
              <span className={cn("relative z-10 font-semibold text-sm transition-colors duration-300",
                tab === "withdraw" ? (dark ? "text-slate-100" : "text-gray-900") : (dark ? "text-slate-400" : "text-gray-500")
              )}>
                {withdrawStep !== "idle" && withdrawStep !== "complete" && withdrawStep !== "failed" ? "Active" : "Withdraw"}
              </span>
            </button>

            {/* Recent */}
            <button
              type="button"
              onClick={() => { setRecentWithdrawals(getWithdrawalHistory()); setTab("history"); }}
              className="group relative z-10 flex-1 inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]"
            >
              <IconBubble active={tab === "history"} dark={dark}><Clock /></IconBubble>
              <span className={cn("relative z-10 font-semibold text-sm transition-colors duration-300",
                tab === "history" ? (dark ? "text-slate-100" : "text-gray-900") : (dark ? "text-slate-400" : "text-gray-500")
              )}>Recent</span>
            </button>
          </div>

          {/* Top Up tab — method cards */}
          {tab === "topup" && topUpView === null && (
            <div className="py-2">
              {devnetMode ? (
                <div className={`rounded-xl border-2 p-4 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`}>
                  <p className={`text-base font-semibold mb-1 ${dark ? "text-white" : "text-gray-900"}`}>Deposit USDC (devnet)</p>
                  <p className={`text-base md:text-sm mb-3 ${dark ? "text-slate-400" : "text-gray-500"}`}>Send devnet USDC directly to your wallet address.</p>
                  {solanaAddress && (
                    <div className={`flex items-center gap-2 rounded-lg p-3 ${dark ? "bg-white/5" : "bg-white border border-gray-200"}`}>
                      <p className={`text-base md:text-sm font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{solanaAddress}</p>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(solanaAddress); toast({ title: "Copied!" }); }} className={`shrink-0 p-1.5 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-2 space-y-3">

                  {/* 1. Crypto deposit via Blink */}
                  <button type="button" disabled={!solanaAddress || blinkDepositing || coinbaseLoading} onClick={handleBlinkDeposit}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {blinkDepositing ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" /> : <img src="/images/icons/deposit-bridge.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Crypto deposit</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>ETH · USDC · USDT — any chain</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {blinkError && <p className="text-sm text-red-500 text-center px-1">{blinkError}</p>}

                  {/* 2. More crypto via Near Intents */}
                  <button type="button" disabled={!solanaAddress} onClick={() => setTopUpView("near-intents-deposit")}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/deposit-receive.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>More crypto deposit</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>ZEC · TON · BTC — cross-chain</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* 3. Fiat / bank via Coinbase Onramp */}
                  <button type="button" disabled={!solanaAddress || blinkDepositing || coinbaseLoading} onClick={handleCoinbaseOnramp}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {coinbaseLoading ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" /> : <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Buy with card or bank</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Apple Pay · card · bank transfer</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                </div>
              )}
            </div>
          )}

          {/* Top Up tab — Near Intents deposit form / address view */}
          {tab === "topup" && !devnetMode && topUpView === "near-intents-deposit" && (
            <div className="space-y-4 py-2">

              {/* Back */}
              <button type="button" onClick={() => { setTopUpView(null); setDepositAddr(null); setDepositMemo(null); setDepositPollAddr(null); setDepositBridgeStatus(null); setDepositFromSel(undefined); setDepositAmount(""); setDepositRefundAddr(""); setDepositQuoteOut(null); }}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {depositAddr ? (
                /* ── Deposit address view ── */
                <div className="space-y-3">

                  {/* Status */}
                  <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${dark ? "bg-white/5 border border-white/10" : "bg-gradient-to-r from-orange-50/70 to-amber-50/30 border border-orange-100"}`}>
                    {!depositBridgeStatus || depositBridgeStatus === "PENDING" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-400 shrink-0" />
                    ) : SUCCESS_BRIDGE_STATUSES.has(depositBridgeStatus) ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{bridgeStatusLabel(depositBridgeStatus)}</p>
                      {depositQuoteOut && (
                        <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>~{Number(depositQuoteOut).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC expected</p>
                      )}
                    </div>
                  </div>

                  {/* Send instructions */}
                  <div className={`rounded-2xl border overflow-hidden ${dark ? "border-white/10" : "border-gray-100"}`}>
                    <div className={`px-4 py-3 border-b ${dark ? "border-white/[0.06] bg-white/5" : "border-gray-100 bg-gray-50/60"}`}>
                      <p className={`text-sm font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        Send <span className={`font-bold ${dark ? "text-white" : "text-gray-900"}`}>{depositAmountNum} {selectedDepositToken?.symbol}</span> to this address
                      </p>
                    </div>

                    {/* Address row */}
                    <div className="px-4 py-3">
                      <p className={`text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-gray-400"}`}>Deposit address</p>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{depositAddr}</p>
                        <button type="button" onClick={() => { navigator.clipboard.writeText(depositAddr!); toast({ title: "Copied!", description: "Deposit address copied." }); }}
                          className={`shrink-0 p-2 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Memo row (only if present) */}
                    {depositMemo && (
                      <div className={`px-4 py-3 border-t ${dark ? "border-white/[0.06]" : "border-gray-100"}`}>
                        <p className={`text-xs font-medium mb-1.5 uppercase tracking-wide text-amber-500`}>⚠ Memo — required</p>
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{depositMemo}</p>
                          <button type="button" onClick={() => { navigator.clipboard.writeText(depositMemo!); toast({ title: "Copied!", description: "Memo copied." }); }}
                            className={`shrink-0 p-2 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* QR code */}
                    <div className={`flex justify-center py-4 border-t ${dark ? "border-white/[0.06]" : "border-gray-100"}`}>
                      <div className={`p-3 rounded-xl ${dark ? "bg-white" : "bg-white border border-gray-100"}`}>
                        <QRCodeSVG value={depositAddr} size={140} />
                      </div>
                    </div>
                  </div>

                  {SUCCESS_BRIDGE_STATUSES.has(depositBridgeStatus || "") && (
                    <Button onClick={() => { setTopUpView(null); setDepositAddr(null); setDepositMemo(null); setDepositPollAddr(null); setDepositBridgeStatus(null); setDepositFromSel(undefined); setDepositAmount(""); setDepositRefundAddr(""); setDepositQuoteOut(null); }}
                      className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white">
                      Done
                    </Button>
                  )}
                </div>
              ) : (
                /* ── Token + amount form ── */
                <div className="space-y-4">

                  {/* Token selector */}
                  <div>
                    <Label className={`text-sm font-medium mb-2 block ${dark ? "text-slate-300" : "text-gray-700"}`}>Token to deposit</Label>
                    <TokenCombobox
                      tokens={depositTokens}
                      value={depositFromSel}
                      onChange={setDepositFromSel}
                      placeholder="Select token and chain"
                      className={dark ? "w-full h-11 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-slate-400" : "w-full h-11 rounded-xl border border-gray-200 bg-white"}
                      defaultShowAllChains
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <Label htmlFor="deposit-amount" className={dark ? "text-slate-300" : undefined}>Amount to send</Label>
                    <Input
                      id="deposit-amount"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                    />
                    {depositQuoteOut && (
                      <p className={`text-sm mt-1.5 flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                        ~{Number(depositQuoteOut).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC received
                      </p>
                    )}
                  </div>

                  {/* Refund address (optional) */}
                  <div>
                    <Label htmlFor="deposit-refund" className={dark ? "text-slate-300" : undefined}>
                      Your {selectedDepositToken?.chain || "source"} address <span className={`font-normal ${dark ? "text-slate-500" : "text-gray-400"}`}>(for refunds if deposit fails)</span>
                    </Label>
                    <Input
                      id="deposit-refund"
                      placeholder={`Enter your ${selectedDepositToken?.chain || "source"} address`}
                      value={depositRefundAddr}
                      onChange={(e) => setDepositRefundAddr(e.target.value)}
                      className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                    />
                    {depositRefundAddr && !depositRefundAddrValid && (
                      <p className="text-sm text-red-400 mt-1 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Invalid address for {depositChain}
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleGetDepositAddress}
                    disabled={depositSubmitting || !selectedDepositToken || !depositAmountNum || (!!depositRefundAddr && !depositRefundAddrValid)}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
                  >
                    {depositSubmitting ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Getting deposit address…</span>
                    ) : "Get deposit address"}
                  </Button>
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
                setWithdrawMethod(null);
                if (withdrawStep === "complete") onRefresh();
              }}
            />
          )}

          {/* Withdraw tab — method selection */}
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod === null && (
            <div className="py-2 space-y-3">

              {/* 1. USDC on Solana */}
              <button
                type="button"
                disabled={!solanaAddress}
                onClick={() => setWithdrawMethod("usdc-sol")}
                className={cn(
                  "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                  dark
                    ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                  <img src="/images/icons/withdraw-usdc.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>USDC on Solana</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Any Solana wallet · Free &amp; instant
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

              {/* 2. Other token via Near Intents */}
              <button
                type="button"
                disabled={!solanaAddress}
                onClick={() => setWithdrawMethod("near-intents")}
                className={cn(
                  "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                  dark
                    ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                  <img src="/images/icons/deposit-bridge.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Other token or chain</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    ETH · BTC · SOL · USDT — any chain
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

              {/* 3. Bank or card via Coinbase off-ramp */}
              <button
                type="button"
                disabled={!solanaAddress || coinbaseOfframpLoading}
                onClick={handleCoinbaseOfframp}
                className={cn(
                  "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                  dark
                    ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                  {coinbaseOfframpLoading
                    ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                    : <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Bank or credit card</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Apple Pay · card · bank transfer
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

            </div>
          )}

          {/* Withdraw tab — form (method selected) */}
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod !== null && (
            <div className="space-y-4 py-2">

              {/* Back button */}
              <button
                type="button"
                onClick={() => setWithdrawMethod(null)}
                className={cn(
                  "flex items-center gap-1 text-base font-medium transition-colors",
                  dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>

              {/* Balance + route summary */}
              {withdrawMethod === "near-intents" ? (
                /* Near Intents: FROM → TO visual flow */
                <div className={`rounded-2xl border overflow-hidden ${dark ? "border-white/10" : "border-gray-100"}`}>
                  {/* FROM row */}
                  <div className={`flex items-center gap-3 px-4 py-3.5 ${dark ? "bg-white/5" : "bg-orange-50/50"}`}>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${dark ? "bg-white/10" : "bg-white shadow-sm border border-orange-100"}`}>
                      {usdcSolanaToken && <TokenIcon token={usdcSolanaToken} chain="solana" size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>From your balance</p>
                      <p className={`text-base font-bold leading-tight ${dark ? "text-white" : "text-gray-900"}`}>
                        {loadingBalance ? "…" : `$${balanceUSD}`}
                        <span className={`text-sm font-normal ml-1.5 ${dark ? "text-slate-400" : "text-gray-400"}`}>USDC · Solana</span>
                      </p>
                    </div>
                  </div>
                  {/* Bridge label */}
                  <div className={`flex items-center gap-2 px-4 py-1.5 border-y ${dark ? "border-white/[0.06] bg-white/[0.02]" : "border-gray-100 bg-gray-50/60"}`}>
                    <ArrowDown className={`h-3.5 w-3.5 shrink-0 ${dark ? "text-slate-500" : "text-gray-400"}`} />
                    <span className={`text-sm ${dark ? "text-slate-500" : "text-gray-400"}`}>Cross-chain via Near Intents</span>
                  </div>
                  {/* TO row — token selector */}
                  <div className={`px-4 py-3.5 ${dark ? "" : ""}`}>
                    <p className={`text-sm font-medium mb-2 ${dark ? "text-slate-300" : "text-gray-600"}`}>You receive</p>
                    <TokenCombobox
                      tokens={withdrawTokens}
                      value={fromSel}
                      onChange={setFromSel}
                      placeholder="Select token and chain"
                      className={dark ? "w-full h-11 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-slate-400" : "w-full h-11 rounded-xl border border-gray-200 bg-white"}
                      defaultShowAllChains
                    />
                  </div>
                </div>
              ) : (
                /* USDC on Solana: compact balance pill */
                <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${dark ? "bg-white/5 border border-white/10" : "bg-gradient-to-r from-orange-50/70 to-amber-50/30 border border-orange-100"}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${dark ? "bg-white/10" : "bg-white shadow-sm border border-orange-100/60"}`}>
                    {effectiveToken && <TokenIcon token={effectiveToken} chain={effectiveToken?.chain} size={22} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Available to withdraw</p>
                    <p className={`text-xl font-bold leading-tight ${dark ? "text-white" : "text-gray-900"}`}>
                      {loadingBalance ? "…" : `$${balanceUSD}`}
                      <span className={`text-sm font-normal ml-1.5 ${dark ? "text-slate-400" : "text-gray-400"}`}>USDC</span>
                    </p>
                  </div>
                  {!loadingBalance && payFromBalanceNum <= 0 && (
                    <span className="text-sm font-medium text-amber-500">Empty</span>
                  )}
                </div>
              )}

              {/* Amount */}
              <div>
                <Label htmlFor="withdraw-amount" className={dark ? "text-slate-300" : undefined}>
                  {withdrawMethod === "near-intents" ? "Amount to bridge (USDC)" : "Amount to send (USDC)"}
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
                <Button variant="outline" onClick={() => setWithdrawMethod(null)} className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}>
                  Back
                </Button>
                <Button
                  onClick={handleWithdraw}
                  disabled={
                    devnetMode ||
                    withdrawing ||
                    withdrawAmountNum < 1 ||
                    withdrawAmountNum > spendableBalance ||
                    !withdrawAddress.trim() ||
                    !wallet ||
                    (withdrawMethod === "near-intents" && !selectedFrom) ||
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
                    isNearIntentsWithdraw ? `Bridge to ${effectiveToken?.symbol || "token"}` : "Withdraw USDC"
                  )}
                </Button>
              </div>
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
