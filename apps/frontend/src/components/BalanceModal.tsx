"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { embeddedSolanaUsdcBalanceQueryKey } from "@/services/solanaBalance";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenIcon } from "@/components/TokenIcon";
import { findTokenBySelection } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { TokenCombobox } from "@/components/TokenCombobox";
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink, Copy, ArrowRight, ArrowDown, ArrowUp, Clock, ChevronLeft, X, VenetianMask } from "lucide-react";
import { PEER_PLATFORMS, PEER_CURRENCIES, getPlatform, getPeerCurrency, type PeerPlatform, getPlatformCooldownRemaining, recordPlatformWithdraw, clearPlatformWithdraw, formatCooldown } from "@/lib/peerPlatforms";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Deposit as BlinkDeposit } from "@swype-org/deposit";
import { usePrivy, useWallets as useEvmWallets, useCreateWallet, useSendTransaction as useEvmSendTransaction } from "@privy-io/react-auth";
import { useWallets, useSignTransaction, useFundWallet } from "@privy-io/react-auth/solana";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { buildUSDCTransferTransaction, sendSignedUSDCTransfer } from "@/services/solanaTransfer";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";

/** Gate check before any EVM gas-sponsored transaction. Throws if rate-limited. */
async function assertEvmSponsorAllowed(walletAddress: string, userId: string, accessToken: string | null) {
  try {
    const res = await fetch("/api/payments/sponsor-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ walletAddress }),
    });
    if (res.status === 429 || res.status === 403) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Sponsorship limit reached. Try again tomorrow.");
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes("limit") || err.message.includes("denied") || err.message.includes("Unauthorized"))) {
      throw err; // re-throw rate-limit / auth errors
    }
    // Network failure — fail open so users aren't blocked by infra issues
    console.warn("[evmSponsorGate] check failed, proceeding:", err);
  }
}
import { getDepositInfo, getAccurateQuote, getExecutionStatus } from "@/services/nearIntents";
import type { NearToken } from "@/services/nearIntents";
import { prepareNearIntentsWithdrawal } from "@/services/solanaSponsor";
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
import { usePerPrivateSelfTransfer } from "@/hooks/usePerPrivateSelfTransfer";
import { privyStandardWalletToAnchorWallet } from "@/lib/per/signer";
import { SolanaWalletConnectProvider, useWallet as useSolanaWalletAdapter, WalletMultiButton } from "@/components/SolanaWalletConnect";
import { startPrivateDeposit, getPrivateTransferStatus, type PrivateTransferStatus } from "@/services/api/privateBalance";
import { PRIVATE_PAYMENT_MAX_WAIT_MINUTES } from "@/lib/privatePaymentCopy";
import { PajCashOnrampView } from "@/components/paj-cash/PajCashOnrampView";
import { PajCashOfframpView } from "@/components/paj-cash/PajCashOfframpView";
import { pajListOrders, type PajCashOrder } from "@/services/pajCash";
import { AmountInput } from "@/components/AmountInput";

const PAJ_CASH_ENABLED = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === "true";

const LOG_PREFIX = "[BalanceModal]";
const PEER_LOG = "[Peer Offramp]";
const PEER_SESSION_KEY = "loofta_peer_session";
const PRIVATE_DEPOSIT_SESSION_KEY = "loofta_private_deposit_id";
const PRIVATE_WITHDRAW_SESSION_KEY = "loofta_private_withdraw_id";
const PRIVATE_TRANSFER_TERMINAL_STATUSES = new Set(["complete", "failed"]);
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ZKP2P_RATE_UNIT = 1_000_000_000_000_000_000n; // 1e18
function zkp2pRate(spreadPercent: number): string {
  // conversionRate = (1 - spread) * 1e18 — peers pay less fiat per USDC, incentivizing faster fills
  return ((ZKP2P_RATE_UNIT * BigInt(Math.round((1 - spreadPercent / 100) * 10_000))) / 10_000n).toString();
}
const BRIDGE_FEE_PCT = 0.6; // Near Intents ~0.1% + 50 BPS Loofta referral fee (Solana → Base)

type WithdrawalStep = "idle" | "submitting" | "sent" | "bridging" | "complete" | "failed" | "settling";
type PeerStep = "platform" | "form" | "bridging" | "creating-deposit" | "deposit-error" | "deposited" | "complete" | "cancelling" | "cancelled" | "failed";
type PeerOfframpRecord = { id: string; created_at: string; platform: string; platform_identifier: string; currency: string; amount_usdc: number; status: string; zkp2p_deposit_id: string | null };

// "cancelling" intentionally excluded — requires active signing and can't be resumed; maps to deposit-error on restore
const ACTIVE_PEER_STEPS = new Set<PeerStep>(["bridging", "creating-deposit", "deposit-error", "deposited"]);

const TERMINAL_BRIDGE_STATUSES = new Set(["SUCCESS", "COMPLETED", "REFUNDED", "FAILED", "EXPIRED"]);
const SUCCESS_BRIDGE_STATUSES = new Set(["SUCCESS", "COMPLETED"]);

function stepLabel(step: WithdrawalStep, isNearIntents: boolean): string {
  if (step === "submitting") return isNearIntents ? "Preparing withdrawal…" : "Building transaction…";
  if (step === "sent") return "Sending USDC…";
  if (step === "bridging") return "Processing…";
  if (step === "complete") return isNearIntents ? "Complete!" : "Sent!";
  if (step === "failed") return "Transaction failed";
  return "";
}

