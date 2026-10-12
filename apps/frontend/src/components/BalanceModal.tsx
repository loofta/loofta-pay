"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { ToastAction } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { embeddedSolanaUsdcBalanceQueryKey } from "@/services/solanaBalance";
import { sora } from "@/components/home-v4/fonts";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenIcon } from "@/components/TokenIcon";
import { findTokenBySelection } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { TokenCombobox } from "@/components/TokenCombobox";
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink, Copy, ArrowRight, ArrowDown, ArrowUp, Clock, ChevronLeft, X, VenetianMask, Ticket, Wallet, CreditCard } from "lucide-react";
import { PEER_PLATFORMS, PEER_CURRENCIES, getPlatform, getPeerCurrency, type PeerPlatform, getPlatformCooldownRemaining, recordPlatformWithdraw, clearPlatformWithdraw, formatCooldown } from "@/lib/peerPlatforms";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Deposit as BlinkDeposit } from "@swype-org/deposit";
import { usePrivy, useUser, useWallets as useEvmWallets, useCreateWallet, useSendTransaction as useEvmSendTransaction, useFiatOnramp } from "@privy-io/react-auth";
import { useWallets, useSignTransaction, useSignAndSendTransaction, useFundWallet } from "@privy-io/react-auth/solana";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useReducedMotion } from "framer-motion";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { cashoutGrossUsdc, cashoutPayoutUsdc } from "@/services/peerCash";

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
import { prepareSolWithdrawal, executeSolSwap } from "@/services/jupiterSwap";
import { isValidAddressForChain, isSolDomain } from "@/lib/refundAddresses";
import { useSolDomain, type SolDomainState } from "@/hooks/useSolDomain";
import {
  addWithdrawal,
  getWithdrawalHistory,
  updateWithdrawalStatus,
  type WithdrawalHistoryItem,
} from "@/lib/withdrawalHistory";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { formatTokenAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { useSolPriceOrNull } from "@/hooks/useSolPrice";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { QRCodeSVG } from "qrcode.react";
import { usePerPrivateSelfTransfer } from "@/hooks/usePerPrivateSelfTransfer";
import { privyStandardWalletToAnchorWallet } from "@/lib/per/signer";
import { SolanaWalletConnectProvider, useWallet as useSolanaWalletAdapter, WalletMultiButton } from "@/components/SolanaWalletConnect";
import { startPrivateDeposit, buildDirectPrivateDeposit, getPrivateTransferStatus, type PrivateTransferStatus } from "@/services/api/privateBalance";
import { PRIVATE_PAYMENT_MAX_WAIT_MINUTES } from "@/lib/privatePaymentCopy";
import { PajCashOnrampView } from "@/components/paj-cash/PajCashOnrampView";
import { PajCashOfframpView } from "@/components/paj-cash/PajCashOfframpView";
import { pajListOrders, type PajCashOrder } from "@/services/pajCash";
import { AmountInput } from "@/components/AmountInput";

const PAJ_CASH_ENABLED = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === "true";

const LOG_PREFIX = "[BalanceModal]";

/**
 * Resolution status for a typed .sol domain. Always shows the wallet a domain resolved to — the
 * user is about to send real money to it, and the domain alone doesn't tell them where it lands.
 */
function SolDomainHint({ domain, input, dark }: { domain: SolDomainState; input: string; dark: boolean }) {
  if (!isSolDomain(input)) return null;
  if (domain.status === "resolving") {
    return (
      <p className={`text-base mt-1.5 flex items-center gap-1.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        Looking up {input.trim().toLowerCase()}…
      </p>
    );
  }
  if (domain.status === "resolved") {
    return (
      <p className="text-base text-emerald-400 mt-1.5 flex items-start gap-1.5 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-1" />
        <span className="font-mono break-all">{domain.address}</span>
      </p>
    );
  }
  if (domain.status === "not-found") {
    return (
      <p className="text-base text-red-400 mt-1.5 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        No wallet registered for this domain
      </p>
    );
  }
  if (domain.status === "error") {
    return (
      <p className="text-base text-amber-400 mt-1.5 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Couldn&apos;t look up that domain — try again, or paste the address
      </p>
    );
  }
  return null;
}

/**
 * Rent-exempt deposit for an SPL token account, in SOL. Fixed by Solana and effectively never
 * changes (same constant as the backend's ATA_RENT_LAMPORTS).
 */
const ATA_RENT_SOL = 0.00203928;

/** Margin over raw rent so a SOL price move between quote and settlement can't leave us short. */
const ATA_FEE_BUFFER = 1.25;

/**
 * Charged when a withdrawal destination has never held USDC and Solana therefore needs a token
 * account created for it. That account's rent leaves our fee payer permanently — it belongs to
 * the recipient, so only they can ever close it and reclaim the SOL — so it comes out of the
 * withdrawal instead (see handleWithdraw). Normally derived from the live SOL price; this flat
 * value is the fallback for when the price feed is unavailable, chosen to comfortably cover the
 * real cost at typical SOL prices rather than risk quoting under it.
 */
const ATA_SETUP_FEE_FALLBACK_USDC = 0.2;

/** Server-enforced floor for a private withdrawal (BuildPrivateWithdrawalDto @Min(1)). Mirrored
 *  client-side so a sub-minimum amount is caught in the form rather than by the API. */
const PRIVATE_WITHDRAW_MIN_USDC = 1;
/** Private withdrawals use MagicBlock's exactOut mode: the typed amount is what lands at the
 *  destination, and MagicBlock's own bps + Loofta's platform bps + its flat ~$0.21 relay fee
 *  (see resolveMagicblockRelayFeeUsdc on the backend) are ALL debited from the sender ON TOP of
 *  that — never out of it. Letting the form default/allow the full wallet balance as the amount
 *  therefore always overdraws the sender by the fee, and MagicBlock's build endpoint doesn't
 *  balance-check, so the failure only ever surfaces as an opaque on-chain "insufficient funds"
 *  once the wallet broadcasts. Reserve a conservative flat buffer so the max offered here always
 *  leaves room for that on-top debit. */
const PRIVATE_WITHDRAW_FEE_HEADROOM_USDC = 0.3;
const PEER_LOG = "[Peer Offramp]";
const PEER_SESSION_KEY = "loofta_peer_session";
const PRIVATE_DEPOSIT_SESSION_KEY = "loofta_private_deposit_id";
const PRIVATE_WITHDRAW_SESSION_KEY = "loofta_private_withdraw_id";
const PRIVATE_TRANSFER_TERMINAL_STATUSES = new Set(["complete", "failed"]);
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
// Withdraw-flow lottery ticket add-on. Mirrors megapot/page.tsx's handlePublicBuy/randomTicket
// (numbers only matter for display — the backend accepts a quick-pick pick same as a manual one).
const LOTTERY_TICKET_PRICE_USDC = 1;
// Below this, adding a ticket would eat the whole withdrawal (or more) — hide the upsell rather
// than tempt someone into a $0 withdrawal.
const LOTTERY_TICKET_UPSELL_MIN_BALANCE_USDC = LOTTERY_TICKET_PRICE_USDC * 2;
const LOTTERY_MAIN_MAX = 30;
const LOTTERY_MAIN_COUNT = 5;
const LOTTERY_BONUS_MAX = 10;
function randomLotteryQuickPick(): { main: number[]; bonus: number } {
  const s = new Set<number>();
  while (s.size < LOTTERY_MAIN_COUNT) s.add(Math.ceil(Math.random() * LOTTERY_MAIN_MAX));
  return { main: [...s].sort((a, b) => a - b), bonus: Math.ceil(Math.random() * LOTTERY_BONUS_MAX) };
}

type WithdrawalStep = "idle" | "submitting" | "sent" | "bridging" | "complete" | "failed" | "settling";
type PeerStep = "platform" | "form" | "bridging" | "creating-deposit" | "deposit-error" | "deposited" | "complete" | "cancelling" | "cancelled" | "failed";

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
              ~{formatTokenAmount(estimatedOut)} {destinationToken}
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
    <span
      className={cn(
        "grid h-[30px] w-[30px] place-items-center rounded-full text-white",
        active
          ? "bg-[linear-gradient(135deg,#FF2D0A,#F5B70C)]"
          : dark
            ? "bg-[#2A2A33] text-white"
            : "bg-gray-200 text-gray-600"
      )}
    >
      <span className="flex items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:stroke-[2.4]">
        {children}
      </span>
    </span>
  );
}

/**
 * "Pay now" widget for a direct wallet-to-wallet deposit — used by both Private Deposit and the
 * regular USDC deposit flow (identical UX, different destination/tx builder passed via onPay).
 * Connecting goes through the library's own WalletMultiButton (its internal click handling is
 * what actually works reliably; an earlier attempt to reimplement that click with our own Button
 * + useWalletModal() broke connecting entirely, for reasons that weren't worth chasing further
 * given a working alternative existed). Styled via CSS overrides only, no behavior changes, to
 * keep that working path intact. Once connected, WalletMultiButton is swapped out for a plain
 * address chip + our own Disconnect link (disconnect() is a simple state call, not a
 * modal-opening one, so reimplementing it doesn't carry the same risk). This also avoids the
 * connected state looking like a big gradient CTA when it's really just a status.
 * Must render inside SolanaWalletConnectProvider. Module-level (not nested in BalanceModal) so
 * it isn't redefined every render.
 */
function WalletPayNowWidget({
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
  /** Deep-link into a withdraw rail when opening the withdraw tab (claim cash-out / ?method=). */
  initialWithdrawMethod?: "peer" | "paj" | "crypto" | "near";
  /** Shortfall to prefill when opening from "Add funds & pay". */
  topUpAmountUsd?: number;
  /** Pay someone else's Venmo, Cash App, or Revolut handle. Opens the Peer cash-out form filled in. */
  peerPay?: { platformId: string; identifier: string; amountUsd: number } | null;
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
  initialWithdrawMethod,
  topUpAmountUsd,
  peerPay,
}: BalanceModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useTokensQuery();
  const reduceMotion = useReducedMotion();

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
  // Withdraw-flow lottery ticket upsell ("add 1 ticket to basket before withdraw")
  const [addLotteryTicket, setAddLotteryTicket] = useState(false);
  const [lotteryPrizePool, setLotteryPrizePool] = useState<string | null>(null);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [addressRiskStatus, setAddressRiskStatus] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");
  const [recipientNeedsUsdcAccount, setRecipientNeedsUsdcAccount] = useState(false);
  // Set once handleWithdraw has confirmed on-chain that the destination has no USDC account —
  // shows the setup-fee confirm step instead of sending straight away.
  const [ataFeeConfirmPending, setAtaFeeConfirmPending] = useState(false);
  // SOL withdrawal (USDC -> native SOL via Jupiter, apps/backend/src/modules/jupiter). The user's
  // own embedded wallet signs and pays for the swap itself — see solana-sponsor-safety project
  // memory for why this deliberately does not go through the generic sign-and-broadcast sponsor.
  const [solWithdrawStep, setSolWithdrawStep] = useState<"form" | "preparing" | "signing" | "sending" | "complete">("form");
  const [solWithdrawPrepared, setSolWithdrawPrepared] = useState<{ requestId: string; swapTransactionBase64: string; estimatedSolOut: number } | null>(null);
  const [solWithdrawSig, setSolWithdrawSig] = useState<string | null>(null);
  const [solWithdrawError, setSolWithdrawError] = useState<string | null>(null);
  const [recentWithdrawals, setRecentWithdrawals] = useState<WithdrawalHistoryItem[]>([]);
  const [dbDeposits, setDbDeposits] = useState<{ id: string; type: string; status: string; amount_usdc: number | null; deposit_address: string | null; bridge_status: string | null; created_at: string }[]>([]);
  const [dbDepositsLoading, setDbDepositsLoading] = useState(false);
  // DB id of the current in-flight Near Intents deposit so we can PATCH it as the bridge progresses
  const [depositDbId, setDepositDbId] = useState<string | null>(null);

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
  const [withdrawMethod, setWithdrawMethod] = useState<"crypto-picker" | "usdc-sol" | "sol-jupiter" | "near-intents" | "peer-offramp" | "private-relay" | "paj-cash" | null>(null);
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
  const [peerBasePending, setPeerBasePending] = useState(false);
  const [peerFailMessage, setPeerFailMessage] = useState<string | null>(null);
  const [peerSubmitting, setPeerSubmitting] = useState(false);
  const [peerOfframpId, setPeerOfframpId] = useState<string | null>(null);
  const [peerShareId, setPeerShareId] = useState<string | null>(null);
  const [peerBridgeDepositAddress, setPeerBridgeDepositAddress] = useState<string | null>(null);
  const [peerBridgeMemo, setPeerBridgeMemo] = useState<string | null>(null);
  const [peerBridgeTxSig, setPeerBridgeTxSig] = useState<string | null>(null);
  const [peerBridgeStatus, setPeerBridgeStatus] = useState<string | null>(null);
  const [peerBaseWalletAddress, setPeerBaseWalletAddress] = useState<string | null>(null);
  const [peerAmountUSDC, setPeerAmountUSDC] = useState<number>(0);
  const [peerZkp2pDepositId, setPeerZkp2pDepositId] = useState<string | null>(null);
  const [peerFilledAmountUSDC, setPeerFilledAmountUSDC] = useState<number | null>(null);
  const peerBridgePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerZkp2pSigningRef = useRef(false);
  const peerPayKickRef = useRef(false);
  const [peerCancelSubStep, setPeerCancelSubStep] = useState<"getting-address" | "signing-withdraw" | "signing-transfer" | "bridging-back" | null>(null);
  const [peerBridgeBackDepositAddress, setPeerBridgeBackDepositAddress] = useState<string | null>(null);
  const [peerBridgeBackStatus, setPeerBridgeBackStatus] = useState<string | null>(null);
  const peerBridgeBackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [platformCooldowns, setPlatformCooldowns] = useState<Record<string, number>>({});
  // Live oracle estimate + real fill-time ETA from @zkp2p/cash's estimate(), replacing the old
  // hand-rolled spread/FX math (now that Peer Cash always prices at zero-spread oracle rate).
  const [peerEstimate, setPeerEstimate] = useState<{ receiveAmount: number; eta: { seconds?: number; label: string } | null } | null>(null);
  const [peerEstimateLoading, setPeerEstimateLoading] = useState(false);

  // Near Intents top-up deposit
  const [topUpView, setTopUpView] = useState<"crypto-picker" | "usdc-deposit" | "near-intents-deposit" | "private-deposit" | "paj-cash-onramp" | "peer-deposit" | null>(null);

  // PAJ Cash (Naira on/off-ramp) history
  const [pajCashHistory, setPajCashHistory] = useState<PajCashOrder[]>([]);

  // Private Deposit (MagicBlock burner-relay) — USDC on Solana only for now (cross-chain sources
  // are built server-side but gated off until failed-bridge refund recovery is automated)
  const [privateDepositAmount, setPrivateDepositAmount] = useState("");
  // True once the amount screen's "Deposit" button is clicked. Moves past the amount form without
  // itself creating a burner. Pay now (direct, no burner) is the default next screen; the burner
  // only gets created if/when the user explicitly asks for a deposit address instead.
  const [privateDepositStarted, setPrivateDepositStarted] = useState(false);
  const [privateDepositSubmitting, setPrivateDepositSubmitting] = useState(false);
  const [privateDepositId, setPrivateDepositId] = useState<string | null>(null);
  const [privateDepositAddress, setPrivateDepositAddress] = useState<string | null>(null);
  const [privateDepositStatus, setPrivateDepositStatus] = useState<PrivateTransferStatus | null>(null);
  const [privateDepositError, setPrivateDepositError] = useState<string | null>(null);
  // Gross amount to actually send to the burner (net amount + estimated fees). The amount input
  // is what the user will receive, not what they send. See private-balance.service.ts startDeposit.
  const [privateDepositSendAmount, setPrivateDepositSendAmount] = useState<number | null>(null);
  const [privateDepositFeeEstimate, setPrivateDepositFeeEstimate] = useState<number | null>(null);
  // Which CTA the user picked once past the amount screen: "qr" shows the burner address/QR view;
  // null shows the direct Pay now (no burner) view, the default. Either can switch to the other.
  const [privateDepositEntryMode, setPrivateDepositEntryMode] = useState<"qr" | null>(null);
  const privateDepositPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  // Fee-confirmation gate between building the private withdrawal and signing it. The ref holds
  // the resolver for the promise handlePrivateWithdraw's onTxBuilt is parked on.
  const [privateFeeConfirmPending, setPrivateFeeConfirmPending] = useState(false);
  const privateFeeConfirmRef = useRef<((accepted: boolean) => void) | null>(null);
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

  // Peer deposit (Peer Pay hosted checkout — Venmo/Cash App/Zelle/PayPal/Revolut/etc, settles
  // USDC on Base only). We don't bridge Base -> Solana ourselves: we get a one-time Near Intents
  // deposit address for (USDC-Base -> USDC-Solana) first, hand that to Peer as destinationAddress,
  // then reuse the Near Intents deposit view/polling above for everything after that — Peer just
  // funds that address instead of a manual wallet-to-wallet send.
  const [peerDepositAmount, setPeerDepositAmount] = useState("");
  const [peerDepositSubmitting, setPeerDepositSubmitting] = useState(false);
  const [peerDepositError, setPeerDepositError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { user, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signAndSendTransaction: signAndSendLotteryTx } = useSignAndSendTransaction();
  const { fundWallet: privyFundWallet } = useFundWallet();
  const { fund: fundFiatOnramp } = useFiatOnramp();
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
    type: string, status = "pending", amount_usdc?: number, deposit_address?: string, provider_order_id?: string
  ): Promise<string | null> => {
    const token = await getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch("/api/users/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, status, amount_usdc, deposit_address, provider_order_id }),
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

  // Card onramp: buy USDC via Privy.
  // Desktop: privyFundWallet with card.preferredProvider: 'moonpay' — Privy's auto-skip
  // (defaultFundingMethod: 'card') fires the MoonPay popup from a useEffect after the modal
  // mounts, which desktop browsers still treat as a trusted gesture.
  // Mobile: that same popup gets silently blocked by mobile Safari/WebKit because it's opened
  // outside the original tap's call stack. useFiatOnramp().fund() runs synchronously from this
  // click instead, so its popup stays inside a trusted gesture — but it has no provider override,
  // so Privy may route to Coinbase/Stripe/Meld instead of MoonPay. The button below drops the
  // MoonPay branding on mobile to stay honest about that, and the deposit record uses a neutral
  // "card-onramp" type since we can't know which provider was actually used.
  const isMobileDevice = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const handleMoonpayOnramp = async () => {
    if (!solanaAddress) return;
    setMoonpayOnrampLoading(true);
    try {
      if (isMobileDevice) {
        recordDeposit("card-onramp", "pending");
        await fundFiatOnramp({
          source: { defaultAsset: "usd" },
          destination: { asset: "USDC", chain: "solana:mainnet", address: solanaAddress },
        });
      } else {
        recordDeposit("moonpay", "pending");
        await privyFundWallet({
          address: solanaAddress,
          options: {
            asset: 'USDC',
            defaultFundingMethod: 'card',
            card: { preferredProvider: 'moonpay' },
          },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open card onramp.";
      toast({ variant: "destructive", title: "Card onramp error", description: msg });
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

  // Peer deposit: get a Near Intents deposit address for (USDC-Base -> USDC-Solana), create a
  // Peer Pay checkout that settles to that address, then hand off to the same deposit-address
  // view/polling the "Near" crypto option already uses (setDepositAddr/setDepositPollAddr below).
  const handlePeerDeposit = async () => {
    if (!solanaAddress || !usdcSolanaToken || !baseUsdcToken || !peerDepositAmountNum) return;
    setPeerDepositSubmitting(true);
    setPeerDepositError(null);
    try {
      // Resolve/create the user's own Base (EVM) embedded wallet — used only as the Near Intents
      // refund address in case the bridge leg needs to return funds; Peer settles the checkout
      // itself, no signature from this wallet is required.
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

      const info = await getDepositInfo({
        fromToken: baseUsdcToken,
        toToken: usdcSolanaToken as NearToken,
        amount: peerDepositAmount,
        recipient: solanaAddress,
        sender: baseWalletAddr,
        refundAddress: baseWalletAddr,
      });
      if (!info.depositAddress) throw new Error("Could not get a deposit address");

      const accessToken = await getAccessToken();
      const res = await fetch("/api/peer-pay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ amountUsdc: peerDepositAmountNum, destinationAddress: info.depositAddress }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Checkout error ${res.status}`);
      }
      const { checkoutUrl, orderId } = await res.json();

      recordDeposit("peer-pay", "pending", peerDepositAmountNum, info.depositAddress, orderId).then((id) => {
        setDepositDbId(id);
      });

      // Feed the same address into the existing Near Intents deposit view/polling.
      setDepositAddr(info.depositAddress);
      setDepositMemo(info.memo ?? null);
      setDepositQuoteOut(peerDepositAmount);
      setDepositPollAddr(info.depositAddress);
      setDepositBridgeStatus("PENDING");
      setTopUpView("near-intents-deposit");

      const popup = window.open(checkoutUrl, "peer-checkout", "width=460,height=730,left=200,top=100,resizable=yes,scrollbars=yes");
      if (!popup) window.open(checkoutUrl, "_blank");

      setPeerDepositAmount("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not start Peer deposit.";
      setPeerDepositError(msg);
      toast({ variant: "destructive", title: "Peer deposit error", description: msg });
    } finally {
      setPeerDepositSubmitting(false);
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
    setPrivateDepositStarted(false);
    setPrivateDepositId(null);
    setPrivateDepositAddress(null);
    setPrivateDepositStatus(null);
    setPrivateDepositError(null);
    setPrivateDepositAmount("");
    setPrivateDepositSendAmount(null);
    setPrivateDepositFeeEstimate(null);
    setPrivateDepositEntryMode(null);
    setPayNowStatus("idle");
    setPayNowError(null);
    localStorage.removeItem(PRIVATE_DEPOSIT_SESSION_KEY);
  }, []);

  // Private Deposit "Pay now": a single direct private transfer from the connected wallet straight
  // to this account's own embedded wallet, no burner, gasless (MagicBlock's relay is the fee
  // payer, reimbursed in-token, never Loofta's sponsor), exactOut (delivers exactly the typed
  // amount). No private_transfers row and nothing to poll afterward: once the signature confirms
  // there's no further backend-tracked state, same as how private claim payments already work.
  const payPrivateDepositFromWallet = useCallback(async (
    senderAddress: string,
    signTx: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
  ) => {
    if (!user?.id || !privateDepositAmountNum) return;
    setPayNowError(null);
    try {
      const mode = devnetMode ? "devnet" : "mainnet";
      const connection = new Connection(getRpcForMode(mode), "confirmed");
      const accessToken = await getAccessToken();

      setPayNowStatus("building");
      const txData = await buildDirectPrivateDeposit(privateDepositAmountNum, senderAddress, user.id, accessToken, mode);

      const rawTxBytes = Buffer.from(txData.transactionBase64, "base64");
      let tx: Transaction | VersionedTransaction;
      try {
        tx = Transaction.from(rawTxBytes);
      } catch {
        tx = VersionedTransaction.deserialize(rawTxBytes);
      }

      setPayNowStatus("awaiting_signature");
      const signedTx = await signTx(tx);

      setPayNowStatus("broadcasting");
      const serialized = signedTx instanceof Transaction ? signedTx.serialize() : (signedTx as VersionedTransaction).serialize();
      const signature = await connection.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: "confirmed" });
      await waitForSignatureConfirmation(connection, signature, 120_000, 1500, "privateDepositDirect");

      setPayNowStatus("sent");
      onRefresh();
      toast({ title: "Sent!", description: "Routing privately to your balance…" });
    } catch (err: unknown) {
      setPayNowStatus("idle");
      const msg = err instanceof Error ? err.message : "Payment failed. Please try again.";
      setPayNowError(msg);
      toast({ variant: "destructive", title: "Payment failed", description: msg });
    }
  }, [devnetMode, toast, user?.id, privateDepositAmountNum, getAccessToken, onRefresh]);

  // Private Withdrawal: sign leg 1 (own wallet -> burner); backend cron handles leg 2 (burner -> destination).
  // USDC on Solana only for now — reuses withdrawAmount/withdrawAddress, same state usdc-sol uses.
  const handlePrivateWithdraw = async () => {
    if (!user?.id || !wallet || !solanaAddress) return;
    const amount = parseFloat(withdrawAmount) || 0;
    const destination = effectiveWithdrawAddress.trim();
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
        // The transaction is built (so the fees are real, not guessed) but nothing is signed yet.
        // Hold here and show the user exactly what lands at the destination; the promise resolves
        // when they confirm and rejects if they back out.
        onTxBuilt: ({ id: txId, feeAmountUsdc }) => {
          setPrivateWithdrawId(txId);
          setPrivateWithdrawFee(feeAmountUsdc);
          localStorage.setItem(PRIVATE_WITHDRAW_SESSION_KEY, txId);
          return new Promise<void>((resolve, reject) => {
            privateFeeConfirmRef.current = (accepted: boolean) => {
              privateFeeConfirmRef.current = null;
              setPrivateFeeConfirmPending(false);
              if (accepted) {
                setPrivateWithdrawStatus("awaiting_signature");
                resolve();
              } else {
                reject(new Error("CANCELLED_BY_USER"));
              }
            };
            setPrivateFeeConfirmPending(true);
          });
        },
      });
      setPrivateWithdrawId(id);
      setPrivateWithdrawStatus("delivering_to_burner");
      optimisticWithdrawBalance(amount);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Private withdrawal failed";
      // Backing out at the fee confirmation isn't a failure — nothing was signed or sent, so
      // return to the form rather than showing an error over a withdrawal that never started.
      if (msg === "CANCELLED_BY_USER") {
        resetPrivateWithdraw();
        return;
      }
      setPrivateWithdrawError(msg);
      toast({ variant: "destructive", title: "Private withdrawal failed", description: msg });
    } finally {
      setPrivateFeeConfirmPending(false);
      privateFeeConfirmRef.current = null;
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

  const wallet = useMemo(() => {
    const list = solanaWallets ?? [];
    const match = solanaAddress ? list.find((w) => w.address === solanaAddress) : undefined;
    // Linked-account resolution can point at a wallet this signer list does not contain.
    // The Privy embedded wallet is the one that can actually sign the payment.
    return match ?? list.find((w) => w.walletClientType === "privy") ?? list[0];
  }, [solanaAddress, solanaWallets]);

  // Withdraw-flow lottery ticket add-on: same /api/lottery/buy + buy-confirm public-route quick-pick
  // purchase as megapot/page.tsx's handlePublicBuy, using the embedded Solana wallet already in scope
  // here. Kept intentionally soft-fail — a failed add-on never blocks the underlying withdrawal.
  const buyQuickLotteryTicket = useCallback(async (): Promise<boolean> => {
    if (!wallet?.address) return false;
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const pick = randomLotteryQuickPick();
      const initRes = await fetch("/api/lottery/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          numTickets: 1,
          userSolanaAddress: wallet.address,
          tickets: [{ main: pick.main, bonus: pick.bonus }],
          route: "solana_public",
        }),
      });
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({} as { message?: string }));
        throw new Error(err.message ?? "Failed to buy ticket");
      }
      const { ticketId, txBase64 } = await initRes.json();
      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendLotteryTx({
        transaction: txBytes as unknown as Uint8Array,
        wallet: wallet as any,
      });
      const signature = bs58.encode(sigBytes as Uint8Array);
      await fetch("/api/lottery/buy-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketId, senderTxHash: signature }),
      });
      return true;
    } catch (err: unknown) {
      console.warn(`${LOG_PREFIX} lottery ticket add-on failed:`, err);
      return false;
    }
  }, [wallet, getAccessToken, signAndSendLotteryTx]);

  // Live prize pool for the upsell copy — fetched once when the primary withdraw form is reached;
  // falls back to the same "$1,100,000+" marketing snapshot used elsewhere in the app.
  useEffect(() => {
    if (tab !== "withdraw" || withdrawMethod !== "usdc-sol" || lotteryPrizePool) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/lottery/dashboard", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) return;
        const data = await res.json();
        const pool = data?.nextDraw?.prizePool;
        if (!cancelled && pool) setLotteryPrizePool(pool);
      } catch { /* non-fatal — fallback copy used */ }
    })();
    return () => { cancelled = true; };
  }, [tab, withdrawMethod, lotteryPrizePool, getAccessToken]);

  const lotteryPrizePoolDisplay = useMemo(() => {
    if (lotteryPrizePool) {
      const amount = Math.round(parseFloat(lotteryPrizePool) / 100_000) * 100_000;
      if (amount > 0) return `$${amount.toLocaleString()}+`;
    }
    return "$1,100,000+";
  }, [lotteryPrizePool]);

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

  // Peer deposit always bridges from USDC on Base — Peer Pay only ever settles there.
  const baseUsdcToken = useMemo(
    () => depositTokens.find((t) => t.symbol?.toUpperCase() === "USDC" && t.chain?.toLowerCase() === "base"),
    [depositTokens]
  );
  const peerDepositAmountNum = parseFloat(peerDepositAmount) || 0;

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

  // Live-priced USDC-account setup fee, rounded up to the cent so we're never short; falls back
  // to the flat quote when the price feed is unavailable.
  const solPriceUsd = useSolPriceOrNull();
  const ataSetupFeeUsdc = useMemo(
    () => (solPriceUsd ? Math.ceil(ATA_RENT_SOL * ATA_FEE_BUFFER * solPriceUsd * 100) / 100 : ATA_SETUP_FEE_FALLBACK_USDC),
    [solPriceUsd],
  );
  // .sol domain support. The user may type either a raw address or a domain; everything
  // downstream (validation, risk check, ATA lookup, the transfer itself) works off
  // `effectiveWithdrawAddress`, which is the resolved wallet whenever a domain resolved and the
  // raw input otherwise. Solana destinations only — a domain means nothing on another chain.
  const solDomain = useSolDomain(isUSDCOnSolana ? withdrawAddress : "", devnetMode ? "devnet" : "mainnet");
  const effectiveWithdrawAddress = solDomain.address ?? withdrawAddress;
  const destinationAddressValid = isValidAddressForChain(effectiveWithdrawAddress, isUSDCOnSolana ? "solana" : destChain);

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
        const result = peerBridgeDepositAddress === "relay"
          ? await (async () => {
              const token = await getAccessToken();
              const res = await fetch(`/api/offramp/${peerOfframpId}?action=relay-status`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              return res.json() as Promise<{ status?: string }>;
            })()
          : await getExecutionStatus(peerBridgeDepositAddress);
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
      (w) => w.address.toLowerCase() === peerBaseWalletAddress.toLowerCase() && typeof (w as any).getEthereumProvider === "function"
    );
    if (!evmWalletForCheck) {
      console.warn(PEER_LOG, "EOA wallet not ready yet, waiting...");
      return;
    }

    peerZkp2pSigningRef.current = true;
    let cancelled = false;
    let startedCashout = false;

    const run = async () => {
      try {
        console.log(PEER_LOG, "step 3 — Peer signing on Base (gas sponsored via Privy)", { baseWallet: peerBaseWalletAddress });
        const evmGateToken = await getAccessToken();
        await assertEvmSponsorAllowed(peerBaseWalletAddress!, user!.id, evmGateToken);

        const { base } = await import("viem/chains");
        const { createPublicClient: mkPublic, createWalletClient, custom, http: httpT, erc20Abi: _erc20Abi } = await import("viem");

        const evmWallet = evmWalletsRef.current.find(
          (w) => w.address.toLowerCase() === peerBaseWalletAddress!.toLowerCase() && typeof (w as any).getEthereumProvider === "function"
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

        // Relay can report the bridge done before Base shows the USDC. Wait for the
        // payout amount instead of failing the setup on the first zero read.
        const requestedAtomic = BigInt(Math.round(peerAmountUSDC * 1_000_000));
        const pubClient = mkPublic({ chain: base, transport: httpT("https://mainnet.base.org") });
        const readBaseUsdc = () => pubClient.readContract({
          address: BASE_USDC_ADDRESS,
          abi: _erc20Abi,
          functionName: "balanceOf",
          args: [peerBaseWalletAddress as `0x${string}`],
        }) as Promise<bigint>;
        setPeerBasePending(true);
        let rawBalance = 0n;
        for (let attempt = 0; attempt < 15 && !cancelled; attempt++) {
          rawBalance = await readBaseUsdc();
          console.log(PEER_LOG, "Base USDC balance", rawBalance.toString(), "deposit", requestedAtomic.toString(), "attempt", attempt);
          if (rawBalance >= requestedAtomic) break;
          await new Promise((r) => setTimeout(r, 4000));
        }
        setPeerBasePending(false);
        if (cancelled) return;
        if (rawBalance < requestedAtomic) throw new Error("No USDC found on Base wallet. It may still be bridging — please wait and retry.");
        const atomicUsdc = requestedAtomic;

        if (cancelled) return;
        startedCashout = true;

        // ZKP2P expects the raw username without display prefixes (@ for Revolut/Venmo, $ for Cash App)
        const zkp2pId = peerIdentifier.trim().replace(/^[@$]/, "");
        console.log(PEER_LOG, "signing cashout()...", { platform: platform.processorName, identifier: zkp2pId, currency: peerCurrency, amount: atomicUsdc.toString() });

        // cash.cashout() owns the whole deposit flow now: approve (if needed), createDeposit, and
        // for Venmo/Cash App/PayPal the follow-up access-policy transaction — replacing what used
        // to be a hand-rolled allowance check + OfframpClient.createDeposit + receipt-log parse.
        const { peerCashout } = await import("@/services/peerCash");
        const { depositId, txHash: depositTxHash, accessPolicyTxHash } = await peerCashout({
          amountAtomicUsdc: atomicUsdc,
          platform: platform.processorName,
          currency: peerCurrency,
          payee: zkp2pId,
          signer: sponsoredClient as any,
          // Paying someone else's handle is one order, filled by one person.
          // Deposit is amount + fill incentive; the peer still pays the typed fiat amount.
          exactFill: !!peerPay,
        });

        if (cancelled) return;

        console.log(PEER_LOG, "Peer deposit created", { depositId, depositTxHash, accessPolicyTxHash });

        // Notify backend to record the deposit
        const accessToken = await getAccessToken();
        await fetch(`/api/offramp/${peerOfframpId}?action=record-deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ depositId, txHash: depositTxHash, accessPolicyTxHash: accessPolicyTxHash ?? null, etaSeconds: peerEstimate?.eta?.seconds ?? null, etaLabel: peerEstimate?.eta?.label ?? null }),
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
        setPeerBasePending(false);

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
    return () => {
      cancelled = true;
      if (!startedCashout) peerZkp2pSigningRef.current = false;
    };
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
        const data = await res.json() as { status?: string; filled_amount_usdc?: number | null };
        console.log(PEER_LOG, "Peer status poll", data.status);
        if (!cancelled && typeof data.filled_amount_usdc === "number") setPeerFilledAmountUSDC(data.filled_amount_usdc);
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

  // Live oracle estimate + real fill-time ETA from @zkp2p/cash — see the effect below
  // withdrawAmountNum's declaration further down in this component.

  useEffect(() => {
    if (!open || !topUpAmountUsd || topUpAmountUsd <= 0) return;
    const prefilled = topUpAmountUsd.toFixed(2);
    setPeerDepositAmount(prefilled);
    setDepositAmount(prefilled);
  }, [open, topUpAmountUsd]);

  const [privyTopUpLoading, setPrivyTopUpLoading] = useState(false);
  const handlePrivyCrossChainTopUp = async () => {
    if (!solanaAddress) return;
    setPrivyTopUpLoading(true);
    try {
      recordDeposit("privy-funding", "pending", topUpAmountUsd);
      await privyFundWallet({
        address: solanaAddress,
        options: {
          asset: "USDC",
          chain: devnetMode ? "solana:devnet" : "solana:mainnet",
          ...(topUpAmountUsd && topUpAmountUsd > 0 ? { amount: topUpAmountUsd.toFixed(2) } : {}),
        },
      });
      onRefresh?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open funding.";
      if (!/cancel|closed|dismiss/i.test(msg)) {
        toast({ variant: "destructive", title: "Couldn't open funding", description: msg });
      }
    } finally {
      setPrivyTopUpLoading(false);
    }
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
        setPeerBaseWalletAddress(null); setPeerAmountUSDC(0); setPeerZkp2pDepositId(null); setPeerFilledAmountUSDC(null);
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

  // Private Deposit: restore an in-progress burner session on reopen (completion is backend-driven,
  // can outlive a single session). Only the burner/QR path has anything to restore. The direct
  // Pay now path has no backend row, nothing persists past a page reload for it.
  useEffect(() => {
    if (!open || privateDepositId) return;
    const saved = localStorage.getItem(PRIVATE_DEPOSIT_SESSION_KEY);
    if (saved) {
      setPrivateDepositId(saved);
      setPrivateDepositStarted(true);
      setPrivateDepositEntryMode("qr");
    }
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

  // Auto-cancel pending near-intents deposits older than 1 hour, but only if bridging never
  // even started (bridge_status unset) — the client-side poll that sets bridge_status only runs
  // while this tab is open, so a deposit that's actually in flight (or already settled) must
  // never get blindly stamped "cancelled" here on a wall-clock timer alone. That used to happen
  // for ANY dep.status === "pending" row regardless of type or progress, and since the backend
  // reconciliation cron (user-deposits-processor.service.ts) only polls status='pending' rows,
  // a wrongly-cancelled row was permanently excluded from ever being corrected. Scoped to
  // near-intents specifically since coinbase/moonpay deposits have no reconciliation cron at all —
  // guessing "cancelled" for those would be strictly worse than leaving them visibly pending.
  const ONE_HOUR_MS = 60 * 60 * 1000;
  useEffect(() => {
    const now = Date.now();
    dbDeposits.forEach((dep) => {
      if (dep.type === "near-intents" && dep.status === "pending" && !dep.bridge_status && !autoExpiredRef.current.has(dep.id)) {
        const age = now - new Date(dep.created_at).getTime();
        if (age > ONE_HOUR_MS) {
          autoExpiredRef.current.add(dep.id);
          patchDeposit(dep.id, { status: "cancelled" });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbDeposits]);

  // Reset token selection and address when withdraw method changes — except switching between
  // usdc-sol and sol-jupiter, which is just toggling the output token for the same Solana
  // destination, so the address (and its compliance check) the user already entered carries over.
  const prevWithdrawMethodRef = useRef(withdrawMethod);
  useEffect(() => {
    const prev = prevWithdrawMethodRef.current;
    prevWithdrawMethodRef.current = withdrawMethod;
    const isSolanaTokenToggle =
      (prev === "usdc-sol" && withdrawMethod === "sol-jupiter") ||
      (prev === "sol-jupiter" && withdrawMethod === "usdc-sol");

    // Also clear any finished public-withdrawal step — otherwise picking a different withdraw
    // method still carries the previous run's terminal state, which surfaces as a stale success
    // panel next to the new flow.
    setWithdrawStep((s) => (s === "complete" || s === "failed" ? "idle" : s));
    setFromSel(undefined);
    setAtaFeeConfirmPending(false);
    setSolWithdrawStep("form");
    setSolWithdrawPrepared(null);
    setSolWithdrawSig(null);
    setSolWithdrawError(null);
    if (!isSolanaTokenToggle) {
      setWithdrawAddress("");
      setAddressRiskStatus("idle");
    }
  }, [withdrawMethod]);

  // On devnet, USDC on Solana is the only supported withdraw method — skip the picker.
  useEffect(() => {
    if (devnetMode && tab === "withdraw" && withdrawMethod === null) {
      setWithdrawMethod("usdc-sol");
    }
  }, [devnetMode, tab, withdrawMethod]);

  // On open: jump to requested tab (e.g. "withdraw" from UpdateJun26Modal) and optional rail
  // (claim Peer cash-out / ?method=peer|paj|crypto).
  useEffect(() => {
    if (!open) return;
    if (initialTab) setTab(initialTab);
    if (peerPay?.platformId && peerPay.identifier && peerPay.amountUsd > 0) {
      setTab("withdraw");
      setShowFiatOfframpPicker(false);
      setWithdrawMethod("peer-offramp");
      setPeerPlatformId(peerPay.platformId);
      setPeerIdentifier(peerPay.identifier);
      setPeerCurrency("USD");
      setWithdrawAmount(peerPay.amountUsd.toFixed(2).replace(/\.00$/, ""));
      setPeerStep("form");
      return;
    }
    if (initialTab === "withdraw" && initialWithdrawMethod) {
      if (initialWithdrawMethod === "peer") {
        setShowFiatOfframpPicker(false);
        setWithdrawMethod("peer-offramp");
      } else if (initialWithdrawMethod === "paj") {
        setShowFiatOfframpPicker(false);
        setWithdrawMethod("paj-cash");
      } else if (initialWithdrawMethod === "crypto") {
        setShowFiatOfframpPicker(false);
        setWithdrawMethod("crypto-picker");
      } else if (initialWithdrawMethod === "near") {
        setShowFiatOfframpPicker(false);
        setTab("withdraw");
        setWithdrawMethod("near-intents");
        if (topUpAmountUsd && topUpAmountUsd > 0) {
          setWithdrawAmount(topUpAmountUsd.toFixed(2).replace(/\.00$/, ""));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab, initialWithdrawMethod, peerPay, topUpAmountUsd]);

  // On open: load history and resume any in-progress Near Intents withdrawal
  useEffect(() => {
    if (!open) return;
    const history = getWithdrawalHistory();
    setRecentWithdrawals(history);
    fetchDbDeposits();
    fetchPajCashHistory();

    // Restore deposit view if a Near Intents top-up is still pending
    if (depositAddr && !TERMINAL_BRIDGE_STATUSES.has(depositBridgeStatus || "")) {
      setTab("topup");
      setTopUpView("near-intents-deposit");
    }

    // A send-form pay-to-handle request owns this open. Don't resume an older cash-out over it.
    if (peerPay?.platformId) return;
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
            filled_amount_usdc?: number | null;
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
          setPeerFilledAmountUSDC(typeof record.filled_amount_usdc === "number" ? record.filled_amount_usdc : null);

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

  // Initialise amount to full spendable balance when modal opens or balance changes.
  // A pay-to-app already has its own amount; overwriting it would send the whole balance.
  useEffect(() => {
    if (peerPay) return;
    if (topUpAmountUsd && topUpAmountUsd > 0) {
      setWithdrawAmount(topUpAmountUsd.toFixed(2).replace(/\.00$/, ""));
      return;
    }
    if (open && spendableBalance > 0) setWithdrawAmount(spendableBalance.toFixed(6).replace(/\.?0+$/, ""));
  }, [open, spendableBalance, peerPay, topUpAmountUsd]);

  const withdrawAmountNum = parseFloat(withdrawAmount) || 0;
  const peerPayGrossUsd = peerPay ? cashoutGrossUsdc(peerPay.amountUsd) : 0;
  const peerPayFeeUsd = peerPay ? Math.max(0, peerPayGrossUsd - peerPay.amountUsd) : 0;

  // Private withdrawals debit the sender for amount + fees ON TOP (MagicBlock exactOut) — see
  // PRIVATE_WITHDRAW_FEE_HEADROOM_USDC. This is the real max the form should ever offer/allow.
  const privateWithdrawMaxUsdc = Math.max(0, spendableBalance - PRIVATE_WITHDRAW_FEE_HEADROOM_USDC);

  // Private-relay debits amount + fees on top of the sender's balance (see
  // PRIVATE_WITHDRAW_FEE_HEADROOM_USDC) — the generic "default to full balance" effect above
  // doesn't know that, so re-clamp whenever this method becomes active or the max shifts.
  useEffect(() => {
    if (withdrawMethod === "private-relay" && withdrawAmountNum > privateWithdrawMaxUsdc) {
      setWithdrawAmount(privateWithdrawMaxUsdc > 0 ? privateWithdrawMaxUsdc.toFixed(6).replace(/\.?0+$/, "") : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawMethod, privateWithdrawMaxUsdc]);

  // Live oracle estimate + real fill-time ETA from @zkp2p/cash, debounced on amount/platform
  // change. Peer Cash always prices at the live zero-spread oracle rate — no more hand-rolled
  // spread/FX math — so this is the actual "you'll receive" number, not an approximation.
  useEffect(() => {
    if (withdrawMethod !== "peer-offramp" || peerStep !== "form") return;
    const platform = getPlatform(peerPlatformId ?? "");
    if (!platform || withdrawAmountNum < 1) { setPeerEstimate(null); return; }

    let cancelled = false;
    setPeerEstimateLoading(true);
    const t = setTimeout(async () => {
      try {
        const { getPeerEstimate: fetchEstimate, usdc } = await import("@/services/peerCash");
        const estimateUsdc = peerPay ? cashoutGrossUsdc(withdrawAmountNum) : withdrawAmountNum;
        const est = await fetchEstimate(usdc(estimateUsdc), peerCurrency, platform.processorName, true);
        if (cancelled) return;
        setPeerEstimate({ receiveAmount: est.receiveAmount, eta: est.eta ?? null });
      } catch (err) {
        console.warn(PEER_LOG, "estimate fetch failed", err);
        if (!cancelled) setPeerEstimate(null);
      } finally {
        if (!cancelled) setPeerEstimateLoading(false);
      }
    }, 400);

    return () => { cancelled = true; clearTimeout(t); };
  }, [withdrawMethod, peerStep, peerPlatformId, peerCurrency, withdrawAmountNum, peerPay]);

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
    if (!isUSDCOnSolana && withdrawMethod !== "sol-jupiter") { setAddressRiskStatus("idle"); return; }
    const raw = effectiveWithdrawAddress.trim();
    if (!raw || !isValidAddressForChain(raw, "solana")) { setAddressRiskStatus("idle"); return; }
    setAddressRiskStatus("checking");
    const t = setTimeout(async () => {
      const { safe } = await checkAddressRisk(raw);
      setAddressRiskStatus(safe ? "safe" : "unsafe");
    }, 500);
    return () => clearTimeout(t);
  }, [effectiveWithdrawAddress, checkAddressRisk, isUSDCOnSolana, withdrawMethod]);

  // Does the destination already have a USDC account? If not, Solana requires one to be created
  // and we charge the setup fee (see ataSetupFeeUsdc) — surfaced in the form BEFORE the
  // user commits, so the smaller-than-expected amount landing is never a surprise.
  useEffect(() => {
    if (!isUSDCOnSolana) { setRecipientNeedsUsdcAccount(false); return; }
    const raw = effectiveWithdrawAddress.trim();
    if (!raw || !isValidAddressForChain(raw, "solana")) { setRecipientNeedsUsdcAccount(false); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const conn = new Connection(getRpcForMode(devnetMode ? "devnet" : "mainnet"), "confirmed");
        const ata = getAssociatedTokenAddressSync(getUsdcMintForMode(devnetMode ? "devnet" : "mainnet"), new PublicKey(raw));
        const info = await conn.getAccountInfo(ata);
        if (!cancelled) setRecipientNeedsUsdcAccount(!info);
      } catch {
        // Can't tell (RPC hiccup) — don't warn about a fee we're not sure applies. handleWithdraw
        // re-checks against the chain right before sending, so the charge itself stays correct.
        if (!cancelled) setRecipientNeedsUsdcAccount(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [effectiveWithdrawAddress, isUSDCOnSolana, devnetMode]);

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
    setPeerOfframpId(null); setPeerShareId(null); setPeerBridgeDepositAddress(null); setPeerBridgeMemo(null);
    setPeerBridgeTxSig(null); setPeerBridgeStatus(null);
    setPeerBaseWalletAddress(null); setPeerAmountUSDC(0); setPeerZkp2pDepositId(null);
    setPeerBridgeBackDepositAddress(null);
    setPeerBridgeBackStatus(null);
    setPeerCancelSubStep(null);
    setPeerEstimate(null);
    setPeerEstimateLoading(false);
    setPeerFailMessage(null);
  };

  const fetchPajCashHistory = async () => {
    if (!PAJ_CASH_ENABLED) return;
    try {
      const token = await getAccessToken();
      const orders = await pajListOrders(token);
      setPajCashHistory(orders);
    } catch { /* non-fatal */ }
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

      // Step 2: Close any open Peer deposit — if deposit found but withdrawal fails, STOP (don't mark cancelled)
      setPeerCancelSubStep("signing-withdraw");
      let foundDepositId: string | null = null;
      {
        const { peerWithdraw, peerOrders } = await import("@/services/peerCash");

        // Find deposit ID: use known value first, otherwise scan on-chain orders
        if (peerZkp2pDepositId) {
          foundDepositId = peerZkp2pDepositId;
          console.log(PEER_LOG, "bridge-back: using known deposit ID", peerZkp2pDepositId);
        } else {
          try {
            const orders = await peerOrders(peerBaseWalletAddress as string, { inFlight: true });
            const activeOrder = orders.find((o) => o.isInFlight && !o.withdrawn);
            if (activeOrder) foundDepositId = activeOrder.depositId;
          } catch (err: any) {
            console.warn(PEER_LOG, "bridge-back: deposit lookup failed (will check balance anyway)", err.message);
          }
        }

        if (foundDepositId !== null) {
          console.log(PEER_LOG, "bridge-back: withdrawing Peer deposit", { depositId: foundDepositId });
          try {
            await peerWithdraw(foundDepositId, walletClient as any);
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
    const payerAddress = wallet?.address || solanaAddress;
    if (!platform || !peerIdentifier.trim() || !payerAddress || !wallet) {
      if (peerPay) peerPayKickRef.current = false;
      return;
    }
    if (withdrawAmountNum < 1) {
      toast({ variant: "destructive", title: "Minimum $1", description: "Minimum offramp is $1.00 USDC." });
      return;
    }
    const depositUsdc = peerPay ? cashoutGrossUsdc(withdrawAmountNum) : withdrawAmountNum;
    if (depositUsdc > spendableBalance) {
      if (peerPay && spendableBalance <= 0) {
        peerPayKickRef.current = false;
        return;
      }
      toast({ variant: "destructive", title: "Insufficient balance" });
      if (peerPay) setPeerStep("failed");
      return;
    }
    if (platform.maxUSDC != null && withdrawAmountNum > platform.maxUSDC) {
      toast({ variant: "destructive", title: `${platform.name} limit is $${platform.maxUSDC} USDC` });
      return;
    }
    const cooldownRemaining = getPlatformCooldownRemaining(platform.id, platform.cooldownHours);
    if (cooldownRemaining > 0) {
      toast({ variant: "destructive", title: `${platform.name} is in cooldown`, description: `${formatCooldown(cooldownRemaining)}` });
      return;
    }
    setPeerSubmitting(true);
    console.log(PEER_LOG, "submit", { platform: platform.id, amount: withdrawAmountNum, depositUsdc, currency: peerCurrency });
    try {
      // Cash-out spends Base USDC from a wallet Privy has linked to this user. Peer does not
      // pull Solana USDC itself, so this address is both the bridge destination and the signer.
      const linkedEvmAddresses = (privyUser: typeof user) => {
        const accounts = (privyUser?.linkedAccounts ?? []) as Array<{ address?: string; type?: string; chainType?: string }>;
        return accounts
          .filter((a) => {
            const type = (a.type || "").toLowerCase();
            const chain = (a.chainType || "").toLowerCase();
            return !type.includes("solana") && chain !== "solana";
          })
          .map((a) => a.address?.trim() ?? "")
          .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
      };
      const findOwnedEvmWallet = (addresses: string[]) => evmWalletsRef.current.find(
        (w) => typeof (w as any).getEthereumProvider === "function"
          && addresses.some((a) => a.toLowerCase() === w.address.toLowerCase()),
      );
      let currentUser = user;
      let baseWallet = findOwnedEvmWallet(linkedEvmAddresses(currentUser));
      if (!baseWallet) {
        try { await createEvmWallet(); } catch (e: any) {
          if (!String(e?.message).toLowerCase().includes("already has")) throw e;
        }
        for (let i = 0; i < 20; i++) {
          try { currentUser = await refreshUser(); } catch { /* keep the last user */ }
          baseWallet = findOwnedEvmWallet(linkedEvmAddresses(currentUser));
          if (baseWallet) break;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!baseWallet) throw new Error("Could not load your Base wallet. Please try again.");
      const baseWalletAddr = baseWallet.address;
      setPeerBaseWalletAddress(baseWalletAddr);
      setPeerAmountUSDC(depositUsdc);
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
          amountUSDC: depositUsdc,
          solanaAddress: payerAddress,
          baseWalletAddress: baseWalletAddr,
        }),
      });
      const prepText = await prepRes.text();
      let prep: {
        id?: string; shortId?: string; bridge?: string; amountInUsdc?: number;
        depositAddress?: string; memo?: string; message?: string;
      } = {};
      try { prep = prepText ? JSON.parse(prepText) : {}; } catch { /* empty or HTML error page */ }
      if (!prepText) {
        throw new Error(prepRes.status >= 500
          ? "The payment service is unavailable. Try again in a moment."
          : `Failed to prepare this send (${prepRes.status}).`);
      }
      console.log(PEER_LOG, "prepare response", { status: prepRes.status, id: prep.id, bridge: prep.bridge });
      if (!prepRes.ok || !prep.id || prep.bridge !== "relay") {
        throw new Error(prep.message || "Failed to prepare offramp");
      }
      setPeerOfframpId(prep.id);
      setPeerShareId(prep.shortId ?? null);

      if (prep.amountInUsdc && spendableBalance + 0.000001 < prep.amountInUsdc) {
        throw new Error(`This send needs $${prep.amountInUsdc.toFixed(2)} from your balance, including the bridge fee.`);
      }

      // 2. Sign the Relay deposit. It moves Solana USDC to Base; the fee payer covers the Solana fee.
      console.log(PEER_LOG, "step 2 — Relay bridge to Base", { amountInUsdc: prep.amountInUsdc });
      setPeerStep("bridging");
      const mode = devnetMode ? "devnet" : "mainnet";
      const txRes = await fetch(`/api/offramp/${prep.id}?action=relay-tx`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const txText = await txRes.text();
      let txBody: { transaction?: string; message?: string } = {};
      try { txBody = txText ? JSON.parse(txText) : {}; } catch { /* empty or HTML error page */ }
      if (!txRes.ok || !txBody.transaction) throw new Error(txBody.message || "Could not build the bridge");
      const rawTx = Uint8Array.from(atob(txBody.transaction), (c) => c.charCodeAt(0));
      const { signedTransaction } = await signTransaction({
        transaction: rawTx,
        wallet,
        chain: getPrivySolanaChainForMode(mode),
        options: { uiOptions: { showWalletUIs: false } },
      });
      let signedBinary = "";
      const signedBytes = signedTransaction instanceof Uint8Array ? signedTransaction : new Uint8Array(signedTransaction as ArrayBuffer);
      for (let i = 0; i < signedBytes.length; i++) signedBinary += String.fromCharCode(signedBytes[i]);
      const broadcastRes = await fetch(`/api/offramp/${prep.id}?action=relay-broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transaction: btoa(signedBinary) }),
      });
      const broadcastText = await broadcastRes.text();
      let broadcast: { signature?: string; message?: string } = {};
      try { broadcast = broadcastText ? JSON.parse(broadcastText) : {}; } catch { /* empty or HTML error page */ }
      if (!broadcastRes.ok || !broadcast.signature) throw new Error(broadcast.message || "Bridge failed to send");

      console.log(PEER_LOG, "Relay deposit sent", { sig: broadcast.signature });
      setPeerBridgeTxSig(broadcast.signature);
      setPeerBridgeDepositAddress("relay");
      setPeerBridgeStatus("PENDING");
      optimisticWithdrawBalance(prep.amountInUsdc || depositUsdc);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(PEER_LOG, "submit error", msg);
      if (msg.includes("user rejected") || msg.includes("denied")) {
        toast({ variant: "destructive", title: "Cancelled" });
        setPeerFailMessage(null);
        setPeerStep(peerPay ? "failed" : "form");
      } else {
        toast({ variant: "destructive", title: "Failed", description: msg });
        setPeerFailMessage(msg);
        setPeerStep("failed");
      }
    } finally {
      setPeerSubmitting(false);
    }
  };

  // Once the pay is actually sending, leave this modal and open the same kind of
  // receipt page a normal payment uses. The share code is the receipt id.
  const peerReceiptOpenedRef = useRef(false);
  useEffect(() => {
    if (!open) peerReceiptOpenedRef.current = false;
  }, [open]);
  useEffect(() => {
    if (!open || !peerPay || !peerShareId || peerReceiptOpenedRef.current) return;
    if (peerStep !== "deposited" && peerStep !== "complete") return;
    peerReceiptOpenedRef.current = true;
    onClose();
    router.push(`/app/pay/${peerShareId}`);
  }, [open, peerPay, peerShareId, peerStep, onClose, router]);

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

        // Withdraw the Peer deposit (returns USDC to user's Base wallet)
        setPeerCancelSubStep("signing-withdraw");
        console.log(PEER_LOG, "cancel step 2 — signing Peer withdraw (sponsored)", { depositId: peerZkp2pDepositId });
        const { peerWithdraw } = await import("@/services/peerCash");
        await peerWithdraw(peerZkp2pDepositId, walletClient as any);
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

  const handleWithdraw = async (ataFeeAcknowledged = false) => {
    const rawAddress = effectiveWithdrawAddress.trim();
    const amount = withdrawAmountNum;

    if (amount <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Enter an amount greater than 0." });
      return;
    }
    if (amount > spendableBalance) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `You have ${spendableBalance.toFixed(6).replace(/\.?0+$/, "")} USDC available.` });
      return;
    }
    if (addLotteryTicket && amount + LOTTERY_TICKET_PRICE_USDC > spendableBalance) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `Adding a $${LOTTERY_TICKET_PRICE_USDC.toFixed(2)} ticket needs a bit more USDC than you have available.` });
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

      // Setup-fee gate. Verified against the chain right here rather than trusting the form's
      // debounced check, so we only ever ask the user to confirm a fee that genuinely applies.
      // A failed lookup falls through and lets the send proceed — handleWithdraw re-checks once
      // more before building the transaction, so the amount charged stays correct either way.
      if (!ataFeeAcknowledged) {
        try {
          const conn = new Connection(getRpcForMode(devnetMode ? "devnet" : "mainnet"), "confirmed");
          const ata = getAssociatedTokenAddressSync(getUsdcMintForMode(devnetMode ? "devnet" : "mainnet"), new PublicKey(rawAddress));
          if (!(await conn.getAccountInfo(ata))) {
            if (ataSetupFeeUsdc >= amount) {
              toast({
                variant: "destructive",
                title: "Amount too small",
                description: `This wallet has never held USDC and needs a one-time $${ataSetupFeeUsdc.toFixed(2)} account setup — more than you're withdrawing. Withdraw a larger amount, or use a wallet that already holds USDC.`,
              });
              return;
            }
            setRecipientNeedsUsdcAccount(true);
            setAtaFeeConfirmPending(true);
            return;
          }
        } catch {
          // Couldn't check — don't block the withdrawal on an RPC hiccup.
        }
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
      // Ticket add-on goes first and never blocks the withdrawal itself — a failed purchase just
      // means no ticket, the user's actual withdrawal still proceeds for the full requested amount.
      if (addLotteryTicket) {
        const ticketAdded = await buyQuickLotteryTicket();
        if (ticketAdded) {
          toast({
            duration: Infinity,
            title: "Ticket added! 🎟️",
            description: (
              <span className="text-base">
                Good luck — you're in for today&apos;s draw, a shot at {lotteryPrizePoolDisplay}.
              </span>
            ),
            action: (
              <ToastAction altText="View your Megapot tickets" asChild>
                <Link
                  href="/app/megapot?tab=history"
                  className="!bg-gradient-to-r !from-[#FF1301] !to-[#EAB308] !text-white !border-0 !font-semibold hover:!opacity-90"
                >
                  View tickets
                </Link>
              </ToastAction>
            ),
          });
        } else {
          toast({ variant: "destructive", title: "Couldn't add your ticket", description: "Continuing with your withdrawal." });
        }
      }

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

      // Account-rent recovery. If the destination has never held USDC, Solana requires a token
      // account to be created for it, and its ~0.00204 SOL rent-exempt deposit comes out of our
      // fee payer — that SOL is gone for good, since the account belongs to the recipient and
      // only they can ever close it and reclaim it. Absorbing that was fine when it was rare, but
      // it's ~$0.15 a pop regardless of withdrawal size (15% of a $1 withdrawal), so it comes out
      // of the withdrawal itself instead: the recipient nets amount - rent, and the rent lands in
      // our fee payer's USDC account, leaving Loofta exactly even. Costs nothing on the common
      // path — a destination that already has a USDC account creates nothing and pays nothing.
      // Re-checked against the chain here (not just the form's debounced check) so the charge is
      // always based on the account's real state at send time.
      //
      // Direct-Solana withdrawals only: a Near Intents `recipientAddress` is a fresh, single-use
      // deposit address minted per order, which never has a pre-existing ATA, so this would fire
      // on every cross-chain withdrawal — charging an undisclosed fee and sending less than the
      // amount Near already quoted, which is enough on its own to make Near see the deposit as
      // short and refund/fail the order.
      const mint = getUsdcMintForMode(mode);
      let ataRentUsdc = 0;
      if (!isNearIntentsWithdraw) {
        const recipientAta = getAssociatedTokenAddressSync(mint, new PublicKey(recipientAddress));
        const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
        ataRentUsdc = recipientAtaInfo ? 0 : ataSetupFeeUsdc;
        if (ataRentUsdc > 0) {
          if (ataRentUsdc >= amount) {
            throw new Error(
              `This wallet has never held USDC, so it needs a one-time $${ataRentUsdc.toFixed(2)} account setup — more than you're withdrawing. Withdraw a larger amount, or use a wallet that already holds USDC.`,
            );
          }
          console.log(`${LOG_PREFIX} recipient has no USDC account — charging $${ataRentUsdc.toFixed(2)} setup fee from the withdrawal`);
        }
      }

      const sig = await sendUsdcWithBackendFeePayer({
        senderAddress: solanaAddress,
        recipientAddress,
        amountUSDC: amount - ataRentUsdc,
        connection,
        wallet,
        privyUserId: user!.id,
        signTransaction,
        memo: memo ?? undefined,
        usdcMint: mint,
        chain: getPrivySolanaChainForMode(mode),
        accessToken,
        network: devnetMode ? "devnet" : "mainnet",
        nearIntentsOrderId,
        // Routes ataRentUsdc to the fee payer's own USDC account in the same signature.
        looftaFeeUsdc: ataRentUsdc > 0 ? ataRentUsdc : undefined,
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
      setAtaFeeConfirmPending(false);
      setAddLotteryTicket(false);

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

  // A quote is only valid for the amount/address it was built against — editing either after
  // getting one (or after a failed attempt) invalidates it, so the effect below re-quotes instead
  // of the button silently signing (or refusing to retry) against stale numbers.
  useEffect(() => {
    setSolWithdrawPrepared(null);
    setSolWithdrawError(null);
  }, [withdrawAmount, withdrawAddress]);

  // Auto-quote, debounced — the Withdraw button's label doubles as the live estimate ("Withdraw
  // ≈X SOL"), so there's no separate "Get quote" step for the user to trigger by hand. Only fires
  // once the address has cleared the compliance check; a request-id guard drops a stale response
  // if the amount/address changed again before this one came back.
  const solWithdrawReqIdRef = useRef(0);
  useEffect(() => {
    if (withdrawMethod !== "sol-jupiter" || solWithdrawStep !== "form") return;
    if (solWithdrawPrepared || solWithdrawError) return;
    if (withdrawAmountNum < 1 || withdrawAmountNum > spendableBalance) return;
    const rawAddress = effectiveWithdrawAddress.trim();
    if (!rawAddress || !isValidAddressForChain(rawAddress, "solana") || addressRiskStatus !== "safe") return;

    const myReqId = ++solWithdrawReqIdRef.current;
    const t = setTimeout(() => {
      if (solWithdrawReqIdRef.current === myReqId) handleSolWithdrawPrepare();
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawMethod, solWithdrawStep, solWithdrawPrepared, solWithdrawError, withdrawAmountNum, effectiveWithdrawAddress, addressRiskStatus, spendableBalance]);

  // SOL withdrawal step 1: quote + build the unsigned swap tx server-side (persists a
  // sol_withdrawal_requests row as an audit trail — see jupiter.service.ts).
  const handleSolWithdrawPrepare = async () => {
    const rawAddress = effectiveWithdrawAddress.trim();
    const amount = withdrawAmountNum;
    if (amount <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Enter an amount greater than 0." });
      return;
    }
    if (amount > spendableBalance) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `You have ${spendableBalance.toFixed(6).replace(/\.?0+$/, "")} USDC available.` });
      return;
    }
    if (addLotteryTicket && amount + LOTTERY_TICKET_PRICE_USDC > spendableBalance) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `Adding a $${LOTTERY_TICKET_PRICE_USDC.toFixed(2)} ticket needs a bit more USDC than you have available.` });
      return;
    }
    if (!rawAddress || !isValidAddressForChain(rawAddress, "solana")) {
      toast({ variant: "destructive", title: "Invalid address", description: "Enter a valid Solana wallet address." });
      return;
    }
    if (addressRiskStatus !== "safe") {
      toast({ variant: "destructive", title: "Address not approved", description: "Withdrawals are only allowed to addresses that pass our compliance check." });
      return;
    }
    if (!solanaAddress || !wallet) {
      toast({ variant: "destructive", title: "Wallet not ready", description: "Your Loofta wallet is not available. Try refreshing or logging out and back in." });
      return;
    }

    setSolWithdrawStep("preparing");
    setSolWithdrawError(null);
    try {
      const accessToken = await getAccessToken();
      const prepared = await prepareSolWithdrawal({ solanaAddress, destinationAddress: rawAddress, amountUSDC: amount }, accessToken);
      setSolWithdrawPrepared(prepared);
      setSolWithdrawStep("form");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not get a swap quote. Please try again.";
      setSolWithdrawError(msg);
      setSolWithdrawStep("form");
      toast({ variant: "destructive", title: "Quote failed", description: msg });
    }
  };

  // Single "Withdraw" button drives both steps: first click quotes (button becomes "Getting
  // quote…"), second click — once the button is already showing the quoted SOL amount — signs.
  const handleSolWithdrawClick = () => {
    if (solWithdrawPrepared) {
      handleSolWithdrawSign();
    } else {
      handleSolWithdrawPrepare();
    }
  };

  // SOL withdrawal step 2: user signs the already-built swap with their own embedded wallet
  // (never Loofta's fee payer — the transaction's payer is the user's own, gas-topped-up, wallet).
  const handleSolWithdrawSign = async () => {
    if (!solWithdrawPrepared || !solanaAddress || !wallet) return;
    setSolWithdrawStep("signing");
    setSolWithdrawError(null);
    try {
      // Ticket add-on goes first and never blocks the withdrawal itself — a failed purchase just
      // means no ticket, the swap (already quoted for the requested amount, unaffected by the
      // ticket) still proceeds. Mirrors handleWithdraw's identical pattern.
      if (addLotteryTicket) {
        const ticketAdded = await buyQuickLotteryTicket();
        if (ticketAdded) {
          toast({
            duration: Infinity,
            title: "Ticket added! 🎟️",
            description: (
              <span className="text-base">
                Good luck — you&apos;re in for today&apos;s draw, a shot at {lotteryPrizePoolDisplay}.
              </span>
            ),
            action: (
              <ToastAction altText="View your Megapot tickets" asChild>
                <Link
                  href="/app/megapot?tab=history"
                  className="!bg-gradient-to-r !from-[#FF1301] !to-[#EAB308] !text-white !border-0 !font-semibold hover:!opacity-90"
                >
                  View tickets
                </Link>
              </ToastAction>
            ),
          });
        } else {
          toast({ variant: "destructive", title: "Couldn't add your ticket", description: "Continuing with your withdrawal." });
        }
      }

      const mode = devnetMode ? "devnet" : "mainnet";
      const rawTxBytes = Buffer.from(solWithdrawPrepared.swapTransactionBase64, "base64");
      const { signedTransaction } = await signTransaction({
        transaction: rawTxBytes,
        wallet,
        chain: getPrivySolanaChainForMode(mode),
      });

      setSolWithdrawStep("sending");
      const accessToken = await getAccessToken();
      const { signature } = await executeSolSwap(solWithdrawPrepared.requestId, Buffer.from(signedTransaction).toString("base64"), accessToken);
      setSolWithdrawSig(signature);

      const item = addWithdrawal({
        id: signature,
        amountUSDC: withdrawAmountNum,
        txSignature: signature,
        destinationAddress: effectiveWithdrawAddress.trim(),
        destinationChain: "solana",
        destinationToken: "SOL",
        isNearIntents: false,
        estimatedOut: solWithdrawPrepared.estimatedSolOut.toFixed(6),
        nearIntentsComplete: true,
      });
      setActiveWithdrawal(item);
      setRecentWithdrawals(getWithdrawalHistory());
      saveWithdrawalToDB(item);
      optimisticWithdrawBalance(withdrawAmountNum);
      setAddLotteryTicket(false);

      setSolWithdrawStep("complete");
      toast({ title: "Sent!", description: "Your SOL is on its way." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSolWithdrawError(msg);
      // Not "form" — solWithdrawPrepared is untouched (the failure was in signing/execute, not
      // the quote), so the button still shows the SOL amount, ready to retry signing directly.
      setSolWithdrawStep("form");
      if (msg.includes("user rejected") || msg.includes("denied")) {
        toast({ variant: "destructive", title: "Signing cancelled" });
      } else {
        toast({ variant: "destructive", title: "Withdrawal failed", description: msg });
      }
    }
  };

  const contentCls = dark
    ? "sm:max-w-[520px] border-white/10 bg-[#121217] text-white shadow-[0_40px_120px_rgba(0,0,0,0.7)] [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.text-gray-400]:!text-slate-500 [&_.bg-gray-100]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.bg-white]:!bg-white/10 [&_.border-gray-200]:!border-white/10 [&_.border-gray-300]:!border-white/20 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&>button]:!text-slate-400 [&>button:hover]:!text-white"
    : "sm:max-w-[520px]";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      {/* modal={false} (see "fix modal blink") makes Radix's own DialogOverlay a no-op,
          so the backdrop is rendered by hand here instead. */}
      <DialogPortal>
        <div className="fixed inset-0 z-[100] bg-[rgba(5,5,7,0.72)] backdrop-blur-[10px] animate-in fade-in-0" aria-hidden />
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
          "sm:h-auto sm:max-h-[calc(100vh-32px)] sm:w-full sm:max-w-[520px] sm:rounded-[30px] sm:border sm:p-7 sm:gap-[22px] sm:overflow-y-auto sm:flex-none sm:block",
          sora.variable,
          peerPay
            ? "[&>button:last-child]:hidden"
            : dark
              ? "[&>button]:!top-4 [&>button]:!right-4 [&>button]:!flex [&>button]:!h-9 [&>button]:!w-9 [&>button]:!items-center [&>button]:!justify-center [&>button]:!rounded-full [&>button]:!border-0 [&>button]:!bg-white/10 [&>button]:!opacity-100 [&>button]:!text-white [&>button]:!outline-none [&>button]:!ring-0 [&>button]:focus:!ring-0 [&>button]:focus:!ring-offset-0 [&>button]:focus-visible:!ring-0 [&>button_svg]:!m-0 [&>button_svg]:!h-4 [&>button_svg]:!w-4"
              : "[&>button]:!top-4 [&>button]:!right-4 [&>button]:!flex [&>button]:!h-9 [&>button]:!w-9 [&>button]:!items-center [&>button]:!justify-center [&>button]:!rounded-full [&>button]:!border-0 [&>button]:!bg-black/5 [&>button]:!opacity-100 [&>button]:!outline-none [&>button]:!ring-0 [&>button]:focus:!ring-0 [&>button]:focus:!ring-offset-0 [&>button]:focus-visible:!ring-0 [&>button_svg]:!m-0 [&>button_svg]:!h-4 [&>button_svg]:!w-4"
        )}
      >

        {peerPay && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full outline-none",
              dark ? "bg-white/10 text-white" : "bg-black/[0.06] text-gray-800"
            )}
          >
            <X className="block h-4 w-4" strokeWidth={2} />
          </button>
        )}

        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-5 pb-2 shrink-0">
          <div className={`w-10 h-1 rounded-full ${dark ? "bg-white/20" : "bg-gray-300"}`} />
        </div>

        {/* Scrollable content area */}
        <div
          className="sm:contents px-6 pb-6 sm:p-0 space-y-5 sm:space-y-4"
          style={{ flex: "1 1 0", height: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >

          {peerPay ? (
            <DialogHeader className="pb-0 pt-2 sm:pt-0 pr-14">
              <div className="flex items-center gap-3">
                {getPlatform(peerPay.platformId)?.logo && (
                  <img
                    src={getPlatform(peerPay.platformId)!.logo}
                    alt=""
                    className="h-12 w-12 rounded-2xl object-cover shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <DialogTitle
                    className={cn("text-[28px] font-bold tracking-[-0.04em] leading-none", dark ? "text-white" : "text-gray-900")}
                    style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}
                  >
                    {`Pay to ${getPlatform(peerPay.platformId)?.name ?? "app"}`}
                  </DialogTitle>
                  <DialogDescription className={cn("text-base font-medium mt-1 truncate", dark ? "text-[#8A8893]" : "text-gray-500")}>
                    {`They receive $${peerPay.amountUsd.toFixed(2)}`}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          ) : (
          <DialogHeader className="pb-0 pt-2 sm:pt-0">
            <DialogTitle
              className={cn("text-[34px] font-bold tracking-[-0.05em] leading-none", dark ? "text-white" : "text-gray-900")}
              style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}
            >
              {loadingBalance ? "…" : `$${balanceUSD}`}
            </DialogTitle>
            <DialogDescription className={cn("text-sm font-medium mt-1", dark ? "text-[#8A8893]" : "text-gray-500")}>
              USDC available · Solana
            </DialogDescription>
          </DialogHeader>
          )}

          {/* Tabs — hidden while paying someone's Venmo, Cash App, or Revolut */}
          {!peerPay && <div className={cn(
            "relative flex rounded-[18px] p-1 overflow-hidden",
            dark
              ? "bg-[#0B0B0E] border border-white/[0.06]"
              : "bg-gray-100 border border-gray-200"
          )}>
            {/* Sliding pill */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1 left-1 rounded-xl w-[calc(33.333%-0.167rem)]",
                "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                dark
                  ? "bg-[#1E1E25]"
                  : "bg-white shadow-sm border border-gray-200",
                tab === "topup" ? "translate-x-0" : tab === "withdraw" ? "translate-x-full" : "translate-x-[200%]"
              )}
            />
            {/* Top up */}
            <button
              type="button"
              onClick={() => setTab("topup")}
              className="group relative z-10 flex-1 inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]"
            >
              <IconBubble active={tab === "topup"} dark={dark}><ArrowDown /></IconBubble>
              <span className={cn("relative z-10 font-semibold text-base transition-colors duration-300",
                tab === "topup" ? (dark ? "text-slate-100" : "text-gray-900") : (dark ? "text-slate-400" : "text-gray-500")
              )}>Top up</span>
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
          </div>}

          {/* Top Up tab — method cards */}
          {tab === "topup" && (topUpView === null || topUpView === "crypto-picker") && (
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

                  {/* Card onramp: MoonPay on desktop, provider-agnostic on mobile (see handleMoonpayOnramp) */}
                  <button
                    type="button"
                    disabled={!solanaAddress || moonpayOnrampLoading}
                    onClick={handleMoonpayOnramp}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {moonpayOnrampLoading
                        ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                        : isMobileDevice
                          ? <CreditCard className={`h-8 w-8 ${dark ? "text-slate-300" : "text-gray-700"}`} />
                          : <img src="/images/icons/moonpay-logo.svg" alt="MoonPay" className="w-10 h-10 object-contain" />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{isMobileDevice ? "Card" : "MoonPay"}</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Apple Pay · debit or credit card. The card fee is shown before you pay.</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* Peer — Venmo/Cash App/Zelle/PayPal/Revolut checkout, settles USDC on Base
                      then bridges to your Solana balance via Near Intents (see peer-deposit view) */}
                  <button
                    type="button"
                    disabled={!solanaAddress}
                    onClick={() => { setShowFiatOnrampPicker(false); setTopUpView("peer-deposit"); }}
                    className={cn(
                      "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                      dark
                        ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/peer-logo.svg" alt="" className="w-10 h-10 object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Peer</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Venmo · Cash App · Zelle · PayPal · Revolut. Peer’s fee is in the checkout total.</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* Coinbase — always last */}
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
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Apple Pay · card · bank transfer. Coinbase shows its fee before you pay.</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

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
                        <img src="/images/icons/paj-cash-logo.svg" alt="" className="w-10 h-10 object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>PAJ Cash</p>
                        <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>NGN bank transfer · Nigeria only. The naira amount includes PAJ’s rate.</p>
                      </div>
                      <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                    </button>
                  )}
                </div>
              ) : topUpView === "crypto-picker" ? (
                <div className="py-2 space-y-3">
                  <button
                    type="button"
                    onClick={() => setTopUpView(null)}
                    className={cn(
                      "flex items-center gap-1 text-base font-medium transition-colors",
                      dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>

                  <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Choose your network
                  </p>

                  <button type="button" disabled={!solanaAddress || privyTopUpLoading} onClick={() => void handlePrivyCrossChainTopUp()}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      {privyTopUpLoading ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" /> : <Wallet className={`h-8 w-8 ${dark ? "text-slate-300" : "text-gray-700"}`} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Any chain</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        {topUpAmountUsd && topUpAmountUsd > 0 ? `$${topUpAmountUsd.toFixed(2)} USDC · ` : ""}Wallet or exchange. The network fee is shown before you confirm.
                      </p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* Near */}
                  <button type="button" disabled={!solanaAddress} onClick={() => setTopUpView("near-intents-deposit")}
                    className={cn("w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all", dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-12 h-12 shrink-0 flex items-center justify-center">
                      <img src="/images/icons/near-logo.png" alt="" className="w-10 h-10 object-contain drop-shadow-md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Near</p>
                      <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                        {topUpAmountUsd && topUpAmountUsd > 0 ? `$${topUpAmountUsd.toFixed(2)} · ` : ""}ZEC · TON · BTC. You receive the quoted USDC after the bridge fee.
                      </p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>
                </div>
              ) : (
                <div className="py-2 space-y-3">

                  {/* 1. Crypto deposit — USDC, Blink, or Near */}
                  <button type="button" disabled={!solanaAddress} onClick={() => setTopUpView("crypto-picker")}
                    className={cn("w-full flex items-center gap-4 p-[18px] rounded-[22px] text-left transition-all", dark ? "border border-white/[0.07] bg-[#1A1A20] hover:border-[rgba(255,122,42,0.5)] disabled:opacity-50 disabled:cursor-not-allowed" : "border border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="w-[76px] shrink-0 flex items-center">
                      <span className="grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#1A1A20] bg-[#2775CA] text-base font-extrabold text-white">$</span>
                      <span className="-ml-[18px] grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#1A1A20] bg-[#00EC97] text-[15px] font-extrabold text-[#0B0B0E]">N</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-lg font-bold ${dark ? "text-white" : "text-gray-900"}`} style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>Crypto deposit</p>
                      <p className={`text-sm mt-0.5 ${dark ? "text-[#8A8893]" : "text-gray-500"}`}>Any chain · Near</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                  {/* 2. Bank & Card — MoonPay, Coinbase, PAJ Cash */}
                  <button type="button" disabled={!solanaAddress || blinkDepositing} onClick={() => setShowFiatOnrampPicker(true)}
                    className={cn("w-full flex items-center gap-4 p-[18px] rounded-[22px] text-left transition-all", dark ? "border border-white/[0.07] bg-[#1A1A20] hover:border-[rgba(255,122,42,0.5)] disabled:opacity-50 disabled:cursor-not-allowed" : "border border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed")}
                  >
                    <div className="grid w-[76px] shrink-0 place-items-center">
                      <div className="relative h-[38px] w-[54px] -rotate-6 rounded-[10px] bg-[radial-gradient(120%_140%_at_25%_10%,#FFC79A_0%,#FF5A1A_45%,#D23806_100%)] shadow-[inset_0_2px_4px_rgba(255,255,255,0.5),0_4px_0_#9C2802,0_10px_20px_rgba(0,0,0,0.4)]">
                        <div className="absolute left-2 top-2.5 h-2.5 w-3.5 rounded-[3px] bg-[#FFE0B0]" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-lg font-bold ${dark ? "text-white" : "text-gray-900"}`} style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>Bank & Card</p>
                      <p className={`text-sm mt-0.5 ${dark ? "text-[#8A8893]" : "text-gray-500"}`}>Card · Peer · Coinbase · PAJ Cash</p>
                    </div>
                    <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                  </button>

                </div>
              )}
            </div>
          )}

          {/* Top Up tab — USDC direct deposit (regular, not private) */}
          {tab === "topup" && topUpView === "usdc-deposit" && (
            <div className="space-y-4 py-2">

              {/* Back */}
              <button type="button" onClick={() => setTopUpView("crypto-picker")}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {/* Wallet-connect "Pay now" never worked reliably here, so this is just the
                  address — send USDC (Solana) from anywhere and it shows up in your balance. */}
              <div className="space-y-3">
                <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                  All payments on Loofta are USDC. Send USDC (Solana) to your Loofta address below to top up your balance.
                </p>

                {solanaAddress && (
                  <div className={`rounded-2xl border overflow-hidden ${dark ? "border-white/10" : "border-gray-100"}`}>
                    <div className="px-4 py-3">
                      <p className={`text-sm font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-gray-400"}`}>Your Loofta address</p>
                      <div className="flex items-center gap-2">
                        <p className={`text-base font-mono flex-1 break-all ${dark ? "text-slate-300" : "text-gray-700"}`}>{solanaAddress}</p>
                        <button type="button" onClick={() => { navigator.clipboard.writeText(solanaAddress); toast({ title: "Copied!" }); }}
                          className={`shrink-0 p-2 rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className={`flex justify-center py-4 border-t ${dark ? "border-white/[0.06]" : "border-gray-100"}`}>
                      <div className={`p-3 rounded-xl ${dark ? "bg-white" : "bg-white border border-gray-100"}`}>
                        <QRCodeSVG value={solanaAddress} size={140} />
                      </div>
                    </div>
                  </div>
                )}

                <button type="button" onClick={() => setTopUpView("private-deposit")}
                  className={`w-full text-center text-base underline underline-offset-2 ${dark ? "text-slate-500 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>
                  Want this deposit to stay private instead?
                </button>
              </div>
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

              {!privateDepositStarted ? (
                /* ── Amount form ── */
                <div className="space-y-4">
                  <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Connect a wallet and send privately, or send USDC from any wallet (e.g. an
                    exchange) to a one-time address. Either way, the sending wallet is never linked
                    to your Loofta wallet on-chain.
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
                    onClick={() => setPrivateDepositStarted(true)}
                    disabled={!privateDepositAmountNum}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
                  >
                    Deposit
                  </Button>
                </div>
              ) : privateDepositAddress && privateDepositEntryMode === "qr" ? (
                /* ── Deposit address view (burner path, exchanges/any wallet) ── */
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

                  {privateDepositStatus !== "complete" && (
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

                  {(privateDepositStatus === "complete" || privateDepositStatus === "failed") && (
                    <Button onClick={() => { setTopUpView(null); resetPrivateDeposit(); }}
                      className={cn("w-full", privateDepositStatus === "complete" ? "bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white" : "bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white")}>
                      {privateDepositStatus === "complete" ? "Done" : "Close"}
                    </Button>
                  )}
                </div>
              ) : (
                /* ── Pay now (direct private transfer, no burner), default once "Deposit" is clicked ── */
                <div className="space-y-4">
                  {payNowStatus === "sent" ? (
                    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${dark ? "bg-white/5 border border-white/10" : "bg-gradient-to-r from-orange-50/70 to-amber-50/30 border border-orange-100"}`}>
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                      <div>
                        <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Sent!</p>
                        <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                          Routing to your balance privately, can take up to {PRIVATE_PAYMENT_MAX_WAIT_MINUTES} minutes.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                      Connect a Solana wallet and we&apos;ll deliver exactly {privateDepositAmountNum.toFixed(2)} USDC
                      to your balance privately, no gas from your wallet.
                    </p>
                  )}

                  {payNowStatus !== "sent" && (
                    privateDepositEntryMode === "qr" && privateDepositSubmitting ? (
                      <div className="flex items-center justify-center gap-2 py-3">
                        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                        <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Getting deposit address…</span>
                      </div>
                    ) : (
                      <SolanaWalletConnectProvider rpcUrl={getRpcForMode(devnetMode ? "devnet" : "mainnet")}>
                        <WalletPayNowWidget
                          dark={dark}
                          status={payNowStatus}
                          error={payNowError}
                          onPay={(senderAddress, signTx) => void payPrivateDepositFromWallet(senderAddress, signTx)}
                          onViewAddressInstead={() => {
                            setPrivateDepositEntryMode("qr");
                            if (!privateDepositAddress) void handleStartPrivateDeposit();
                          }}
                        />
                      </SolanaWalletConnectProvider>
                    )
                  )}

                  {payNowStatus === "sent" && (
                    <Button onClick={() => { setTopUpView(null); resetPrivateDeposit(); }}
                      className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white">
                      Done
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Top Up tab — Peer deposit amount entry (settles USDC on Base, then hands off to the
              Near Intents deposit view/polling below via handlePeerDeposit) */}
          {tab === "topup" && !devnetMode && topUpView === "peer-deposit" && (
            <div className="space-y-4 py-2">

              {/* Back */}
              <button type="button" onClick={() => { setTopUpView(null); setPeerDepositAmount(""); setPeerDepositError(null); }}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              <div className="space-y-4">
                <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                  Pay with Venmo, Cash App, Zelle, PayPal, Revolut, and more — Peer opens in a
                  window, and your balance updates once the payment settles.
                </p>
                <div>
                  <Label htmlFor="peer-deposit-amount" className={dark ? "text-slate-300" : undefined}>Amount (USDC)</Label>
                  <AmountInput
                    id="peer-deposit-amount"
                    dark={dark}
                    value={peerDepositAmount}
                    onChange={setPeerDepositAmount}
                    suffix="USDC"
                    className="mt-1"
                  />
                </div>
                {peerDepositError && <p className="text-base text-orange-500 text-center px-1">{peerDepositError}</p>}
                <Button
                  onClick={handlePeerDeposit}
                  disabled={peerDepositSubmitting || !peerDepositAmountNum || !baseUsdcToken}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
                >
                  {peerDepositSubmitting ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Preparing…</span>
                  ) : (
                    "Continue to Peer"
                  )}
                </Button>
              </div>
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
                        <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>~{formatTokenAmount(depositQuoteOut)} USDC expected</p>
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
                                ~{formatTokenAmount(depositQuoteOut)} USDC
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
            const isEmpty = dbDeposits.length === 0 && recentWithdrawals.length === 0 && pajCashHistory.length === 0 && !dbDepositsLoading;
            return (
              <div className="py-2 min-h-0 overflow-y-auto sm:max-h-[60vh]">
                {dbDepositsLoading && dbDeposits.length === 0 && recentWithdrawals.length === 0 ? (
                  <div className="flex justify-center py-6"><Loader2 className={`h-5 w-5 animate-spin ${dark ? "text-slate-400" : "text-gray-400"}`} /></div>
                ) : isEmpty ? (
                  <p className={`text-base text-center py-6 ${dark ? "text-slate-400" : "text-gray-500"}`}>No recent activity.</p>
                ) : (
                  <ul className="space-y-2">
                    {[
                      ...dbDeposits.map((dep) => ({ kind: "deposit" as const, ts: new Date(dep.created_at).getTime(), dep })),
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
                                      {order.direction === "ON_RAMP" ? "NGN top-up" : "NGN withdrawal"}
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
                        // A backend cron reconciles near_intents_complete against the real bridge
                        // status (see near-intents-withdrawals-processor.service.ts), so an
                        // over-1hr row isn't presumed dead here anymore — it's still genuinely in
                        // flight until that cron (or this poll) says otherwise. This used to stamp
                        // "Cancelled" purely off elapsed time, mislabeling withdrawals that were
                        // just slow, or had already succeeded while the tab was closed.
                        const isStaleWithdraw = item.isNearIntents && !item.nearIntentsComplete && withdrawAgeMs > ONE_HOUR_MS;
                        const isInProgress = item.isNearIntents && !item.nearIntentsComplete;
                        return (
                          <li key={item.id}>
                            <div className={`rounded-lg border p-3 transition-colors ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                              <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className={`font-semibold text-base ${dark ? "text-white" : "text-gray-900"}`}>
                                    ${item.amountUSDC.toFixed(2)} → {item.destinationToken}
                                    {item.estimatedOut && (
                                      <span className={`font-normal text-base ml-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                                        (~{formatTokenAmount(item.estimatedOut)} received)
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
                                      {isStaleWithdraw ? "Still bridging" : "Bridging"}
                                    </span>
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
          {/* Public-withdrawal progress/result panel. Excludes the flows that render their own
              status UI (peer-offramp, private-relay) — otherwise a finished withdrawal's success
              panel stays on screen underneath them, which read as "it worked" while the flow you
              were actually looking at had failed. */}
          {tab === "withdraw" && withdrawStep !== "idle" && withdrawStep !== "settling" && withdrawMethod !== "peer-offramp" && withdrawMethod !== "private-relay" && (
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
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod === "crypto-picker" && !showFiatOfframpPicker && (
            <div className="py-2 space-y-3">
              <button
                type="button"
                onClick={() => setWithdrawMethod(null)}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>

              {/* Solana — USDC direct or swapped to native SOL; the form itself lets you switch */}
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
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>USDC or SOL</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Any Solana wallet · Free &amp; instant
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

              {/* Other tokens — Near Intents cross-chain withdrawal */}
              {spendableBalance >= 1 && (
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
                    <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Other tokens</p>
                    <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                      ETH · BTC · USDT — any chain
                    </p>
                  </div>
                  <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                </button>
              )}

              {/* Private withdrawal — burner-relay MagicBlock private transfer */}
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
            </div>
          )}

          {/* ── SOL withdrawal (USDC -> native SOL via Jupiter) — amount + destination form ── */}
          {tab === "withdraw" && withdrawMethod === "sol-jupiter" && solWithdrawStep !== "complete" && (
            <div className="space-y-4 py-2">
              <button type="button" onClick={() => setWithdrawMethod("crypto-picker")}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {/* USDC / SOL toggle — same Solana destination, switches which token lands there */}
              <div className={cn("inline-flex rounded-xl border p-1 gap-1", dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50")}>
                <button type="button" onClick={() => setWithdrawMethod("usdc-sol")}
                  disabled={solWithdrawStep !== "form"}
                  className={cn("px-4 py-1.5 rounded-lg text-base font-medium transition-colors disabled:opacity-50", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                  USDC
                </button>
                <button type="button"
                  className={cn("px-4 py-1.5 rounded-lg text-base font-medium transition-colors", dark ? "bg-white/15 text-white" : "bg-white text-gray-900 shadow-sm")}>
                  SOL
                </button>
              </div>

              <div>
                <Label htmlFor="sol-withdraw-amount" className={dark ? "text-slate-300" : undefined}>Amount (USDC)</Label>
                <div className="mt-1 flex items-center gap-2">
                  <AmountInput id="sol-withdraw-amount" dark={dark}
                    value={withdrawAmount}
                    onChange={setWithdrawAmount}
                    maxDecimals={2}
                    suffix="USDC"
                    disabled={solWithdrawStep !== "form"}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => {
                      const max = Math.max(0, spendableBalance - (addLotteryTicket ? LOTTERY_TICKET_PRICE_USDC : 0));
                      setWithdrawAmount(max.toFixed(6).replace(/\.?0+$/, ""));
                    }}
                    disabled={solWithdrawStep !== "form"}
                    className={`shrink-0 px-3 ${dark ? "border-white/20 bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white" : ""}`}>
                    Max
                  </Button>
                </div>
                {withdrawAmountNum > 0 && withdrawAmountNum < 1 && (
                  <p className="text-base text-red-400 mt-1">Minimum is $1.00 USDC.</p>
                )}
                {withdrawAmountNum > spendableBalance && spendableBalance > 0 && (
                  <p className="text-base text-red-400 mt-1">Exceeds available balance of {spendableBalance.toFixed(6).replace(/\.?0+$/, "")} USDC.</p>
                )}
                {addLotteryTicket && withdrawAmountNum > 0 && withdrawAmountNum <= spendableBalance && withdrawAmountNum + LOTTERY_TICKET_PRICE_USDC > spendableBalance && (
                  <p className="text-base text-red-400 mt-1">Not enough left over for the ${LOTTERY_TICKET_PRICE_USDC.toFixed(2)} ticket — lower the amount or turn it off.</p>
                )}
              </div>

              <div>
                <Label htmlFor="sol-withdraw-address" className={dark ? "text-slate-300" : undefined}>Destination Solana wallet</Label>
                <Input
                  id="sol-withdraw-address"
                  placeholder="Enter a Solana address"
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  disabled={solWithdrawStep !== "form"}
                  className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                />
                {addressRiskStatus === "checking" && (
                  <p className={`text-base mt-1.5 flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking address…
                  </p>
                )}
                {addressRiskStatus === "unsafe" && (
                  <p className="text-base text-red-400 mt-1.5">This address did not pass our compliance check.</p>
                )}
              </div>

              {spendableBalance >= LOTTERY_TICKET_UPSELL_MIN_BALANCE_USDC && withdrawAmountNum > 0 && (
                <div className="relative rounded-2xl">
                  <style>{`
                    @keyframes looftaGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                    @keyframes looftaGlowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
                  `}</style>
                  <div
                    aria-hidden
                    className="absolute -inset-[2.5px] rounded-2xl blur-[7px]"
                    style={{
                      background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)",
                      backgroundSize: "220% 100%",
                      animation: reduceMotion ? undefined : "looftaGlowShift 2.4s linear infinite, looftaGlowPulse 2.4s ease-in-out infinite",
                      opacity: reduceMotion ? 0.7 : undefined,
                    }}
                  />
                  <div
                    className={cn(
                      "relative rounded-2xl border p-4",
                      dark ? "bg-[#15110d] border-white/10" : "bg-white border-orange-100"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_8px_20px_rgba(255,122,42,0.35)]">
                        <Ticket className="h-5 w-5 text-white" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                          Multiply your win — add a Megapot ticket
                        </p>
                        <p className={`text-base mt-0.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
                          The Loofta Megapot draws every day. $1 = 1 ticket, a shot at {lotteryPrizePoolDisplay} prize pool.
                        </p>
                      </div>
                      <Switch
                        checked={addLotteryTicket}
                        disabled={solWithdrawStep !== "form"}
                        onCheckedChange={(checked) => {
                          setAddLotteryTicket(checked);
                          if (checked && withdrawAmountNum + LOTTERY_TICKET_PRICE_USDC > spendableBalance) {
                            const adjusted = Math.max(0, spendableBalance - LOTTERY_TICKET_PRICE_USDC);
                            setWithdrawAmount(adjusted.toFixed(6).replace(/\.?0+$/, ""));
                          }
                        }}
                        className="shrink-0 mt-1 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#FF4A26] data-[state=checked]:to-[#E1A041]"
                      />
                    </div>
                    {addLotteryTicket && (
                      <div className={cn(
                        "mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-base font-semibold",
                        dark ? "bg-white/10 text-white" : "bg-orange-50 text-gray-900"
                      )}>
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />1 Megapot ticket added</span>
                        <span>+${LOTTERY_TICKET_PRICE_USDC.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {solWithdrawError && <p className="text-base text-red-400">{solWithdrawError}</p>}

              <Button
                onClick={handleSolWithdrawClick}
                disabled={
                  solWithdrawStep === "preparing" || solWithdrawStep === "signing" || solWithdrawStep === "sending" ||
                  !effectiveWithdrawAddress.trim() || withdrawAmountNum < 1 || withdrawAmountNum > spendableBalance ||
                  addressRiskStatus !== "safe" ||
                  // Stays disabled until a quote is actually showing — clicking to retry after a
                  // failed attempt is the one exception.
                  (!solWithdrawPrepared && !solWithdrawError)
                }
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
              >
                {solWithdrawStep === "preparing"
                  ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Getting quote…</span>
                  : solWithdrawStep === "signing"
                    ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Approve in your wallet…</span>
                    : solWithdrawStep === "sending"
                      ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Sending…</span>
                      : solWithdrawPrepared
                        ? `Withdraw ≈${solWithdrawPrepared.estimatedSolOut.toFixed(6)} SOL`
                        : solWithdrawError
                          ? "Retry quote"
                          : "Withdraw"}
              </Button>
            </div>
          )}

          {/* ── SOL withdrawal: complete ── */}
          {tab === "withdraw" && withdrawMethod === "sol-jupiter" && solWithdrawStep === "complete" && solWithdrawPrepared && (
            <div className="py-2 space-y-4">
              <div className={`rounded-2xl border p-5 flex flex-col items-center gap-3 text-center ${dark ? "border-white/10 bg-white/5" : "border-emerald-100 bg-emerald-50/60"}`}>
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                <p className={`text-xl font-bold ${dark ? "text-white" : "text-gray-900"}`}>Sent!</p>
                <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                  ≈ {solWithdrawPrepared.estimatedSolOut.toFixed(6)} SOL is on its way.
                </p>
              </div>
              {solWithdrawSig && (
                <a
                  href={getExplorerTxUrl("solana", solWithdrawSig)}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex items-center gap-2 text-base rounded-lg border px-3 py-2 transition-colors ${dark ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  View Solana transaction
                </a>
              )}
              <Button onClick={() => { setWithdrawMethod(null); onRefresh(); }} className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 text-white">
                Done
              </Button>
            </div>
          )}

          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod === null && !showFiatOfframpPicker && (
            <div className="py-2 space-y-3">

              {/* 1. Crypto withdrawal — USDC on Solana, other tokens, private withdrawal */}
              <button
                type="button"
                disabled={!solanaAddress}
                onClick={() => setWithdrawMethod("crypto-picker")}
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
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Crypto withdrawal</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    USDC on Solana · other tokens · private
                  </p>
                </div>
                <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>

              {/* 2. Bank — shows provider picker: Cash out with Peer, Coinbase, PAJ Cash.
                  Deliberately NOT gated on spendableBalance >= 1: PAJ Cash / Naira lives behind
                  this, and users need to be able to open it at $0 balance to link their PAJ
                  account and set up a default bank account ahead of time — not just when they
                  already have funds to move. */}
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
                  <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Cash / bank</p>
                  <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                    Venmo · Cash App · Revolut · Zelle · PAJ Cash
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
              <button type="button" onClick={() => { setWithdrawMethod("crypto-picker"); resetPrivateWithdraw(); }}
                className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                <ChevronLeft className="h-4 w-4" />Back
              </button>

              {privateFeeConfirmPending ? (
                /* ── Fee confirmation — transaction is built (so these are the real fees, not an
                      estimate) but nothing is signed yet. ── */
                <div className={cn("rounded-2xl border p-4", dark ? "bg-white/5 border-white/10" : "bg-white border-gray-200")}>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_8px_20px_rgba(255,122,42,0.35)]">
                      <VenetianMask className="h-5 w-5 text-white" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-base font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>
                        Confirm private withdrawal
                      </p>
                      <p className={`text-base mt-0.5 ${dark ? "text-slate-400" : "text-gray-600"}`}>
                        Delivery is delayed and split by the private-transfer relay, which charges a
                        flat fee regardless of amount.
                      </p>
                    </div>
                  </div>

                  <div className={cn("mt-3 rounded-xl px-3 py-2.5 space-y-1.5", dark ? "bg-white/5" : "bg-gray-50")}>
                    <div className="flex items-center justify-between text-base">
                      <span className={dark ? "text-slate-400" : "text-gray-600"}>Withdrawing</span>
                      <span className={dark ? "text-slate-300" : "text-gray-700"}>${(parseFloat(withdrawAmount) || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-base">
                      <span className={dark ? "text-slate-400" : "text-gray-600"}>Privacy fee</span>
                      <span className={dark ? "text-slate-300" : "text-gray-700"}>−${(privateWithdrawFee ?? 0).toFixed(2)}</span>
                    </div>
                    <div className={cn("flex items-center justify-between pt-1.5 border-t", dark ? "border-white/10" : "border-gray-200")}>
                      <span className={`text-base font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>They receive</span>
                      <span className={`text-base font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>
                        ${Math.max(0, (parseFloat(withdrawAmount) || 0) - (privateWithdrawFee ?? 0)).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* MagicBlock's exactOut mode debits the sender for amount + this fee ON TOP —
                      the built transaction is already real by this point, so if the reserved
                      headroom above still wasn't enough, catch it here with the actual fee rather
                      than let the signature go through to an on-chain "insufficient funds" fail. */}
                  {(parseFloat(withdrawAmount) || 0) + (privateWithdrawFee ?? 0) > spendableBalance + 1e-6 && (
                    <p className="text-base text-red-400 flex items-center gap-1.5 mt-3">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Amount plus the ${(privateWithdrawFee ?? 0).toFixed(2)} relay fee exceeds your balance — cancel and lower the amount.
                    </p>
                  )}

                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      onClick={() => privateFeeConfirmRef.current?.(false)}
                      className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => privateFeeConfirmRef.current?.(true)}
                      disabled={(parseFloat(withdrawAmount) || 0) + (privateWithdrawFee ?? 0) > spendableBalance + 1e-6}
                      className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
                    >
                      Confirm &amp; send
                    </Button>
                  </div>
                </div>
              ) : privateWithdrawId ? (
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
                      Available to send privately: {privateWithdrawMaxUsdc.toFixed(2)} USDC (${PRIVATE_WITHDRAW_FEE_HEADROOM_USDC.toFixed(2)} reserved for the relay fee)
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="private-withdraw-address" className={dark ? "text-slate-300" : undefined}>Destination Solana address</Label>
                    <Input
                      id="private-withdraw-address"
                      placeholder="Enter a Solana address or .sol domain"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                    />
                    <SolDomainHint domain={solDomain} input={withdrawAddress} dark={dark} />
                    {withdrawAddress && !isSolDomain(withdrawAddress) && !isValidAddressForChain(withdrawAddress, "solana") && (
                      <p className="text-base text-red-400 mt-1 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Invalid Solana address
                      </p>
                    )}
                  </div>
                  {/* Surface the server's own minimum (BuildPrivateWithdrawalDto @Min(1)) here —
                      otherwise a sub-$1 amount only fails after the request, and the raw
                      validator text ("amount_usdc must not be less than 1") is what the user
                      ends up reading. */}
                  {parseFloat(withdrawAmount) > 0 && parseFloat(withdrawAmount) < PRIVATE_WITHDRAW_MIN_USDC && (
                    <p className="text-base text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Private withdrawals start at ${PRIVATE_WITHDRAW_MIN_USDC.toFixed(2)}
                    </p>
                  )}
                  <Button
                    onClick={handlePrivateWithdraw}
                    disabled={
                      privateWithdrawSubmitting ||
                      !parseFloat(withdrawAmount) ||
                      parseFloat(withdrawAmount) < PRIVATE_WITHDRAW_MIN_USDC ||
                      parseFloat(withdrawAmount) > privateWithdrawMaxUsdc ||
                      !effectiveWithdrawAddress.trim() ||
                      !isValidAddressForChain(effectiveWithdrawAddress, "solana")
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

              {/* Cash out via Peer (ZKP2P) */}
              {spendableBalance >= 1 && (
                <button
                  type="button"
                  disabled={!solanaAddress}
                  onClick={() => { setShowFiatOfframpPicker(false); resetPeer(); setWithdrawMethod("peer-offramp"); }}
                  className={cn(
                    "w-full flex items-center gap-5 p-5 rounded-2xl border-2 text-left transition-all",
                    dark
                      ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  <div className="w-12 h-12 shrink-0 rounded-xl bg-[#111114] flex items-center justify-center p-2">
                    <img src="/images/icons/peer-logo.svg" alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>Cash out with Peer</p>
                    <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
                      Venmo · Cash App · Revolut · Zelle
                    </p>
                  </div>
                  <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                </button>
              )}

              {/* PAJ Cash — NGN off-ramp */}
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
                    <img src="/images/icons/paj-cash-logo.svg" alt="" className="w-10 h-10 object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xl font-semibold ${dark ? "text-white" : "text-gray-900"}`}>NGN with PAJ Cash</p>
                    <p className={`text-base mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>Bank transfer · Nigeria only</p>
                  </div>
                  <ArrowRight className={`h-5 w-5 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
                </button>
              )}

              {/* Coinbase — always last */}
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
            </div>
          )}

          {/* Top-up tab — PAJ Cash (Naira) */}
          {tab === "topup" && topUpView === "paj-cash-onramp" && (
            <PajCashOnrampView
              dark={dark}
              prefillEmail={pajPrefillEmail}
              prefillAmountUsd={topUpAmountUsd}
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
          {/* Generic withdraw form (usdc-sol / near-intents). Every method that brings its own
              form must be excluded here, or both render stacked — private-relay was missing, and
              only stayed hidden by accident whenever a previous run had left withdrawStep on a
              terminal value. */}
          {tab === "withdraw" && withdrawStep === "idle" && withdrawMethod !== null && withdrawMethod !== "crypto-picker" && withdrawMethod !== "sol-jupiter" && withdrawMethod !== "peer-offramp" && withdrawMethod !== "paj-cash" && withdrawMethod !== "private-relay" && (
            <div className="space-y-4 py-2">

              {/* Back button — hidden on devnet (only one method available, nothing to go back to) */}
              {!devnetMode && <button
                type="button"
                onClick={() => setWithdrawMethod("crypto-picker")}
                className={cn(
                  "flex items-center gap-1 text-base font-medium transition-colors",
                  dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>}

              {/* USDC / SOL toggle — same Solana destination, switches which token lands there */}
              {isUSDCOnSolana && (
                <div className={cn("inline-flex rounded-xl border p-1 gap-1", dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50")}>
                  <button type="button"
                    className={cn("px-4 py-1.5 rounded-lg text-base font-medium transition-colors", dark ? "bg-white/15 text-white" : "bg-white text-gray-900 shadow-sm")}>
                    USDC
                  </button>
                  <button type="button" onClick={() => setWithdrawMethod("sol-jupiter")}
                    className={cn("px-4 py-1.5 rounded-lg text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                    SOL
                  </button>
                </div>
              )}

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
                    onClick={() => {
                      const max = Math.max(0, spendableBalance - (addLotteryTicket ? LOTTERY_TICKET_PRICE_USDC : 0));
                      setWithdrawAmount(max.toFixed(6).replace(/\.?0+$/, ""));
                    }}
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
                            ~{formatTokenAmount(quoteAmount)} {effectiveToken?.symbol || "token"}
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
                  placeholder={isUSDCOnSolana ? "Enter Solana address or .sol domain" : `Enter ${effectiveToken?.chain || "destination"} address`}
                  value={withdrawAddress}
                  onChange={(e) => { setWithdrawAddress(e.target.value); setAtaFeeConfirmPending(false); }}
                  className={`mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`}
                />
                <SolDomainHint domain={solDomain} input={withdrawAddress} dark={dark} />
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

              {/* Lottery ticket upsell — high-conversion "add to basket" toggle before withdrawing.
                  Toggling on never blocks on balance: it reduces the withdraw amount by the ticket
                  price instead, so there's always room. Flowing glow border matches the one used
                  around the ticket-purchase confirm button on the lottery page (SlideToPay.tsx). */}
              {isUSDCOnSolana && spendableBalance >= LOTTERY_TICKET_UPSELL_MIN_BALANCE_USDC && withdrawAmountNum > 0 && !ataFeeConfirmPending && (
                <div className="relative rounded-2xl">
                  <style>{`
                    @keyframes looftaGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                    @keyframes looftaGlowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
                  `}</style>
                  <div
                    aria-hidden
                    className="absolute -inset-[2.5px] rounded-2xl blur-[7px]"
                    style={{
                      background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)",
                      backgroundSize: "220% 100%",
                      animation: reduceMotion ? undefined : "looftaGlowShift 2.4s linear infinite, looftaGlowPulse 2.4s ease-in-out infinite",
                      opacity: reduceMotion ? 0.7 : undefined,
                    }}
                  />
                  <div
                    className={cn(
                      "relative rounded-2xl border p-4",
                      dark ? "bg-[#15110d] border-white/10" : "bg-white border-orange-100"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_8px_20px_rgba(255,122,42,0.35)]">
                        <Ticket className="h-5 w-5 text-white" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                          Multiply your win — add a Megapot ticket
                        </p>
                        <p className={`text-base mt-0.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
                          The Loofta Megapot draws every day. $1 = 1 ticket, a shot at {lotteryPrizePoolDisplay} prize pool.
                        </p>
                      </div>
                      <Switch
                        checked={addLotteryTicket}
                        onCheckedChange={(checked) => {
                          setAddLotteryTicket(checked);
                          if (checked && withdrawAmountNum + LOTTERY_TICKET_PRICE_USDC > spendableBalance) {
                            const adjusted = Math.max(0, spendableBalance - LOTTERY_TICKET_PRICE_USDC);
                            setWithdrawAmount(adjusted.toFixed(6).replace(/\.?0+$/, ""));
                          }
                        }}
                        className="shrink-0 mt-1 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#FF4A26] data-[state=checked]:to-[#E1A041]"
                      />
                    </div>
                    {addLotteryTicket && (
                      <div className={cn(
                        "mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-base font-semibold",
                        dark ? "bg-white/10 text-white" : "bg-orange-50 text-gray-900"
                      )}>
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />1 Megapot ticket added to your withdrawal</span>
                        <span>+${LOTTERY_TICKET_PRICE_USDC.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* One-time USDC-account setup fee — shown as an explicit confirm step after the
                  user hits Withdraw, so the deduction is acknowledged rather than just displayed.
                  Only reachable once handleWithdraw has verified against the chain that the
                  destination really has no USDC account. */}
              {ataFeeConfirmPending && (
                <div className={cn(
                  "rounded-2xl border p-4",
                  dark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"
                )}>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_8px_20px_rgba(255,122,42,0.35)]">
                      <Wallet className="h-5 w-5 text-white" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-base font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>
                        First time sending USDC here
                      </p>
                      <p className={`text-base mt-0.5 ${dark ? "text-slate-400" : "text-gray-600"}`}>
                        Solana charges a one-time fee to open a USDC account for this wallet
                        {solPriceUsd ? ` (${ATA_RENT_SOL} SOL at $${solPriceUsd.toFixed(2)})` : ""}.
                      </p>
                    </div>
                  </div>

                  <div className={cn(
                    "mt-3 rounded-xl px-3 py-2.5 space-y-1.5",
                    dark ? "bg-white/5" : "bg-gray-50"
                  )}>
                    <div className="flex items-center justify-between text-base">
                      <span className={dark ? "text-slate-400" : "text-gray-600"}>Withdrawing</span>
                      <span className={dark ? "text-slate-300" : "text-gray-700"}>${withdrawAmountNum.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-base">
                      <span className={dark ? "text-slate-400" : "text-gray-600"}>Account setup</span>
                      <span className={dark ? "text-slate-300" : "text-gray-700"}>−${ataSetupFeeUsdc.toFixed(2)}</span>
                    </div>
                    <div className={cn("flex items-center justify-between pt-1.5 border-t", dark ? "border-white/10" : "border-gray-200")}>
                      <span className={`text-base font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>You receive</span>
                      <span className={`text-base font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>
                        ${Math.max(0, withdrawAmountNum - ataSetupFeeUsdc).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      onClick={() => setAtaFeeConfirmPending(false)}
                      className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => { setAtaFeeConfirmPending(false); handleWithdraw(true); }}
                      className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white"
                    >
                      Confirm &amp; withdraw
                    </Button>
                  </div>
                </div>
              )}

              <div className={`flex gap-2 pt-2 ${ataFeeConfirmPending ? "hidden" : ""}`}>
                <Button variant="outline" onClick={() => setWithdrawMethod("crypto-picker")} className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}>
                  Back
                </Button>
                <Button
                  onClick={() => handleWithdraw()}
                  disabled={
                    withdrawing ||
                    withdrawAmountNum <= 0 ||
                    withdrawAmountNum > spendableBalance ||
                    (addLotteryTicket && withdrawAmountNum + LOTTERY_TICKET_PRICE_USDC > spendableBalance) ||
                    !effectiveWithdrawAddress.trim() ||
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
                  ) : isNearIntentsWithdraw ? (
                    `Bridge to ${effectiveToken?.symbol || "token"}`
                  ) : addLotteryTicket ? (
                    "Withdraw + Add Ticket"
                  ) : (
                    "Withdraw USDC"
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
                      {inCooldown ? (
                        <span className="text-sm text-amber-400 leading-tight">{formatCooldown(cooldownMins)}</span>
                      ) : p.maxUSDC != null ? (
                        <span className={`text-sm leading-tight ${dark ? "text-slate-500" : "text-gray-400"}`}>${p.maxUSDC} max</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Paying someone's app handle — no cash-out form, just status until the bridge starts. */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerPay && peerStep === "form" && (
            <div className="py-6 flex flex-col items-center gap-4 text-center">
              {!loadingBalance && spendableBalance + 1e-6 < peerPayGrossUsd ? (
                <div className="w-full space-y-3 text-left">
                  <div className={cn("flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5", dark ? "border-white/10 bg-[#0E0E12]" : "border-gray-200 bg-white")}>
                    <div className="min-w-0">
                      <div className={cn("text-base", dark ? "text-[#B5B2BC]" : "text-gray-500")}>Loofta balance</div>
                      <div className={cn("mt-0.5 text-xl font-semibold", dark ? "text-white" : "text-gray-900")}>${spendableBalance.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-base", dark ? "text-[#8A8893]" : "text-gray-500")}>You pay</div>
                      <div className={cn("mt-0.5 text-xl font-semibold", dark ? "text-white" : "text-gray-900")}>${peerPayGrossUsd.toFixed(2)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const shortfall = Math.max(0, peerPayGrossUsd - spendableBalance).toFixed(2);
                      setDepositAmount(shortfall);
                      setPeerDepositAmount(shortfall);
                      setTopUpView(null);
                      setTab("topup");
                    }}
                    className="w-full h-12 rounded-xl font-semibold text-base border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
                  >
                    Add funds & pay
                  </button>
                </div>
              ) : (
                <div className="w-full space-y-3 text-left">
                  <div className={cn("rounded-2xl border px-4 py-3.5 space-y-2", dark ? "border-white/10 bg-[#0E0E12]" : "border-gray-200 bg-white")}>
                    <div className="flex items-center justify-between">
                      <span className={cn("text-base", dark ? "text-[#B5B2BC]" : "text-gray-500")}>They receive</span>
                      <span className={cn("text-base font-semibold", dark ? "text-white" : "text-gray-900")}>${peerPay.amountUsd.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cn("text-base", dark ? "text-[#B5B2BC]" : "text-gray-500")}>Fill incentive</span>
                      <span className={cn("text-base", dark ? "text-slate-300" : "text-gray-700")}>${peerPayFeeUsd.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2">
                      <span className={cn("text-base", dark ? "text-[#B5B2BC]" : "text-gray-500")}>You pay</span>
                      <span className={cn("text-xl font-semibold", dark ? "text-white" : "text-gray-900")}>${peerPayGrossUsd.toFixed(2)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handlePeerSubmit(); }}
                    disabled={peerSubmitting}
                    className="w-full h-12 rounded-xl font-semibold text-base bg-gradient-to-r from-orange-500 to-red-500 text-white disabled:opacity-60"
                  >
                    {peerSubmitting ? "Preparing…" : `Pay $${peerPayGrossUsd.toFixed(2)}`}
                  </button>
                  <p className={cn("text-center text-sm", dark ? "text-slate-500" : "text-gray-500")}>
                    Getting your USDC back costs a bridge fee.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Peer offramp: form ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "form" && !peerPay && (() => {
            const platform = getPlatform(peerPlatformId ?? "");
            if (!platform) return null;
            const platformCap = platform.maxUSDC ?? Infinity; // null = no Loofta-side cap
            return (
              <div className="space-y-4 py-2">
                {!peerPay && (
                <button type="button" onClick={() => setPeerStep("platform")}
                  className={cn("flex items-center gap-1 text-base font-medium transition-colors", dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                  <ChevronLeft className="h-4 w-4" />Back
                </button>
                )}

                {/* Platform badge */}
                <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${dark ? "bg-white/5 border border-white/10" : "bg-orange-50/60 border border-orange-100"}`}>
                  <img src={platform.logo} alt={platform.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  <div>
                    <p className={`text-base font-bold ${dark ? "text-white" : "text-gray-900"}`}>{platform.name}</p>
                    <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
                      USDC → {peerCurrency}
                      {platform.maxUSDC != null ? ` · max $${platform.maxUSDC}` : ""}
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
                      onClick={() => setWithdrawAmount(Math.min(spendableBalance, platformCap).toFixed(2).replace(/\.00$/, ""))}
                      className={`shrink-0 px-3 ${dark ? "border-white/20 bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white" : ""}`}>
                      Max
                    </Button>
                  </div>
                  {withdrawAmountNum > 0 && withdrawAmountNum < 1 && (
                    <p className="text-base text-red-400 mt-1">Minimum is $1.00 USDC.</p>
                  )}
                  {platform.maxUSDC != null && withdrawAmountNum > platform.maxUSDC && (
                    <p className="text-base text-red-400 mt-1">{platform.name} limit is ${platform.maxUSDC} USDC.</p>
                  )}
                  {withdrawAmountNum > spendableBalance && withdrawAmountNum <= platformCap && spendableBalance > 0 && (
                    <p className="text-base text-red-400 mt-1">Exceeds your balance.</p>
                  )}
                </div>

                {/* Estimated receive + real fill-time ETA (live oracle rate, zero spread) */}
                {withdrawAmountNum >= 1 && (
                  <div className={`rounded-xl border px-4 py-3 space-y-1.5 ${dark ? "border-white/10 bg-white/5" : "border-orange-100 bg-orange-50/50"}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>{peerPay ? "They receive" : "You'll receive"}</span>
                      {peerEstimateLoading ? (
                        <span className={`text-base flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-gray-400"}`}>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />Fetching rate…
                        </span>
                      ) : (
                        <span className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                          ${cashoutPayoutUsdc(withdrawAmountNum).toFixed(2)} {peerCurrency}
                        </span>
                      )}
                    </div>
                    {peerEstimate?.eta && (
                      <div className="flex items-center justify-between">
                        <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>{peerPay ? "Arrives in" : "Time to fill"}</span>
                        <span className={`text-base ${dark ? "text-slate-300" : "text-gray-700"}`}>{peerEstimate.eta.label}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Peer discount</span>
                      <span className={`text-base ${dark ? "text-slate-300" : "text-gray-700"}`}>${Math.max(0, withdrawAmountNum - cashoutPayoutUsdc(withdrawAmountNum)).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div className={`rounded-xl border p-3 ${dark ? "border-white/10 bg-white/5" : "border-blue-100 bg-blue-50/60"}`}>
                  <p className={`text-base ${dark ? "text-slate-400" : "text-blue-700"}`}>
                    {peerPay
                      ? `A peer sends ${peerCurrency} to ${peerIdentifier.trim() || "this handle"} on ${platform.name}. Getting your USDC back costs a bridge fee.`
                      : `A peer sends ${peerCurrency} to ${peerIdentifier.trim() || "this handle"} on ${platform.name}. Getting your USDC back costs a bridge fee.`}
                  </p>
                </div>

                <div className="flex gap-2 pt-1">
                  {!peerPay && (
                  <Button variant="outline" onClick={() => setPeerStep("platform")}
                    className={dark ? "flex-1 border-white/20 bg-white/90 !text-black hover:bg-white hover:!text-black" : "flex-1"}>
                    Back
                  </Button>
                  )}
                  <Button
                    onClick={handlePeerSubmit}
                    disabled={peerSubmitting || !peerIdentifier.trim() || withdrawAmountNum < (devnetMode ? 0.01 : 1) || withdrawAmountNum > platformCap || withdrawAmountNum > spendableBalance}
                    className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50">
                    {peerSubmitting
                      ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Preparing…</span>
                      : `Pay $${withdrawAmountNum > 0 ? withdrawAmountNum.toFixed(2) : "0.00"}`}
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
            if (peerPay) {
              return (
                <div className="py-8 flex flex-col items-center gap-3 text-center">
                  <span className="relative block h-7 w-7" aria-hidden>
                    <span className={cn("absolute inset-0 rounded-full border-[1.5px]", dark ? "border-white/15" : "border-black/10")} />
                    <span className={cn("absolute inset-0 rounded-full border-[1.5px] border-transparent animate-spin", dark ? "border-t-white" : "border-t-gray-900")} />
                  </span>
                  <p className={cn("text-sm", dark ? "text-[#8A8893]" : "text-gray-500")}>
                    {isSuccess ? `Sending to ${platform?.name ?? "them"}` : peerBridgeTxSig ? "Confirming" : "Sending"}
                  </p>
                </div>
              );
            }
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
              <p className={`text-base font-medium ${dark ? "text-white" : "text-gray-900"}`}>
                {peerBasePending ? "Waiting for your USDC" : peerPay ? "Approve to send" : "Approve signing in your wallet"}
              </p>
              <p className={`text-base text-center ${dark ? "text-slate-400" : "text-gray-500"}`}>
                {peerBasePending
                  ? "The transfer to Base is still landing. This retries on its own."
                  : peerPay
                  ? `One approval sends $${cashoutPayoutUsdc(peerAmountUSDC || withdrawAmountNum).toFixed(2)} to ${peerIdentifier.replace(/^[@$]/, "")}.`
                  : "Almost there — approve the wallet prompt to finalize your cash out."}
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
              <p className={`text-sm text-center ${dark ? "text-slate-500" : "text-gray-500"}`}>Getting your USDC back costs a bridge fee.</p>
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
              <p className={`text-sm text-center ${dark ? "text-slate-500" : "text-gray-500"}`}>Getting your USDC back costs a bridge fee.</p>
            </div>
          )}

          {/* ── Peer offramp: deposited / waiting for payment ── */}
          {tab === "withdraw" && withdrawMethod === "peer-offramp" && peerStep === "deposited" && (() => {
            const platform = getPlatform(peerPlatformId ?? "");
            const escrowIdx = peerZkp2pDepositId?.lastIndexOf("_") ?? -1;
            const escrowAddress = escrowIdx > 0 ? peerZkp2pDepositId!.slice(0, escrowIdx) : null;
            const onchainDepositId = escrowIdx > 0 ? peerZkp2pDepositId!.slice(escrowIdx + 1) : null;
            return (
              <div className="py-2 space-y-4">
                <div className={`rounded-2xl border p-4 space-y-1 ${dark ? "border-white/10 bg-white/5" : "border-emerald-100 bg-emerald-50/60"}`}>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-500 shrink-0" />
                    <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
                      {peerPay ? `Sending to ${peerIdentifier}` : "Cash out request sent"}
                    </p>
                  </div>
                  <p className={`text-base ${dark ? "text-slate-400" : "text-gray-600"}`}>
                    {peerPay
                      ? <>A peer sends <strong>{peerCurrency}</strong> to {peerIdentifier} on {platform?.name}.{peerEstimate?.eta ? ` ${peerEstimate.eta.label}.` : ""}</>
                      : <>A peer will send <strong>{peerCurrency}</strong> to your {platform?.name} account (<span className="font-medium">{peerIdentifier}</span>).{peerEstimate?.eta ? ` Typical fill time: ${peerEstimate.eta.label}.` : " This usually takes a few minutes, but may take longer depending on availability."}</>}
                  </p>
                </div>
                {peerPay && peerShareId && (() => {
                  const shareUrl = typeof window !== "undefined"
                    ? `${window.location.origin}/share/${peerShareId}`
                    : `https://pay.loofta.xyz/share/${peerShareId}`;
                  return (
                  <div className="space-y-2">
                    <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 ${dark ? "border-white/10 bg-white/[0.03]" : "border-gray-200 bg-white"}`}>
                      <a
                        href={shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex-1 min-w-0 truncate text-base hover:underline underline-offset-2 ${dark ? "text-slate-300 hover:text-white" : "text-gray-700 hover:text-gray-900"}`}
                      >
                        {shareUrl.replace(/^https?:\/\//, "")}
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(shareUrl).then(() => toast({ title: "Link copied" })).catch(() => {});
                        }}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${dark ? "bg-white/10 text-slate-200 hover:bg-white/15" : "bg-gray-100 text-gray-800"}`}
                      >
                        Copy
                      </button>
                    </div>
                    <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>
                      {peerEstimate?.eta ? `${peerEstimate.eta.label}. ` : ""}Share this link so they can follow it.
                    </p>
                  </div>
                  );
                })()}

                <div className={`rounded-xl border p-3 flex items-center justify-between ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}>
                  <div>
                    <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Amount</p>
                    <p className={`text-base font-medium ${dark ? "text-white" : "text-gray-900"}`}>
                      {peerPay
                        ? `$${cashoutPayoutUsdc(peerAmountUSDC || withdrawAmountNum).toFixed(2)} to ${peerIdentifier.replace(/^[@$]/, "")}`
                        : `$${cashoutPayoutUsdc(peerAmountUSDC || withdrawAmountNum).toFixed(2)} ${peerCurrency}`}
                    </p>
                    {typeof peerFilledAmountUSDC === "number" && peerFilledAmountUSDC > 0 && peerFilledAmountUSDC < (peerAmountUSDC || withdrawAmountNum) && (
                      <p className={`text-xs mt-0.5 ${dark ? "text-amber-300" : "text-amber-600"}`}>
                        ${peerFilledAmountUSDC.toFixed(2)} funded so far, partial fill in progress
                      </p>
                    )}
                  </div>
                  {platform?.logo && <img src={platform.logo} alt={platform.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />}
                </div>

                {escrowAddress && onchainDepositId && (
                  <a
                    href={`https://app.peer.xyz/deposit/${escrowAddress}/${onchainDepositId}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`block text-sm -mt-2 ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
                  >
                    {peerPay ? "Status link" : "View deposit on Peer →"}
                  </a>
                )}

                {!peerPay && (
                <div className={`rounded-xl border p-3 text-base ${dark ? "border-amber-400/20 bg-amber-400/5 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                  Taking too long? You can cancel to get your USDC back, which costs a bridge fee.{peerEstimate?.eta ? ` Typical fill time for ${platform?.name} is ${peerEstimate.eta.label}.` : " Cash outs usually complete within minutes, but can take longer if peers are busy."}
                </div>
                )}

                {!peerPay && (
                <Button
                  onClick={handlePeerCancel}
                  variant="outline"
                  className={cn("w-full", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
                >
                  <X className="h-4 w-4 mr-2" />Cancel and get USDC back
                </Button>
                )}
                {peerPay ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className={`w-full text-base text-center ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
                  >
                    Done
                  </button>
                ) : (
                <button
                  type="button"
                  onClick={() => { resetPeer(); }}
                  className={`w-full text-base text-center ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
                >
                  Start a new cash out
                </button>
                )}
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
                    ${cashoutPayoutUsdc(peerAmountUSDC || withdrawAmountNum).toFixed(2)} {peerCurrency} was sent to your {platform?.name} account.
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
                  {peerFailMessage
                    ? peerFailMessage
                    : peerPay
                    ? "The payment didn't go through. Your USDC is still in your balance if it never left, or you can cancel to get it back."
                    : peerBaseWalletAddress && !peerZkp2pDepositId
                    ? "Your cash out couldn't be set up, but your USDC is safe. Try again or cancel to get it back."
                    : "Your USDC will be returned automatically. Contact support if it doesn't arrive within a few minutes."
                  }
                </p>
              </div>
              {peerBaseWalletAddress && !peerZkp2pDepositId && peerOfframpId && (
                <>
                  <Button
                    onClick={() => {
                      peerZkp2pSigningRef.current = false;
                      if (peerBridgeTxSig) {
                        setPeerStep("creating-deposit");
                        return;
                      }
                      setPeerFailMessage(null);
                      setPeerOfframpId(null);
                      setPeerStep("form");
                      peerPayKickRef.current = false;
                    }}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white"
                  >
                    Try again
                  </Button>
                  {peerBridgeTxSig && (
                    <>
                      <Button
                        onClick={handlePeerBridgeBackDirect}
                        variant="outline"
                        className={cn("w-full", dark ? "border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white" : "border-gray-300 !bg-transparent text-gray-900 hover:!bg-gray-100 hover:text-gray-900")}
                      >
                        <X className="h-4 w-4 mr-2" />Cancel and get USDC back
                      </Button>
                      <p className={`text-sm text-center ${dark ? "text-slate-500" : "text-gray-500"}`}>Getting your USDC back costs a bridge fee.</p>
                    </>
                  )}
                </>
              )}
              {(!peerOfframpId || !peerBaseWalletAddress || peerZkp2pDepositId) && (
                <Button onClick={() => { resetPeer(); setWithdrawMethod(null); if (peerPay) onClose(); }}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white">
                  Close
                </Button>
              )}
            </div>
          )}

        </div>{/* end scrollable content */}

        {/* Large close button — mobile only, always visible at bottom. Pay status has its own close. */}
        <div className={`${peerPay ? "hidden" : "sm:hidden"} shrink-0 px-4 pt-3 pb-8 border-t ${dark ? "border-white/10 bg-[#0f0f12]" : "border-gray-100 bg-white"}`}>
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