function bridgeStatusLabel(status: string | null | undefined): string {
  if (!status) return "Sending back to your wallet…";
  const s = status.toUpperCase();
  if (s === "PENDING") return "Received, processing…";
  if (s === "PROCESSING") return "On its way…";
  if (s === "SUCCESS" || s === "COMPLETED") return "Complete!";
  if (s === "REFUNDED") return "Refunded — your USDC has returned";
  if (s === "FAILED") return "Something went wrong";
  if (s === "EXPIRED") return "Expired — your USDC was returned";
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
        { label: "Preparing", sublabel: "Setting up your withdrawal", status: s1Status },
        { label: "Send USDC", sublabel: amountUSDC ? `Sending $${amountUSDC.toFixed(2)} USDC` : "Sending USDC", status: s2Status },
        {
          label: step === "complete" ? "Complete" : step === "failed" ? "Failed" : "Processing",
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
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-base font-bold ${dark ? "border-white/20 text-slate-500" : "border-gray-300 text-gray-400"}`}>
                  {i + 1}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-base font-medium ${textBase}`}>{s.label}</p>
              {s.sublabel && <p className={`text-base mt-0.5 ${textSub}`}>{s.sublabel}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Estimate / result */}
      {isNearIntents && estimatedOut && destinationToken && destinationChain && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${borderBase}`}>
          <ArrowRight className={`h-4 w-4 shrink-0 ${dark ? "text-slate-400" : "text-gray-400"}`} />
          <div>
            <p className={`text-base ${textSub}`}>You receive (estimated)</p>
            <p className={`text-base font-semibold ${textBase}`}>
              ~{Number(estimatedOut).toLocaleString(undefined, { maximumFractionDigits: 2 })} {destinationToken}
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
          className={`flex items-center gap-2 text-base rounded-lg border px-3 py-2 transition-colors ${dark ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
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

/**
 * Private Deposit "Pay now" widget. Connecting goes through the library's own WalletMultiButton
 * (its internal click handling is what actually works reliably; an earlier attempt to reimplement
 * that click with our own Button + useWalletModal() broke connecting entirely, for reasons that
 * weren't worth chasing further given a working alternative existed). Styled via CSS overrides
 * only, no behavior changes, to keep that working path intact. Once connected, WalletMultiButton
 * is swapped out for a plain address chip + our own Disconnect link (disconnect() is a simple
 * state call, not a modal-opening one, so reimplementing it doesn't carry the same risk). This
 * also avoids the connected state looking like a big gradient CTA when it's really just a status.
 * Must render inside SolanaWalletConnectProvider. Module-level (not nested in BalanceModal) so
 * it isn't redefined every render.
 */
function PrivateDepositPayNowWidget({
  dark,
  status,
  error,
  onPay,
  onViewAddressInstead,
}: {
  dark?: boolean;
  status: "idle" | "building" | "awaiting_signature" | "broadcasting" | "sent";
  error: string | null;
  onPay: (senderAddress: string, signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>) => void;
  onViewAddressInstead: () => void;
}) {
  const { publicKey, signTransaction, connected, disconnect } = useSolanaWalletAdapter();
  const canPay = connected && !!publicKey && !!signTransaction && status === "idle";
  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}..${publicKey.toBase58().slice(-4)}` : "";

  return (
    <div className="space-y-2">
      {connected && publicKey ? (
        <div className={`flex items-center justify-center gap-2 rounded-md py-2 ${dark ? "bg-white/5" : "bg-gray-50"}`}>
          <span className={`text-sm font-mono ${dark ? "text-slate-300" : "text-gray-700"}`}>{short}</span>
          <button type="button" onClick={() => void disconnect()}
            className={`text-sm underline underline-offset-2 ${dark ? "text-slate-500 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="[&_.wallet-adapter-dropdown]:block [&_.wallet-adapter-dropdown]:w-full [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center [&_.wallet-adapter-button]:h-10 [&_.wallet-adapter-button]:rounded-md [&_.wallet-adapter-button]:text-sm [&_.wallet-adapter-button]:font-medium [&_.wallet-adapter-button]:font-sans">
          <WalletMultiButton
            style={{ background: "linear-gradient(to right, #f97316, #ef4444)" }}
          />
        </div>
      )}
      {connected && publicKey && signTransaction && (
        <Button
          type="button"
          onClick={() => onPay(publicKey.toBase58(), signTransaction)}
          disabled={!canPay}
          className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
        >
          {status === "building" ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Preparing…</span>
          ) : status === "awaiting_signature" ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Confirm in your wallet…</span>
          ) : status === "broadcasting" ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Sending…</span>
          ) : status === "sent" ? (
            "Sent!"
          ) : (
            "Pay now"
          )}
        </Button>
      )}
      {error && <p className="text-sm text-center text-red-400">{error}</p>}
      {status === "idle" && (
        <button type="button" onClick={onViewAddressInstead}
          className={`w-full text-center text-base underline underline-offset-2 ${dark ? "text-slate-500 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>
          Or view the deposit address instead
        </button>
      )}
    </div>
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
  /** Tab to activate when the modal opens. Defaults to "topup". */
  initialTab?: "topup" | "withdraw" | "history";
  /** When true, `initialTab` was explicitly requested by a CTA (e.g. "Add funds to your
   * balance") — skip the auto-redirect to Recent for a stuck withdrawal so that request wins. */
  lockInitialTab?: boolean;
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
  initialTab,
  lockInitialTab = false,
}: BalanceModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useTokensQuery();

  // Optimistically subtract the withdrawn amount so the UI updates instantly.
  // The normal 5 s polling cycle will sync the real on-chain value once the TX is indexed.
  const optimisticWithdrawBalance = useCallback((amountUSDC: number) => {
    if (!solanaAddress) return;
    const mode = devnetMode ? "devnet" : "mainnet";
    const key = embeddedSolanaUsdcBalanceQueryKey(solanaAddress, mode);
    queryClient.setQueryData(key, (prev: { balanceUSD?: number; walletAddress?: string } | undefined) => {
      if (!prev) return prev;
      return { ...prev, balanceUSD: Math.max(0, (prev.balanceUSD ?? 0) - amountUSDC) };
    });
  }, [queryClient, solanaAddress, devnetMode]);

  const [tab, setTab] = useState<"topup" | "withdraw" | "history">(initialTab ?? "topup");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [addressRiskStatus, setAddressRiskStatus] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");
  const [recentWithdrawals, setRecentWithdrawals] = useState<WithdrawalHistoryItem[]>([]);
  const [dbDeposits, setDbDeposits] = useState<{ id: string; type: string; status: string; amount_usdc: number | null; deposit_address: string | null; bridge_status: string | null; created_at: string }[]>([]);
  const [dbDepositsLoading, setDbDepositsLoading] = useState(false);
  // DB id of the current in-flight Near Intents deposit so we can PATCH it as the bridge progresses
  const [depositDbId, setDepositDbId] = useState<string | null>(null);
  const [peerOfframpHistory, setPeerOfframpHistory] = useState<PeerOfframpRecord[]>([]);
  const [peerHistoryLoading, setPeerHistoryLoading] = useState(false);

  // Quote estimation for cross-chain
  const [quoteAmount, setQuoteAmount] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Withdrawal progress tracking
  const [withdrawStep, setWithdrawStep] = useState<WithdrawalStep>("idle");
  const [activeWithdrawal, setActiveWithdrawal] = useState<WithdrawalHistoryItem | null>(null);
  const [depositAddressForPolling, setDepositAddressForPolling] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null);

  // Blink crypto deposit
  const [blinkDepositing, setBlinkDepositing] = useState(false);
  const [blinkError, setBlinkError] = useState<string | null>(null);
  const blinkDepositRef = useRef<BlinkDeposit | null>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);

  const [coinbaseLoading, setCoinbaseLoading] = useState(false);
  const [withdrawMethod, setWithdrawMethod] = useState<"usdc-sol" | "near-intents" | "peer-offramp" | "private-relay" | "paj-cash" | null>(null);
  const [coinbaseOfframpLoading, setCoinbaseOfframpLoading] = useState(false);
  const [showFiatOfframpPicker, setShowFiatOfframpPicker] = useState(false);
  const [showFiatOnrampPicker, setShowFiatOnrampPicker] = useState(false);
  const [moonpayOfframpLoading, setMoonpayOfframpLoading] = useState(false);
  const [moonpayOnrampLoading, setMoonpayOnrampLoading] = useState(false);

  // Peer offramp state
  const [peerPlatformId, setPeerPlatformId] = useState<string | null>(null);
  const [peerIdentifier, setPeerIdentifier] = useState("");
  const [peerCurrency, setPeerCurrency] = useState("USD");
  const [peerStep, setPeerStep] = useState<PeerStep>("platform");
  const [peerSubmitting, setPeerSubmitting] = useState(false);
  const [peerOfframpId, setPeerOfframpId] = useState<string | null>(null);
  const [peerBridgeDepositAddress, setPeerBridgeDepositAddress] = useState<string | null>(null);
  const [peerBridgeMemo, setPeerBridgeMemo] = useState<string | null>(null);
  const [peerBridgeTxSig, setPeerBridgeTxSig] = useState<string | null>(null);
  const [peerBridgeStatus, setPeerBridgeStatus] = useState<string | null>(null);
  const [peerBaseWalletAddress, setPeerBaseWalletAddress] = useState<string | null>(null);
  const [peerAmountUSDC, setPeerAmountUSDC] = useState<number>(0);
  const [peerZkp2pDepositId, setPeerZkp2pDepositId] = useState<string | null>(null);
  const peerBridgePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerZkp2pSigningRef = useRef(false);
  const [peerCancelSubStep, setPeerCancelSubStep] = useState<"getting-address" | "signing-withdraw" | "signing-transfer" | "bridging-back" | null>(null);
  const [peerBridgeBackDepositAddress, setPeerBridgeBackDepositAddress] = useState<string | null>(null);
  const [peerBridgeBackStatus, setPeerBridgeBackStatus] = useState<string | null>(null);
  const peerBridgeBackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [platformCooldowns, setPlatformCooldowns] = useState<Record<string, number>>({});
  const [peerFxRates, setPeerFxRates] = useState<Record<string, number>>({});
  const [peerFxLoading, setPeerFxLoading] = useState(false);
  const [peerUsdcUsdPrice, setPeerUsdcUsdPrice] = useState<number>(1); // USDC/USD, defaults to 1

  // Near Intents top-up deposit
  const [topUpView, setTopUpView] = useState<"near-intents-deposit" | "private-deposit" | "paj-cash-onramp" | null>(null);

  // PAJ Cash (Naira on/off-ramp) history
  const [pajCashHistory, setPajCashHistory] = useState<PajCashOrder[]>([]);

  // Private Deposit (MagicBlock burner-relay) — USDC on Solana only for now (cross-chain sources
  // are built server-side but gated off until failed-bridge refund recovery is automated)
  const [privateDepositAmount, setPrivateDepositAmount] = useState("");
  const [privateDepositSubmitting, setPrivateDepositSubmitting] = useState(false);
  const [privateDepositId, setPrivateDepositId] = useState<string | null>(null);
  const [privateDepositAddress, setPrivateDepositAddress] = useState<string | null>(null);
  const [privateDepositStatus, setPrivateDepositStatus] = useState<PrivateTransferStatus | null>(null);
  const [privateDepositError, setPrivateDepositError] = useState<string | null>(null);
  // Gross amount to actually send to the burner (net amount + estimated fees). The amount input
  // is what the user will receive, not what they send. See private-balance.service.ts startDeposit.
  const [privateDepositSendAmount, setPrivateDepositSendAmount] = useState<number | null>(null);
  const [privateDepositFeeEstimate, setPrivateDepositFeeEstimate] = useState<number | null>(null);
  // Which CTA the user picked on the amount screen: controls whether the address/QR view or the
  // wallet-pay view is shown once the burner exists. Either can switch to the other afterward.
  const [privateDepositEntryMode, setPrivateDepositEntryMode] = useState<"qr" | null>(null);
  const privateDepositPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror privateDepositAddress/privateDepositSendAmount in refs so the "Pay now" flow (which can
  // be triggered in the same call as burner creation, before a re-render lands) always reads the
  // just-created burner instead of a stale pre-creation state closure.
  const privateDepositAddressRef = useRef<string | null>(null);
  const privateDepositSendAmountRef = useRef<number | null>(null);

  // Private Deposit "Pay now": @solana/wallet-adapter-react connect/disconnect state
  // (SolanaWalletConnectProvider, see components/SolanaWalletConnect.tsx) for an installed
  // Phantom/Solflare/etc., used to sign a plain USDC transfer to the burner in-app,
  // paying its own gas. No Loofta sponsor involved; the burner still performs the actual private
  // relay to the embedded wallet, unchanged.
  const [payNowStatus, setPayNowStatus] = useState<"idle" | "building" | "awaiting_signature" | "broadcasting" | "sent">("idle");
  const [payNowError, setPayNowError] = useState<string | null>(null);

  // Private Withdrawal (MagicBlock burner-relay) — to USDC on Solana direct, or any Near Intents token
  // cross-chain. Reuses the same withdrawAmount/withdrawAddress/fromSel state as usdc-sol/near-intents
  // withdrawals (withdrawTokens already resolves to [usdcSol, ...otherChains] for any non-near-intents
  // method, private-relay included — no separate token list needed).
  const [privateWithdrawSubmitting, setPrivateWithdrawSubmitting] = useState(false);
  const [privateWithdrawId, setPrivateWithdrawId] = useState<string | null>(null);
  const [privateWithdrawStatus, setPrivateWithdrawStatus] = useState<PrivateTransferStatus | null>(null);
  const [privateWithdrawError, setPrivateWithdrawError] = useState<string | null>(null);
  const [privateWithdrawFee, setPrivateWithdrawFee] = useState<number | null>(null);
  const privateWithdrawPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [depositFromSel, setDepositFromSel] = useState<TokenSelection | undefined>(undefined);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositRefundAddr, setDepositRefundAddr] = useState("");
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositAddr, setDepositAddr] = useState<string | null>(null);
  const [depositMemo, setDepositMemo] = useState<string | null>(null);
  const [depositBridgeStatus, setDepositBridgeStatus] = useState<string | null>(null);
  const [depositPollAddr, setDepositPollAddr] = useState<string | null>(null);
  const [depositQuoteOut, setDepositQuoteOut] = useState<string | null>(null);
  const [depositQuoteLoading, setDepositQuoteLoading] = useState(false);
  const [depositQuoteError, setDepositQuoteError] = useState<string | null>(null);
  const depositPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoExpiredRef = useRef<Set<string>>(new Set());

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { user, getAccessToken } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { fundWallet: privyFundWallet } = useFundWallet();
  const { wallets: evmWallets } = useEvmWallets();
  const { createWallet: createEvmWallet } = useCreateWallet();
  const { sendTransaction: privySendEvmTx } = useEvmSendTransaction();
  const { withdraw: perPrivateWithdraw } = usePerPrivateSelfTransfer();

  // Keep a ref so async callbacks always see the latest EVM wallets list
  const evmWalletsRef = useRef(evmWallets);
  useEffect(() => { evmWalletsRef.current = evmWallets; }, [evmWallets]);

  // Keep a ref to Privy's sendTransaction for use in async effects
  const privySendEvmTxRef = useRef(privySendEvmTx);
  useEffect(() => { privySendEvmTxRef.current = privySendEvmTx; }, [privySendEvmTx]);

  // DB deposit helpers
  const fetchDbDeposits = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    setDbDepositsLoading(true);
    try {
      const res = await fetch("/api/users/deposits", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setDbDeposits(data.deposits ?? []);
      }
    } catch { /* non-fatal */ } finally {
      setDbDepositsLoading(false);
    }
  }, [getAccessToken]);

  const recordDeposit = useCallback(async (
    type: string, status = "pending", amount_usdc?: number, deposit_address?: string
  ): Promise<string | null> => {
    const token = await getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch("/api/users/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, status, amount_usdc, deposit_address }),
      });
      if (res.ok) {
        const data = await res.json();
        fetchDbDeposits();
        return data.id ?? null;
      }
    } catch { /* non-fatal */ }
    return null;
  }, [getAccessToken, fetchDbDeposits]);

  const patchDeposit = useCallback(async (
    id: string, updates: { status?: string; bridge_status?: string; amount_usdc?: number }
  ) => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      await fetch("/api/users/deposits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, ...updates }),
      });
      fetchDbDeposits();
    } catch { /* non-fatal */ }
  }, [getAccessToken, fetchDbDeposits]);

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
      blinkDepositRef.current?.destroy();
      const { Deposit } = await import("@swype-org/deposit");
      blinkDepositRef.current = new Deposit({
        signer: getBlinkSigner,
        debug: true,
        containerElement: document.body,
      });
      const depositResult = await blinkDepositRef.current.requestDeposit({
        amount: null,
        chainId: 792703809,
        address: solanaAddress,
        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      });
      toast({ title: "Deposit complete!", description: "USDC will appear in your balance shortly." });
      const depositedAmount = depositResult?.transfer?.amount?.amount;
      recordDeposit("blink", "complete", depositedAmount);
      onRefresh();
    } catch (err: unknown) {
      const { DepositError, getDisplayMessage } = await import("@swype-org/deposit");
      const msg = err instanceof DepositError ? getDisplayMessage(err) : "Deposit failed. Please try again.";
      setBlinkError(msg);
    } finally {
      blinkDepositRef.current?.destroy();
      blinkDepositRef.current = null;
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

      recordDeposit("coinbase", "pending");

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
      window.open(offrampUrl, "_blank");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open Coinbase Off-ramp.";
      toast({ variant: "destructive", title: "Off-ramp error", description: msg });
    } finally {
      setCoinbaseOfframpLoading(false);
    }
  };

  // MoonPay Off-ramp: open MoonPay via Privy's fund wallet with MoonPay as preferred provider
  const handleMoonpayOfframp = async () => {
    if (!solanaAddress) return;
    setMoonpayOfframpLoading(true);
    try {
      await privyFundWallet({ address: solanaAddress, options: { asset: 'USDC', card: { preferredProvider: 'moonpay' } } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open MoonPay.";
      toast({ variant: "destructive", title: "MoonPay error", description: msg });
    } finally {
      setMoonpayOfframpLoading(false);
    }
  };

  // MoonPay Onramp: buy USDC via Privy's fund wallet, bypassing the method picker
  const handleMoonpayOnramp = async () => {
    if (!solanaAddress) return;
    setMoonpayOnrampLoading(true);
    try {
      recordDeposit("moonpay", "pending");
      await privyFundWallet({
        address: solanaAddress,
        options: {
          asset: 'USDC',
          defaultFundingMethod: 'card',
          card: { preferredProvider: 'moonpay' },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open MoonPay.";
      toast({ variant: "destructive", title: "MoonPay error", description: msg });
    } finally {
      setMoonpayOnrampLoading(false);
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
      recordDeposit("near-intents", "pending", depositQuoteOut ? parseFloat(depositQuoteOut) : undefined, info.depositAddress).then((id) => {
        setDepositDbId(id);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not get deposit address";
      toast({ variant: "destructive", title: "Failed to get deposit address", description: msg });
    } finally {
      setDepositSubmitting(false);
    }
  };

  // Private Deposit: create a one-time burner address to send USDC to (USDC on Solana only for now).
  // Single CTA on the amount screen. The next screen is where the user picks Pay now vs. Get
  // deposit address (privateDepositEntryMode), no QR shown until they explicitly ask for it.
  const privateDepositAmountNum = parseFloat(privateDepositAmount) || 0;
  const handleStartPrivateDeposit = async () => {
    if (!user?.id || !privateDepositAmountNum) return;
    setPrivateDepositSubmitting(true);
    setPrivateDepositError(null);
    try {
      const accessToken = await getAccessToken();
      const result = await startPrivateDeposit(privateDepositAmountNum, user.id, accessToken, devnetMode ? "devnet" : "mainnet");
      const sendAmount = result.amountToSendUsdc ?? privateDepositAmountNum;
      privateDepositAddressRef.current = result.depositAddress;
      privateDepositSendAmountRef.current = sendAmount;
      setPrivateDepositId(result.id);
      setPrivateDepositAddress(result.depositAddress);
      setPrivateDepositStatus("awaiting_funds");
      setPrivateDepositSendAmount(sendAmount);
      setPrivateDepositFeeEstimate(result.feeEstimateUsdc ?? null);
      localStorage.setItem(PRIVATE_DEPOSIT_SESSION_KEY, result.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not start private deposit";
      toast({ variant: "destructive", title: "Failed to start private deposit", description: msg });
    } finally {
      setPrivateDepositSubmitting(false);
    }
  };

  const resetPrivateDeposit = useCallback(() => {
    setPrivateDepositId(null);
    setPrivateDepositAddress(null);
    setPrivateDepositStatus(null);
    setPrivateDepositError(null);
    setPrivateDepositAmount("");
    setPrivateDepositSendAmount(null);
    setPrivateDepositFeeEstimate(null);
    setPrivateDepositEntryMode(null);
    privateDepositAddressRef.current = null;
    privateDepositSendAmountRef.current = null;
    setPayNowStatus("idle");
    setPayNowError(null);
    localStorage.removeItem(PRIVATE_DEPOSIT_SESSION_KEY);
  }, []);

  // Private Deposit "Pay now": build the funding transfer and sign it with whatever wallet
  // SolanaWalletConnectProvider/useWallet() has connected. The existing status-poll effect below
  // picks up the burner-funded -> delivering -> complete transitions automatically once this lands
  // on-chain, exactly as it does for a manually-sent deposit. No extra plumbing needed here.
  const payPrivateDepositFromWallet = useCallback(async (
    senderAddress: string,
    signTx: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
  ) => {
    // Read from refs, not state: this can run right after burner creation in the same click
    // (before a re-render lands), so the state variables may still be stale.
    const depositAddress = privateDepositAddressRef.current;
    const sendAmount = privateDepositSendAmountRef.current;
    if (!depositAddress || !sendAmount) return;
    setPayNowError(null);
    try {
      const mode = devnetMode ? "devnet" : "mainnet";
      const connection = new Connection(getRpcForMode(mode), "confirmed");

      setPayNowStatus("building");
      const unsignedTx = await buildUSDCTransferTransaction({
        senderAddress,
        recipientAddress: depositAddress,
        amountUSDC: sendAmount,
        connection,
        usdcMint: getUsdcMintForMode(mode),
      });

      setPayNowStatus("awaiting_signature");
      const signedTx = await signTx(unsignedTx);

      setPayNowStatus("broadcasting");
      const signature = await sendSignedUSDCTransfer(signedTx, connection);
      await waitForSignatureConfirmation(connection, signature, 120_000, 1500, "privateDepositPayNow");

      setPayNowStatus("sent");
      toast({ title: "Sent!", description: "Routing privately to your balance…" });
    } catch (err: unknown) {
      setPayNowStatus("idle");
      const msg = err instanceof Error ? err.message : "Payment failed. Please try again.";
      setPayNowError(msg);
      toast({ variant: "destructive", title: "Payment failed", description: msg });
    }
  }, [devnetMode, toast]);

  // Private Withdrawal: sign leg 1 (own wallet -> burner); backend cron handles leg 2 (burner -> destination).
  // USDC on Solana only for now — reuses withdrawAmount/withdrawAddress, same state usdc-sol uses.
  const handlePrivateWithdraw = async () => {
    if (!user?.id || !wallet || !solanaAddress) return;
    const amount = parseFloat(withdrawAmount) || 0;
    const destination = withdrawAddress.trim();
    if (!amount || !destination) return;
    setPrivateWithdrawSubmitting(true);
    setPrivateWithdrawError(null);
    try {
      const accessToken = await getAccessToken();
      const anchorWallet = privyStandardWalletToAnchorWallet(
        wallet,
        signTransaction,
        getPrivySolanaChainForMode(devnetMode ? "devnet" : "mainnet"),
      );
      const { id } = await perPrivateWithdraw(anchorWallet, {
        privyUserId: user.id,
        accessToken,
        amountUsdc: amount,
        destinationAddress: destination,
        onTxBuilt: ({ id: txId, feeAmountUsdc }) => {
          setPrivateWithdrawId(txId);
          setPrivateWithdrawFee(feeAmountUsdc);
          setPrivateWithdrawStatus("awaiting_signature");
          localStorage.setItem(PRIVATE_WITHDRAW_SESSION_KEY, txId);
        },
      });
      setPrivateWithdrawId(id);
      setPrivateWithdrawStatus("delivering_to_burner");
      optimisticWithdrawBalance(amount);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Private withdrawal failed";
      setPrivateWithdrawError(msg);
      toast({ variant: "destructive", title: "Private withdrawal failed", description: msg });
    } finally {
      setPrivateWithdrawSubmitting(false);
    }
  };

  const resetPrivateWithdraw = useCallback(() => {
    setPrivateWithdrawId(null);
    setPrivateWithdrawStatus(null);
    setPrivateWithdrawError(null);
    setPrivateWithdrawFee(null);
    setWithdrawAmount("");
    setWithdrawAddress("");
    localStorage.removeItem(PRIVATE_WITHDRAW_SESSION_KEY);
  }, []);

  const wallet = useMemo(
    () => (solanaAddress ? solanaWallets?.find((w) => w.address === solanaAddress) : undefined),
    [solanaAddress, solanaWallets]
  );

  const pajPrefillEmail = user?.email?.address || undefined;

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

  // Persist active peer session to localStorage so page refresh restores state
  useEffect(() => {
    if (ACTIVE_PEER_STEPS.has(peerStep) && peerOfframpId) {
      const session = {
        peerPlatformId, peerIdentifier, peerCurrency, peerStep, peerOfframpId,
        peerBridgeDepositAddress, peerBridgeMemo, peerBridgeTxSig, peerBridgeStatus,
        peerBaseWalletAddress, peerAmountUSDC, peerZkp2pDepositId,
        peerBridgeBackDepositAddress,
      };
      localStorage.setItem(PEER_SESSION_KEY, JSON.stringify(session));
      console.log(PEER_LOG, "session saved", session);
    } else if (peerStep === "cancelling" && peerOfframpId && peerBridgeBackDepositAddress) {
      const session = {
        peerPlatformId, peerIdentifier, peerCurrency, peerStep, peerOfframpId,
        peerBridgeDepositAddress, peerBridgeMemo, peerBridgeTxSig, peerBridgeStatus,
        peerBaseWalletAddress, peerAmountUSDC, peerZkp2pDepositId,
        peerBridgeBackDepositAddress,
      };
      localStorage.setItem(PEER_SESSION_KEY, JSON.stringify(session));
      console.log(PEER_LOG, "session saved (cancelling+bridging-back)", session);
    } else if (["complete", "cancelled", "failed"].includes(peerStep)) {
      localStorage.removeItem(PEER_SESSION_KEY);
      console.log(PEER_LOG, "session cleared — terminal state:", peerStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerStep, peerBridgeStatus, peerBridgeTxSig, peerOfframpId, peerZkp2pDepositId, peerBridgeBackDepositAddress]);

  // Peer offramp: bridge polling
  useEffect(() => {
    if (peerStep !== "bridging" || !peerBridgeDepositAddress) {
      if (peerBridgePollRef.current) clearInterval(peerBridgePollRef.current);
      return;
    }
    console.log(PEER_LOG, "bridge polling started", { depositAddress: peerBridgeDepositAddress });
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await getExecutionStatus(peerBridgeDepositAddress);
        const s = String(result?.status || result?.executionStatus || result?.state || "PENDING").toUpperCase();
        console.log(PEER_LOG, "bridge status", s);
        setPeerBridgeStatus(s);
        if (SUCCESS_BRIDGE_STATUSES.has(s) && !cancelled) {
          console.log(PEER_LOG, "bridge SUCCESS — moving to Peer signing");
          // ZKP2P signing is handled by the creating-deposit effect below
          setPeerStep("creating-deposit");
        } else if (TERMINAL_BRIDGE_STATUSES.has(s) && !cancelled) {
          console.log(PEER_LOG, "bridge terminal:", s);
          setPeerStep(s === "REFUNDED" ? "cancelled" : "failed");
        }
      } catch (err) {
        console.warn(PEER_LOG, "bridge poll error", err);
      }
    };
    poll();
    peerBridgePollRef.current = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (peerBridgePollRef.current) clearInterval(peerBridgePollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerStep, peerBridgeDepositAddress]);

  // Peer offramp: sign ZKP2P approve + createDeposit on Base using user's Privy EVM wallet
  useEffect(() => {
    if (peerStep !== "creating-deposit") {
      peerZkp2pSigningRef.current = false;
      return;
    }
    if (peerZkp2pSigningRef.current) return; // prevent double-run
    if (!peerOfframpId || !peerBaseWalletAddress || !peerAmountUSDC || !peerPlatformId) return;

    const platform = getPlatform(peerPlatformId);
    if (!platform) { setPeerStep("failed"); return; }

    const evmWalletForCheck = evmWalletsRef.current.find(
      (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
    );
    if (!evmWalletForCheck) {
      console.warn(PEER_LOG, "EOA wallet not ready yet, waiting...");
      return;
    }

    peerZkp2pSigningRef.current = true;
    let cancelled = false;

    const run = async () => {
      try {
        console.log(PEER_LOG, "step 3 — Peer signing on Base (gas sponsored via Privy)", { baseWallet: peerBaseWalletAddress });
        const evmGateToken = await getAccessToken();
        await assertEvmSponsorAllowed(peerBaseWalletAddress!, user!.id, evmGateToken);

        const { base } = await import("viem/chains");
        const { createPublicClient: mkPublic, createWalletClient, custom, http: httpT, erc20Abi: _erc20Abi, encodeFunctionData } = await import("viem");

        const evmWallet = evmWalletsRef.current.find(
          (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
        );
        if (!evmWallet) throw new Error("Base wallet not available — please try again.");

        const rawProvider = await (evmWallet as any).getEthereumProvider();
        const privySendTx = privySendEvmTxRef.current;

        // Custom transport: intercept eth_sendTransaction and route through Privy's gas sponsorship
        const sponsoredTransport = custom({
          async request({ method, params }: { method: string; params: any[] }) {
            if (method === 'eth_chainId') return '0x2105';
            if (method === 'eth_sendTransaction') {
              const tx = params[0];
              const result = await privySendTx({
                to: tx.to,
                data: tx.data,
                ...(tx.value ? { value: BigInt(tx.value) } : {}),
                chainId: base.id,
              }, { sponsor: true });
              return result.hash;
            }
            return rawProvider.request({ method, params });
          }
        });

        const sponsoredClient = createWalletClient({
          chain: base,
          transport: sponsoredTransport,
          account: peerBaseWalletAddress as `0x${string}`,
        });

        const { OfframpClient, getContracts } = await import("@zkp2p/sdk");
        const client = new OfframpClient({ walletClient: sponsoredClient as any, chainId: base.id, runtimeEnv: 'production' });
        const { addresses } = getContracts(base.id, "production");

        // Use actual on-chain balance — bridge fee may have reduced the delivered amount
        const pubClient = mkPublic({ chain: base, transport: httpT("https://mainnet.base.org") });
        const rawBalance = await pubClient.readContract({
          address: BASE_USDC_ADDRESS,
          abi: _erc20Abi,
          functionName: "balanceOf",
          args: [peerBaseWalletAddress as `0x${string}`],
        }) as bigint;
        if (rawBalance === 0n) throw new Error("No USDC found on Base wallet. It may still be bridging — please wait and retry.");
        const atomicUsdc = rawBalance;
        console.log(PEER_LOG, "Base USDC balance", rawBalance.toString(), "requested", Math.round(peerAmountUSDC * 1_000_000));

        // Check allowance — approve via Privy sponsored tx if needed
        const currentAllowance = await pubClient.readContract({
          address: BASE_USDC_ADDRESS,
          abi: _erc20Abi,
          functionName: "allowance",
          args: [peerBaseWalletAddress as `0x${string}`, addresses.escrow as `0x${string}`],
        }) as bigint;
        console.log(PEER_LOG, "current allowance", currentAllowance.toString(), "needed", atomicUsdc.toString());
        if (currentAllowance < atomicUsdc) {
          console.log(PEER_LOG, "approving USDC for Peer escrow (Privy sponsored)...");
          await privySendTx({
            to: BASE_USDC_ADDRESS,
            data: encodeFunctionData({ abi: _erc20Abi, functionName: 'approve', args: [addresses.escrow as `0x${string}`, atomicUsdc] }),
            chainId: base.id,
          }, { sponsor: true });
          console.log(PEER_LOG, "approval complete");
        } else {
          console.log(PEER_LOG, "allowance sufficient, skipping approval");
        }

        if (cancelled) return;

        // ZKP2P expects the raw username without display prefixes (@ for Revolut/Venmo, $ for Cash App)
        const zkp2pId = peerIdentifier.trim().replace(/^[@$]/, "");
        // Minimum intent: larger of 10% of deposit or $5 USDC (allows partial fills)
        const FIVE_USDC = 5_000_000n;
        const tenPercent = atomicUsdc / 10n;
        const minIntent = tenPercent > FIVE_USDC ? tenPercent : FIVE_USDC;
        console.log(PEER_LOG, "signing createDeposit...", { platform: platform.processorName, identifier: zkp2pId, currency: peerCurrency, minIntent: minIntent.toString(), maxIntent: atomicUsdc.toString() });
        const { hash: depositTxHash } = await client.createDeposit({
          token: BASE_USDC_ADDRESS,
          amount: atomicUsdc,
          intentAmountRange: { min: minIntent, max: atomicUsdc },
          processorNames: [platform.processorName],
          payeeData: [{ offchainId: zkp2pId }],
          conversionRates: [[{ currency: peerCurrency.toUpperCase(), conversionRate: zkp2pRate(getPeerCurrency(peerCurrency)?.spreadPercent ?? 0) }]],
        });

        if (cancelled) return;

        // Wait for tx to be mined, then extract deposit ID from receipt logs
        const receipt = await pubClient.waitForTransactionReceipt({ hash: depositTxHash as `0x${string}`, timeout: 90_000 });
        let depositId: string | null = null;

        // Primary: parse deposit ID from emitted event logs
        try {
          const { parseEventLogs } = await import("viem");
          const { getContracts: getZkpContracts } = await import("@zkp2p/sdk");
          const { abis } = getZkpContracts(base.id, 'production');
          const parsed = parseEventLogs({ abi: abis.escrow as any, logs: receipt.logs });
          for (const log of parsed as any[]) {
            if (log.args?.depositId !== undefined) {
              depositId = log.args.depositId.toString();
              break;
            }
          }
        } catch { /* fall through to polling */ }

        // Fallback: poll getAccountDeposits until the new deposit appears
        if (!depositId) {
          for (let attempt = 0; attempt < 6; attempt++) {
            try {
              const deposits = await client.getAccountDeposits(peerBaseWalletAddress as `0x${string}`);
              if (Array.isArray(deposits) && deposits.length > 0) {
                const latest = deposits[deposits.length - 1];
                depositId = latest?.depositId?.toString() ?? null;
                if (depositId) break;
              }
            } catch { /* retry */ }
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        console.log(PEER_LOG, "Peer deposit created", { depositId, depositTxHash });

        // Notify backend to record the deposit
        const accessToken = await getAccessToken();
        await fetch(`/api/offramp/${peerOfframpId}?action=record-deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ depositId, txHash: depositTxHash }),
        });

        if (!cancelled) {
          if (depositId) setPeerZkp2pDepositId(depositId);
          // Only record cooldown after ZKP2P deposit is confirmed created
          recordPlatformWithdraw(platform.id);
          setPeerStep("deposited");
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(PEER_LOG, "Peer sign error", msg);
        peerZkp2pSigningRef.current = false;

        const isGasError = msg.includes("insufficient funds for gas") || msg.includes("exceeds the balance of the account");
        if (isGasError && peerBaseWalletAddress && peerOfframpId) {
          // Auto-fund gas and retry
          console.log(PEER_LOG, "gas insufficient — requesting gas funding from backend");
          toast({ title: "Funding gas…", description: "Getting ETH for your Base wallet, retrying in a moment." });
          try {
            const t = await getAccessToken();
            await fetch(`/api/offramp/${peerOfframpId}?action=fund-gas`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
              body: JSON.stringify({ baseWalletAddress: peerBaseWalletAddress }),
            });
          } catch { /* non-fatal */ }
          // Wait for funding tx to land then retry
          await new Promise(r => setTimeout(r, 8000));
          if (!cancelled) setPeerStep("creating-deposit");
        } else if (msg.includes("user rejected") || msg.includes("denied") || msg.includes("User rejected")) {
          toast({ variant: "destructive", title: "Signing cancelled", description: "You declined the transaction. Tap retry to try again." });
          setPeerStep("bridging");
        } else {
          toast({ variant: "destructive", title: "Setup failed", description: "Your USDC is safe. Try again or cancel to get it back." });
          setPeerStep("deposit-error");
        }
      }
    };

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerStep, peerOfframpId, peerBaseWalletAddress, peerAmountUSDC, peerPlatformId, evmWallets]);

  // Peer offramp: ZKP2P deposit status polling
  useEffect(() => {
    if (peerStep !== "deposited" || !peerOfframpId) {
      if (peerStatusPollRef.current) clearInterval(peerStatusPollRef.current);
      return;
    }
    console.log(PEER_LOG, "Peer status polling started", { offrampId: peerOfframpId });
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/offramp/${peerOfframpId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json() as { status?: string };
        console.log(PEER_LOG, "Peer status poll", data.status);
        if (data.status === "COMPLETE" && !cancelled) {
          console.log(PEER_LOG, "offramp COMPLETE");
          setPeerStep("complete");
          onRefresh();
        } else if ((data.status === "CANCELLED" || data.status === "FAILED") && !cancelled) {
          console.log(PEER_LOG, "offramp terminal:", data.status);
          setPeerStep(data.status === "CANCELLED" ? "cancelled" : "failed");
        }
      } catch (err) {
        console.warn(PEER_LOG, "Peer poll error", err);
      }
    };
    poll();
    peerStatusPollRef.current = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      if (peerStatusPollRef.current) clearInterval(peerStatusPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerStep, peerOfframpId]);

  // Peer offramp: bridge-back polling (after sending USDC to Near Intents during cancellation)
  useEffect(() => {
    if (peerCancelSubStep !== "bridging-back" || !peerBridgeBackDepositAddress) {
      if (peerBridgeBackPollRef.current) clearInterval(peerBridgeBackPollRef.current);
      return;
    }
    console.log(PEER_LOG, "bridge-back polling started", { depositAddress: peerBridgeBackDepositAddress });
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await getExecutionStatus(peerBridgeBackDepositAddress);
        const s = String(result?.status || result?.executionStatus || result?.state || "PENDING").toUpperCase();
        console.log(PEER_LOG, "bridge-back status", s);
        setPeerBridgeBackStatus(s);
        if (SUCCESS_BRIDGE_STATUSES.has(s) && !cancelled) {
          console.log(PEER_LOG, "bridge-back SUCCESS — marking cancelled");
          const token = await getAccessToken();
          await fetch(`/api/offramp/${peerOfframpId}?action=mark-cancelled`, {
            method: "POST", headers: { Authorization: `Bearer ${token}` },
          }).catch(() => { });
          if (peerPlatformId) clearPlatformWithdraw(peerPlatformId);
          setPeerCancelSubStep(null);
          setPeerBridgeBackDepositAddress(null);
          setPeerBridgeBackStatus(null);
          setPeerStep("cancelled");
          toast({ title: "USDC bridged back", description: "Your USDC has returned to Solana." });
        } else if (TERMINAL_BRIDGE_STATUSES.has(s) && !SUCCESS_BRIDGE_STATUSES.has(s) && !cancelled) {
          console.log(PEER_LOG, "bridge-back terminal (refund/fail):", s, "— restoring to deposit-error for retry");
          setPeerCancelSubStep(null);
          setPeerBridgeBackDepositAddress(null);
          setPeerBridgeBackStatus(null);
          setPeerStep("deposit-error");
          toast({ variant: "destructive", title: "Refunded", description: "Your USDC was returned. Tap 'Cancel and get USDC back' to complete the cancellation." });
        }
      } catch (err) {
        console.warn(PEER_LOG, "bridge-back poll error", err);
      }
    };
    poll();
    peerBridgeBackPollRef.current = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (peerBridgeBackPollRef.current) clearInterval(peerBridgeBackPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerCancelSubStep, peerBridgeBackDepositAddress]);

  // Compute per-platform cooldown remainders when the platform picker is shown
  useEffect(() => {
    if (withdrawMethod !== "peer-offramp" || peerStep !== "platform") return;
    const cooldowns: Record<string, number> = {};
    for (const p of PEER_PLATFORMS) {
      cooldowns[p.id] = getPlatformCooldownRemaining(p.id, p.cooldownHours);
    }
    setPlatformCooldowns(cooldowns);
  }, [withdrawMethod, peerStep]);

  // Fetch USDC/USD price + full FX table whenever a non-USD currency is selected
  useEffect(() => {
    if (peerCurrency === "USD") return;
    if (peerFxRates[peerCurrency]) return; // already fetched this currency
    setPeerFxLoading(true);
    Promise.all([
      // USD → all fiat rates
      fetch("https://open.er-api.com/v6/latest/USD").then(r => r.json()),
      // USDC/USD price from CoinGecko (no key needed for simple queries)
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd")
        .then(r => r.json())
        .catch(() => null),
    ])
      .then(([fxData, cgData]) => {
        if (fxData?.rates) setPeerFxRates(prev => ({ ...prev, ...fxData.rates }));
        const usdcPrice = cgData?.["usd-coin"]?.usd;
        if (usdcPrice) setPeerUsdcUsdPrice(usdcPrice);
      })
      .catch(() => { })
      .finally(() => setPeerFxLoading(false));
  }, [peerCurrency]);

  const getPeerEstimate = (amountUsdc: number, currency: string): { formatted: string; spreadPct: number } | null => {
    if (!amountUsdc || amountUsdc <= 0) return null;
    const cur = getPeerCurrency(currency);
    if (!cur) return null;
    const afterBridge = amountUsdc * (1 - BRIDGE_FEE_PCT / 100);
    if (currency === "USD") {
      const usd = afterBridge * peerUsdcUsdPrice * (1 - cur.spreadPercent / 100);
      return { formatted: `$${usd.toFixed(2)} USD`, spreadPct: cur.spreadPercent };
    }
    const usdToTarget = peerFxRates[currency];
    if (!usdToTarget) return null; // still loading
    const receive = afterBridge * peerUsdcUsdPrice * usdToTarget * (1 - cur.spreadPercent / 100);
    const decimals = currency === "EUR" ? 2 : 0;
    const formatted = `${cur.symbol}${receive.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })} ${currency}`;
    return { formatted, spreadPct: cur.spreadPercent };
  };

  // Clear Blink error and reset states when modal closes
  useEffect(() => {
    if (!open) {
      setBlinkError(null);
      setWithdrawMethod(null);
      setShowFiatOfframpPicker(false);
      setShowFiatOnrampPicker(false);
      // Reset peer offramp unless an active deposit is in-flight
      if (!["deposited", "bridging", "creating-deposit", "deposit-error"].includes(peerStep)) {
        setPeerPlatformId(null); setPeerIdentifier(""); setPeerCurrency("USD");
        setPeerStep("platform"); setPeerOfframpId(null);
        setPeerBridgeDepositAddress(null); setPeerBridgeMemo(null);
        setPeerBridgeTxSig(null); setPeerBridgeStatus(null);
        setPeerBaseWalletAddress(null); setPeerAmountUSDC(0); setPeerZkp2pDepositId(null);
        peerZkp2pSigningRef.current = false;
      }
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
    if (!selectedDepositToken || !depositAmountNum) {
      setDepositQuoteOut(null);
      setDepositQuoteLoading(false);
      setDepositQuoteError(null);
      return;
    }
    if (!usdcSolanaToken) {
      setDepositQuoteOut(null);
      setDepositQuoteLoading(false);
      setDepositQuoteError("USDC/Solana token list not loaded — try reopening the modal");
      return;
    }
    let cancelled = false;
    setDepositQuoteLoading(true);
    setDepositQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const r = await getAccurateQuote({
          fromToken: selectedDepositToken as NearToken,
          toToken: usdcSolanaToken as NearToken,
          amount: depositAmountNum.toString(),
          slippageBps: 100,
          dryRun: true,
        });
        if (cancelled) return;
        // r.error can be present even when r.amountOut is (a fee-free price-ratio fallback,
        // not a real quote) — never show that as if it were an accurate, fee-inclusive number.
        if (r.amountOut && !r.error) {
          setDepositQuoteOut(r.amountOut);
        } else {
          setDepositQuoteOut(null);
          const msg = r.error?.message || `Quote failed (${r.error?.type ?? "unknown"})`;
          setDepositQuoteError(msg);
          console.error("[deposit quote] failed:", r.error);
        }
      } catch (e) {
        if (!cancelled) {
          setDepositQuoteOut(null);
          setDepositQuoteError(e instanceof Error ? e.message : "Quote failed");
        }
      } finally {
        if (!cancelled) setDepositQuoteLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
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
          const isSuccess = SUCCESS_BRIDGE_STATUSES.has(s);
          if (depositDbId) patchDeposit(depositDbId, { status: isSuccess ? "complete" : "failed", bridge_status: s, ...(isSuccess && depositQuoteOut ? { amount_usdc: parseFloat(depositQuoteOut) } : {}) });
          setDepositPollAddr(null);
          if (isSuccess) onRefresh();
        } else {
          if (depositDbId) patchDeposit(depositDbId, { bridge_status: s });
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

  // Private Deposit: restore an in-progress session on reopen (completion is backend-driven, can outlive a single session)
  useEffect(() => {
    if (!open || privateDepositId) return;
    const saved = localStorage.getItem(PRIVATE_DEPOSIT_SESSION_KEY);
    if (saved) setPrivateDepositId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Private Deposit: status polling
  useEffect(() => {
    if (!privateDepositId || !user?.id || PRIVATE_TRANSFER_TERMINAL_STATUSES.has(privateDepositStatus || "")) {
      if (privateDepositPollRef.current) clearInterval(privateDepositPollRef.current);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const accessToken = await getAccessToken();
        const status = await getPrivateTransferStatus(privateDepositId, user.id, accessToken);
        if (cancelled) return;
        setPrivateDepositStatus(status.status);
        if (status.depositAddress) setPrivateDepositAddress(status.depositAddress);
        if (status.errorMessage) setPrivateDepositError(status.errorMessage);
        if (status.status === "complete") {
          localStorage.removeItem(PRIVATE_DEPOSIT_SESSION_KEY);
          onRefresh();
        } else if (status.status === "failed") {
          localStorage.removeItem(PRIVATE_DEPOSIT_SESSION_KEY);
        }
      } catch { /* ignore, retry next tick */ }
    };
    poll();
    privateDepositPollRef.current = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (privateDepositPollRef.current) clearInterval(privateDepositPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateDepositId, privateDepositStatus, user?.id]);

  // Private Withdrawal: restore an in-progress session on reopen
  useEffect(() => {
    if (!open || privateWithdrawId) return;
    const saved = localStorage.getItem(PRIVATE_WITHDRAW_SESSION_KEY);
    if (saved) setPrivateWithdrawId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Private Withdrawal: status polling — leg 2 (burner -> destination) is entirely backend-driven
  useEffect(() => {
    if (!privateWithdrawId || !user?.id || PRIVATE_TRANSFER_TERMINAL_STATUSES.has(privateWithdrawStatus || "")) {
      if (privateWithdrawPollRef.current) clearInterval(privateWithdrawPollRef.current);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const accessToken = await getAccessToken();
        const status = await getPrivateTransferStatus(privateWithdrawId, user.id, accessToken);
        if (cancelled) return;
        setPrivateWithdrawStatus(status.status);
        if (status.errorMessage) setPrivateWithdrawError(status.errorMessage);
        if (status.status === "complete") {
          localStorage.removeItem(PRIVATE_WITHDRAW_SESSION_KEY);
          onRefresh();
        } else if (status.status === "failed") {
          localStorage.removeItem(PRIVATE_WITHDRAW_SESSION_KEY);
        }
      } catch { /* ignore, retry next tick */ }
    };
    poll();
    privateWithdrawPollRef.current = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (privateWithdrawPollRef.current) clearInterval(privateWithdrawPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateWithdrawId, privateWithdrawStatus, user?.id]);

  // Auto-cancel pending deposits/withdrawals older than 1 hour
  const ONE_HOUR_MS = 60 * 60 * 1000;
  useEffect(() => {
    const now = Date.now();
    dbDeposits.forEach((dep) => {
      if (dep.status === "pending" && !autoExpiredRef.current.has(dep.id)) {
        const age = now - new Date(dep.created_at).getTime();
        if (age > ONE_HOUR_MS) {
          autoExpiredRef.current.add(dep.id);
          patchDeposit(dep.id, { status: "cancelled" });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbDeposits]);

  // Reset token selection and address when withdraw method changes
  useEffect(() => {
    setFromSel(undefined);
    setWithdrawAddress("");
    setAddressRiskStatus("idle");
  }, [withdrawMethod]);

  // On devnet, USDC on Solana is the only supported withdraw method — skip the picker.
  useEffect(() => {
    if (devnetMode && tab === "withdraw" && withdrawMethod === null) {
      setWithdrawMethod("usdc-sol");
    }
  }, [devnetMode, tab, withdrawMethod]);

  // On open: jump to requested tab (e.g. "withdraw" from UpdateJun26Modal)
  useEffect(() => {
    if (!open) return;
    if (initialTab) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // On open: load history and resume any in-progress Near Intents withdrawal
  useEffect(() => {
    if (!open) return;
    const history = getWithdrawalHistory();
    setRecentWithdrawals(history);
    fetchPeerHistory();
    fetchDbDeposits();
    fetchPajCashHistory();

    // Restore deposit view if a Near Intents top-up is still pending
    if (depositAddr && !TERMINAL_BRIDGE_STATUSES.has(depositBridgeStatus || "")) {
      setTab("topup");
      setTopUpView("near-intents-deposit");
    }

    // Restore active peer offramp session (survives page refresh)
    let restoredFromSession = false;
    try {
      const raw = localStorage.getItem(PEER_SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as {
          peerPlatformId: string | null; peerIdentifier: string; peerCurrency: string;
          peerStep: PeerStep; peerOfframpId: string | null;
          peerBridgeDepositAddress: string | null; peerBridgeMemo: string | null;
          peerBridgeTxSig: string | null; peerBridgeStatus: string | null;
          peerBaseWalletAddress: string | null; peerAmountUSDC: number;
          peerZkp2pDepositId: string | null; peerBridgeBackDepositAddress: string | null;
        };
        const isResumable = ACTIVE_PEER_STEPS.has(s.peerStep) || s.peerStep === "cancelling";
        if (isResumable && s.peerOfframpId) {
          // For cancelling with bridging-back in progress, restore to cancelling + bridging-back
          const restoredStep: PeerStep = (s.peerStep === "cancelling" && s.peerBridgeBackDepositAddress)
            ? "cancelling"
            : s.peerStep === "cancelling"
              ? "deposit-error"
              : s.peerStep;
          console.log(PEER_LOG, "restoring session from localStorage", s, "→ step:", restoredStep);
          setPeerPlatformId(s.peerPlatformId);
          setPeerIdentifier(s.peerIdentifier);
          setPeerCurrency(s.peerCurrency);
          setPeerStep(restoredStep);
          setPeerOfframpId(s.peerOfframpId);
          setPeerBridgeDepositAddress(s.peerBridgeDepositAddress);
          setPeerBridgeMemo(s.peerBridgeMemo);
          setPeerBridgeTxSig(s.peerBridgeTxSig);
          setPeerBridgeStatus(s.peerBridgeStatus);
          setPeerBaseWalletAddress(s.peerBaseWalletAddress ?? null);
          setPeerAmountUSDC(s.peerAmountUSDC ?? 0);
          setPeerZkp2pDepositId(s.peerZkp2pDepositId ?? null);
          setPeerBridgeBackDepositAddress(s.peerBridgeBackDepositAddress ?? null);
          // For cancelling with bridge-back in progress, restore sub-step
          if (restoredStep === "cancelling") {
            setPeerCancelSubStep("bridging-back");
          }
          setWithdrawMethod("peer-offramp");
          if (!lockInitialTab) setTab("history");
          restoredFromSession = true;
        }
      }
    } catch {
      localStorage.removeItem(PEER_SESSION_KEY);
    }

    // No localStorage session — check backend for any stuck offramp (e.g. after page refresh mid-flow)
    if (!restoredFromSession) {
      getAccessToken().then(async (token) => {
        if (!token) return;
        try {
          const res = await fetch("/api/offramp", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return;
          const record = await res.json() as {
            id: string; status: string; platform: string; platform_identifier: string;
            currency: string; amount_usdc: string; zkp2p_deposit_id: string | null;
          } | null;
          if (!record?.id) return;

          const baseWallet = evmWalletsRef.current.find(
            (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
          );

          console.log(PEER_LOG, "auto-detected pending record", { id: record.id, status: record.status, zkp2pDepositId: record.zkp2p_deposit_id });
          setPeerOfframpId(record.id);
          setPeerPlatformId(record.platform);
          setPeerIdentifier(record.platform_identifier);
          setPeerCurrency(record.currency);
          setPeerAmountUSDC(parseFloat(record.amount_usdc));
          if (baseWallet) setPeerBaseWalletAddress(baseWallet.address);

          if (record.status === 'CANCELLING') {
            // Cancellation was started but not completed — restore to deposit-error so user can finish bridging back
            console.log(PEER_LOG, "restoring CANCELLING → deposit-error (cancellation incomplete)");
            if (record.zkp2p_deposit_id) setPeerZkp2pDepositId(record.zkp2p_deposit_id);
            setPeerStep("deposit-error");
          } else if (!record.zkp2p_deposit_id) {
            // Bridge ran but ZKP2P deposit never created — show retry/bridge-back
            setPeerStep("deposit-error");
          } else {
            setPeerZkp2pDepositId(record.zkp2p_deposit_id);
            setPeerStep("deposited");
          }
          setWithdrawMethod("peer-offramp");
          if (!lockInitialTab) setTab("history");
        } catch { /* non-fatal */ }
      });
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

  // Auto-dismiss settling state after 7 s (lets the RPC index the TX)
  useEffect(() => {
    if (withdrawStep !== "settling") return;
    const t = setTimeout(() => {
      setWithdrawStep("idle");
      setWithdrawMethod(null);
      setActiveWithdrawal(null);
      onRefresh();
    }, 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawStep]);

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
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const r = await getAccurateQuote({
          fromToken: usdcSolanaToken as NearToken,
          toToken: effectiveToken as NearToken,
          amount: withdrawAmountNum.toString(),
          slippageBps: 100,
          dryRun: true,
        });
        if (cancelled) return;
        // r.error can be present even when r.amountOut is (a fee-free price-ratio fallback,
        // not a real quote) — never show that as if it were an accurate, fee-inclusive number.
        if (r.amountOut && !r.error) {
          setQuoteAmount(r.amountOut);
        } else {
          setQuoteAmount(null);
          const msg = r.error?.message || `Quote failed (${r.error?.type ?? "unknown"})`;
          setQuoteError(msg);
          console.error("[withdraw quote] failed:", r.error);
        }
      } catch (e) {
        if (!cancelled) {
          setQuoteAmount(null);
          setQuoteError(e instanceof Error ? e.message : "Quote failed");
        }
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
    if (!raw || !isValidAddressForChain(raw, "solana")) { setAddressRiskStatus("idle"); return; }
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

  const resetPeer = () => {
    console.log(PEER_LOG, "reset");
    localStorage.removeItem(PEER_SESSION_KEY);
    peerZkp2pSigningRef.current = false;
    setPeerStep("platform"); setPeerPlatformId(null); setPeerIdentifier(""); setPeerCurrency("USD");
    setPeerOfframpId(null); setPeerBridgeDepositAddress(null); setPeerBridgeMemo(null);
    setPeerBridgeTxSig(null); setPeerBridgeStatus(null);
    setPeerBaseWalletAddress(null); setPeerAmountUSDC(0); setPeerZkp2pDepositId(null);
    setPeerBridgeBackDepositAddress(null);
    setPeerBridgeBackStatus(null);
    setPeerCancelSubStep(null);
  };

  const fetchPeerHistory = async () => {
    const token = await getAccessToken();
    if (!token) return;
    setPeerHistoryLoading(true);
    try {
      const res = await fetch("/api/offramp?history=true", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const records = await res.json();
        setPeerOfframpHistory(Array.isArray(records) ? records : []);
      }
    } catch { /* non-fatal */ } finally { setPeerHistoryLoading(false); }
  };

  const fetchPajCashHistory = async () => {
    if (!PAJ_CASH_ENABLED) return;
    try {
      const token = await getAccessToken();
      const orders = await pajListOrders(token);
      setPajCashHistory(orders);
    } catch { /* non-fatal */ }
  };

  const resumePeerOfframp = (record: PeerOfframpRecord) => {
    const baseWallet = evmWalletsRef.current.find(
      (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
    );
    resetPeer();
    setPeerOfframpId(record.id);
    setPeerPlatformId(record.platform);
    setPeerIdentifier(record.platform_identifier);
    setPeerCurrency(record.currency);
    setPeerAmountUSDC(record.amount_usdc);
    if (baseWallet) setPeerBaseWalletAddress(baseWallet.address);
    if (record.zkp2p_deposit_id) setPeerZkp2pDepositId(record.zkp2p_deposit_id);
    if (record.status === "CANCELLING") {
      setPeerStep("deposit-error");
    } else {
      setPeerStep("deposited");
    }
    setWithdrawMethod("peer-offramp");
    setTab("withdraw");
  };

  const handlePeerBridgeBackDirect = async () => {
    if (!peerBaseWalletAddress || !peerOfframpId || !solanaAddress) return;
    setPeerStep("cancelling");
    setPeerCancelSubStep("getting-address");
    const token = await getAccessToken();
    await assertEvmSponsorAllowed(peerBaseWalletAddress, user!.id, token);
    try {
      const { createPublicClient, createWalletClient, custom, http, erc20Abi, encodeFunctionData } = await import("viem");
      const { base } = await import("viem/chains");

      // Build sponsored wallet client
      const evmWallet = evmWalletsRef.current.find(
        (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
      );
      if (!evmWallet) throw new Error("Base wallet not available");
      const rawProvider = await (evmWallet as any).getEthereumProvider();
      const privySendTx = privySendEvmTxRef.current;
      const sponsoredTransport = custom({
        async request({ method, params }: { method: string; params: any[] }) {
          if (method === 'eth_chainId') return '0x2105';
          if (method === 'eth_sendTransaction') {
            const tx = params[0];
            const result = await privySendTx({ to: tx.to, data: tx.data, ...(tx.value ? { value: BigInt(tx.value) } : {}), chainId: base.id }, { sponsor: true });
            return result.hash;
          }
          return rawProvider.request({ method, params });
        }
      });
      const walletClient = createWalletClient({ chain: base, transport: sponsoredTransport, account: peerBaseWalletAddress as `0x${string}` });

      // Step 2: Close any open ZKP2P deposit — if deposit found but withdrawal fails, STOP (don't mark cancelled)
      setPeerCancelSubStep("signing-withdraw");
      let foundDepositId: bigint | null = null;
      {
        const { OfframpClient } = await import("@zkp2p/sdk");
        const offrampClient = new OfframpClient({ walletClient: walletClient as any, chainId: base.id, runtimeEnv: 'production' });

        // Find deposit ID: use known value first, otherwise scan on-chain
        if (peerZkp2pDepositId) {
          foundDepositId = BigInt(peerZkp2pDepositId);
          console.log(PEER_LOG, "bridge-back: using known deposit ID", peerZkp2pDepositId);
        } else {
          try {
            const deposits = await offrampClient.getAccountDeposits(peerBaseWalletAddress as `0x${string}`);
            const activeDeposit = Array.isArray(deposits) ? deposits.find((d: any) => {
              const remaining = d.remainingDeposits ?? d.remainingAmount ?? d.deposit?.remainingDeposits;
              return remaining !== undefined && BigInt(remaining) > 0n;
            }) : null;
            if (activeDeposit) {
              const depositId = (activeDeposit as any).depositId ?? (activeDeposit as any).deposit?.depositId;
              foundDepositId = BigInt(depositId);
            }
          } catch (err: any) {
            console.warn(PEER_LOG, "bridge-back: deposit lookup failed (will check balance anyway)", err.message);
          }
        }

        if (foundDepositId !== null) {
          console.log(PEER_LOG, "bridge-back: withdrawing Peer deposit", { depositId: foundDepositId.toString() });
          try {
            await offrampClient.withdrawDeposit({ depositId: foundDepositId });
            console.log(PEER_LOG, "bridge-back: Peer deposit withdrawn");
          } catch (err: any) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(PEER_LOG, "bridge-back: withdrawDeposit failed", errMsg);
            setPeerCancelSubStep(null);
            if (errMsg.includes("user rejected") || errMsg.includes("denied")) {
              toast({ variant: "destructive", title: "Signing cancelled" });
            } else {
              toast({ variant: "destructive", title: "Could not retrieve USDC", description: "Your USDC is still in the cash out escrow. Please try again." });
            }
            setPeerStep("deposit-error");
            return;
          }
        } else {
          console.log(PEER_LOG, "bridge-back: no active Peer deposit found on-chain");
        }
      }

      // Step 3: Read ACTUAL on-chain balance (after withdrawal, exact amount to bridge)
      setPeerCancelSubStep("signing-transfer");
      const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
      const rawBalance = await publicClient.readContract({
        address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf",
        args: [peerBaseWalletAddress as `0x${string}`],
      }) as bigint;
      console.log(PEER_LOG, "bridge-back: actual Base USDC balance after withdrawal", rawBalance.toString());

      if (rawBalance === 0n) {
        if (foundDepositId !== null) {
          // We just withdrew from escrow but balance is still 0 — something went wrong
          setPeerCancelSubStep(null);
          toast({ variant: "destructive", title: "Balance check failed", description: "USDC not found after withdrawal. Please try again." });
          setPeerStep("deposit-error");
          return;
        }
        // No deposit found anywhere and no balance — safe to mark cancelled
        await fetch(`/api/offramp/${peerOfframpId}?action=mark-cancelled`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        setPeerCancelSubStep(null);
        setPeerStep("cancelled");
        toast({ title: "Cancelled", description: "No USDC remaining — record cleared." });
        return;
      }

      // Get bridge-back address using ACTUAL balance amount (prevents Near Intents "deposit < quoted" refund)
      const actualAmountUsdc = Number(rawBalance) / 1_000_000;
      console.log(PEER_LOG, "bridge-back: requesting bridge quote for actual amount", actualAmountUsdc);
      const bbRes = await fetch(`/api/offramp/${peerOfframpId}?action=bridge-back`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseWalletAddress: peerBaseWalletAddress, amountUsdc: actualAmountUsdc }),
      });
      const bbData = await bbRes.json() as { depositAddress?: string; amountUsdc?: number };
      if (!bbRes.ok || !bbData.depositAddress) throw new Error("Could not get refund bridge address");
      console.log(PEER_LOG, "bridge-back: Near Intents address", bbData.depositAddress, "for amount", actualAmountUsdc);

      // Send exact on-chain balance to bridge
      await privySendTx({
        to: BASE_USDC_ADDRESS,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [bbData.depositAddress as `0x${string}`, rawBalance] }),
        chainId: base.id,
      }, { sponsor: true });
      console.log(PEER_LOG, "bridge-back: USDC sent to Near Intents — starting bridge polling");

      // Step 4: Poll bridge status — don't mark cancelled until bridge confirms
      setPeerBridgeBackDepositAddress(bbData.depositAddress);
      setPeerBridgeBackStatus("PENDING");
      setPeerCancelSubStep("bridging-back");
      // Polling handled by useEffect
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(PEER_LOG, "bridge-back direct error", msg);
      setPeerCancelSubStep(null);
      if (msg.includes("user rejected") || msg.includes("denied")) {
        toast({ variant: "destructive", title: "Signing cancelled" });
      } else {
        toast({ variant: "destructive", title: "Bridge back failed", description: msg });
      }
      setPeerStep("deposit-error");
    }
  };

  const handlePeerSubmit = async () => {
    const platform = getPlatform(peerPlatformId ?? "");
    if (!platform || !peerIdentifier.trim() || !solanaAddress || !wallet) return;
    if (withdrawAmountNum < 1) {
      toast({ variant: "destructive", title: "Minimum $1", description: "Minimum offramp is $1.00 USDC." });
      return;
    }
    if (withdrawAmountNum > spendableBalance) {
      toast({ variant: "destructive", title: "Insufficient balance" });
      return;
    }
    if (withdrawAmountNum > platform.maxUSDC) {
      toast({ variant: "destructive", title: `${platform.name} limit is $${platform.maxUSDC} USDC` });
      return;
    }
    const cooldownRemaining = getPlatformCooldownRemaining(platform.id, platform.cooldownHours);
    if (cooldownRemaining > 0) {
      toast({ variant: "destructive", title: `${platform.name} is in cooldown`, description: `${formatCooldown(cooldownRemaining)}` });
      return;
    }
    setPeerSubmitting(true);
    console.log(PEER_LOG, "submit", { platform: platform.id, amount: withdrawAmountNum, currency: peerCurrency });
    try {
      // Use Privy EOA embedded wallet — gas sponsored via Privy's gas management ({ sponsor: true })
      const findEvmWallet = () => evmWalletsRef.current.find(
        (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
      );
      let baseWallet = findEvmWallet();
      if (!baseWallet) {
        try { await createEvmWallet(); } catch (e: any) {
          if (!String(e?.message).toLowerCase().includes("already has")) throw e;
        }
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 300));
          baseWallet = findEvmWallet();
          if (baseWallet) break;
        }
      }
      if (!baseWallet) throw new Error("Could not load Base wallet. Please try again.");
      const baseWalletAddr = baseWallet.address;
      setPeerBaseWalletAddress(baseWalletAddr);
      setPeerAmountUSDC(withdrawAmountNum);
      console.log(PEER_LOG, "using Base EOA wallet (sponsored)", baseWalletAddr);

      const token = await getAccessToken();

      // 1. Prepare: get Near Intents bridge deposit address (bridge goes to user's Base wallet)
      console.log(PEER_LOG, "step 1 — prepare offramp");
      const prepRes = await fetch("/api/offramp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          platform: platform.processorName,
          identifier: peerIdentifier.trim(),
          currency: peerCurrency,
          amountUSDC: withdrawAmountNum,
          solanaAddress,
          baseWalletAddress: baseWalletAddr,
        }),
      });
      const prep = await prepRes.json() as { id?: string; depositAddress?: string; memo?: string; message?: string };
      console.log(PEER_LOG, "prepare response", { status: prepRes.status, id: prep.id, hasDepositAddr: !!prep.depositAddress });
      if (!prepRes.ok || !prep.depositAddress) {
        throw new Error((prep as any).message || "Failed to prepare offramp");
      }
      setPeerOfframpId(prep.id ?? null);
      setPeerBridgeDepositAddress(prep.depositAddress);
      setPeerBridgeMemo(prep.memo ?? null);

      // 2. Send Solana USDC to bridge deposit address
      console.log(PEER_LOG, "step 2 — send USDC to bridge", { depositAddress: prep.depositAddress, memo: prep.memo });
      setPeerStep("bridging");
      const mode = devnetMode ? "devnet" : "mainnet";
      const { Connection: SolanaConnection } = await import("@solana/web3.js");
      const connection = new SolanaConnection(getRpcForMode(mode), "confirmed");

      const bridgeAccessToken = await getAccessToken();
      const sig = await sendUsdcWithBackendFeePayer({
        senderAddress: solanaAddress,
        recipientAddress: prep.depositAddress,
        amountUSDC: withdrawAmountNum,
        connection,
        wallet,
        privyUserId: user!.id,
        signTransaction,
        memo: prep.memo ?? undefined,
        usdcMint: getUsdcMintForMode(mode),
        chain: getPrivySolanaChainForMode(mode),
        accessToken: bridgeAccessToken,
        network: devnetMode ? "devnet" : "mainnet",
        offrampRequestId: prep.id,
      });

      console.log(PEER_LOG, "USDC sent to bridge", { sig });
      setPeerBridgeTxSig(sig);
      setPeerBridgeStatus("PENDING");
      optimisticWithdrawBalance(withdrawAmountNum);

      // Confirm bridge start on backend (fire-and-forget)
      fetch(`/api/offramp/${prep.id}?action=confirm-bridge`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(PEER_LOG, "submit error", msg);
      if (msg.includes("user rejected") || msg.includes("denied")) {
        toast({ variant: "destructive", title: "Cancelled" });
        setPeerStep("form");
      } else {
        toast({ variant: "destructive", title: "Failed", description: msg });
        setPeerStep("failed");
      }
    } finally {
      setPeerSubmitting(false);
    }
  };

  const handlePeerCancel = async () => {
    if (!peerOfframpId) { setWithdrawMethod(null); resetPeer(); return; }
    console.log(PEER_LOG, "cancel", { offrampId: peerOfframpId, step: peerStep });

    // USDC is on Base but ZKP2P deposit ID is unknown or deposit never created — bridge back directly
    if ((peerStep === "creating-deposit" || peerStep === "deposit-error" || peerStep === "deposited") && peerBaseWalletAddress && !peerZkp2pDepositId) {
      return handlePeerBridgeBackDirect();
    }

    const token = await getAccessToken();
    if (peerBaseWalletAddress) await assertEvmSponsorAllowed(peerBaseWalletAddress, user!.id, token);

    // DEPOSITED state: user must sign ZKP2P withdrawDeposit + USDC bridge on Base
    if (peerStep === "deposited" && peerZkp2pDepositId && peerBaseWalletAddress) {
      setPeerStep("cancelling");
      setPeerCancelSubStep("getting-address");
      try {
        const { base } = await import("viem/chains");
        const { createWalletClient, createPublicClient, custom, encodeFunctionData, erc20Abi: _erc20Abi, http: httpT } = await import("viem");

        const evmWallet = evmWalletsRef.current.find(
          (w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"
        );
        if (!evmWallet) throw new Error("Base wallet not available");

        const rawProviderC = await (evmWallet as any).getEthereumProvider();
        const privySendTxCancel = privySendEvmTxRef.current;
        const sponsoredTransportCancel = custom({
          async request({ method, params }: { method: string; params: any[] }) {
            if (method === 'eth_chainId') return '0x2105';
            if (method === 'eth_sendTransaction') {
              const tx = params[0];
              const result = await privySendTxCancel({
                to: tx.to, data: tx.data,
                ...(tx.value ? { value: BigInt(tx.value) } : {}),
                chainId: base.id,
              }, { sponsor: true });
              return result.hash;
            }
            return rawProviderC.request({ method, params });
          }
        });
        const walletClient = createWalletClient({
          chain: base,
          transport: sponsoredTransportCancel,
          account: peerBaseWalletAddress as `0x${string}`,
        });

        // Sign ZKP2P withdrawDeposit (returns USDC to user's Base wallet)
        setPeerCancelSubStep("signing-withdraw");
        console.log(PEER_LOG, "cancel step 2 — signing Peer withdrawDeposit (sponsored)", { depositId: peerZkp2pDepositId });
        const { OfframpClient } = await import("@zkp2p/sdk");
        const client = new OfframpClient({ walletClient, chainId: base.id, runtimeEnv: 'production' });
        await client.withdrawDeposit({ depositId: BigInt(peerZkp2pDepositId) });
        console.log(PEER_LOG, "cancel step 2 done — Peer deposit withdrawn");

        // Read ACTUAL balance after ZKP2P withdrawal (quote must match what we send)
        setPeerCancelSubStep("signing-transfer");
        const publicClient = createPublicClient({ chain: base, transport: httpT("https://mainnet.base.org") });
        const rawBalance = await publicClient.readContract({
          address: BASE_USDC_ADDRESS,
          abi: _erc20Abi,
          functionName: "balanceOf",
          args: [peerBaseWalletAddress as `0x${string}`],
        }) as bigint;
        console.log(PEER_LOG, "cancel step 3 — actual Base balance after Peer withdrawal:", rawBalance.toString());

        if (rawBalance === 0n) {
          await fetch(`/api/offramp/${peerOfframpId}?action=mark-cancelled`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
          setPeerCancelSubStep(null);
          setPeerStep("cancelled");
          toast({ title: "Cancelled", description: "Funds cleared." });
          return;
        }

        // Get bridge-back address using actual balance amount
        const actualAmountUsdc = Number(rawBalance) / 1_000_000;
        const bbRes = await fetch(`/api/offramp/${peerOfframpId}?action=bridge-back`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ baseWalletAddress: peerBaseWalletAddress, amountUsdc: actualAmountUsdc }),
        });
        const bbData = await bbRes.json() as { depositAddress?: string; memo?: string; amountUsdc?: number };
        if (!bbRes.ok || !bbData.depositAddress) throw new Error("Could not get refund bridge address");
        console.log(PEER_LOG, "cancel step 3 — bridge-back address", bbData.depositAddress, "for", actualAmountUsdc, "USDC");

        // Send exact balance to bridge
        await privySendTxCancel({
          to: BASE_USDC_ADDRESS,
          data: encodeFunctionData({ abi: _erc20Abi, functionName: 'transfer', args: [bbData.depositAddress as `0x${string}`, rawBalance] }),
          chainId: base.id,
        }, { sponsor: true });
        console.log(PEER_LOG, "cancel step 4 — USDC sent to bridge, starting poll");

        // Poll bridge status — mark cancelled only after bridge confirms
        setPeerBridgeBackDepositAddress(bbData.depositAddress);
        setPeerBridgeBackStatus("PENDING");
        setPeerCancelSubStep("bridging-back");
        // Polling handled by useEffect
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(PEER_LOG, "cancel error", { msg, step: peerCancelSubStep });
        setPeerCancelSubStep(null);
        if (msg.includes("user rejected") || msg.includes("denied")) {
          toast({ variant: "destructive", title: "Signing cancelled", description: "You can retry cancellation." });
        } else {
          toast({ variant: "destructive", title: "Cancel failed", description: msg });
        }
        setPeerStep("deposited");
      }
      return;
    }

    // Pre-deposit cancel: backend handles everything
    setPeerStep("cancelling");
    try {
      const res = await fetch(`/api/offramp/${peerOfframpId}?action=cancel`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { status?: string; refundNote?: string; zkp2pDepositId?: string | null };
      console.log(PEER_LOG, "cancel response", data);

      if (data.status === 'CANCELLING' && peerBaseWalletAddress) {
        // Backend says ZKP2P deposit exists — need to sign withdrawal + bridge back
        if (data.zkp2pDepositId) setPeerZkp2pDepositId(data.zkp2pDepositId);
        setPeerStep("deposit-error");
      } else {
        setPeerStep("cancelled");
        if (data.refundNote) toast({ title: "Cancelling", description: data.refundNote });
      }
    } catch (err) {
      console.error(PEER_LOG, "cancel error", err);
      toast({ variant: "destructive", title: "Cancel failed", description: "Try again or contact support." });
      setPeerStep("deposited");
    }
  };

  const handleWithdraw = async () => {
    const rawAddress = withdrawAddress.trim();
    const amount = withdrawAmountNum;

    if (amount <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Enter an amount greater than 0." });
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
      if (!rawAddress || !isValidAddressForChain(rawAddress, "solana")) {
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
      const accessToken = await getAccessToken();
      let recipientAddress: string;
      let memo: string | null = null;
      let depositAddr: string | undefined;
      let nearIntentsOrderId: string | undefined;

      if (isNearIntentsWithdraw && usdcSolanaToken && effectiveToken) {
        // Fetch the deposit quote server-side and persist it as a real order BEFORE signing,
        // instead of trusting a deposit address fetched directly from NEAR's public API — see
        // project memory: solana sponsor security hardening. The backend verifies the ATA it
        // sponsors matches this order's own deposit_address.
        const order = await prepareNearIntentsWithdrawal(
          {
            fromToken: usdcSolanaToken as NearToken,
            toToken: effectiveToken as NearToken,
            amountUsdc: amount.toString(),
            destinationAddress: rawAddress,
            refundAddress: solanaAddress,
            isDevnet: devnetMode,
          },
          accessToken,
        );
        recipientAddress = order.depositAddress ?? "";
        memo = order.memo ?? null;
        depositAddr = recipientAddress;
        nearIntentsOrderId = order.id;

        if (!recipientAddress || !isValidAddressForChain(recipientAddress, "solana")) {
          throw new Error("Invalid deposit address from Near Intents. Please try again.");
        }
      } else {
        recipientAddress = rawAddress;
      }

      setWithdrawStep("sent");

      const sig = await sendUsdcWithBackendFeePayer({
        senderAddress: solanaAddress,
        recipientAddress,
        amountUSDC: amount,
        connection,
        wallet,
        privyUserId: user!.id,
        signTransaction,
        memo: memo ?? undefined,
        usdcMint: getUsdcMintForMode(mode),
        chain: getPrivySolanaChainForMode(mode),
        accessToken,
        network: devnetMode ? "devnet" : "mainnet",
        nearIntentsOrderId,
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
      // Optimistically subtract and schedule background refetches to sync with chain.
      optimisticWithdrawBalance(amount);
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      {/* modal={false} (see "fix modal blink") makes Radix's own DialogOverlay a no-op,
          so the backdrop is rendered by hand here instead. */}
      <DialogPortal>
        <div className="fixed inset-0 z-[100] bg-black/80 animate-in fade-in-0" aria-hidden />
      </DialogPortal>
      <DialogContent
        ref={dialogContentRef}
        onInteractOutside={(e) => e.preventDefault()}
        // BalanceModal is a global, app-level modal that can be opened from the header on top of
        // ANY page — including the Mystery Pack page, whose result/info sheets use z-[60]/z-[70]
        // for their own internal layering. The shared dialog wrapper's default z-50 sat below
        // those, so opening the balance modal while a pack sheet was showing rendered it behind
        // the sheet instead of on top like every other modal in the app.
        wrapperZIndexClassName="z-[100]"
        className={cn(
          contentCls,
          "left-0 right-0 top-0 [transform:none] h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col data-[state=open]:!zoom-in-100 data-[state=open]:!animate-none",
          "sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-xl sm:rounded-2xl sm:border sm:p-7 sm:gap-4 sm:overflow-y-auto sm:flex-none sm:block",
          "[&>button]:h-12 [&>button]:w-12 [&>button]:rounded-full [&>button_svg]:h-5 [&>button_svg]:w-5"
        )}
      >

        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-5 pb-2 shrink-0">
          <div className={`w-10 h-1 rounded-full ${dark ? "bg-white/20" : "bg-gray-300"}`} />
        </div>

        {/* Scrollable content area */}
        <div
          className="sm:contents px-6 pb-6 sm:p-0 space-y-5 sm:space-y-4"
          style={{ flex: "1 1 0", height: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >

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
              <span className={cn("relative z-10 font-semibold text-base transition-colors duration-300",
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
              <span className={cn("relative z-10 font-semibold text-base transition-colors duration-300",
                tab === "withdraw" ? (dark ? "text-slate-100" : "text-gray-900") : (dark ? "text-slate-400" : "text-gray-500")
              )}>
                {withdrawStep !== "idle" && withdrawStep !== "complete" && withdrawStep !== "failed" ? "Active" : "Withdraw"}
              </span>
            </button>

            {/* Recent */}
            <button
              type="button"
              onClick={() => {
                setRecentWithdrawals(getWithdrawalHistory());
                fetchPeerHistory();
                fetchDbDeposits();
                setTab("history");
              }}
              className="group relative z-10 flex-1 inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]"
            >
              <IconBubble active={tab === "history"} dark={dark}><Clock /></IconBubble>
              <span className={cn("relative z-10 font-semibold text-base transition-colors duration-300",
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
                  <p className={`text-base mb-3 ${dark ? "text-slate-400" : "text-gray-500"}`}>Send devnet USDC directly to your wallet address.</p>
                  {solanaAddress && (
                    <div className={`flex items-center gap-2 rounded-lg p-3 ${dark ? "bg-white/5" : "bg-white border border-gray-200"}`}>
                      <p className={`text-base font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{solanaAddress}</p>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(solanaAddress); toast({ title: "Copied!" }); }} className={`shrink-0 p-1.5 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ) : showFiatOnrampPicker ? (
                <div className="py-2 space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowFiatOnrampPicker(false)}
                    className={cn(
                      "flex items-center gap-1 text-base font-medium transition-colors",
                      dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>

                  <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Choose your provider
                  </p>

                  {/* Coinbase */}
                  <button
                    type="button"
                    disabled={!solanaAddress || coinbaseLoading}
                    onClick={handleCoinbaseOnramp}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {coinbaseLoading
                        ? <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        : <img src="/images/icons/coinbase-logo.png" alt="Coinbase" className="w-10 h-10 object-contain" />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Coinbase</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Apple Pay · card · bank transfer</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* PAJ Cash — Naira on-ramp */}
                  {PAJ_CASH_ENABLED && (
                    <button
                      type="button"
                      disabled={!solanaAddress}
                      onClick={() => { setShowFiatOnrampPicker(false); setTopUpView("paj-cash-onramp"); }}
                      className={cn(
                        "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                        dark
                          ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                        <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Naira · PAJ Cash</p>
                        <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Bank transfer in Nigeria</p>
                      </div>
                      <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                    </button>
                  )}

                  {/* Disabled/coming-soon options last — no reason to make working ones compete
                      with providers that aren't live yet. */}
                  {/* MoonPay — disabled pending KYB approval */}
                  <div
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left opacity-50 cursor-not-allowed",
                      dark
                        ? "border-white/10 bg-white/5"
                        : "border-gray-100 bg-white shadow-sm"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/moonpay-logo.svg" alt="MoonPay" className="w-10 h-10 object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>MoonPay</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Coming soon</p>
                    </div>
                  </div>

                  {/* Stripe — coming soon */}
                  <div
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left opacity-50 cursor-not-allowed",
                      dark
                        ? "border-white/10 bg-white/5"
                        : "border-gray-100 bg-white shadow-sm"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/stripe-logo.svg" alt="Stripe" className="rounded-[6px] h-7 w-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Stripe</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Coming soon</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-2 space-y-3">

                  {/* 1. Private deposit — burner-relay MagicBlock private transfer */}
                  <button type="button" disabled={!solanaAddress} onClick={() => setTopUpView("private-deposit")}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <VenetianMask className={`h-7 w-7 ${dark ? "text-slate-300" : "text-gray-500"}`} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Private Deposit</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>USDC on Solana · not linked on-chain</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* 2. Crypto deposit via Blink */}
                  <button type="button" disabled={!solanaAddress || blinkDepositing || coinbaseLoading} onClick={handleBlinkDeposit}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {blinkDepositing ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" /> : <img src="/images/icons/deposit-bridge.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Deposit with Blink</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>USDC · USDT — any chain</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {blinkError && <p className="text-base text-orange-500 text-center px-1">{blinkError}</p>}

                  {/* 3. More crypto via Near Intents */}
                  <button type="button" disabled={!solanaAddress} onClick={() => setTopUpView("near-intents-deposit")}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/deposit-receive.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Deposit with Near</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>ZEC · TON · BTC — cross-chain</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* 4. Fiat / bank — opens provider picker */}
                  <button type="button" disabled={!solanaAddress || blinkDepositing} onClick={() => setShowFiatOnrampPicker(true)}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
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

          {/* Top Up tab — Private Deposit (burner-relay) */}
          {tab === "topup" && topUpView === "private-deposit" && (
            <div className="space-y-4 py-2">

              {/* Back */}
              <button type="button" onClick={() => { setTopUpView(null); resetPrivateDeposit(); }}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {privateDepositAddress ? (
                /* ── Deposit address view ── */
                <div className="space-y-3">

                  {/* Status */}
                  <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${dark ? "bg-white/5 border border-white/10" : "bg-gradient-to-r from-orange-50/70 to-amber-50/30 border border-orange-100"}`}>
                    {privateDepositStatus === "complete" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                    ) : privateDepositStatus === "failed" ? (
                      <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-400 shrink-0" />
                    )}
                    <div>
                      <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                        {privateDepositStatus === "complete" ? "Complete!"
                          : privateDepositStatus === "failed" ? "Something went wrong"
                            : privateDepositStatus === "delivering_privately" ? "Delivering privately…"
                              : "Waiting for your deposit…"}
                      </p>
                      <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        {privateDepositStatus === "complete"
                          ? "Funds have landed in your balance."
                          : privateDepositStatus === "failed"
                            ? (privateDepositError || "Please contact support.")
                            : privateDepositStatus === "delivering_privately"
                              ? `Routing to your balance privately, can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes.`
                              : `Once received, it's automatically routed to your balance privately, usually within up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes. No need to keep this open.`}
                      </p>
                    </div>
                  </div>

                  {privateDepositFeeEstimate != null && privateDepositStatus !== "complete" && (
                    <p className={`text-sm text-center ${dark ? "text-slate-500" : "text-gray-400"}`}>
                      You&apos;ll receive approximately {privateDepositAmountNum.toFixed(2)} USDC after ${privateDepositFeeEstimate.toFixed(2)} in fees
                    </p>
                  )}

                  {privateDepositStatus !== "complete" && privateDepositEntryMode === "qr" && (
                    <div className={`rounded-2xl border overflow-hidden ${dark ? "border-white/10" : "border-gray-100"}`}>
                      <div className={`px-4 py-3 border-b ${dark ? "border-white/[0.06] bg-white/5" : "border-gray-100 bg-gray-50/60"}`}>
                        <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
                          Send <span className={`font-bold ${dark ? "text-white" : "text-gray-900"}`}>{(privateDepositSendAmount ?? privateDepositAmountNum).toFixed(2)} USDC</span> (Solana) to this address
                        </p>
                      </div>

                      <div className="px-4 py-3">
                        <p className={`text-sm font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-gray-400"}`}>Deposit address</p>
                        <div className="flex items-center gap-2">
                          <p className={`text-base font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{privateDepositAddress}</p>
                          <button type="button" onClick={() => { navigator.clipboard.writeText(privateDepositAddress!); toast({ title: "Copied!", description: "Deposit address copied." }); }}
                            className={`shrink-0 p-2 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className={`flex justify-center py-4 border-t ${dark ? "border-white/[0.06]" : "border-gray-100"}`}>
                        <div className={`p-3 rounded-xl ${dark ? "bg-white" : "bg-white border border-gray-100"}`}>
                          <QRCodeSVG value={privateDepositAddress} size={140} />
                        </div>
                      </div>

                      <div className="px-4 py-3 border-t border-inherit">
                        <button type="button" onClick={() => setPrivateDepositEntryMode(null)}
                          className={`w-full text-center text-base underline underline-offset-2 ${dark ? "text-slate-500 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>
                          Or pay with a connected wallet instead
                        </button>
                      </div>
                    </div>
                  )}

                  {privateDepositStatus === "awaiting_funds" && privateDepositEntryMode !== "qr" && (
                    <SolanaWalletConnectProvider rpcUrl={getRpcForMode(devnetMode ? "devnet" : "mainnet")}>
                      <PrivateDepositPayNowWidget
                        dark={dark}
                        status={payNowStatus}
                        error={payNowError}
                        onPay={(senderAddress, signTx) => void payPrivateDepositFromWallet(senderAddress, signTx)}
                        onViewAddressInstead={() => setPrivateDepositEntryMode("qr")}
                      />
                    </SolanaWalletConnectProvider>
                  )}

                  {(privateDepositStatus === "complete" || privateDepositStatus === "failed") && (
                    <Button onClick={() => { setTopUpView(null); resetPrivateDeposit(); }}
                      className={cn("w-full", privateDepositStatus === "complete" ? "bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white" : "bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white")}>
                      {privateDepositStatus === "complete" ? "Done" : "Close"}
                    </Button>
                  )}
                </div>
              ) : (
                /* ── Amount form ── */
                <div className="space-y-4">
                  <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Send USDC from any wallet to a one-time address. It's privately routed to your balance. The sending wallet is never linked to your Loofta wallet on-chain.
                  </p>
                  <div>
                    <Label htmlFor="private-deposit-amount" className={dark ? "text-slate-300" : undefined}>Amount you&apos;ll receive (USDC)</Label>
                    <AmountInput
                      id="private-deposit-amount"
                      dark={dark}
                      value={privateDepositAmount}
                      onChange={setPrivateDepositAmount}
                      suffix="USDC"
                      className="mt-1"
                    />
                  </div>
                  <Button
                    onClick={handleStartPrivateDeposit}
                    disabled={privateDepositSubmitting || !privateDepositAmountNum}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
                  >
                    {privateDepositSubmitting ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Getting deposit ready…</span>
                    ) : "Deposit"}
                  </Button>
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
                        <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>~{Number(depositQuoteOut).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC expected</p>
                      )}
                    </div>
                  </div>

                  {/* Send instructions */}
                  <div className={`rounded-2xl border overflow-hidden ${dark ? "border-white/10" : "border-gray-100"}`}>
                    <div className={`px-4 py-3 border-b ${dark ? "border-white/[0.06] bg-white/5" : "border-gray-100 bg-gray-50/60"}`}>
                      <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        Send <span className={`font-bold ${dark ? "text-white" : "text-gray-900"}`}>{depositAmountNum} {selectedDepositToken?.symbol}</span> to this address
                      </p>
                    </div>

                    {/* Address row */}
                    <div className="px-4 py-3">
                      <p className={`text-sm font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-gray-400"}`}>Deposit address</p>
                      <div className="flex items-center gap-2">
                        <p className={`text-base font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{depositAddr}</p>
                        <button type="button" onClick={() => { navigator.clipboard.writeText(depositAddr!); toast({ title: "Copied!", description: "Deposit address copied." }); }}
                          className={`shrink-0 p-2 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Memo row (only if present) */}
                    {depositMemo && (
                      <div className={`px-4 py-3 border-t ${dark ? "border-white/[0.06]" : "border-gray-100"}`}>
                        <p className={`text-sm font-medium mb-1.5 uppercase tracking-wide text-amber-500`}>⚠ Memo — required</p>
                        <div className="flex items-center gap-2">
                          <p className={`text-base font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{depositMemo}</p>
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
                    <Label className={`text-base font-medium mb-2 block ${dark ? "text-slate-300" : "text-gray-700"}`}>Token to deposit</Label>
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
                    <AmountInput
                      id="deposit-amount"
                      dark={dark}
                      value={depositAmount}
                      onChange={setDepositAmount}
                      className="mt-1"
                    />
                    {depositAmountNum > 0 && selectedDepositToken && (
                      <div className={`mt-2 rounded-xl border p-3 flex items-center gap-3 ${dark ? "border-white/10" : "border-gray-200"}`}>
                        <ArrowRight className={`h-4 w-4 shrink-0 ${dark ? "text-slate-400" : "text-gray-400"}`} />
                        <div>
                          <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>You will receive</p>
                          <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                            {depositQuoteLoading ? (
                              <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching quote…</span>
                            ) : depositQuoteOut ? (
                              <>
                                ~{Number(depositQuoteOut).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                                <span className={`font-normal ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>on {usdcSolanaToken?.chain || "solana"}</span>
                              </>
                            ) : (
                              <span className="text-red-400 text-sm font-normal">{depositQuoteError || "Unable to fetch quote"}</span>
                            )}
                          </p>
                        </div>
                      </div>
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
                      <p className="text-base text-red-400 mt-1 flex items-center gap-1.5">
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

          {/* History tab — deposits (from DB) + withdrawals */}
          {tab === "history" && (() => {
            const depositTypeLabel: Record<string, string> = {
              blink: "Blink",
              "near-intents": "Near Intents",
              coinbase: "Coinbase",
              moonpay: "MoonPay",
            };
            const isEmpty = dbDeposits.length === 0 && recentWithdrawals.length === 0 && peerOfframpHistory.length === 0 && pajCashHistory.length === 0 && !dbDepositsLoading;
            return (
              <div className="py-2 min-h-0 overflow-y-auto sm:max-h-[60vh]">
                {dbDepositsLoading && dbDeposits.length === 0 && peerOfframpHistory.length === 0 && recentWithdrawals.length === 0 ? (
                  <div className="flex justify-center py-6"><Loader2 className={`h-5 w-5 animate-spin ${dark ? "text-slate-400" : "text-gray-400"}`} /></div>
                ) : isEmpty ? (
                  <p className={`text-base text-center py-6 ${dark ? "text-slate-400" : "text-gray-500"}`}>No recent activity.</p>
                ) : (
                  <ul className="space-y-2">
                    {[
                      ...dbDeposits.map((dep) => ({ kind: "deposit" as const, ts: new Date(dep.created_at).getTime(), dep })),
                      ...peerOfframpHistory.map((record) => ({ kind: "peer" as const, ts: new Date(record.created_at).getTime(), record })),
                      ...recentWithdrawals.map((item) => ({ kind: "withdrawal" as const, ts: item.createdAt, item })),
                      ...pajCashHistory.map((order) => ({ kind: "paj" as const, ts: new Date(order.created_at).getTime(), order })),
                    ]
                      .sort((a, b) => b.ts - a.ts)
                      .map((entry) => {
                        if (entry.kind === "deposit") {
                          const dep = entry.dep;
                          const ageMs = Date.now() - new Date(dep.created_at).getTime();
                          const effectiveStatus = (dep.status === "pending" && ageMs > ONE_HOUR_MS) ? "cancelled" : dep.status;
                          const isPending = effectiveStatus === "pending";
                          const isComplete = effectiveStatus === "complete";
                          const isCancelled = effectiveStatus === "cancelled";
                          const statusColor = isComplete ? "text-emerald-400"
                            : effectiveStatus === "failed" ? "text-red-400"
                              : isCancelled ? (dark ? "text-slate-500" : "text-gray-400")
                                : "text-blue-400";
                          const statusLabel = isComplete ? "Complete"
                            : effectiveStatus === "failed" ? "Failed"
                              : isCancelled ? "Cancelled"
                                : dep.type === "near-intents" ? (dep.bridge_status ? bridgeStatusLabel(dep.bridge_status) : "Bridging…")
                                  : "Check your wallet";
                          return (
                            <li key={dep.id}>
                              <div className={`rounded-lg border p-3 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className={`font-semibold text-base ${dark ? "text-white" : "text-gray-900"}`}>
                                      {depositTypeLabel[dep.type] ?? dep.type} deposit
                                      {dep.amount_usdc ? <span className={`font-normal ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>· ${Number(dep.amount_usdc).toFixed(2)} USDC</span> : ""}
                                    </p>
                                    <p className={`text-base mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
                                      {new Date(dep.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                  </div>
                                  <span className={`text-base font-medium flex items-center gap-1 shrink-0 ${statusColor}`}>
                                    {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                    {statusLabel}
                                  </span>
                                </div>
                              </div>
                            </li>
                          );
                        }

                        if (entry.kind === "peer") {
                          const record = entry.record;
                          const platform = getPlatform(record.platform);
                          const isActive = ["PENDING_BRIDGE", "BRIDGING", "DEPOSITED", "CANCELLING"].includes(record.status);
                          const canResume = ["DEPOSITED", "CANCELLING"].includes(record.status);
                          const statusLabel = record.status === "PENDING_BRIDGE" ? "Sending…" : record.status === "BRIDGING" ? "Bridging…" : record.status === "DEPOSITED" ? "Waiting for peer" : record.status === "COMPLETE" ? "Complete" : record.status === "CANCELLING" ? "Cancelling…" : record.status === "CANCELLED" ? "Cancelled" : "Failed";
                          const statusColor = record.status === "COMPLETE" ? "text-emerald-400" : record.status === "CANCELLED" ? (dark ? "text-slate-500" : "text-gray-400") : record.status === "FAILED" ? "text-red-400" : "text-blue-400";
                          return (
                            <li key={`peer-${record.id}`}>
                              <div className={`rounded-lg border p-3 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className={`font-semibold text-base ${dark ? "text-white" : "text-gray-900"}`}>
                                      ${Number(record.amount_usdc).toFixed(2)} → {record.currency} via {platform?.name ?? record.platform}
                                    </p>
                                    <p className={`text-base mt-0.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>{record.platform_identifier}</p>
                                    <p className={`text-base mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
                                      {new Date(record.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                  </div>
                                  <div className="flex flex-col items-end gap-2 shrink-0">
                                    <span className={`text-base font-medium flex items-center gap-1 ${statusColor}`}>
                                      {isActive && <Loader2 className="h-3 w-3 animate-spin" />}
                                      {statusLabel}
                                    </span>
                                    {canResume && (
                                      <button
                                        type="button"
                                        onClick={() => resumePeerOfframp(record)}
                                        className={`text-base font-medium underline underline-offset-2 ${dark ? "text-orange-400 hover:text-orange-300" : "text-orange-600 hover:text-orange-700"}`}
                                      >
                                        Resume →
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        }

                        if (entry.kind === "paj") {
                          const order = entry.order;
                          const isComplete = order.status === "COMPLETE";
                          const isFailed = order.status === "FAILED" || order.status === "CANCELLED" || order.status === "EXPIRED";
                          const statusColor = isComplete ? "text-emerald-400" : isFailed ? "text-red-400" : "text-blue-400";
                          const statusLabel = isComplete ? "Complete" : isFailed ? order.status.charAt(0) + order.status.slice(1).toLowerCase() : "In progress";
                          return (
                            <li key={`paj-${order.id}`}>
                              <div className={`rounded-lg border p-3 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className={`font-semibold text-base ${dark ? "text-white" : "text-gray-900"}`}>
                                      {order.direction === "ON_RAMP" ? "Naira top-up" : "Naira withdrawal"}
                                      {order.fiat_amount ? <span className={`font-normal ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>· ₦{Number(order.fiat_amount).toLocaleString()}</span> : ""}
                                    </p>
                                    <p className={`text-base mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
                                      {new Date(order.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                  </div>
                                  <span className={`text-base font-medium flex items-center gap-1 shrink-0 ${statusColor}`}>
                                    {!isComplete && !isFailed && <Loader2 className="h-3 w-3 animate-spin" />}
                                    {statusLabel}
                                  </span>
                                </div>
                              </div>
                            </li>
                          );
                        }

                        const item = entry.item;
                        const withdrawAgeMs = Date.now() - item.createdAt;
                        const isStaleWithdraw = item.isNearIntents && !item.nearIntentsComplete && withdrawAgeMs > ONE_HOUR_MS;
                        const isInProgress = item.isNearIntents && !item.nearIntentsComplete && !isStaleWithdraw;
                        return (
                          <li key={item.id}>
                            <div className={`rounded-lg border p-3 transition-colors ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                              <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className={`font-semibold text-base ${dark ? "text-white" : "text-gray-900"}`}>
                                    ${item.amountUSDC.toFixed(2)} → {item.destinationToken}
                                    {item.estimatedOut && (
                                      <span className={`font-normal text-base ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                                        (~{Number(item.estimatedOut).toLocaleString(undefined, { maximumFractionDigits: 4 })} received)
                                      </span>
                                    )}
                                  </p>
                                  <p className={`text-base font-mono mt-0.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                                    To {shortAddr(item.destinationAddress)} · {item.destinationChain}
                                  </p>
                                  <p className={`text-base mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
                                    {new Date(item.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                </div>
                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                  {isInProgress ? (
                                    <span className="flex items-center gap-1 text-base font-medium text-blue-400">
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Bridging
                                    </span>
                                  ) : isStaleWithdraw ? (
                                    <span className={`text-base font-medium ${dark ? "text-slate-500" : "text-gray-400"}`}>Cancelled</span>
                                  ) : item.nearIntentsComplete && item.nearIntentsStatus ? (
                                    <span className={`text-base font-medium ${SUCCESS_BRIDGE_STATUSES.has(item.nearIntentsStatus.toUpperCase()) ? "text-emerald-400" : "text-amber-400"}`}>
                                      {SUCCESS_BRIDGE_STATUSES.has(item.nearIntentsStatus.toUpperCase()) ? "Completed" : item.nearIntentsStatus}
                                    </span>
                                  ) : !item.isNearIntents ? (
                                    <span className="text-base font-medium text-emerald-400">Sent</span>
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
                              {isInProgress && item.nearIntentsStatus && (
                                <p className={`text-base mt-2 pt-2 border-t ${dark ? "border-white/10 text-slate-400" : "border-gray-100 text-gray-500"}`}>
                                  {bridgeStatusLabel(item.nearIntentsStatus)}
                                </p>
                              )}
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
                                  className={`mt-2 text-base font-medium underline underline-offset-2 ${dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}`}
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
            );
          })()}

          {/* Withdraw tab — progress panel (not shown during peer offramp or settling state) */}
          {tab === "withdraw" && withdrawStep !== "idle" && withdrawStep !== "settling" && withdrawMethod !== "peer-offramp" && (
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
                const wasDirectUsdc = withdrawMethod === "usdc-sol";
                setActiveWithdrawal(null);
                setBridgeStatus(null);
                setDepositAddressForPolling(null);
                if (withdrawStep === "complete" && wasDirectUsdc) {
                  setWithdrawStep("settling");
                  onRefresh();
                } else {
                  setWithdrawStep("idle");
                  setWithdrawMethod(null);
                  if (withdrawStep === "complete") onRefresh();
                }
              }}
            />
          )}

          {/* Withdraw tab — settling state: shown after a direct USDC withdrawal is sent */}
          {tab === "withdraw" && withdrawStep === "settling" && (
            <div className="py-2 space-y-4">
              <div className={cn(
                "rounded-xl border p-5 flex items-start gap-4",
                dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"
              )}>
                <div className={cn(
                  "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                  dark ? "bg-emerald-500/15" : "bg-emerald-50"
                )}>
                  <Clock className={cn("w-5 h-5", dark ? "text-emerald-400" : "text-emerald-500")} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("font-semibold", dark ? "text-white" : "text-gray-900")}>Withdrawal in progress</p>
                  <p className={cn("text-base mt-1", dark ? "text-slate-400" : "text-gray-500")}>
                    Your USDC is on its way — balance will update in a few seconds.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setWithdrawStep("idle");
                  setWithdrawMethod(null);
                  setActiveWithdrawal(null);
                  onClose();
                }}
                className={cn(
                  "w-full h-11 rounded-xl font-medium text-base border transition-colors",
                  dark
                    ? "border-white/10 text-slate-300 hover:bg-white/5"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Withdraw tab — method selection */}
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod === null && !showFiatOfframpPicker && (
            <div className="py-2 space-y-3">

              {/* 1. Private withdrawal — burner-relay MagicBlock private transfer */}
              <button
                type="button"
                disabled={!solanaAddress}
                onClick={() => setWithdrawMethod("private-relay")}
                className={cn(
                  "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                  dark
                    ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                  <VenetianMask className={`h-7 w-7 ${dark ? "text-slate-300" : "text-gray-500"}`} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Private Withdrawal</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    To any Solana wallet · not linked on-chain
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

              {/* 2. USDC on Solana */}
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

              {spendableBalance >= 1 && (
                <>
                  {/* 3. Other token via Near Intents */}
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

                  {/* 4. Cash out via Peer (ZKP2P) */}
                  <button
                    type="button"
                    disabled={!solanaAddress}
                    onClick={() => { resetPeer(); setWithdrawMethod("peer-offramp"); }}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/withdraw-peer.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Cash out with Peer</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        Venmo · Cash App
                      </p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>
                </>
              )}

              {/* 5. Bank or card — shows provider picker. Deliberately NOT gated on spendableBalance
                  >= 1 (unlike items 3/4 above): PAJ Cash / Naira lives behind this, and users need
                  to be able to open it at $0 balance to link their PAJ account and set up a default
                  bank account ahead of time — not just when they already have funds to move. */}
              <button
                type="button"
                disabled={!solanaAddress}
                onClick={() => setShowFiatOfframpPicker(true)}
                className={cn(
                  "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                  dark
                    ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                  <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
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

          {/* Withdraw tab — Private Withdrawal (burner-relay) */}
          {tab === "withdraw" && withdrawMethod === "private-relay" && (
            <div className="space-y-4 py-2">

              {/* Back */}
              <button type="button" onClick={() => { setWithdrawMethod(null); resetPrivateWithdraw(); }}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {privateWithdrawId ? (
                /* ── Status view ── */
                <div className="space-y-3">
                  <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${dark ? "bg-white/5 border border-white/10" : "bg-gradient-to-r from-orange-50/70 to-amber-50/30 border border-orange-100"}`}>
                    {privateWithdrawStatus === "complete" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                    ) : privateWithdrawStatus === "failed" ? (
                      <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-400 shrink-0" />
                    )}
                    <div>
                      <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                        {privateWithdrawStatus === "complete" ? "Complete!"
                          : privateWithdrawStatus === "failed" ? "Something went wrong"
                            : privateWithdrawStatus === "awaiting_signature" ? "Waiting for signature…"
                              : "Delivering privately…"}
                      </p>
                      <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        {privateWithdrawStatus === "complete"
                          ? "Funds have landed at the destination."
                          : privateWithdrawStatus === "failed"
                            ? (privateWithdrawError || "Please contact support.")
                            : `Can take up to ${PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes — no need to keep this open, it'll finish in the background.`}
                      </p>
                    </div>
                  </div>

                  {privateWithdrawFee != null && (
                    <p className={`text-base text-center ${dark ? "text-slate-500" : "text-gray-400"}`}>
                      Privacy fee: ~${privateWithdrawFee.toFixed(3)}
                    </p>
                  )}

                  {(privateWithdrawStatus === "complete" || privateWithdrawStatus === "failed") && (
                    <Button onClick={() => { setWithdrawMethod(null); resetPrivateWithdraw(); }}
                      className={cn("w-full", privateWithdrawStatus === "complete" ? "bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white" : "bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white")}>
                      {privateWithdrawStatus === "complete" ? "Done" : "Close"}
                    </Button>
                  )}
                </div>
              ) : (
                /* ── Form ── */
                <div className="space-y-4">
                  <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Send USDC to any Solana address without linking your Loofta wallet to the destination on-chain.
                  </p>
                  <div>
                    <Label htmlFor="private-withdraw-amount" className={dark ? "text-slate-300" : undefined}>Amount (USDC)</Label>
                    <AmountInput
                      id="private-withdraw-amount"
                      dark={dark}
                      value={withdrawAmount}
                      onChange={setWithdrawAmount}
                      suffix="USDC"
                      className="mt-1"
                    />
                    <p className={`text-base mt-1.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
                      Available: {spendableBalance.toFixed(2)} USDC
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="private-withdraw-address" className={dark ? "text-slate-300" : undefined}>Destination Solana address</Label>
                    <Input
                      id="private-withdraw-address"
                      placeholder="Enter a Solana address"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                    />
                    {withdrawAddress && !isValidAddressForChain(withdrawAddress, "solana") && (
                      <p className="text-base text-red-400 mt-1 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Invalid Solana address
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={handlePrivateWithdraw}
                    disabled={
                      privateWithdrawSubmitting ||
                      !parseFloat(withdrawAmount) ||
                      parseFloat(withdrawAmount) > spendableBalance ||
                      !withdrawAddress.trim() ||
                      !isValidAddressForChain(withdrawAddress, "solana")
                    }
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
                  >
                    {privateWithdrawSubmitting ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Building transfer…</span>
                    ) : "Send privately"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Withdraw tab — fiat provider picker (Coinbase vs MoonPay) */}
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod === null && showFiatOfframpPicker && (
            <div className="py-2 space-y-3">
              <button
                type="button"
                onClick={() => setShowFiatOfframpPicker(false)}
                className={cn(
                  "flex items-center gap-1 text-base font-medium transition-colors",
                  dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>

              <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
                Choose your provider
              </p>

              {/* Coinbase */}
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
                    ? <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    : <img src="/images/icons/coinbase-logo.png" alt="Coinbase" className="w-10 h-10 object-contain" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Coinbase</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Bank · card · Apple Pay
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

              {/* PAJ Cash — Naira off-ramp */}
              {PAJ_CASH_ENABLED && (
                <button
                  type="button"
                  disabled={!solanaAddress}
                  onClick={() => { setShowFiatOfframpPicker(false); setWithdrawMethod("paj-cash"); }}
                  className={cn(
                    "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                    dark
                      ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                    <img src="/images/icons/deposit-bank.svg" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Naira · PAJ Cash</p>
                    <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Bank transfer in Nigeria</p>
                  </div>
                  <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                </button>
              )}
            </div>
          )}

          {/* Top-up tab — PAJ Cash (Naira) */}
          {tab === "topup" && topUpView === "paj-cash-onramp" && (
            <PajCashOnrampView
              dark={dark}
              prefillEmail={pajPrefillEmail}
              getAccessToken={getAccessToken}
              onBack={() => setTopUpView(null)}
              onComplete={() => { fetchPajCashHistory(); onRefresh?.(); }}
            />
          )}

          {/* Withdraw tab — PAJ Cash (Naira) */}
          {tab === "withdraw" && withdrawMethod === "paj-cash" && (
            <PajCashOfframpView
              dark={dark}
              devnetMode={devnetMode}
              solanaAddress={solanaAddress}
              wallet={wallet}
              signTransaction={signTransaction}
              userId={user?.id}
              prefillEmail={pajPrefillEmail}
              maxAmountUsdc={spendableBalance}
              getAccessToken={getAccessToken}
              onBack={() => setWithdrawMethod(null)}
              onComplete={() => { fetchPajCashHistory(); onRefresh?.(); }}
            />
          )}

          {/* Withdraw tab — form (method selected, not peer-offramp or paj-cash which have their own sections) */}
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod !== null && withdrawMethod !== "peer-offramp" && withdrawMethod !== "paj-cash" && (
            <div className="space-y-4 py-2">

              {/* Back button — hidden on devnet (only one method available, nothing to go back to) */}
              {!devnetMode && <button
                type="button"
                onClick={() => setWithdrawMethod(null)}
                className={cn(
                  "flex items-center gap-1 text-base font-medium transition-colors",
                  dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>}

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
                      <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>From your balance</p>
                      <p className={`text-base font-bold leading-tight ${dark ? "text-white" : "text-gray-900"}`}>
                        {loadingBalance ? "…" : `$${balanceUSD}`}
                        <span className={`text-base font-normal ml-1.5 ${dark ? "text-slate-400" : "text-gray-400"}`}>USDC · Solana</span>
                      </p>
                    </div>
                  </div>
                  {/* Bridge label */}
                  <div className={`flex items-center gap-2 px-4 py-1.5 border-y ${dark ? "border-white/[0.06] bg-white/[0.02]" : "border-gray-100 bg-gray-50/60"}`}>
                    <ArrowDown className={`h-3.5 w-3.5 shrink-0 ${dark ? "text-slate-500" : "text-gray-400"}`} />
                    <span className={`text-base ${dark ? "text-slate-500" : "text-gray-400"}`}>Cross-chain bridge</span>
                  </div>
                  {/* TO row — token selector */}
                  <div className={`px-4 py-3.5 ${dark ? "" : ""}`}>
                    <p className={`text-base font-medium mb-2 ${dark ? "text-slate-300" : "text-gray-600"}`}>You receive</p>
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
                    <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Available to withdraw</p>
                    <p className={`text-xl font-bold leading-tight ${dark ? "text-white" : "text-gray-900"}`}>
                      {loadingBalance ? "…" : `$${balanceUSD}`}
                      <span className={`text-base font-normal ml-1.5 ${dark ? "text-slate-400" : "text-gray-400"}`}>USDC</span>
                    </p>
                  </div>
                  {!loadingBalance && payFromBalanceNum <= 0 && (
                    <span className="text-base font-medium text-amber-500">Empty</span>
                  )}
                </div>
              )}

              {/* Amount */}
              <div>
                <Label htmlFor="withdraw-amount" className={dark ? "text-slate-300" : undefined}>
                  {withdrawMethod === "near-intents" ? "Amount to bridge (USDC)" : "Amount to send (USDC)"}
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <AmountInput
                    id="withdraw-amount"
                    dark={dark}
                    value={withdrawAmount}
                    onChange={setWithdrawAmount}
                    maxDecimals={2}
                    suffix="USDC"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWithdrawAmount(spendableBalance.toFixed(6).replace(/\.?0+$/, ""))}
                    className={`shrink-0 px-3 text-base ${dark ? "border-white/20 bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white" : ""}`}
                  >
                    Max
                  </Button>
                </div>
                {withdrawAmountNum > spendableBalance && spendableBalance > 0 && (
                  <p className="text-base text-red-400 mt-1">Exceeds available balance of {spendableBalance.toFixed(6).replace(/\.?0+$/, "")} USDC.</p>
                )}
                {isNearIntentsWithdraw && withdrawAmountNum > 0 && (
                  <div className={`mt-2 rounded-xl border p-3 flex items-center gap-3 ${dark ? "border-white/10" : "border-gray-200"}`}>
                    <ArrowRight className={`h-4 w-4 shrink-0 ${dark ? "text-slate-400" : "text-gray-400"}`} />
                    <div>
                      <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>You will receive</p>
                      <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                        {quoteLoading ? (
                          <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching quote…</span>
                        ) : quoteAmount ? (
                          <>
                            ~{Number(quoteAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {effectiveToken?.symbol || "token"}
                            <span className={`font-normal ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>on {effectiveToken?.chain}</span>
                          </>
                        ) : (
                          <span className="text-red-400 text-sm font-normal">{quoteError || "Unable to fetch quote"}</span>
                        )}
                      </p>
                    </div>
                  </div>
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
                  className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                />
                {isUSDCOnSolana && addressRiskStatus === "checking" && (
                  <p className={`text-base mt-1.5 flex items-center gap-1.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    Checking address with Range…
                  </p>
                )}
                {isUSDCOnSolana && addressRiskStatus === "safe" && (
                  <p className="text-base text-emerald-400 mt-1.5 flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Address compliant — safe to withdraw
                  </p>
                )}
                {isUSDCOnSolana && addressRiskStatus === "unsafe" && (
                  <p className="text-base text-red-400 mt-1.5 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Address flagged — withdrawal blocked
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setWithdrawMethod(null)} className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}>
                  Back
                </Button>
                <Button
                  onClick={handleWithdraw}
                  disabled={
                    withdrawing ||
                    withdrawAmountNum <= 0 ||
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

          {/* ── Peer offramp: platform picker ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "platform" && (
            <div className="space-y-4 py-2">
              <button type="button" onClick={() => setWithdrawMethod(null)}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {/* Currency selector — hidden while USD is the only supported currency (Venmo/Cash App are both USD-only) */}
              {PEER_CURRENCIES.length > 1 && (
                <div>
                  <p className={`text-base font-semibold mb-2 ${dark ? "text-white" : "text-gray-900"}`}>Receive currency</p>
                  <Select value={peerCurrency} onValueChange={(v) => setPeerCurrency(v)}>
                    <SelectTrigger className={cn(
                      "w-full text-base",
                      dark ? "bg-white/10 border-white/20 text-white" : "bg-white border-gray-200 text-gray-900"
                    )}>
                      <SelectValue>
                        {(() => {
                          const cur = getPeerCurrency(peerCurrency);
                          return cur ? `${cur.flag}  ${cur.code} — ${cur.label}` : peerCurrency;
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className={dark ? "bg-zinc-900 border-white/10 text-white" : ""}>
                      {PEER_CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code} className={cn(
                          "text-base cursor-pointer",
                          dark ? "text-white focus:bg-white/10 focus:text-white" : ""
                        )}>
                          {c.flag}{"  "}{c.code} — {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {peerCurrency !== "USD" && (() => {
                    const platforms = PEER_PLATFORMS.filter(p => p.currencies.includes(peerCurrency));
                    if (!platforms.length) return null;
                    const names = platforms.map(p => p.name).join(" & ");
                    return (
                      <p className={`text-base mt-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        {peerCurrency} payouts available via {names}.
                      </p>
                    );
                  })()}
                </div>
              )}

              <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Choose a platform</p>
              <div className="grid grid-cols-2 gap-2">
                {PEER_PLATFORMS.filter((p) => p.currencies.includes(peerCurrency)).map((p) => {
                  const cooldownMins = platformCooldowns[p.id] ?? 0;
                  const inCooldown = cooldownMins > 0;
                  return (
                    <button key={p.id} type="button"
                      disabled={inCooldown}
                      onClick={() => { setPeerPlatformId(p.id); setPeerStep("form"); }}
                      className={cn(
                        "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center",
                        inCooldown
                          ? dark ? "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed" : "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                          : dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm"
                      )}>
                      <img src={p.logo} alt={p.name} className="w-10 h-10 rounded-xl object-cover" />
                      <span className={`text-base font-medium leading-tight ${dark ? "text-white" : "text-gray-900"}`}>{p.name}</span>
                      {inCooldown
                        ? <span className="text-sm text-amber-400 leading-tight">{formatCooldown(cooldownMins)}</span>
                        : <span className={`text-sm leading-tight ${dark ? "text-slate-500" : "text-gray-400"}`}>${p.maxUSDC} max</span>
                      }
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Peer offramp: form ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "form" && (() => {
            const platform = getPlatform(peerPlatformId ?? "");
            if (!platform) return null;
            return (
              <div className="space-y-4 py-2">
                <button type="button" onClick={() => setPeerStep("platform")}
                  className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                  <ChevronLeft className="h-4 w-4" />Back
                </button>

                {/* Platform badge */}
                <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${dark ? "bg-white/5 border border-white/10" : "bg-orange-50/60 border border-orange-100"}`}>
                  <img src={platform.logo} alt={platform.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  <div>
                    <p className={`text-base font-bold ${dark ? "text-white" : "text-gray-900"}`}>{platform.name}</p>
                    <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                      USDC → {peerCurrency} · max ${platform.maxUSDC}
                      {platform.cooldownHours ? ` · ${platform.cooldownHours}h cooldown` : ""}
                    </p>
                  </div>
                </div>

                {/* Identifier */}
                <div>
                  <Label className={dark ? "text-slate-300" : undefined}>{platform.idLabel}</Label>
                  <Input
                    placeholder={platform.placeholder}
                    value={peerIdentifier}
                    onChange={(e) => setPeerIdentifier(e.target.value)}
                    className={`mt-1 text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                  />
                </div>


                {/* Amount */}
                <div>
                  <Label htmlFor="peer-amount" className={dark ? "text-slate-300" : undefined}>Amount (USDC)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <AmountInput id="peer-amount" dark={dark}
                      value={withdrawAmount}
                      onChange={setWithdrawAmount}
                      maxDecimals={2}
                      suffix="USDC"
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => setWithdrawAmount(Math.min(spendableBalance, platform.maxUSDC).toFixed(2).replace(/\.?0+$/, ""))}
                      className={`shrink-0 px-3 ${dark ? "border-white/20 bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white" : ""}`}>
                      Max
                    </Button>
                  </div>
                  {withdrawAmountNum > 0 && withdrawAmountNum < 1 && (
                    <p className="text-base text-red-400 mt-1">Minimum is $1.00 USDC.</p>
                  )}
                  {withdrawAmountNum > platform.maxUSDC && (
                    <p className="text-base text-red-400 mt-1">{platform.name} limit is ${platform.maxUSDC} USDC.</p>
                  )}
                  {withdrawAmountNum > spendableBalance && withdrawAmountNum <= platform.maxUSDC && spendableBalance > 0 && (
                    <p className="text-base text-red-400 mt-1">Exceeds your balance.</p>
                  )}
                </div>

                {/* Estimated receive */}
                {withdrawAmountNum >= 1 && (
                  <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${dark ? "border-white/10 bg-white/5" : "border-orange-100 bg-orange-50/50"}`}>
                    <div>
                      <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>You'll receive</span>
                      {(() => {
                        const est = getPeerEstimate(withdrawAmountNum, peerCurrency);
                        if (est?.spreadPct && est.spreadPct > 0) {
                          return null;
                        }
                        return null;
                      })()}
                    </div>
                    {peerFxLoading && peerCurrency !== "USD" ? (
                      <span className={`text-base flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-gray-400"}`}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />Fetching rate…
                      </span>
                    ) : (() => {
                      const est = getPeerEstimate(withdrawAmountNum, peerCurrency);
                      return est
                        ? <span className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>≈ {est.formatted}</span>
                        : <span className={`text-base ${dark ? "text-slate-500" : "text-gray-400"}`}>—</span>;
                    })()}
                  </div>
                )}

                <div className={`rounded-xl border p-3 ${dark ? "border-white/10 bg-white/5" : "border-blue-100 bg-blue-50/60"}`}>
                  <p className={`text-base ${dark ? "text-slate-400" : "text-blue-700"}`}>
                    A peer sends you {peerCurrency} via {platform.name}. You can cancel anytime to get your USDC back.
                  </p>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" onClick={() => setPeerStep("platform")}
                    className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}>
                    Back
                  </Button>
                  <Button
                    onClick={handlePeerSubmit}
                    disabled={peerSubmitting || !peerIdentifier.trim() || withdrawAmountNum < (devnetMode ? 0.01 : 1) || withdrawAmountNum > Math.min(spendableBalance, platform.maxUSDC)}
                    className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50">
                    {peerSubmitting
                      ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Preparing…</span>
                      : `Cash out $${withdrawAmountNum > 0 ? withdrawAmountNum.toFixed(2) : "0.00"} → ${platform.name}`}
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* ── Peer offramp: bridge in progress ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "bridging" && (() => {
            const platform = getPlatform(peerPlatformId ?? "");
            const s = (peerBridgeStatus ?? "PENDING").toUpperCase();
            const isDone = TERMINAL_BRIDGE_STATUSES.has(s);
            const isSuccess = SUCCESS_BRIDGE_STATUSES.has(s);
            const steps = [
              { label: "Sending USDC", sublabel: "Processing your cash out", status: peerBridgeTxSig ? "done" : "active" },
              { label: "Confirming receipt", sublabel: isSuccess ? "USDC received" : s === "PROCESSING" ? "Processing…" : "Waiting for confirmation…", status: isSuccess ? "done" : peerBridgeTxSig ? "active" : "pending" },
              { label: "Setting up your cash out", sublabel: "Registering your payment details", status: isSuccess ? "active" : "pending" },
            ] as const;
            return (
              <div className="py-2 space-y-4">
                <div className="space-y-3">
                  {steps.map((step, i) => (
                    <div key={i} className={`flex items-start gap-3 rounded-xl border p-3 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                      <div className="mt-0.5 shrink-0 w-6 h-6 flex items-center justify-center">
                        {step.status === "done" && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                        {step.status === "active" && <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />}
                        {step.status === "pending" && <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-sm font-bold ${dark ? "border-white/20 text-slate-500" : "border-gray-300 text-gray-400"}`}>{i + 1}</span>}
                      </div>
                      <div>
                        <p className={`text-base font-medium ${dark ? "text-white" : "text-gray-900"}`}>{step.label}</p>
                        <p className={`text-base mt-0.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>{step.sublabel}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {peerBridgeTxSig && (
                  <a href={getExplorerTxUrl("solana", peerBridgeTxSig)} target="_blank" rel="noreferrer"
                    className={`flex items-center gap-2 text-base rounded-lg border px-3 py-2 ${dark ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />View Solana transaction
                  </a>
                )}
                {isDone && !isSuccess && (
                  <Button onClick={() => { resetPeer(); setWithdrawMethod(null); }}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white">
                    Close
                  </Button>
                )}
              </div>
            );
          })()}

          {/* ── Peer offramp: creating ZKP2P deposit (user signs on Base) ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "creating-deposit" && (
            <div className="py-6 flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
              <p className={`text-base font-medium ${dark ? "text-white" : "text-gray-900"}`}>Approve signing in your wallet</p>
              <p className={`text-base text-center ${dark ? "text-slate-400" : "text-gray-500"}`}>
                Almost there — approve the wallet prompt to finalize your cash out.
              </p>
              {peerBaseWalletAddress && (
                <Button
                  onClick={handlePeerBridgeBackDirect}
                  variant="outline"
                  className={cn("mt-2", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
                >
                  <X className="h-4 w-4 mr-2" />Cancel and get USDC back
                </Button>
              )}
            </div>
          )}

          {/* ── Peer offramp: ZKP2P deposit error — USDC on Base, no deposit created ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "deposit-error" && (
            <div className="py-2 space-y-4">
              <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 text-center ${dark ? "border-white/10 bg-white/5" : "border-amber-100 bg-amber-50/60"}`}>
                <AlertTriangle className="h-10 w-10 text-amber-400" />
                <p className={`text-xl font-bold ${dark ? "text-white" : "text-gray-900"}`}>Setup failed</p>
                <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                  Your cash out couldn&apos;t be set up, but your USDC is safe. You can try again or cancel to get it back.
                </p>
              </div>
              <Button
                onClick={() => { peerZkp2pSigningRef.current = false; setPeerStep("creating-deposit"); }}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white"
              >
                Try again
              </Button>
              <Button
                onClick={handlePeerBridgeBackDirect}
                variant="outline"
                className={cn("w-full", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
              >
                Cancel and get USDC back
              </Button>
            </div>
          )}

          {/* ── Peer offramp: deposited / waiting for payment ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "deposited" && (() => {
            const platform = getPlatform(peerPlatformId ?? "");
            return (
              <div className="py-2 space-y-4">
                <div className={`rounded-2xl border p-4 space-y-1 ${dark ? "border-white/10 bg-white/5" : "border-emerald-100 bg-emerald-50/60"}`}>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-500 shrink-0" />
                    <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Cash out request sent</p>
                  </div>
                  <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                    A peer will send <strong>{peerCurrency}</strong> to your {platform?.name} account (<strong>{peerIdentifier}</strong>).
                    This usually takes a few minutes, but may take longer depending on availability.
                  </p>
                </div>

                <div className={`rounded-xl border p-3 flex items-center justify-between ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                  <div>
                    <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Amount</p>
                    <p className={`text-base font-bold ${dark ? "text-white" : "text-gray-900"}`}>${(peerAmountUSDC || withdrawAmountNum).toFixed(2)} USDC → {peerCurrency}</p>
                  </div>
                  {platform?.logo && <img src={platform.logo} alt={platform.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />}
                </div>

                <div className={`rounded-xl border p-3 text-base ${dark ? "border-amber-400/20 bg-amber-400/5 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                  Taking too long? You can cancel to get your USDC back. Cash outs usually complete within minutes, but can take longer if peers are busy.
                </div>

                <Button
                  onClick={handlePeerCancel}
                  variant="outline"
                  className={cn("w-full", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
                >
                  <X className="h-4 w-4 mr-2" />Cancel and get USDC back
                </Button>
                <button
                  type="button"
                  onClick={() => { resetPeer(); }}
                  className={`w-full text-base text-center ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
                >
                  Start a new cash out
                </button>
              </div>
            );
          })()}

          {/* ── Peer offramp: complete ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "complete" && (() => {
            const platform = getPlatform(peerPlatformId ?? "");
            return (
              <div className="py-2 space-y-4">
                <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 text-center ${dark ? "border-white/10 bg-white/5" : "border-emerald-100 bg-emerald-50/60"}`}>
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                  <p className={`text-xl font-bold ${dark ? "text-white" : "text-gray-900"}`}>Cash out complete!</p>
                  <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                    ${(peerAmountUSDC || withdrawAmountNum).toFixed(2)} USDC was successfully sent to your {platform?.name} account as {peerCurrency}.
                  </p>
                </div>
                <Button onClick={() => { resetPeer(); setWithdrawMethod(null); onRefresh(); }}
                  className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white">
                  Done
                </Button>
              </div>
            );
          })()}

          {/* ── Peer offramp: cancelling ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "cancelling" && (() => {
            type SubStepDef = { label: string; sublabel: string; status: "done" | "active" | "pending" };
            const sub = peerCancelSubStep;
            const steps: SubStepDef[] = [
              {
                label: "Setting up wallet",
                sublabel: "Preparing your wallet",
                status: sub === null ? "pending"
                  : sub === "getting-address" ? "active"
                    : "done",
              },
              {
                label: "Cancelling your request",
                sublabel: "Retrieving your USDC",
                status: (sub === null || sub === "getting-address") ? "pending"
                  : sub === "signing-withdraw" ? "active"
                    : "done",
              },
              {
                label: "Returning your USDC",
                sublabel: "Signing the return transfer",
                status: (sub === null || sub === "getting-address" || sub === "signing-withdraw") ? "pending"
                  : sub === "signing-transfer" ? "active"
                    : "done",
              },
              {
                label: "Returning to your wallet",
                sublabel: peerBridgeBackStatus ? bridgeStatusLabel(peerBridgeBackStatus) : "Sending your USDC back…",
                status: (sub === null || sub === "getting-address" || sub === "signing-withdraw" || sub === "signing-transfer") ? "pending"
                  : sub === "bridging-back" ? "active"
                    : "done",
              },
            ];
            return (
              <div className="py-2 space-y-4">
                <div className={`rounded-2xl border p-4 flex items-center gap-3 ${dark ? "border-white/10 bg-white/5" : "border-orange-100 bg-orange-50/60"}`}>
                  <Loader2 className="h-5 w-5 animate-spin text-orange-400 shrink-0" />
                  <div>
                    <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Cancelling…</p>
                    <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                      {sub === "bridging-back" ? "Returning your USDC to your wallet…" : "Approve wallet prompts to cancel"}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {steps.map((s, i) => (
                    <div key={i} className={`flex items-start gap-3 rounded-xl border p-3 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                      <div className="mt-0.5 shrink-0 w-6 h-6 flex items-center justify-center">
                        {s.status === "done" && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                        {s.status === "active" && <Loader2 className="h-5 w-5 text-orange-400 animate-spin" />}
                        {s.status === "pending" && <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-sm font-bold ${dark ? "border-white/20 text-slate-500" : "border-gray-300 text-gray-400"}`}>{i + 1}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-base font-medium ${s.status === "pending" ? (dark ? "text-slate-500" : "text-gray-400") : (dark ? "text-white" : "text-gray-900")}`}>{s.label}</p>
                        <p className={`text-base mt-0.5 ${dark ? "text-slate-500" : "text-gray-500"}`}>{s.sublabel}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Peer offramp: cancelled ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "cancelled" && (
            <div className="py-2 space-y-4">
              <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 text-center ${dark ? "border-white/10 bg-white/5" : "border-orange-100 bg-orange-50/60"}`}>
                <CheckCircle2 className="h-10 w-10 text-amber-400" />
                <p className={`text-xl font-bold ${dark ? "text-white" : "text-gray-900"}`}>Cancelled</p>
                <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                  Your USDC is on its way back to your wallet. It may take a few minutes to arrive.
                </p>
              </div>
              <Button onClick={() => { resetPeer(); setWithdrawMethod(null); onRefresh(); }}
                variant="outline"
                className={cn("w-full", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
              >
                Close
              </Button>
            </div>
          )}

          {/* ── Peer offramp: failed ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "failed" && (
            <div className="py-2 space-y-4">
              <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 text-center ${dark ? "border-white/10 bg-white/5" : "border-red-100 bg-red-50/40"}`}>
                <AlertTriangle className="h-10 w-10 text-red-400" />
                <p className={`text-xl font-bold ${dark ? "text-white" : "text-gray-900"}`}>Something went wrong</p>
                <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                  {peerBaseWalletAddress && !peerZkp2pDepositId
                    ? "Your cash out couldn't be set up, but your USDC is safe. Try again or cancel to get it back."
                    : "Your USDC will be returned automatically. Contact support if it doesn't arrive within a few minutes."
                  }
                </p>
              </div>
              {peerBaseWalletAddress && !peerZkp2pDepositId && (
                <>
                  <Button
                    onClick={() => { peerZkp2pSigningRef.current = false; setPeerStep("creating-deposit"); }}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white"
                  >
                    Try again
                  </Button>
                  <Button
                    onClick={handlePeerBridgeBackDirect}
                    variant="outline"
                    className={cn("w-full", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
                  >
                    <X className="h-4 w-4 mr-2" />Cancel and get USDC back
                  </Button>
                </>
              )}
              {(!peerBaseWalletAddress || peerZkp2pDepositId) && (
                <Button onClick={() => { resetPeer(); setWithdrawMethod(null); }}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white">
                  Close
                </Button>
              )}
            </div>
          )}

        </div>{/* end scrollable content */}

        {/* Large close button — mobile only, always visible at bottom */}
        <div className={`sm:hidden shrink-0 px-4 pt-3 pb-8 border-t ${dark ? "border-white/10 bg-[#0f0f12]" : "border-gray-100 bg-white"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`w-full py-4 rounded-2xl text-base font-semibold transition-colors ${dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-900 hover:bg-gray-200"}`}
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
