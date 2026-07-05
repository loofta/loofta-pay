'use client'

import React, { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { trimDecimals, roundUpDecimals, formatUTCTimestamp } from "@/lib/format";
import { findTokenBySelection } from "@/lib/tokens";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { useClaimPayStore } from "@/store/claimPay";
import { useAuthStore } from "@/store/auth";
import { TokenIcon } from "@/components/TokenIcon";
import Image from "next/image";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRight, Wallet, LogIn, CheckCircle2, Send, Copy, Check } from "lucide-react";
import { PaymentStatusTracker } from "@/components/PaymentStatusTracker";
import { ShareLinkMenu } from "@/components/ShareLinkMenu";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
const EVM_CHAIN_SET = new Set(["eth", "ethereum", "arb", "arbitrum", "base", "op", "optimism", "bsc", "avax", "avalanche", "polygon", "matic", "fantom", "ftm", "gnosis", "linea", "scroll", "zksync", "zk", "blast", "pol"]);
function isEvmChainId(chain?: string): boolean { return EVM_CHAIN_SET.has(String(chain || "").toLowerCase()); }
import { usePrivy, useWallets as useEvmWallets, useLinkAccount } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction as usePrivySolanaSignTransaction,
} from "@privy-io/react-auth/solana";
import { isDemoMode } from "@/config/demoMode";
import { getUsdcAtaBalanceBaseUnits } from "@/services/solanaBalance";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { getRefundToForChain, isValidAddressForChain } from "@/lib/refundAddresses";
import { getExplorerTxUrl, getExplorerName } from "@/lib/getExplorerTxUrl";
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
import { usePerPrivateTransfer, type PerTransferProgress } from "@/hooks/usePerPrivateTransfer";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { phantomWalletToAnchorWallet, privyStandardWalletToAnchorWallet } from "@/lib/per/signer";
import { PaymentHistoryClaim } from "@/app/app/history/page";
import type { NearToken } from "@/services/nearIntents";
import {
  PRIVATE_PAYMENT_ALL_PRIVATE_LINE,
  privatePaymentFundsAppearCopy,
  privatePaymentWaitingAfterSenderCopy,
} from "@/lib/privatePaymentCopy";
import { buildClaimPrivateTransfer } from "@/services/api/claims";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";

function formatPerTransferStepName(step: string): string {
  const labels: Record<string, string> = {
    sessionAndRecipientInitTx: "Session & setup",
    combinedBaseTx: "Session & on-chain steps",
    createSessionTx: "Create session",
    recipientInitTx: "Recipient deposit",
    recipientAndMainnetTx: "Recipient & on-chain steps",
    baseSolanaOpsTx: "Deposit & delegation",
    preliminaryTx: "Prepare funds (rollup)",
    ephemeralTx: "Private transfer",
    revokeSessionTx: "Close session",
    sponsoredBaseTx: "Sponsor on-chain steps",
    mainnetTx: "Deposit & delegation",
  };
  return labels[step] ?? step;
}

/** When embedInApp: only the pay content in a dark card (no tabs, no full page). When false: full page with SendReceiveTabs and white card. */
function ClaimPayLayout({
  embedInApp,
  topRight,
  from,
  children,
}: {
  embedInApp?: boolean;
  topRight?: React.ReactNode;
  from?: string | null;
  children: React.ReactNode;
}) {
  const backHref = from === "history" ? "/history" : "/";
  const backLabel = from === "history" ? "← Back to History" : "← Back to Send";

  if (embedInApp) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={backHref} className="inline-flex items-center gap-2 text-base md:text-sm font-medium text-slate-400 hover:text-white transition-colors">
            {backLabel}
          </Link>
          {topRight}
        </div>
        <div
          className="rounded-xl border border-white/10 bg-white/5 p-6 text-white [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.bg-white]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.border-gray-200]:!border-white/10 [&_.border-gray-100]:!border-white/10 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&_input]:focus-visible:!ring-white/30"
          data-embed-pay
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <div className="hidden md:block">
          <SendReceiveTabs activeTab="send" visualOnly />
        </div>
        <div className="flex items-center justify-between gap-2 mt-4 mb-4">
          <Link href={backHref} className="inline-flex items-center gap-2 text-base md:text-sm font-medium text-slate-400 hover:text-white transition-colors">
            {backLabel}
          </Link>
          {topRight}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.bg-white]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.border-gray-200]:!border-white/10 [&_.border-gray-100]:!border-white/10 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&_input]:focus-visible:!ring-white/30">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Shown for logged-in creator of pending-recipient claim: copy/share/reclaim after payment. */
function ClaimPageSenderShareView({
  claimId,
  shortCode,
  amount,
  recipientLabel,
  status,
  userId,
  onReclaimed,
}: {
  claimId: string;
  /** Short URL code (8 chars) — used in the share link when available. Falls back to UUID. */
  shortCode?: string | null;
  amount: number;
  recipientLabel?: string;
  status: string;
  /** Logged-in creator's Privy user id; Reclaim is only shown when this is set. */
  userId?: string | null;
  onReclaimed?: () => void;
}) {
  const { toast } = useToast();
  const { getAccessToken: getSenderAccessToken } = usePrivy();
  const [copied, setCopied] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [reclaimed, setReclaimed] = useState(false);
  const [canReclaim, setCanReclaim] = useState<boolean | null>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const statusUpper = (status || "").toUpperCase();
  const isCancelled = statusUpper === "CANCELLED" || reclaimed;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hostname;
    setIsLocalhost(h === "localhost" || h === "127.0.0.1");
  }, []);

  // Reclaim button only when not cancelled and burner has balance
  useEffect(() => {
    if (!userId || isCancelled) {
      setCanReclaim(false);
      return;
    }
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
    getSenderAccessToken().then((token) => {
      fetch(`${backendUrl}/claims/${claimId}/reclaim-eligibility`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => (r.ok ? r.json() : { canReclaim: false }))
        .then((data) => setCanReclaim(!!data?.canReclaim))
        .catch(() => setCanReclaim(false));
    });
  }, [claimId, userId, isCancelled, getSenderAccessToken]);

  const shareId = shortCode || claimId;
  const claimLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/share/${shareId}`
      : `https://pay.loofta.xyz/share/${shareId}`;

  const handleReclaim = async () => {
    if (!userId) {
      toast({ variant: "destructive", title: "Sign in to reclaim" });
      return;
    }
    setReclaiming(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const senderToken = await getSenderAccessToken();
      const r = await fetch(`${backendUrl}/claims/${claimId}/reclaim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(senderToken ? { Authorization: `Bearer ${senderToken}` } : {}),
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.message || `Reclaim failed: ${r.status}`);
      }
      setReclaimed(true);
      toast({ title: "Payment cancelled", description: "Funds (if any were sent) will be returned to your Loofta wallet." });
      onReclaimed?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Reclaim failed";
      toast({ variant: "destructive", title: "Reclaim failed", description: msg });
    } finally {
      setReclaiming(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(claimLink);
      setCopied(true);
      toast({ title: "Link copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  };

  const shareRecipientSuffix = recipientLabel ? ` (${recipientLabel})` : "";
  const shareText = `You have a payment of $${amount.toFixed(2)} to claim${shareRecipientSuffix}. Sign in or sign up on Loofta to claim it.`;

  return (
    <div className="mt-6 text-center py-12">
      <div className="mb-4 text-6xl">🔗</div>
      <h3 className="text-2xl font-semibold text-gray-900 mb-2">
        Share this claim link
      </h3>
      <p className="text-gray-600 text-base mb-4">
        {["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(status)
          ? `$${amount.toFixed(2)} is ready. The recipient can claim after signing in or signing up on Loofta${recipientLabel ? ` (${recipientLabel})` : ""}.`
          : `The recipient can claim $${amount.toFixed(2)} after signing in or signing up on Loofta${recipientLabel ? ` (${recipientLabel})` : ""}.`}
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center items-stretch sm:items-center">
        <div className="flex gap-2 flex-1 max-w-md mx-auto">
          <Input
            readOnly
            value={claimLink}
            className="font-mono text-sm md:text-xs flex-1 bg-gray-50"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCopy}
            className="shrink-0 !text-slate-900 border-gray-400 hover:bg-gray-100 hover:!text-slate-900"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 !text-slate-900" />}
          </Button>
        </div>
        <ShareLinkMenu
          url={claimLink}
          title="Payment for you"
          text={shareText}
          triggerClassName="px-6 py-3"
        />
      </div>
      {/* Reclaim only on localhost, when not cancelled, creator is logged in, and burner has balance */}
      {isLocalhost && !isCancelled && userId && canReclaim === true && (
        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleReclaim}
            disabled={reclaiming}
            className="rounded-xl border-2 border-amber-200 bg-amber-50/50 text-amber-800 hover:bg-amber-100 hover:border-amber-300 font-medium transition-all shadow-sm cursor-pointer"
          >
            {reclaiming ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wallet className="mr-2 h-4 w-4" />
            )}
            Reclaim funds
          </Button>
        </div>
      )}
      {isCancelled && (
        <p className="mt-4 text-base md:text-sm text-gray-500">Payment cancelled. Any funds have been returned to your Loofta wallet.</p>
      )}
    </div>
  );
}

/** Inline Loofta logo SVG (no Image component). */
function LooftaIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = React.useId().replace(/:/g, "-");
  return (
    <svg
      viewBox="0 0 56 57"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
      {...props}
    >
      <g filter={`url(#loofta-shadow-${id})`}>
        <path
          d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z"
          fill="#FF4A26"
        />
      </g>
      <defs>
        <filter id={`loofta-shadow-${id}`} x="0" y="0" width="56" height="57" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="2" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_617_42" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_617_42" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}

/** Poll until tx is confirmed or failed on-chain; only return true if confirmed without error. */
async function waitForConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  const pollIntervalMs = 1500;
  while (Date.now() - start < timeoutMs) {
    const { value: status } = await connection.getSignatureStatus(signature);
    if (status?.err) {
      // Tx failed on-chain (e.g. insufficient SOL for fee)
      throw new Error(
        `Transaction failed on-chain: ${typeof status.err === "object" ? JSON.stringify(status.err) : String(status.err)}. You may need a small amount of SOL for gas.`
      );
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}

/** Phantom wallet provider (injected by Phantom extension). Use for USDC-on-Solana payments. */
function getPhantomProvider(): { connect: () => Promise<{ publicKey: PublicKey }>; publicKey: PublicKey | null; signMessage: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>; signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction> } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: { connect?: () => Promise<{ publicKey: PublicKey }>; publicKey: PublicKey | null; signMessage?: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>; signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction> } };
  const solana = w?.solana;
  if (!solana?.signTransaction || !solana?.signMessage) return null;
  return solana as { connect: () => Promise<{ publicKey: PublicKey }>; publicKey: PublicKey | null; signMessage: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>; signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction> };
}

// Check demo mode at module level for consistent behavior
const DEMO_MODE = isDemoMode();

async function fetchClaim(id: string, authToken?: string | null) {
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const r = await fetch(`/api/claims/${id}`, { headers: authHeaders });
  if (!r.ok) {
    // Not finding this claim (or not being recognized as its recipient) is a normal, expected
    // outcome for this page — wrong identity, expired link, genuinely nonexistent id — not a
    // network/server failure. Resolving with claim: null (instead of throwing) keeps this query
    // in React Query's real "success" state, so it never re-enters isPending on a retry. Before
    // this, every attempt of the background recheck loop briefly flipped isLoading back to true
    // (since a thrown/errored query is still "pending" until it actually gets data), collapsing
    // the whole page back to the loading skeleton on every single poll.
    return { claim: null, latestIntent: null };
  }
  const data = await r.json();
  const c = data.claim || {};
  console.log("[fetchClaim]", {
    claimId: id,
    hasBurner: !!c.claim_burner_address,
    isRegistered: !!(c as { recipient_is_registered?: boolean }).recipient_is_registered,
  });
  return {
    claim: c as { id: string; short_id?: string | null; amount: string; to_symbol: string; to_chain: string; status: string; recipient_address?: string; recipient_username?: string | null; recipient_email?: string | null; claim_burner_address?: string; recipient_pending_email?: boolean; recipient_pending_email_value?: string; recipient_pending_username?: boolean; recipient_pending_username_value?: string; created_at?: string; paid_at?: string; creator_email?: string; creator_username?: string | null; created_by?: string | null; description?: string; is_private?: boolean | null; paid_with_token?: string; paid_with_chain?: string; sender_tx_hash?: string | null; direction?: "from_sender" | "from_recipient"; is_devnet?: boolean; fee_on_sender?: boolean | null },
    latestIntent: data.latestIntent || null,
  };
}

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";

function getEffectiveRecipient(claim: { claim_burner_address?: string; recipient_address?: string } | null): string {
  if (!claim) return "";
  const c = claim as { claim_burner_address?: string; recipient_address?: string };
  return (c.claim_burner_address || c.recipient_address || "").trim();
}

async function prepareDeposit(input: {
  claimId: string;
  claim: { id: string; amount: string; to_symbol: string; to_chain: string; recipient_address?: string };
  fromToken: { tokenId: string; decimals: number; chain: string; symbol?: string };
  amount: string;
  userAddress?: string;
  refundAddress?: string;
  isPrivate?: boolean;
  /** For private cross-chain to Solana: logged-in user's embedded Solana wallet (required) */
  recipientSolanaAddress?: string;
}) {
  // For private cross-chain payments (to Solana USDC), user must be logged in; Near-Intents sends to their embedded Solana wallet
  const originChain = String(input.fromToken?.chain || '').toLowerCase();
  const destChain = String(input.claim?.to_chain || '').toLowerCase();
  const isCrossChain = originChain !== destChain;
  const isPrivateCrossChain = input.isPrivate && isCrossChain && (destChain === 'solana' || destChain === 'sol') && input.claim.to_symbol === 'USDC';

  if (isPrivateCrossChain) {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

    if (!input.fromToken.symbol) {
      throw new Error('Token symbol is required for private cross-chain payments');
    }
    if (!input.recipientSolanaAddress) {
      throw new Error('Private cross-chain to Solana requires login. Please connect your Loofta account — your embedded Solana wallet will receive the funds, then you complete the private transfer.');
    }

    const backendPayload = {
      claimId: input.claimId,
      fromToken: {
        tokenId: input.fromToken.tokenId,
        symbol: input.fromToken.symbol,
        chain: input.fromToken.chain,
        decimals: input.fromToken.decimals,
      },
      amount: input.amount,
      ...(input.userAddress && { userAddress: input.userAddress }),
      ...(input.refundAddress && { refundAddress: input.refundAddress }),
      recipientSolanaAddress: input.recipientSolanaAddress,
      isPrivate: true,
    };

    console.log('[prepareDeposit] Calling backend for private cross-chain payment:', {
      backendUrl: `${backendUrl}/claims/deposit`,
      payload: backendPayload,
    });

    const r = await fetch(`${backendUrl}/claims/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backendPayload),
    });

    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      console.error('[prepareDeposit] Backend error:', {
        status: r.status,
        error: errData,
      });
      const err = new Error(errData?.error || errData?.message || "Failed to prepare deposit") as any;
      err.code = errData?.code;
      throw err;
    }

    const result = await r.json();
    console.log('[prepareDeposit] Backend response:', result);
    return result;
  }

  // For standard payments, use frontend API route
  const r = await fetch(`/api/claims/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const errData = await r.json().catch(() => ({}));
    const err = new Error(errData?.error || "Failed to prepare deposit") as any;
    err.code = errData?.code;
    throw err;
  }
  return await r.json();
}

async function updateClaimStatus(
  claimId: string,
  status: string,
  extra?: {
    txHash?: string;
    paidWith?: string;
    depositReceivedAt?: string;
    originAsset?: string;
    destinationAsset?: string;
    isPrivate?: boolean;
    paidWithToken?: string;
    paidWithChain?: string;
    feeAmountUsdc?: number;
    feeBreakdown?: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number };
  },
  accessToken?: string | null,
) {
  const authHeader: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
  try {
    // Try backend API first (more reliable)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
    const r = await fetch(`${backendUrl}/claims/${claimId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ status, ...extra }),
    });

    if (r.ok) {
      console.log("[updateClaimStatus] Successfully updated via backend");
      return;
    }

    // Fallback to frontend API route (pass userId so PATCH can backfill created_by for history)
    console.log("[updateClaimStatus] Backend failed, trying frontend API route");
    const r2 = await fetch(`/api/claims/${claimId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ status, ...extra }),
    });

    if (!r2.ok) {
      const errorText = await r2.text();
      console.error("[updateClaimStatus] Frontend API also failed:", errorText);
    }
  } catch (e) {
    console.error("[updateClaimStatus] Error:", e);
  }
}

/** Message + embedded GIF rendering for claim description (shared paid / claim flows). */
function ClaimDescriptionMessageBox({ description }: { description?: string | null }) {
  if (!description?.trim()) return null;
  const GIF_REGEX = /(https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\/[^\s]*)/gi;
  const gifMatch = description.match(GIF_REGEX);
  const gifUrl = gifMatch ? gifMatch[0] : null;
  const textOnly = description.replace(GIF_REGEX, "").replace(/\s+/g, " ").trim();

  let resolvedGifUrl = gifUrl;
  if (gifUrl?.includes("giphy.com") && !gifUrl.endsWith(".gif")) {
    const m = gifUrl.match(/giphy\.com\/media\/([^/]+)/);
    resolvedGifUrl = m
      ? `https://media.giphy.com/media/${m[1]}/giphy.gif`
      : gifUrl.replace(/\/$/, "") + ".gif";
  }

  return (
    <div className="mb-4 space-y-3">
      {textOnly && (
        <div className="relative pl-5 pr-4 py-4 rounded-xl bg-white/[0.06] overflow-hidden">
          <span className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#FF1301] to-[#EAB308]" />
          <span className="absolute top-1 left-4 text-4xl font-serif text-white/10 select-none leading-none">"</span>
          <p className="relative text-lg font-medium text-white italic leading-relaxed pl-3">{textOnly}</p>
        </div>
      )}
      {resolvedGifUrl && (
        <div className="rounded-xl overflow-hidden border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element -- GIF URLs from user message; remote patterns vary */}
          <img
            src={resolvedGifUrl}
            alt="GIF"
            className="w-full h-auto block"
            style={{ maxHeight: "220px", objectFit: "cover" }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Shared "Payment not found" empty state — used both when a claim genuinely doesn't resolve
 * (404) and when it resolves but the viewer isn't the recognized recipient. Previously these
 * were two independently hand-styled blocks that drifted apart; this is the one design.
 */
function PaymentNotFoundNotice({
  message,
  hint,
  showLinkButtons,
  hasTwitterLinked,
  hasEmailLinked,
  onConnectTwitter,
  onConnectEmail,
  isConfirmingIdentity,
  backHref,
  backLabel,
}: {
  message: string;
  hint?: string | null;
  showLinkButtons: boolean;
  hasTwitterLinked: boolean;
  hasEmailLinked: boolean;
  onConnectTwitter: () => void;
  onConnectEmail: () => void;
  /** True while confirmIdentityThenReload() is running after Connect X/email — the page is
   *  about to reload once this resolves, so show that something is actively happening instead
   *  of leaving the stale "not found" state sitting there looking frozen/broken for a few
   *  seconds while the backend genuinely catches up. */
  isConfirmingIdentity?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-4xl select-none">
        🔍
      </div>
      <h3 className="text-xl font-semibold text-white mb-3">Payment not found</h3>
      <div className="space-y-2 mb-8 max-w-xs">
        <p className="text-slate-300 text-base">{message}</p>
        {hint && <p className="text-slate-300 text-base">{hint}</p>}
      </div>
      {isConfirmingIdentity ? (
        <p className="mb-6 flex items-center gap-2 text-base text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirming your account…
        </p>
      ) : (
        showLinkButtons && (!hasTwitterLinked || !hasEmailLinked) && (
          <div className="flex flex-wrap justify-center gap-3 mb-6">
            {!hasTwitterLinked && (
              <button
                type="button"
                onClick={onConnectTwitter}
                className="inline-flex items-center justify-center h-11 rounded-lg bg-white/10 text-white px-5 text-base font-semibold hover:bg-white/20 transition-colors"
              >
                Connect X
              </button>
            )}
            {!hasEmailLinked && (
              <button
                type="button"
                onClick={onConnectEmail}
                className="inline-flex items-center justify-center h-11 rounded-lg bg-white/10 text-white px-5 text-base font-semibold hover:bg-white/20 transition-colors"
              >
                Add email
              </button>
            )}
          </div>
        )
      )}
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-base md:text-sm font-medium text-slate-400 hover:text-white transition-colors"
        >
          {backLabel}
        </Link>
      )}
    </div>
  );
}

function ClaimPayView({ claimId, embedInApp }: { claimId: string; embedInApp?: boolean }) {
  const id = claimId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const [isClaimPageLocalhost, setIsClaimPageLocalhost] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hostname;
    setIsClaimPageLocalhost(h === "localhost" || h === "127.0.0.1");
  }, []);
  const { toast } = useToast();
  const { user, logout, login, authenticated, ready: privyReady, getAccessToken } = usePrivy();

  // Twitter/X handle from Privy linked accounts — used to nudge recipients whose Loofta
  // username doesn't match their X handle into syncing it (see backend X-handle fallback
  // matching in claims.service.ts checkIsRecipient).
  const twitterHandle = useMemo(() => {
    const linkedAccounts = (user?.linkedAccounts || []) as Array<{ type?: string; username?: string; name?: string; subject?: string }>;
    const tw = linkedAccounts.find((a) => a.type === "twitter_oauth" || a.type === "twitter" || a.type === "x");
    const raw = tw?.username || tw?.name || tw?.subject || null;
    return raw ? raw.replace(/^@/, "") : null;
  }, [user?.linkedAccounts]);
  const hasTwitterLinked = !!twitterHandle;
  const hasEmailLinked = useMemo(
    () => ((user?.linkedAccounts || []) as Array<{ type?: string }>).some((a) => a.type === "email"),
    [user?.linkedAccounts],
  );
  const [updatingUsernameToTwitter, setUpdatingUsernameToTwitter] = useState(false);

  // ---------------------------------------------------------------------------------------
  // Recipient-identity recheck: runs silently in the background after sign-in or linking a
  // new account, until the claim + recipient-check genuinely confirm this user (or it times
  // out) — no button, no visible loading state, the page just updates itself once resolved.
  //
  // Why this exists: the backend caches each user's Privy record (linked_accounts) for 5 min
  // (privy-verification.service.ts), and the recipient-identity check (checkIsRecipient) reads
  // from that cache. So right after linking an account or signing in, "payment not found" /
  // "not the recipient" can be stale even though the account now genuinely matches — busting
  // the cache once and refetching once isn't reliable because of a real race: getAccessToken()
  // can resolve before Privy's session is fully settled, and even a fresh backend call can hit
  // Privy's own API before it has indexed the just-linked account. So this polls (busting the
  // cache each attempt) on an interval up to a real ceiling instead of guessing a fixed count.
  // `recheckInFlightRef` blocks overlapping loops if sign-in and link-success fire close together.
  const RECIPIENT_RECHECK_TIMEOUT_MS = 30_000;
  const RECIPIENT_RECHECK_INTERVAL_MS = 3_000;
  const recheckInFlightRef = useRef(false);

  const bustPrivyCacheOnce = async () => {
    const token = await getAccessToken();
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
    await fetch(`${backendUrl}/users/refresh-privy-cache`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  /** Resolves true once the claim + recipient-check both confirm this user, false if it timed out. */
  const recheckRecipientUntilResolved = async (): Promise<boolean> => {
    if (recheckInFlightRef.current) return false;
    recheckInFlightRef.current = true;
    const deadline = Date.now() + RECIPIENT_RECHECK_TIMEOUT_MS;
    try {
      let first = true;
      while (Date.now() < deadline) {
        if (!first) await new Promise((r) => setTimeout(r, RECIPIENT_RECHECK_INTERVAL_MS));
        first = false;
        try {
          await bustPrivyCacheOnce();
        } catch {
          // best-effort — the recheck itself is what actually matters
        }
        const [claimResult, recipientResult] = await Promise.all([
          claimQuery.refetch(),
          recipientCheckQuery.refetch(),
        ]);
        const resolved = !!claimResult.data?.claim && recipientResult.data?.isRecipient === true;
        if (resolved) return true;
      }
      return false;
    } finally {
      recheckInFlightRef.current = false;
    }
  };

  // True only while confirmIdentityThenReload is actively running — drives a visible
  // "Confirming your account…" state so the few seconds of real backend/Privy propagation lag
  // don't just look like a frozen "Payment not found" screen with nothing happening.
  const [isConfirmingIdentity, setIsConfirmingIdentity] = useState(false);

  /**
   * The one place identity-driven actions on this page end: verify the recheck actually
   * converged, then reload. A reload before confirming just relocates the race (see
   * recheckRecipientUntilResolved's own doc comment); confirming first means the page that
   * comes back after reload should be correct on its very first fetch.
   */
  const confirmIdentityThenReload = async () => {
    setIsConfirmingIdentity(true);
    try {
      await recheckRecipientUntilResolved();
    } finally {
      // Only matters if it timed out without resolving — a successful resolve reloads the
      // page right after this, tearing all component state down anyway.
      setIsConfirmingIdentity(false);
    }
    window.location.reload();
  };

  const { linkTwitter, linkEmail } = useLinkAccount({
    onSuccess: ({ linkedAccount }) => {
      void (async () => {
        // Push what Privy's client SDK just confirmed straight into our own DB before
        // rechecking — this is data we already have zero-latency, verified proof of (Privy
        // wouldn't have fired onSuccess otherwise), so there's no reason to wait on our
        // backend's separate live call to Privy's API to independently rediscover it. That
        // live call is exactly what's still subject to Privy's own eventual consistency; this
        // fast path (checked first in verifyRecipientIdentityForSendPayment) sidesteps it for
        // the case where the client already knows the answer.
        const acct = linkedAccount as { type?: string; username?: string | null; name?: string | null };
        const isTwitter = acct?.type === "twitter_oauth" || acct?.type === "twitter" || acct?.type === "x";
        const handle = (acct?.username || acct?.name || "").replace(/^@/, "").trim();
        if (isTwitter && handle) {
          try {
            const token = await getAccessToken().catch(() => null);
            await fetch("/api/users/save-twitter-username", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ twitterUsername: handle }),
            });
          } catch {
            // best-effort — the recheck loop below still falls back to the live Privy check
          }
        }
        await confirmIdentityThenReload();
      })();
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Couldn't connect", description: String(error) });
    },
  });

  // Re-check recipient status the first time this page sees you as signed in (covers both a
  // fresh login and signing back in after being logged out) — otherwise a stale cached/
  // pre-login snapshot can make an already-matching account keep showing as "not the
  // recipient". Fires AT MOST ONCE per page load: `hasFiredRef` only ever gets set, never
  // reset, so if `authenticated` itself flickers (Privy re-validating its session in the
  // background) this can't re-trigger and silently reload the page out from under you. No
  // reload here (unlike confirmIdentityThenReload) — this covers routine sign-ins, which
  // happen on every visit, not just the rare deliberate actions below.
  const authRecheckFiredRef = useRef(false);
  useEffect(() => {
    if (authenticated && !authRecheckFiredRef.current) {
      authRecheckFiredRef.current = true;
      void recheckRecipientUntilResolved();
    }
  }, [authenticated]);

  const useTwitterHandleAsUsername = async (handle: string) => {
    setUpdatingUsernameToTwitter(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/users/setup-username", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ username: handle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "Update failed", description: data?.error || "Try again." });
        return;
      }
      await confirmIdentityThenReload();
    } catch {
      toast({ variant: "destructive", title: "Update failed", description: "Try again." });
    } finally {
      setUpdatingUsernameToTwitter(false);
    }
  };

  const networkMode = useAuthStore((s) => s.networkMode);
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode);
  const isOnboardingOpen = useAuthStore((s) => s.isOnboardingOpen);
  const hideAlternateTokenPay = false;
  const mainnetViewOnly = false;
  const { data: tokensRaw = [], isLoading } = useTokensQuery();
  /** Devnet mode: inject devnet USDC mint so Pay with + selection resolve correctly. */
  const tokens = useMemo(() => {
    const list = tokensRaw;
    if (networkMode === "mainnet") return list;
    const mint = getUsdcMintForMode(networkMode).toBase58();
    const mintLc = mint.toLowerCase();
    // Remove Solana USDC rows whose mint is not this cluster (e.g. mainnet EPjF… on devnet).
    const filtered = list.filter((t) => {
      if (String(t.symbol || "").toUpperCase() !== "USDC") return true;
      if (!["sol", "solana"].includes(String(t.chain || "").toLowerCase())) return true;
      const id = String(t.tokenId || t.address || "").toLowerCase();
      return id === mintLc;
    });
    const hasClusterUsdc = filtered.some(
      (t) =>
        String(t.symbol || "").toUpperCase() === "USDC" &&
        ["sol", "solana"].includes(String(t.chain || "").toLowerCase()) &&
        [String(t.tokenId || "").toLowerCase(), String(t.address || "").toLowerCase()].includes(mintLc),
    );
    if (hasClusterUsdc) return filtered;
    const synthetic: NearToken = {
      symbol: "USDC",
      name: "USD Coin",
      chain: "solana",
      address: mint,
      tokenId: mint,
      decimals: 6,
      price: 1,
      logoURI: "/usdt.svg",
    };
    return [...filtered, synthetic];
  }, [tokensRaw]);
  const claimQuery = useQuery({
    queryKey: ["claim", id, user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      return fetchClaim(id, token);
    },
    enabled: privyReady,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
  const claimData = claimQuery.data as any;
  const claim = claimData?.claim;
  // Safe to use isLoading again now that fetchClaim() resolves with claim: null instead of
  // throwing on a 404/403 — "not found" is real success data, not an error state, so isLoading
  // (isPending && isFetching) is only ever true on the genuine first load, not on every
  // subsequent refetch attempt of the background recheck loop.
  const loadingClaim = claimQuery.isLoading;
  /** The network this claim was created on, derived from is_devnet once the claim has loaded. */
  const claimExpectedNetwork: "devnet" | "mainnet" | null = (() => {
    if (!claim) return null;
    const isDevnet = (claim as { is_devnet?: boolean }).is_devnet;
    if (isDevnet === true) return "devnet";
    if (isDevnet === false) return "mainnet";
    return null;
  })();
  /** True when the user's active network doesn't match the claim's network — blocks payment to prevent wrong-chain submission. */
  const isWrongNetwork = claimExpectedNetwork !== null && networkMode !== claimExpectedNetwork;

  const [showNetworkSwitchPrompt, setShowNetworkSwitchPrompt] = useState(false);
  const networkMismatchHandledRef = useRef(false);
  // Keep a ref so the deferred timeout below can read the latest value without a stale closure.
  const isOnboardingOpenRef = useRef(isOnboardingOpen);
  useEffect(() => { isOnboardingOpenRef.current = isOnboardingOpen; }, [isOnboardingOpen]);

  // Show a modal the first time a mismatch is detected between the claim's network and the
  // user's active network. Both deps are intentional: networkMode can update after Privy
  // resolves the user's saved preference, which may arrive after the claim API response.
  // The ref prevents the modal from re-opening after the user has already handled it.
  // Wait for the onboarding modal to close first to avoid Radix focus-trap conflicts.
  // UserSync opens onboarding after a 600 ms delay, so we defer by 800 ms and re-check
  // via the ref — otherwise the network-switch modal races ahead and both appear at once.
  useEffect(() => {
    if (!claimExpectedNetwork) return;
    if (networkMismatchHandledRef.current) return;
    if (networkMode === claimExpectedNetwork) return;
    if (isOnboardingOpen) return;
    const timer = setTimeout(() => {
      if (isOnboardingOpenRef.current) return;
      networkMismatchHandledRef.current = true;
      setShowNetworkSwitchPrompt(true);
    }, 800);
    return () => clearTimeout(timer);
  }, [claimExpectedNetwork, networkMode, isOnboardingOpen]);

  // Extract latest intent from claim query (merged into main GET endpoint)
  const latestIntentData = useMemo(() => {
    return claimData?.latestIntent || null;
  }, [claimData]);

  const recipientCheckQuery = useQuery({
    queryKey: ["claim", id, "recipient-check", user?.id],
    queryFn: async () => {
      if (!user?.id) return { isRecipient: false };
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const token = await getAccessToken();
      const r = await fetch(`${backendUrl}/claims/${id}/recipient-check`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return { isRecipient: false };
      const data = await r.json();
      return { isRecipient: data?.isRecipient === true };
    },
    enabled: !!claim && !!user?.id,
    staleTime: 60_000,
  });
  const isRecipient = recipientCheckQuery.data?.isRecipient === true;
  // True while we're still checking — hide the pay form until we know the user is NOT the recipient.
  const isCheckingRecipient = recipientCheckQuery.isLoading || recipientCheckQuery.isFetching;
  // True only for the very first check (no data yet) — unlike isCheckingRecipient, this stays
  // false during background refetches (e.g. the retry loop after linking an account), so those
  // silent rechecks don't collapse the whole page back to the skeleton once content is showing.
  const isInitialRecipientCheck = recipientCheckQuery.isLoading;

  // Registered recipients now also route through a burner — treat them the same as pending
  // recipients so the burner-balance poller and claim UI are activated.
  const isPendingRecipientClaim =
    !!claim?.recipient_pending_email ||
    !!claim?.recipient_pending_username ||
    !!(claim as { recipient_is_registered?: boolean } | null)?.recipient_is_registered;

  // Poll claim burner USDC (per-claim pubkey — not the user’s Privy wallet). Privy cannot surface this; we must read chain state (or a future backend “burner funded” flag).
  const burnerAddr = (claim as { claim_burner_address?: string | null } | null)?.claim_burner_address ?? null;
  /** Network the claim was created on — drives burner polling and sweep RPC. Overrides user's global networkMode for claim-specific ops. */
  const claimNetworkMode = (claim as { is_devnet?: boolean } | null)?.is_devnet === false ? "mainnet" : networkMode;
  // Private (MagicBlock) transfers can arrive in parts rather than atomically — the burner ATA
  // can show a real, positive, but partial balance while the rest is still in transit. Gating
  // "ready" on balance > 0 let the Claim button light up on a partial deposit, which then made
  // the actual claim sit for up to 90s server-side (claimAsRecipientMutation.mutate() ->
  // pollBurnerAtaUntilPositive) waiting for the rest to land — with the click already committed
  // and no obvious feedback loop tying that wait back to this button. Comparing against the
  // claim's expected amount instead means the button simply doesn't enable until delivery is
  // actually complete, matching what "Claim" should mean.
  const claimExpectedBaseUnits = Math.round(parseFloat(claim?.amount || "0") * 1_000_000);
  const burnerReadyQuery = useQuery({
    queryKey: ["burner-ready", burnerAddr, claimNetworkMode, claimExpectedBaseUnits],
    queryFn: async (): Promise<{ balance: number; isReady: boolean }> => {
      if (!burnerAddr) return { balance: 0, isReady: false };
      const balance = await getUsdcAtaBalanceBaseUnits(burnerAddr, claimNetworkMode);
      console.info(
        `[BurnerReady] claimId=${id} usdcBaseUnits=${balance} expected=${claimExpectedBaseUnits} (ATA may be missing until first deposit)`,
      );
      return { balance, isReady: claimExpectedBaseUnits > 0 && balance >= claimExpectedBaseUnits };
    },
    enabled: !!burnerAddr && !!user?.id && isPendingRecipientClaim,
    refetchInterval: 15_000,
    staleTime: 12_000,
  });
  const burnerIsReady = burnerReadyQuery.data?.isReady ?? false;
  const burnerIsChecking = burnerReadyQuery.isLoading || (!burnerReadyQuery.isFetched && !!burnerAddr);
  /** Logged-in pending recipient cannot claim until burner USDC ATA has a balance (or burner address is missing). */
  const waitingForBurnerFunds =
    !!user?.id && isPendingRecipientClaim && (!burnerAddr || !burnerIsReady);
  /** True while Privy hasn't finished creating the user's embedded Solana wallet (created async after login). */
  const walletNotReady = !!user?.id && !deriveSolanaEmbeddedAddress(user);

  const solPriceQuery = useQuery({
    queryKey: ["sol-price"],
    queryFn: async (): Promise<number> => {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
      const apiKey = rpcUrl.split("/").pop() ?? "";
      const r = await fetch(`https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?symbols=SOL`);
      const json = await r.json();
      return parseFloat(json?.data?.[0]?.prices?.find((p: { currency: string }) => p.currency === "usd")?.value ?? "0");
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const solPrice = solPriceQuery.data ?? 0;

  const estimatePrivateTotal = (usd: number) => {
    // No gross-up: MagicBlock delivers `amount` unchanged, so the only real cost is its flat
    // gasless relay fee. protocolFee kept at 0 for backwards-compat with callers.
    const gasFee = 0.20; // flat USDC relay fee charged by MagicBlock
    const feeEstimate = gasFee;
    return { total: usd + feeEstimate, protocolFee: 0, gasFee, feeEstimate };
  };

  useEffect(() => {
    if (!isPendingRecipientClaim) return;
    if (!burnerAddr) {
      console.warn("[Claim] pending recipient but claim_burner_address missing — claim cannot fund until backfilled", {
        claimId: id,
      });
    }
  }, [id, isPendingRecipientClaim, burnerAddr]);

  const queryClient = useQueryClient();
  /**
   * Retry the header/pay-modal balance query on a growing backoff after a claim sweep.
   * Private (MagicBlock PER) transfers can take up to PRIVATE_PAYMENT_MAX_WAIT_MINUTES to
   * land on-chain — the header's own 5s refetchInterval alone doesn't help if it silently
   * pauses (e.g. embedded wallet re-init), so we drive it explicitly out to ~2min.
   */
  const refreshWalletBalances = () => {
    const delaysMs = [2_000, 5_000, 10_000, 20_000, 35_000, 55_000, 80_000, 110_000];
    for (const delay of delaysMs) {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
        queryClient.refetchQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      }, delay);
    }
  };
  const claimAsRecipientMutation = useMutation({
    mutationFn: async () => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      console.info("[Claim] Initiating claim for:", id, "user:", user?.id?.slice(0, 12));
      const claimToken = await getAccessToken();
      const claimResp = await fetch(`${backendUrl}/claims/${id}/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(claimToken ? { Authorization: `Bearer ${claimToken}` } : {}),
        },
      });
      console.info("[Claim] /claim response:", claimResp.status);
      if (claimResp.ok) {
        const claimData = await claimResp.json().catch(() => ({}));
        console.info("[Claim] /claim success:", claimData);
        // Fire retry-sweep in the background — for private payments the backend can poll
        // up to 90s for payer→burner delivery. We never await it so the success UI
        // shows immediately after /claim 200.
        const retrySweepHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (claimToken) retrySweepHeaders["Authorization"] = `Bearer ${claimToken}`;
        fetch(`${backendUrl}/claims/${id}/claim-retry-sweep`, {
          method: "POST",
          headers: retrySweepHeaders,
        }).then(r => r.json()).then(d => console.info("[Claim] retry-sweep (bg):", d)).catch(() => { });
        return { claimed: true, sweepTxHash: claimData?.sweepTxHash, sweptAmount: claimData?.sweptAmount };
      }
      // If already claimed/not pending, fire a background retry-sweep for recovery.
      const err = await claimResp.json().catch(() => ({}));
      const msg = String(err?.message || "");
      console.warn("[Claim] /claim failed:", msg);
      if (/not pending claim|already been claimed|already claimed/i.test(msg)) {
        console.info("[Claim] Already claimed — retry-sweep in background…");
        const retrySweepHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (claimToken) retrySweepHeaders["Authorization"] = `Bearer ${claimToken}`;
        fetch(`${backendUrl}/claims/${id}/claim-retry-sweep`, {
          method: "POST",
          headers: retrySweepHeaders,
        }).then(r => r.json()).then(d => console.info("[Claim] retry-sweep (already-claimed bg):", d)).catch(() => { });
        return { claimed: true, sweepTxHash: undefined, sweptAmount: undefined };
      }
      throw new Error(err?.message || `Claim failed: ${claimResp.status}`);
    },
    onMutate: async () => {
      const now = new Date().toISOString();
      setOptimisticClaimedAt(now);
      // Snapshot then optimistically mark the claim as SUCCESS with a paid_at timestamp.
      await queryClient.cancelQueries({ queryKey: ["claim", id] });
      const prevClaim = queryClient.getQueryData(["claim", id]);
      queryClient.setQueryData(["claim", id], (old: any) =>
        old ? { ...old, status: "SUCCESS", paid_at: now } : old,
      );
      // Optimistically prepend to every matching history cache (user may have several key variants).
      const historyKeys = queryClient.getQueriesData<{ sent: any[]; received: any[] }>({
        queryKey: ["payments", "history"],
      });
      const prevHistories = historyKeys.map(([key, data]) => ({ key, data }));
      if (claim) {
        const optimisticEntry = {
          id: claim.id,
          amount: claim.amount,
          direction: claim.direction ?? "from_sender",
          to_symbol: claim.to_symbol ?? "USDC",
          to_chain: claim.to_chain ?? "solana",
          status: "SUCCESS",
          created_at: claim.created_at ?? now,
          paid_at: now,
          recipient_address: claim.recipient_address,
          recipient_username: claim.recipient_username ?? null,
          creator_email: claim.creator_email ?? null,
          creator_username: claim.creator_username ?? null,
          created_by: claim.created_by ?? null,
          paid_with_token: claim.paid_with_token ?? null,
          paid_with_chain: claim.paid_with_chain ?? null,
          is_private: claim.is_private ?? null,
          description: claim.description ?? null,
          short_id: (claim as any).short_id ?? null,
        };
        for (const [key, data] of historyKeys) {
          if (!data) continue;
          const alreadyIn = data.received.some((r: any) => r.id === claim.id);
          if (!alreadyIn) {
            queryClient.setQueryData(key, {
              ...data,
              received: [optimisticEntry, ...data.received],
            });
          }
        }
      }
      return { prevClaim, prevHistories };
    },
    onSuccess: (data: { claimed?: boolean; sweepTxHash?: string; sweptAmount?: string; swept?: boolean } | undefined, _vars, context) => {
      setClaimCompleted(true);
      setStatus("SUCCESS");
      useClaimPayStore.getState().setClaimed(id, true);
      queryClient.setQueryData(["claim", id, "recipient-check", user?.id], { isRecipient: true });
      // Refetch real paid_at from DB once the sweep completes. exact: true matters here —
      // without it this fuzzy-matches ["claim", id, "recipient-check", user?.id] too, which
      // flips isCheckingRecipient back to true and collapses the whole page to the loading
      // skeleton mid-celebration (the "flicker between success and skeleton" bug).
      queryClient.invalidateQueries({ queryKey: ["claim", id], exact: true });
      queryClient.refetchQueries({ queryKey: ["claim", id], exact: true });
      queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
      refreshWalletBalances();
    },
    onError: (error: unknown, _vars, context: any) => {
      // Roll back optimistic claim data.
      setOptimisticClaimedAt(null);
      if (context?.prevClaim !== undefined) {
        queryClient.setQueryData(["claim", id], context.prevClaim);
      }
      for (const { key, data } of context?.prevHistories ?? []) {
        queryClient.setQueryData(key, data);
      }
      const message = error instanceof Error ? error.message : "Claim failed";
      toast({ variant: "destructive", title: "Claim failed", description: message });
    },
  });
  useEffect(() => {
    claimAsRecipientMutation.reset();
    // Only reset when navigating to a different payment link (reset is stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const [burnerDiagLoading, setBurnerDiagLoading] = useState(false);
  const [retrySweepLoading, setRetrySweepLoading] = useState(false);
  const [reclaimingSenderFunds, setReclaimingSenderFunds] = useState(false);
  const [claimInitiated, setClaimInitiated] = useState(false);
  const [claimCompleted, setClaimCompleted] = useState(false);
  const confettiFiredRef = React.useRef(false);
  const [optimisticClaimedAt, setOptimisticClaimedAt] = useState<string | null>(null);

  // Poll claim status while mutation is pending (catches cases where HTTP response is lost
  // but the backend already processed the claim and balance has updated).
  useEffect(() => {
    if (!claimInitiated || !claimAsRecipientMutation.isPending || claimCompleted) return;
    const interval = setInterval(() => {
      // exact: true — a fuzzy match here also refetches the recipient-check subquery,
      // which flips isCheckingRecipient true and flashes the loading skeleton every 4s.
      queryClient.refetchQueries({ queryKey: ["claim", id], exact: true });
    }, 4000);
    return () => clearInterval(interval);
  }, [claimInitiated, claimAsRecipientMutation.isPending, claimCompleted, id, queryClient]);

  // Auto-detect success from polled claim status.
  useEffect(() => {
    if (!claimInitiated || !claimAsRecipientMutation.isPending || claimCompleted) return;
    const currentStatus = String(claim?.status || "").toUpperCase();
    if (["SUCCESS", "CLAIMED"].includes(currentStatus)) {
      setClaimCompleted(true);
    }
  }, [claim?.status, claimInitiated, claimAsRecipientMutation.isPending, claimCompleted]);

  // Trigger balance refetch and confetti whenever claimCompleted first becomes true.
  useEffect(() => {
    if (!claimCompleted || confettiFiredRef.current) return;
    confettiFiredRef.current = true;
    const end = Date.now() + 2200;
    const colors = ["#FF1301", "#EAB308", "#22c55e", "#a855f7", "#3b82f6"];
    (function frame() {
      confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors });
      confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    refreshWalletBalances();
  }, [claimCompleted, queryClient]);

  useEffect(() => {
    if (!claimAsRecipientMutation.isSuccess) return;
    if (confettiFiredRef.current) return;
    confettiFiredRef.current = true;
    const end = Date.now() + 2200;
    const colors = ["#FF1301", "#EAB308", "#22c55e", "#a855f7", "#3b82f6"];
    (function frame() {
      confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors });
      confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [claimAsRecipientMutation.isSuccess]);

  useEffect(() => {
    if (claimAsRecipientMutation.isPending) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [claimAsRecipientMutation.isPending]);
  const [burnerDiag, setBurnerDiag] = useState<{
    claimId: string;
    claimStatus: string;
    isPrivate: boolean;
    paidWithToken: string | null;
    paidWithChain: string | null;
    burnerAddress: string | null;
    burnerUsdcRaw: string;
    burnerUsdc: string;
    perDepositDetected?: boolean;
    perWithdrawAttempted?: boolean;
    perDepositAmountRaw?: string;
    perWithdrawError?: string | null;
    perDebugLog?: string[];
    recipientWallet: string | null;
  } | null>(null);
  const runBurnerTroubleshoot = async () => {
    if (!user?.id) {
      toast({ variant: "destructive", title: "Login required", description: "Sign in to run diagnostics." });
      return;
    }
    setBurnerDiagLoading(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const diagToken = await getAccessToken();
      const r = await fetch(`${backendUrl}/claims/${id}/troubleshoot-burner`, {
        headers: diagToken ? { Authorization: `Bearer ${diagToken}` } : {},
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.message || `Diagnostics failed: ${r.status}`);
      }
      const data = await r.json();
      setBurnerDiag(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not run diagnostics";
      toast({ variant: "destructive", title: "Diagnostics failed", description: msg });
    } finally {
      setBurnerDiagLoading(false);
    }
  };
  const retryClaimSweep = async () => {
    if (!user?.id) {
      toast({ variant: "destructive", title: "Login required", description: "Sign in to retry claim sweep." });
      return;
    }
    setRetrySweepLoading(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const sweepToken = await getAccessToken();
      const r = await fetch(`${backendUrl}/claims/${id}/claim-retry-sweep`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sweepToken ? { Authorization: `Bearer ${sweepToken}` } : {}),
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.message || `Retry sweep failed: ${r.status}`);
      }
      const data = await r.json();
      if (data?.swept && data?.sweptAmount) {
        toast({ title: "Claim sweep completed", description: `$${data.sweptAmount} USDC moved to your wallet.` });
      } else {
        toast({ title: "No funds to sweep", description: "Burner currently has no USDC in ATA. For private PER payments, funds may still be in PER state." });
      }
      await runBurnerTroubleshoot();
      queryClient.invalidateQueries({ queryKey: ["claim", id], exact: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not retry sweep";
      toast({ variant: "destructive", title: "Retry sweep failed", description: msg });
    } finally {
      setRetrySweepLoading(false);
    }
  };
  const reclaimBySender = async () => {
    if (!user?.id) {
      toast({ variant: "destructive", title: "Login required", description: "Sign in to reclaim funds." });
      return;
    }
    setReclaimingSenderFunds(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const reclaimToken = await getAccessToken();
      const r = await fetch(`${backendUrl}/claims/${id}/reclaim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(reclaimToken ? { Authorization: `Bearer ${reclaimToken}` } : {}),
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.message || `Reclaim failed: ${r.status}`);
      }
      toast({ title: "Withdraw/reclaim sent", description: "We attempted PER withdraw and return to your wallet." });
      await runBurnerTroubleshoot();
      queryClient.invalidateQueries({ queryKey: ["claim", id], exact: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reclaim funds";
      toast({ variant: "destructive", title: "Reclaim failed", description: msg });
    } finally {
      setReclaimingSenderFunds(false);
    }
  };
  // Phase 2 = recipient has already claimed (wallet linked). Phase 1 = sender paid, burner in-flight.
  const ALREADY_COMPLETE_STATUSES = ["SUCCESS", "CLAIMED", "FUNDED"];

  // Log claim + intent when data loads or updates
  useEffect(() => {
    if (!claimData) return;
    console.log("[Claim] Data loaded/updated", {
      claimId: claim?.id,
      claimStatus: claim?.status,
      isPrivate: claim?.is_private,
      amount: claim?.amount,
      toSymbol: claim?.to_symbol,
      toChain: claim?.to_chain,
      intentStatus: latestIntentData?.status,
      intentDepositAddress: latestIntentData?.depositAddress ? latestIntentData.depositAddress.slice(0, 12) + "…" : null,
    });
  }, [claimData, claim?.id, claim?.status, claim?.is_private, claim?.amount, claim?.to_symbol, claim?.to_chain, latestIntentData?.status, latestIntentData?.depositAddress]);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [deposit, setDeposit] = useState<any>(null);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string; usd?: number; est?: number } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Covers the plain "already claimed" view (isRecipient + SUCCESS, no pending flags) —
  // reachable directly via optimistic status updates or a fresh page load without ever
  // passing through the claimCompleted branch above, so it needs its own refresh trigger.
  const staticSuccessBalanceRefreshedRef = React.useRef(false);
  useEffect(() => {
    const alreadyClaimedStatically =
      isRecipient &&
      !claim?.recipient_pending_email &&
      !claim?.recipient_pending_username &&
      String(status || claim?.status || "").toUpperCase() === "SUCCESS";
    if (!alreadyClaimedStatically || staticSuccessBalanceRefreshedRef.current) return;
    staticSuccessBalanceRefreshedRef.current = true;
    refreshWalletBalances();
  }, [isRecipient, claim?.recipient_pending_email, claim?.recipient_pending_username, status, claim?.status]);

  const [statusData, setStatusData] = useState<any>(null);
  const [paidFeeUsdc, setPaidFeeUsdc] = useState<number | null>(null);
  const [paidFeeBreakdown, setPaidFeeBreakdown] = useState<{ looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number } | null>(null);
  const [speedUpOpen, setSpeedUpOpen] = useState<boolean>(false);
  const [txInput, setTxInput] = useState<string>("");
  const [submittingTx, setSubmittingTx] = useState<boolean>(false);
  const [isPrivateMode, setIsPrivateMode] = useState<boolean>(false);
  const [showPrivacyTutorial, setShowPrivacyTutorial] = useState<boolean>(false);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const [refundAddress, setRefundAddress] = useState<string>("");
  const [refundAddressError, setRefundAddressError] = useState<string | null>(null);
  const hasUpdatedClaimStatus = React.useRef<string | null>(null); // Track if we've already updated DB for this status
  const userCancelled = React.useRef<boolean>(false); // Track if user manually cancelled to prevent re-hydration
  const privateTransferTriggeredRef = React.useRef<Set<string>>(new Set()); // Auto-run private PER transfer once per claim when PRIVATE_TRANSFER_PENDING
  const onPayPrivatelyRef = React.useRef<(() => Promise<void>) | null>(null);
  const { wallets } = useEvmWallets();
  const [showPayNowModal, setShowPayNowModal] = useState(false);
  const [payingWithLoofta, setPayingWithLoofta] = useState(false);
  const [payWithLooftaError, setPayWithLooftaError] = useState<string | null>(null);
  const [payingWithWallet, setPayingWithWallet] = useState(false);
  const [payWithWalletError, setPayWithWalletError] = useState<string | null>(null);
  const [lastFailedPayMethod, setLastFailedPayMethod] = useState<"loofta" | "wallet" | null>(null);
  /** Actual fee confirmed by onTxBuilt — replaces the estimate once the tx is built. */
  const [pendingFeeUsdc, setPendingFeeUsdc] = useState<number | null>(null);
  /** True while silently pre-building tx to get real fee before modal opens. */
  const [preBuilding, setPreBuilding] = useState(false);
  /** When set, we're waiting for on-chain confirmation; show tracker UI in Pay Now modal. */
  const [confirmingTxSignature, setConfirmingTxSignature] = useState<string | null>(null);
  const [confirmingTxSource, setConfirmingTxSource] = useState<"loofta" | "wallet" | null>(null);
  /** MagicBlock PER: signing popup + sequential broadcast (stay on page). */
  const [perTransferPhase, setPerTransferPhase] = useState<PerTransferProgress | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paymentCompleteCopied, setPaymentCompleteCopied] = useState(false);
  const { wallets: solanaStandardWallets } = useSolanaWallets();
  const { signTransaction: privySolanaSignTransaction } = usePrivySolanaSignTransaction();
  const solanaPayment = useSolanaPayment({ enabled: authenticated });
  const { transfer: perTransfer } = usePerPrivateTransfer();

  /** Overlay / Escape / close must not dismiss Pay Now while Privy, Phantom, or confirmation is in flight. */
  const payNowModalDismissLocked =
    confirmingTxSignature !== null || payingWithLoofta || payingWithWallet || perTransferPhase !== null;

  // fee_on_sender: true (default) = fees charged on top of amount; false = fees deducted from amount
  const isFeeOnSender = (claim as any)?.fee_on_sender !== false;
  // requiresPrivate: false only when claim was explicitly created as non-private
  const requiresPrivate = claim ? (claim as any).is_private !== false : true;
  const privateRequired = requiresPrivate;
  const privatePayActive = requiresPrivate;
  const isCreatorView = !!user?.id && claim?.created_by === user.id;
  const isSenderPendingFundedView =
    isCreatorView &&
    isPendingRecipientClaim &&
    ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CLAIMED"].includes(String(status || claim?.status || "").toUpperCase());
  /** Only hide payer UI for the intended recipient (pending claim flow). Do not hide for anonymous/other payers when recipient_is_registered is set. */
  const hidePaySectionForPendingClaimant =
    isPendingRecipientClaim && isRecipient && !isCreatorView;

  // Auto-set private mode when private-only is required globally or by claim.
  useEffect(() => {
    if (privateRequired) {
      setIsPrivateMode(true);
    }
  }, [privateRequired]);

  // Refresh Loofta balance every time the Pay Now modal opens so the displayed amount is current.
  useEffect(() => {
    if (!showPayNowModal) return;
    queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
    queryClient.invalidateQueries({ queryKey: ["solanaPaymentBalance"] });
  }, [showPayNowModal, queryClient]);

  const selectedFrom = findTokenBySelection(tokens, fromSel || null);
  const destToken = useMemo(() => {
    if (!claim?.to_symbol || !claim?.to_chain) return null;
    // Try exact match first
    let token = tokens.find(t =>
      t.symbol?.toUpperCase() === claim.to_symbol.toUpperCase() &&
      t.chain?.toLowerCase() === claim.to_chain.toLowerCase()
    );
    // If not found, try with chain aliases (sol/solana, eth/ethereum, etc.)
    if (!token) {
      const chainAliases: Record<string, string[]> = {
        'sol': ['solana', 'sol'],
        'solana': ['sol', 'solana'],
        'eth': ['ethereum', 'eth'],
        'ethereum': ['eth', 'ethereum'],
      };
      const chainLower = claim.to_chain.toLowerCase();
      const aliases = chainAliases[chainLower] || [chainLower];
      token = tokens.find(t =>
        t.symbol?.toUpperCase() === claim.to_symbol.toUpperCase() &&
        aliases.some(alias => t.chain?.toLowerCase() === alias.toLowerCase())
      );
    }
    return token || null;
  }, [tokens, claim?.to_symbol, claim?.to_chain]);

  const destUSD = useMemo(() => {
    const amt = Number(claim?.amount || 0);
    return Number.isFinite(amt) ? amt : null;
  }, [claim?.amount]);
  const destTokenAmount = useMemo(() => {
    const usd = Number(claim?.amount || 0);
    const p = typeof destToken?.price === "number" ? destToken.price : null;
    if (!Number.isFinite(usd) || !p || p <= 0) return null;
    return usd / p;
  }, [claim?.amount, destToken?.price]);
  const sameChain = useMemo(() => {
    if (!selectedFrom || !destToken) return false;
    return String(selectedFrom.chain || "").toLowerCase() === String(destToken.chain || "").toLowerCase();
  }, [selectedFrom, destToken]);
  // Check if same token AND same chain (direct transfer, no swap needed)
  const sameTokenAndChain = useMemo(() => {
    if (!selectedFrom || !destToken || !sameChain) return false;
    return String(selectedFrom.symbol || "").toLowerCase() === String(destToken.symbol || "").toLowerCase();
  }, [selectedFrom, destToken, sameChain]);

  // Swap (Rhinestone/Biconomy) is not used — only USDC on Solana (Pay with Loofta / Use wallet)
  const destChainSupportsSwap = false;
  const supportedSwapTokens: string[] = [];

  // Filter tokens to show: 
  // - For same-chain EVM: only show supported tokens (ETH, WETH, USDC, USDT)
  // - For non-EVM same-chain: only show the destination token (same token required)
  // - For cross-chain: show all tokens
  const filteredTokens = useMemo(() => {
    if (!destToken?.chain || !destToken?.symbol) return tokens;

    const destChainLower = String(destToken.chain).toLowerCase();
    const isNonEvmDest = ['sol', 'solana', 'btc', 'bitcoin', 'zec', 'zcash', 'xrp', 'xlm', 'ton', 'sui'].includes(destChainLower);

    const mapped = tokens.map(t => {
      const tokenChainLower = String(t.chain || "").toLowerCase();
      const isSameChain = tokenChainLower === destChainLower;

      if (isSameChain) {
        // Same chain scenario
        if (isNonEvmDest) {
          // Non-EVM: Must use same token
          const isSameToken = String(t.symbol || "").toUpperCase() === String(destToken.symbol || "").toUpperCase();
          if (!isSameToken) {
            // Mark as unsupported but keep in list with warning
            return { ...t, _unsupported: true, _reason: `Only ${destToken.symbol} accepted on ${destToken.chain}` };
          }
        } else if (destChainSupportsSwap) {
          // EVM with swap support: only supported tokens
          const isSupported = supportedSwapTokens.includes(String(t.symbol || "").toUpperCase());
          if (!isSupported) {
            return { ...t, _unsupported: true, _reason: `${t.symbol} not supported for swap. Use ETH, WETH, USDC, or USDT.` };
          }
        }
      }

      return t;
    });
    // Exclude Solana/SOL from token combobox options only (USDC on Solana remains as the card option)
    return mapped.filter(t => {
      const c = String(t.chain || "").toLowerCase();
      return c !== "sol" && c !== "solana";
    });
  }, [tokens, destToken, destChainSupportsSwap, supportedSwapTokens]);

  // Find USDC token on Solana for private mode
  const usdcSolanaToken = useMemo(() => {
    return tokens.find(t => t.symbol.toUpperCase() === 'USDC' && (t.chain === 'solana' || t.chain === 'sol'));
  }, [tokens]);

  // Auto-select USDC on Solana once the token list is ready
  useEffect(() => {
    if (!usdcSolanaToken || fromSel) return;
    setFromSel({ symbol: usdcSolanaToken.symbol, chain: usdcSolanaToken.chain });
  }, [usdcSolanaToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rhinestone and Biconomy are not used — only USDC on Solana (Pay with Loofta / Use wallet) is supported
  const swapProviderEligible = false;
  // Derive payer token from status originAsset if available, or from claim.is_private for private payments
  const paidToken = useMemo(() => {
    // For private payments, return USDC on Solana
    if (claim?.is_private) {
      return usdcSolanaToken || null;
    }

    // Otherwise, derive from statusData
    const assetId = statusData?.originAsset as string | undefined;
    if (!assetId || !Array.isArray(tokens) || !tokens.length) return null;
    const t = tokens.find(tk => {
      const id = tk.tokenId || tk.address;
      return String(id || "").toLowerCase() === String(assetId || "").toLowerCase();
    });
    return t || null;
  }, [statusData?.originAsset, tokens, claim?.is_private, usdcSolanaToken]);

  // Hydrate UI state from persisted zustand on mount
  useEffect(() => {
    const entry = useClaimPayStore.getState().byId[id];
    if (entry?.fromSel) setFromSel(entry.fromSel as any);
    if (entry?.deposit) setDeposit(entry.deposit);
    if (entry?.status) {
      console.log("[Claim] Hydrating status from store:", { claimId: id, status: entry.status });
      setStatus(entry.status);
    }
    if (entry?.refundAddress) setRefundAddress(entry.refundAddress);
    if (entry?.claimed) setClaimInitiated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);


  // Hydrate from latest-intent cache (skip if user manually cancelled)
  useEffect(() => {
    // Don't re-hydrate if user cancelled
    if (userCancelled.current) return;

    const d: any = latestIntentData;
    if (!d) return;
    // Set deposit if we have a depositAddress and haven't set it yet
    if (d?.depositAddress && !deposit) {
      const dep = {
        depositAddress: d.depositAddress,
        memo: d.memo ?? null,
        deadline: d.deadline,
        quoteId: d.quoteId,
        minDepositFormatted: d.minDepositFormatted,
      };
      setDeposit(dep);
      useClaimPayStore.getState().setDeposit(id, dep as any);
    }
    // Set status from intent only when we don't have one yet, and avoid showing
    // "Deposit failed" when the claim is still in progress (e.g. intent failed from
    // an expired quote but claim is still PENDING_DEPOSIT and user can get a new intent).
    if (d?.status && !status) {
      const s = String(d.status).toUpperCase();
      const intentTerminal = s === "FAILED" || s === "REFUNDED";
      const claimInProgress = claim?.status
        ? ["PENDING", "PENDING_DEPOSIT", "IN_FLIGHT", "CREATED"].includes(String(claim.status).toUpperCase())
        : false;
      if (intentTerminal && claimInProgress) {
        // Don't set FAILED/REFUNDED from intent when claim is still in progress
        return;
      }
      console.log("[Claim] Setting status from intent/deposit:", { claimId: id, status: s, from: "latestIntentData/deposit" });
      setStatus(s);
      useClaimPayStore.getState().setStatus(id, s);
    }
  }, [latestIntentData, deposit, status, id, claim?.status]);

  // Hydrate status from claim data (for cross-device support and after refetch)
  useEffect(() => {
    if (!claim?.status) return;
    const claimStatus = String(claim.status).toUpperCase();
    // Map database status to UI status
    const statusMap: Record<string, string> = {
      "SUCCESS": "SUCCESS",
      "IN_FLIGHT": "IN_FLIGHT",
      "PENDING_DEPOSIT": "PENDING_DEPOSIT",
      "PRIVATE_TRANSFER_PENDING": "PRIVATE_TRANSFER_PENDING",
      "REFUNDED": "FAILED",
      "FAILED": "FAILED",
      "EXPIRED": "FAILED",
      "CANCELLED": "FAILED",
    };
    const mappedStatus = statusMap[claimStatus] || claimStatus;

    // Update status if:
    // 1. We don't have a status yet, OR
    // 2. The claim status is SUCCESS (always sync SUCCESS from DB)
    // 3. The claim status changed to a terminal state or PRIVATE_TRANSFER_PENDING
    // 4. Claim is in progress (PENDING_DEPOSIT etc.) and we're currently showing FAILED/REFUNDED (fix flicker)
    const isTerminalStatus = ["SUCCESS", "FAILED", "REFUNDED"].includes(mappedStatus);
    const claimInProgress = ["PENDING_DEPOSIT", "IN_FLIGHT", "PRIVATE_TRANSFER_PENDING"].includes(mappedStatus);
    const showingStaleFailure = status === "FAILED" || status === "REFUNDED";
    const shouldSync =
      (!status || mappedStatus === "SUCCESS" || mappedStatus === "PRIVATE_TRANSFER_PENDING" || isTerminalStatus || (claimInProgress && showingStaleFailure))
      && mappedStatus !== "PENDING"
      && mappedStatus !== "CREATED";
    if (shouldSync && status !== mappedStatus) {
      console.log(`[Claim Status] Syncing status from DB: ${status} -> ${mappedStatus}`);
      setStatus(mappedStatus);
      useClaimPayStore.getState().setStatus(id, mappedStatus);
    }
  }, [claim?.status, status, id]);

  useEffect(() => {
    (async () => {
      setQuote(null);
      if (!claim || !selectedFrom || sameTokenAndChain) {
        setQuoteLoading(false);
        return;
      }
      setQuoteLoading(true);
      try {
        const r = await fetch(`/api/claims/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId: id,
            fromToken: { tokenId: selectedFrom.tokenId || selectedFrom.address, decimals: selectedFrom.decimals, chain: selectedFrom.chain, price: selectedFrom.price },
            destToken: { tokenId: destToken?.tokenId || destToken?.address, decimals: destToken?.decimals, chain: destToken?.chain, price: destToken?.price },
            fromTokenPriceUSD: selectedFrom?.price,
            destTokenPriceUSD: destToken?.price,
            // For quotes, always use a generated mock refund address (user field is only used for real deposit)
            refundAddress: getRefundToForChain(selectedFrom.chain),
          }),
        });
        const data = await r.json();
        if (r.ok) {
          if (data?.amountInFormatted) setQuote({ amountInFormatted: data.amountInFormatted });
          else {
            const usd = typeof data?.amountInUSD === "number" ? data.amountInUSD : undefined;
            const est = typeof data?.amountInEst === "number" ? data.amountInEst : undefined;
            setQuote({ usd, est });
          }
        } else {
          // Fallback: try simple calculation if we have token price
          if (selectedFrom.price && selectedFrom.price > 0 && claim?.amount) {
            const amountUsd = parseFloat(claim.amount);
            const tokenPrice = selectedFrom.price;
            const tokenAmount = amountUsd / tokenPrice;
            setQuote({ amountInFormatted: tokenAmount.toFixed(6) });
          }
        }
      } catch (e) {
        console.error("[Claim] Failed to fetch quote:", e);
        // Fallback: try simple calculation if we have token price
        if (selectedFrom.price && selectedFrom.price > 0 && claim?.amount) {
          const amountUsd = parseFloat(claim.amount);
          const tokenPrice = selectedFrom.price;
          const tokenAmount = amountUsd / tokenPrice;
          setQuote({ amountInFormatted: tokenAmount.toFixed(6) });
        }
      } finally {
        setQuoteLoading(false);
      }
    })();
  }, [id, claim, selectedFrom, destToken?.tokenId, destToken?.price, destToken?.decimals, sameTokenAndChain]);

  async function onPrepare() {
    // Prevent double payment - check if claim is already paid
    const currentStatus = String(status || claim?.status || "").toUpperCase();
    if (currentStatus === "SUCCESS") {
      toast({
        variant: "destructive",
        title: "Already paid",
        description: "This claim has already been paid.",
      });
      return;
    }

    // Enforce private mode if claim requires it
    if (claim?.is_private && !isPrivateMode) {
      toast({
        variant: "destructive",
        title: "Private payment required",
        description: "This payment link requires private payments only. Please use the private payment option.",
      });
      setIsPrivateMode(true);
      return;
    }

    if (!claim || !selectedFrom) return;

    // User MUST provide a real refund address for the actual deposit
    if (!refundAddress.trim()) {
      setRefundAddressError("Please enter a refund address");
      toast({ variant: "destructive", title: "Error", description: "Please enter a refund address for refunds." });
      return;
    }

    const finalRefundAddress = refundAddress.trim();

    // Validate refund address format
    if (!isValidAddressForChain(finalRefundAddress, selectedFrom.chain)) {
      setRefundAddressError(`Invalid ${selectedFrom.chain} address format`);
      toast({ variant: "destructive", title: "Error", description: `Invalid refund address format for ${selectedFrom.chain.toUpperCase()}.` });
      return;
    }

    // Reset cancelled flag when starting new deposit
    userCancelled.current = false;
    setPreparing(true);
    setDeposit(null);
    setRefundAddressError(null);
    try {
      useClaimPayStore.getState().setFromSel(id, { symbol: selectedFrom.symbol, chain: selectedFrom.chain } as any);

      // If same token AND same chain, use recipient address (or burner for pending claims) directly (no swap needed)
      const effectiveRecipient = getEffectiveRecipient(claim);
      if (sameTokenAndChain && effectiveRecipient) {
        const directDeposit = {
          depositAddress: effectiveRecipient,
          memo: undefined,
          deadline: undefined,
          quoteId: undefined,
          minDepositFormatted: destTokenAmount ? String(destTokenAmount) : claim.amount,
        };
        setDeposit({ ...directDeposit, isDirect: true });
        useClaimPayStore.getState().setDeposit(id, directDeposit);
        toast({ title: "Direct transfer", description: "Same token & chain - send directly to recipient" });
        return;
      }

      // Get user's wallet address for intents mode
      const userWalletAddress = wallets[0]?.address;

      // Determine if this is a private payment
      const isPrivatePayment = privateRequired || isPrivateMode;

      // For private cross-chain to Solana: use Phantom wallet (USDC-on-Solana payments use Phantom, not Privy)
      const destChainLower = (claim.to_chain || '').toLowerCase();
      const isPrivateCrossChainToSolana = isPrivatePayment && (destChainLower === 'solana' || destChainLower === 'sol') && claim.to_symbol === 'USDC';
      let solanaAddress: string | undefined;
      if (isPrivateCrossChainToSolana) {
        const phantom = getPhantomProvider();
        if (phantom) {
          if (phantom.publicKey) {
            solanaAddress = phantom.publicKey.toBase58();
          } else if (phantom.connect) {
            try {
              const { publicKey } = await phantom.connect();
              solanaAddress = publicKey.toBase58();
            } catch (_e) {
              // User cancelled or connect failed
            }
          }
          if (solanaAddress) {
            console.log("[Claim] Prepare: private cross-chain to Solana, recipientSolanaAddress (Phantom):", solanaAddress.slice(0, 8) + "…");
          }
        }
        if (!solanaAddress) {
          console.log("[Claim] Prepare: private cross-chain to Solana but Phantom not available or not connected");
          toast({
            variant: "destructive",
            title: "Phantom wallet required",
            description: "Install and connect Phantom to pay with USDC on Solana. Funds will be sent to your Phantom address.",
          });
          setPreparing(false);
          return;
        }
      }

      const res = await prepareDeposit({
        claimId: id,
        claim: {
          id: claim.id,
          amount: claim.amount,
          to_symbol: claim.to_symbol,
          to_chain: claim.to_chain,
          recipient_address: getEffectiveRecipient(claim),
        },
        fromToken: { tokenId: selectedFrom.tokenId || selectedFrom.address, decimals: selectedFrom.decimals, chain: selectedFrom.chain, symbol: selectedFrom.symbol },
        amount: claim.amount,
        userAddress: userWalletAddress,
        refundAddress: finalRefundAddress,
        isPrivate: isPrivatePayment,
        ...(isPrivateCrossChainToSolana && solanaAddress && { recipientSolanaAddress: solanaAddress }),
      });

      // Handle different response types
      if (res.directTransfer) {
        // Same chain, same token - direct to recipient
        setDeposit({
          ...res,
          isDirect: true,
          minAmountInFormatted: res.amount,
        });
        toast({ title: "Direct transfer", description: "Same token & chain - send directly to recipient" });
      } else if (res.sameChainSwap) {
        // Same chain, different token - companion wallet swap
        setDeposit({
          ...res,
          isCompanionSwap: true,
          minAmountInFormatted: res.estimatedTotal,
        });
        toast({ title: "Swap enabled", description: `Send ${res.depositToken} to companion wallet. We'll swap to ${claim.to_symbol} for you.` });
      } else {
        // Cross-chain via NEAR Intents
        setDeposit(res);
      }

      useClaimPayStore.getState().setDeposit(id, {
        depositAddress: res.depositAddress,
        memo: res.memo ?? null,
        deadline: res.deadline,
        quoteId: res.quoteId,
        minDepositFormatted: res.minDepositFormatted,
        minAmountInFormatted: res.minAmountInFormatted, // Add the actual amount to send
      });
    } catch (e: any) {
      // Handle specific error codes with better messages
      const errorCode = e?.code || "";
      let errorMessage = e?.message || "Could not obtain deposit info";

      if (errorCode === "NON_EVM_SAME_TOKEN_REQUIRED") {
        errorMessage = `For this network, you must pay with ${claim?.to_symbol}. Cross-token swaps are only available on EVM chains.`;
      } else if (errorCode === "TOKENS_NOT_SUPPORTED") {
        errorMessage = "This token pair is not supported for swaps. Try ETH, WETH, USDC, or USDT.";
      } else if (errorCode === "CHAIN_NOT_SUPPORTED") {
        errorMessage = "This chain is not supported for swaps. Supported: Ethereum, Base, Optimism, Arbitrum, Polygon, zkSync.";
      } else if (errorCode === "ROUTE_NOT_AVAILABLE") {
        errorMessage = "Route not available. Please try another token or network.";
      }

      toast({ variant: "destructive", title: "Failed to prepare", description: errorMessage });
    } finally {
      setPreparing(false);
    }
  }

  async function onPayPrivately() {
    console.log("[PrivateTransfer] onPayPrivately called", { claimId: claim?.id, authenticated });
    // Enforce private mode if claim requires it
    if (claim?.is_private && !isPrivateMode) {
      console.log("[PrivateTransfer] Enforcing private mode");
      setIsPrivateMode(true);
      toast({
        variant: "destructive",
        title: "Private payment required",
        description: "This payment link requires private payments only.",
      });
      return;
    }

    if (!claim || !usdcSolanaToken) {
      console.log("[PrivateTransfer] Early exit: no claim or usdcSolanaToken");
      toast({ variant: "destructive", title: "Error", description: "Private payment requires USDC on Solana." });
      return;
    }

    // For registered recipients, the backend resolves the real wallet server-side (no burner stored).
    // For pending recipients, the burner holds funds until they sign up and claim.
    const burnerAddr = ((claim as { claim_burner_address?: string }).claim_burner_address || "").trim();
    const isRegisteredRecipient = !!(claim as { recipient_is_registered?: boolean }).recipient_is_registered;
    const isBurnerRecipient = !!burnerAddr;
    const hasRecipient = isBurnerRecipient || isRegisteredRecipient;
    if (!hasRecipient) {
      console.log("[PrivateTransfer] Early exit: no recipient");
      toast({ variant: "destructive", title: "Missing recipient", description: "Recipient address is not available for this claim." });
      return;
    }

    const requestedAmount = parseFloat(claim.amount);
    if (!requestedAmount || requestedAmount <= 0) {
      console.log("[PrivateTransfer] Early exit: invalid amount", { amount: claim.amount });
      toast({ variant: "destructive", title: "Invalid amount", description: "Please enter a valid amount." });
      return;
    }

    // Total USDC to send: claim amount only (no Privacy Cash rent / withdraw-fee gross-up)
    const amountUSD = requestedAmount;

    console.log("[PrivateTransfer] Starting", { claimId: claim.id, amountUSD });
    setPreparing(true);

    try {
      if (!user?.id) {
        toast({ variant: "destructive", title: "Log in required", description: "Sign in to complete a private transfer." });
        setPreparing(false);
        return;
      }
      const phantom = getPhantomProvider();
      if (!phantom) {
        toast({
          variant: "destructive",
          title: "Phantom wallet required",
          description: "Install the Phantom browser extension to pay with USDC on Solana.",
        });
        setPreparing(false);
        return;
      }

      let publicKey: PublicKey;
      try {
        const res = phantom.publicKey ? { publicKey: phantom.publicKey } : await phantom.connect();
        publicKey = res.publicKey;
      } catch (e) {
        console.warn("[PrivateTransfer] Phantom connect failed:", e);
        toast({
          variant: "destructive",
          title: "Phantom connection failed",
          description: "Please connect your Phantom wallet and try again.",
        });
        setPreparing(false);
        return;
      }

      console.log("[PrivateTransfer] Using Phantom wallet:", publicKey.toBase58().slice(0, 8) + "…");

      const anchorWallet = phantomWalletToAnchorWallet({
        publicKey,
        signTransaction: async (tx: Transaction) => {
          const signed = await phantom.signTransaction(tx as unknown as VersionedTransaction);
          return signed as unknown as Transaction;
        },
      });
      console.log("[PrivateTransfer] Calling private transfer…", { isBurnerRecipient });
      const perToken = await getAccessToken();
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const authHeader: Record<string, string> = perToken
        ? { Authorization: `Bearer ${perToken}` }
        : {};

      // Saved immediately after sendRawTransaction, before confirmation polling.
      let broadcastedSignature: string | null = null;

      let signature: string;
      try {
        signature = await perTransfer(anchorWallet, {
          privyUserId: user.id,
          accessToken: perToken,
          claimId: claim.id,
          isBurnerRecipient,
          onTxBuilt: ({ feeAmountUsdc, feeBreakdown }) => {
            setPaidFeeUsdc(feeAmountUsdc);
            if (feeBreakdown) setPaidFeeBreakdown(feeBreakdown);

          },
          onSignature: async (sig) => {
            broadcastedSignature = sig;
            // Fire-and-forget — don't block the confirmation flow
            fetch(`${backendUrl}/claims/${claim.id}/tx-hash`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...authHeader },
              body: JSON.stringify({ txHash: sig }),
            }).catch((e) => console.warn("[PrivateTransfer] Failed to save tx hash early:", e));
          },
        });
      } catch (confirmErr: any) {
        // If the tx was broadcast but RPC confirmation failed, the signature is already saved
        // in the backend. Mark the claim as pending instead of showing a hard failure.
        if (broadcastedSignature) {
          console.warn("[PrivateTransfer] Confirmation polling failed but tx was broadcast — marking as pending:", confirmErr?.message);
          toast({
            title: "Transfer submitted!",
            description: "Your payment was sent. Confirmation is taking longer than usual — it will update automatically.",
          });
          await updateClaimStatus(
            claim.id,
            "PRIVATE_TRANSFER_PENDING",
            {
              txHash: broadcastedSignature,
              paidWith: "USDC (Private)",
              isPrivate: true,
              paidWithToken: "USDC",
              paidWithChain: "solana",
            },
            perToken,
          );
          setStatus("PRIVATE_TRANSFER_PENDING");
          useClaimPayStore.getState().setStatus(id, "PRIVATE_TRANSFER_PENDING");
          await claimQuery.refetch();
          return;
        }
        throw confirmErr;
      }

      console.log("[PrivateTransfer] PER transfer signature:", signature);
      toast({
        title: "Transfer submitted!",
        description: `Your private transfer is processing — ${privatePaymentFundsAppearCopy()}`,
      });
      await updateClaimStatus(
        claim.id,
        "SUCCESS",
        {
          txHash: signature,
          paidWith: "USDC (Private)",
          isPrivate: true,
          paidWithToken: "USDC",
          paidWithChain: "solana",
          ...(paidFeeUsdc != null ? { feeAmountUsdc: paidFeeUsdc } : {}),
          ...(paidFeeBreakdown ? { feeBreakdown: paidFeeBreakdown } : {}),
        },
        perToken,
      );
      setStatus("SUCCESS");
      useClaimPayStore.getState().setStatus(id, "SUCCESS");
      await claimQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
      queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      queryClient.invalidateQueries({ queryKey: ["solanaPaymentBalance"] });
      queryClient.refetchQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      queryClient.refetchQueries({ queryKey: ["solanaPaymentBalance"] });
      // Second refetch after a short delay in case the RPC hasn't indexed the tx yet.
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
        queryClient.refetchQueries({ queryKey: ["solanaPaymentBalance"] });
      }, 4000);
      console.log("[PrivateTransfer] Claim refetched, flow complete");
    } catch (error: any) {
      console.error("[PrivateTransfer] Error:", error);
      toast({ variant: "destructive", title: "Payment failed", description: error?.message || "Could not complete private payment" });
    } finally {
      setPreparing(false);
    }
  }

  // Get Solana *embedded* wallet address (must match Privy signer and backend balance)
  // Prefer solana_embedded_wallet / solana type so we don't use a smart_wallet (8McJ...) by mistake
  // Fetch Loofta balance when Pay Now modal is open (for "Pay with Loofta" option).
  // This is USDC only (backend uses getTokenAccountsByOwner for USDC mint).
  // Note: Privy’s confirm modal shows the wallet’s SOL balance (for gas), not USDC — so you may see "$0.00" there even when you have USDC; gas sponsorship covers fees.
  const claimAmountUSD = parseFloat(claim?.amount || "0") || 0;
  const { total: privatePayTotal, protocolFee: privatePayProtocolFee, gasFee: privatePayGasFee } = estimatePrivateTotal(claimAmountUSD);
  const looftaBalanceUSD = solanaPayment.balanceUSD;
  // Sender owes gross USDC (base + privacy fee); check that, not just base.
  // Privy wallets can take a moment to hydrate after login; guard Pay Now until the signer is present.
  const senderAddress = solanaPayment.senderAddress;
  const isPayerWalletReady = !authenticated || !senderAddress || !!solanaStandardWallets?.find((w) => w.address === senderAddress);

  /** Phantom payment path. Pending recipients use burner ATA escrow; registered users use PER. */
  async function payWithWallet(gasless = true) {
    const effectiveRecipient = getEffectiveRecipient(claim);
    const isRegisteredRecipient = !!(claim as { recipient_is_registered?: boolean }).recipient_is_registered;
    if (!claim?.id || (!effectiveRecipient && !isRegisteredRecipient) || !claim?.amount) {
      toast({ variant: "destructive", title: "Missing info", description: "Claim or recipient address is missing." });
      return;
    }
    const baseAmount = parseFloat(claim.amount) || 0;
    if (baseAmount <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Claim amount must be greater than 0." });
      return;
    }
    // Amount to send: claim amount only (no Privacy Cash gross-up for private mode)
    const amountUSD = baseAmount;
    const phantom = getPhantomProvider();
    if (!phantom) {
      toast({ variant: "destructive", title: "Phantom not found", description: "Install the Phantom extension to pay with wallet." });
      return;
    }
    if (!usdcSolanaToken) {
      toast({ variant: "destructive", title: "Token not loaded", description: "USDC on Solana is required. Please try again." });
      return;
    }
    const isPending =
      !!(claim as { recipient_pending_username?: boolean; recipient_pending_email?: boolean })
        ?.recipient_pending_username ||
      (claim as { recipient_pending_email?: boolean })?.recipient_pending_email;
    setPayingWithWallet(true);
    setPayWithWalletError(null);
    setPerTransferPhase({ phase: "preparing" });
    try {
      let publicKey: PublicKey;
      try {
        const res = phantom.publicKey ? { publicKey: phantom.publicKey } : await phantom.connect();
        publicKey = res.publicKey;
      } catch {
        throw new Error("Could not connect Phantom. Please try again.");
      }
      if (!publicKey) throw new Error("Could not get wallet address from Phantom.");

      if (effectiveRecipient) {
        const rawRecipient = effectiveRecipient.replace(/\s/g, "");
        if (/^0x/i.test(rawRecipient)) {
          throw new Error("This payment link is for a different network. Use Pay with Loofta.");
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawRecipient)) {
          throw new Error("Recipient address is not a valid Solana address.");
        }
      }

      const anchorWallet = phantomWalletToAnchorWallet({
        publicKey,
        signTransaction: async (tx: Transaction) => {
          const signed = await phantom.signTransaction(tx as unknown as VersionedTransaction);
          return signed as unknown as Transaction;
        },
      });
      if (!user?.id) {
        throw new Error("Log in to pay with your wallet.");
      }
      const isBurnerWallet = !!((claim as { claim_burner_address?: string }).claim_burner_address || "").trim();
      const walletToken = await getAccessToken();
      let walletFeeUsdc: number | null = null;
      let walletFeeBreakdown: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number } | null = null;
      const sig = await perTransfer(anchorWallet, {
        privyUserId: user.id,
        accessToken: walletToken,
        claimId: claim.id,
        onProgress: setPerTransferPhase,
        isBurnerRecipient: isBurnerWallet,
        gasless,
        onTxBuilt: ({ feeAmountUsdc, feeBreakdown }) => {
          walletFeeUsdc = feeAmountUsdc;
          walletFeeBreakdown = feeBreakdown ?? null;
          setPaidFeeUsdc(feeAmountUsdc);
          setPendingFeeUsdc(feeAmountUsdc);
          if (feeBreakdown) setPaidFeeBreakdown(feeBreakdown);
        },
      });
      setPerTransferPhase(null);
      setConfirmingTxSignature(sig);
      setConfirmingTxSource("wallet");

      const connection = new Connection(getRpcForMode(networkMode), "confirmed");
      const confirmed = await waitForConfirmation(connection, sig, 90_000);
      if (!confirmed) {
        throw new Error(
          "Transaction did not confirm in time. Check Solscan for status."
        );
      }

      console.info("[PayWithWallet] Updating claim status → SUCCESS, tx:", sig);
      await updateClaimStatus(
        claim.id,
        "SUCCESS",
        {
          txHash: sig,
          paidWith: "USDC (Phantom / Private)",
          isPrivate: true,
          paidWithToken: "USDC",
          paidWithChain: "solana",
          ...(walletFeeUsdc != null ? { feeAmountUsdc: walletFeeUsdc } : {}),
          ...(walletFeeBreakdown ? { feeBreakdown: walletFeeBreakdown } : {}),
        },
        walletToken,
      );
      console.info("[PayWithWallet] Claim status updated to SUCCESS");
      setStatus("SUCCESS");
      useClaimPayStore.getState().setStatus(claim.id, "SUCCESS");
      await claimQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
      queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      queryClient.invalidateQueries({ queryKey: ["solanaPaymentBalance"] });
      setShowPayNowModal(false);
      toast({
        title: "Transfer submitted!",
        description: `$${amountUSD.toFixed(2)} USDC sent privately. ${privatePaymentFundsAppearCopy()}`,
      });
    } catch (e: any) {
      console.error("[PayWithWallet] Error:", e);
      const message = e?.message || "Could not complete payment with wallet.";
      setPayWithWalletError(message);
      setLastFailedPayMethod("wallet");
      toast({ variant: "destructive", title: "Payment failed", description: message });
    } finally {
      setPayingWithWallet(false);
      setPerTransferPhase(null);
      setConfirmingTxSignature(null);
      setConfirmingTxSource(null);
    }
  }

  async function preBuildFee(): Promise<number | null> {
    const senderAddress = solanaPayment.senderAddress;
    if (!senderAddress || !claim?.id || !user?.id) return null;
    try {
      const accessToken = await getAccessToken();
      const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";
      const txData = await buildClaimPrivateTransfer(claim.id, user.id, senderAddress, accessToken, apiCluster);
      return txData.feeAmountUsdc ?? null;
    } catch {
      return null;
    }
  }

  async function payWithLooftaBalance(gasless = true) {
    const isPending = !!(claim as { recipient_pending_username?: boolean; recipient_pending_email?: boolean })?.recipient_pending_username || (claim as { recipient_pending_email?: boolean })?.recipient_pending_email;
    console.log("[PayWithLoofta] Clicked:", { claimId: claim?.id, isPending, hasBurner: !!(claim as { claim_burner_address?: string })?.claim_burner_address });
    let effectiveRecipient = getEffectiveRecipient(claim);
    if (!effectiveRecipient && isPending && claim?.id) {
      console.log("[PayWithLoofta] Pending claim missing burner, refetching...", { claimId: claim.id });
      const result = await claimQuery.refetch();
      const freshClaim = (result.data as { claim?: typeof claim } | undefined)?.claim;
      effectiveRecipient = getEffectiveRecipient(freshClaim ?? null);
      console.log("[PayWithLoofta] After refetch:", { hasBurner: !!(freshClaim as { claim_burner_address?: string } | null)?.claim_burner_address, recipientFound: !!effectiveRecipient });
    }
    const isRegisteredRecipient = !!(claim as { recipient_is_registered?: boolean }).recipient_is_registered;
    if (!claim?.id || (!effectiveRecipient && !isRegisteredRecipient) || !claim?.amount) {
      console.warn("[PayWithLoofta] Missing recipient:", { claimId: claim?.id, recipientFound: !!effectiveRecipient, isPending });
      const description = isPending && !effectiveRecipient
        ? "This payment link is for someone who hasn't signed up yet. The burner address could not be loaded — try refreshing the page or use a different browser."
        : "Claim or recipient address is missing.";
      toast({ variant: "destructive", title: "Missing info", description });
      return;
    }
    const baseAmount = parseFloat(claim.amount) || 0;
    if (baseAmount <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Claim amount must be greater than 0." });
      return;
    }
    // Amount to send: claim amount only (no Privacy Cash gross-up for private mode)
    const amountUSD = baseAmount;
    const senderAddress = solanaPayment.senderAddress;
    if (!senderAddress) {
      toast({ variant: "destructive", title: "Wallet not ready", description: "Your Loofta Solana wallet was not found. Try logging in again." });
      return;
    }
    setShowPayNowModal(true);
    setPayingWithLoofta(true);
    setPayWithLooftaError(null);
    try {
      // Normalize and validate Solana recipient (base58) — use burner when recipient not yet claimed
      if (effectiveRecipient) {
        const rawRecipient = effectiveRecipient.replace(/\s/g, "");
        if (/^0x/i.test(rawRecipient)) {
          throw new Error("This payment link is for a different network. Use another payment method.");
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawRecipient)) {
          throw new Error("Recipient address is not a valid Solana address for this payment.");
        }
      }

      const wallet = solanaStandardWallets?.find((w) => w.address === senderAddress);
      if (!wallet) {
        toast({
          variant: "destructive",
          title: "Wallet not ready",
          description: "Could not find your Loofta Solana wallet. Try logging in again.",
        });
        return;
      }

      const connection = new Connection(getRpcForMode(networkMode), "confirmed");
      // Sign silently — user already approved in our modal; no per-tx Privy popup needed.
      const silentSign: Parameters<typeof privyStandardWalletToAnchorWallet>[1] = (input) =>
        privySolanaSignTransaction({ ...input, options: { uiOptions: { showWalletUIs: false } } });
      const anchorWallet = privyStandardWalletToAnchorWallet(wallet, silentSign, getPrivySolanaChainForMode(networkMode));
      const isBurnerForLoofta = !!((claim as { claim_burner_address?: string }).claim_burner_address || "").trim();
      if (!user?.id) {
        throw new Error("Log in to pay with Loofta.");
      }
      setPerTransferPhase({ phase: "preparing" });
      const looFtaToken = await getAccessToken();
      let looftaFeeUsdc: number | null = null;
      let looftaFeeBreakdown: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number } | null = null;
      const chain = getPrivySolanaChainForMode(networkMode);
      const sig = await perTransfer(anchorWallet, {
        privyUserId: user.id,
        accessToken: looFtaToken,
        claimId: claim.id,
        onProgress: setPerTransferPhase,
        isBurnerRecipient: isBurnerForLoofta,
        gasless,
        onTxBuilt: ({ feeAmountUsdc, feeBreakdown }) => {
          looftaFeeUsdc = feeAmountUsdc;
          looftaFeeBreakdown = feeBreakdown ?? null;
          setPaidFeeUsdc(feeAmountUsdc);
          setPendingFeeUsdc(feeAmountUsdc);
          if (feeBreakdown) setPaidFeeBreakdown(feeBreakdown);
        },
        privySignAndSend: async (txBytes) => {
          // MagicBlock gasless=true: the validator is already the fee payer (pre-signed).
          // Use sign-only so Privy doesn't run a gas-policy SOL-balance preflight check.
          // We broadcast directly after signing.
          console.info("[PrivySign] signing tx", {
            walletAddress: wallet.address,
            chain,
            txBytesLen: txBytes.length,
          });
          let signedTxBytes: Uint8Array;
          try {
            const result = await privySolanaSignTransaction({
              transaction: txBytes,
              wallet,
              chain,
              options: { uiOptions: { showWalletUIs: false } },
            });
            signedTxBytes = result.signedTransaction;
          } catch (e: unknown) {
            console.error("[PrivySign] sign error:", e);
            throw e;
          }
          const sig = await connection.sendRawTransaction(signedTxBytes, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
          console.info("[PrivySign] broadcast | sig=", sig.slice(0, 12) + "…");
          return sig;
        },
      });
      setPerTransferPhase(null);
      setConfirmingTxSignature(sig);
      setConfirmingTxSource("loofta");

      const confirmed = await waitForConfirmation(connection, sig, 90_000);
      if (!confirmed) {
        throw new Error(
          "Transaction did not confirm in time. Check Solscan for status — do not mark as paid until the transaction confirms."
        );
      }

      console.info("[PayWithLoofta] Updating claim status → SUCCESS, tx:", sig);
      await updateClaimStatus(
        claim.id,
        "SUCCESS",
        {
          txHash: sig,
          paidWith: "USDC (Loofta / Private)",
          isPrivate: true,
          paidWithToken: "USDC",
          paidWithChain: "solana",
          ...(looftaFeeUsdc != null ? { feeAmountUsdc: looftaFeeUsdc } : {}),
          ...(looftaFeeBreakdown ? { feeBreakdown: looftaFeeBreakdown } : {}),
        },
        looFtaToken,
      );
      console.info("[PayWithLoofta] Claim status updated to SUCCESS");
      setStatus("SUCCESS");
      useClaimPayStore.getState().setStatus(claim.id, "SUCCESS");
      await claimQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
      queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      queryClient.invalidateQueries({ queryKey: ["solanaPaymentBalance"] });
      // Wait for the RPC to index the confirmed tx before refetching balance,
      // otherwise we'd get the stale pre-transfer amount back.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
        queryClient.invalidateQueries({ queryKey: ["solanaPaymentBalance"] });
        queryClient.refetchQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
        queryClient.refetchQueries({ queryKey: ["solanaPaymentBalance"] });
      }, 2000);
      setShowPayNowModal(false);
      toast({
        title: "Transfer submitted!",
        description: `$${amountUSD.toFixed(2)} USDC sent privately. ${privatePaymentFundsAppearCopy()}`,
      });
    } catch (e: any) {
      console.error("[PayWithLoofta] Error:", e);
      const message = e?.message || "Could not send from Loofta balance. Try again or use wallet.";
      setPayWithLooftaError(message);
      setLastFailedPayMethod("loofta");
      toast({
        variant: "destructive",
        title: "Payment failed",
        description: message,
      });
    } finally {
      setPayingWithLoofta(false);
      setPerTransferPhase(null);
      setConfirmingTxSignature(null);
      setConfirmingTxSource(null);
    }
  }

  // Hydrate fee data from DB (via claim.fee_paid_usdc attached by backend on findOne)
  useEffect(() => {
    if (!claim?.id || paidFeeUsdc != null) return;
    const feePaid = (claim as any).fee_paid_usdc;
    if (typeof feePaid === "number") setPaidFeeUsdc(feePaid);
  }, [claim?.id, (claim as any)?.fee_paid_usdc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ref updated (retained for any legacy callers but auto-trigger is disabled below)
  useEffect(() => {
    onPayPrivatelyRef.current = onPayPrivately;
  });

  // PRIVATE_TRANSFER_PENDING auto-trigger is intentionally disabled in the new API-based flow.
  // In the old SDK flow this triggered onPayPrivately (which required Phantom) from the recipient side.
  // In the new flow, claimAsRecipientMutation (above) handles recipient claiming automatically.
  // Keeping this comment so the intent is clear: do NOT re-enable without updating onPayPrivately.

  // Recovery: if the claim loaded with PRIVATE_TRANSFER_PENDING and a saved sender_tx_hash,
  // poll the RPC once to check if the tx actually confirmed (handles the case where the browser
  // closed or the RPC timed out before updateClaimStatus(SUCCESS) was called).
  const txHashRecoveryRef = React.useRef<string | null>(null);
  useEffect(() => {
    const txHash = claim?.sender_tx_hash;
    const claimStatus = String(claim?.status || "").toUpperCase();
    if (!txHash || claimStatus !== "PRIVATE_TRANSFER_PENDING") return;
    // Only run for the payer — the recipient needs the sweep to complete, not just tx confirmation.
    if (isRecipient) return;
    if (txHashRecoveryRef.current === txHash) return; // already tried this hash
    txHashRecoveryRef.current = txHash;

    const conn = new Connection(getRpcForMode(networkMode), "confirmed");
    console.info(`[TxRecovery] Polling on-chain for saved tx hash ${txHash.slice(0, 12)}…`);

    waitForSignatureConfirmation(conn, txHash, 60_000, 2000, "recovery")
      .then(async () => {
        console.info(`[TxRecovery] tx confirmed — upgrading claim ${id} to SUCCESS`);
        const perToken = await getAccessToken().catch(() => null);
        await updateClaimStatus(id, "SUCCESS", {
          txHash,
          paidWith: "USDC (Private)",
          isPrivate: true,
          paidWithToken: "USDC",
          paidWithChain: "solana",
        }, perToken);
        setStatus("SUCCESS");
        useClaimPayStore.getState().setStatus(id, "SUCCESS");
        await claimQuery.refetch();
      })
      .catch((e) => {
        console.warn(`[TxRecovery] tx not yet confirmed for ${txHash.slice(0, 12)}… — leaving as PRIVATE_TRANSFER_PENDING:`, e?.message);
      });
  }, [claim?.sender_tx_hash, claim?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onPayNow() {
    if (!claim || !selectedFrom || !destToken) return;

    // Handle private payments separately
    if (isPrivateMode) {
      await onPayPrivately();
      return;
    }

    // Only USDC on Solana (Pay with Loofta / Use wallet) is supported; Rhinestone/Biconomy are not used
    if (!swapProviderEligible) {
      toast({ variant: "destructive", title: "Not supported", description: "This network is not supported for direct pay. Use Pay with Loofta or your wallet for USDC on Solana." });
      return;
    }
  }

  // Cache and refresh status via TanStack Query
  // Get deposit address from multiple sources
  const depositAddress: string | undefined = deposit?.depositAddress
    || statusData?.quoteResponse?.quote?.depositAddress
    || statusData?.depositAddress
    || undefined;
  const statusQuery = useQuery({
    queryKey: ["status", depositAddress],
    enabled: !!depositAddress,
    queryFn: async ({ queryKey }) => {
      // Use depositAddress from queryKey to avoid stale closure
      const addr = queryKey[1] as string;
      if (!addr) throw new Error("No deposit address");
      const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(addr)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load status");
      return await r.json();
    },
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const s = query?.state?.data?.status;
      const terminal = s && ["SUCCESS", "FAILED", "REFUNDED", "EXPIRED"].includes(String(s).toUpperCase());
      return terminal ? false : 15000;
    },
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    const s = statusQuery.data?.status || statusQuery.data?.executionStatus || null;
    if (s) {
      const upperStatus = String(s).toUpperCase();
      const previousStatus = status ? String(status).toUpperCase() : null;

      setStatus(s);
      useClaimPayStore.getState().setStatus(id, s);
      setStatusData(statusQuery.data || null);

      // When status first becomes PROCESSING (from NEAR Intents deposit detection), set deposit_received_at
      if (upperStatus === "PROCESSING" && previousStatus !== "PROCESSING") {
        // Extract route information from status data if available
        const originAsset = statusQuery.data?.originAsset;
        const destinationAsset = statusQuery.data?.destinationAsset;

        // Deposit was just detected - record the time
        getAccessToken().catch(() => null).then((statusToken) =>
          updateClaimStatus(id, "IN_FLIGHT", {
            paidWith: paidToken?.symbol
              ? `${paidToken.symbol} on ${paidToken.chain || selectedFrom?.chain}`
              : selectedFrom?.symbol
                ? `${selectedFrom.symbol} on ${selectedFrom.chain}`
                : undefined,
            depositReceivedAt: new Date().toISOString(),
            originAsset,
            destinationAsset,
          }, statusToken).catch((e) => {
            console.error("[statusQuery] Failed to update deposit_received_at:", e);
          })
        );
      }

      // When status becomes terminal, update the claim in DB (only once per status)
      const isTerminalStatus = ["SUCCESS", "FAILED", "REFUNDED"].includes(upperStatus);
      if (isTerminalStatus && hasUpdatedClaimStatus.current !== upperStatus) {
        hasUpdatedClaimStatus.current = upperStatus; // Mark as updated to prevent duplicates

        // Update claim in DB then refresh cache
        (async () => {
          const statusToken = await getAccessToken().catch(() => null);
          if (upperStatus === "SUCCESS") {
            await updateClaimStatus(id, "SUCCESS", {
              paidWith: paidToken?.symbol
                ? `${paidToken.symbol} on ${paidToken.chain || selectedFrom?.chain}`
                : selectedFrom?.symbol
                  ? `${selectedFrom.symbol} on ${selectedFrom.chain}`
                  : undefined,
            }, statusToken);
            queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
          } else {
            await updateClaimStatus(id, upperStatus, undefined, statusToken);
          }
          // Refetch claim after DB is updated
          claimQuery.refetch();
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data]);

  function extractTxHash(raw: string): string | null {
    const v = String(raw || "").trim();
    if (!v) return null;
    // If it's a URL, try to get query param 'hash' or last path segment
    try {
      if (v.startsWith("http")) {
        const u = new URL(v);
        const q = u.searchParams.get("hash") || u.searchParams.get("tx") || u.searchParams.get("transactionHash");
        if (q && q.length > 10) return q;
        const segs = (u.pathname || "").split("/").filter(Boolean);
        const last = segs[segs.length - 1];
        if (last && last.length > 10) return last;
      }
    } catch { }
    // EVM-like 0x... hash
    const evm = v.match(/0x[0-9a-fA-F]{10,}/);
    if (evm) return evm[0];
    // Fallback: long base58/hex-ish token
    const longToken = v.match(/[A-Za-z0-9]{20,}/);
    if (longToken) return longToken[0];
    return null;
  }

  function getSenderDisplay(claim: PaymentHistoryClaim): string {
    if (claim.creator_username) return `@${claim.creator_username}`;
    if (claim.creator_email) return claim.creator_email;
    return "Anonymous";
  }

  async function onSubmitTxHash() {
    if (!deposit?.depositAddress) {
      toast({ variant: "destructive", title: "No deposit", description: "Prepare a deposit address first." });
      return;
    }
    const hash = extractTxHash(txInput);
    if (!hash) {
      toast({ variant: "destructive", title: "Invalid hash", description: "Paste a valid transaction hash or explorer link." });
      return;
    }

    // Optimistic UI: immediately set status to IN_FLIGHT (PROCESSING is not a valid DB status)
    setStatus("IN_FLIGHT");
    useClaimPayStore.getState().setStatus(id, "IN_FLIGHT");

    // Update claim status in database
    const statusToken = await getAccessToken().catch(() => null);
    updateClaimStatus(id, "IN_FLIGHT", { txHash: hash }, statusToken).catch((e) => {
      console.error("[onSubmitTxHash] Failed to update claim status:", e);
    });

    setSubmittingTx(true);
    try {
      const token = (process as any)?.env?.NEXT_PUBLIC_ONECLICK_JWT;
      const r = await fetch("https://1click.chaindefuser.com/v0/deposit/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "*/*",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          txHash: hash,
          depositAddress: deposit.depositAddress,
          memo: deposit.memo || undefined,
          // nearSenderAccount optional; omit unless you want to expose a user field
        }),
      });
      if (!r.ok) {
        let msg = "Failed to submit transaction";
        try { msg = (await r.json())?.error || msg; } catch { }
        throw new Error(msg);
      }
      toast({ title: "Submitted", description: "Transaction submitted for faster processing." });
      setSpeedUpOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Submit failed", description: e?.message || "Could not submit tx hash" });
      // Note: We keep the PROCESSING status even on error for optimistic UI
      // The status query will eventually sync with the actual status
    } finally {
      setSubmittingTx(false);
    }
  }

  return (
    <>
      {/* Privacy Tutorial Modal */}
      {showPrivacyTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setShowPrivacyTutorial(false); setTutorialStep(0); }}>
          <div
            className="bg-white rounded-[20px] w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="flex gap-1.5 p-4 pb-0">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                  <div className={`h-full transition-all duration-300 ${tutorialStep >= i ? 'w-full' : 'w-0'}`} style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }} />
                </div>
              ))}
            </div>

            {/* Content - fixed height */}
            <div className="relative h-[360px] overflow-hidden">
              {/* Step 0: Intro */}
              <div className={`absolute inset-0 p-6 flex flex-col items-center justify-center text-center transition-all duration-300 ${tutorialStep === 0 ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <Image src="/images/icons/shield-icon.png" alt="" width={64} height={64} className="mb-5" />
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-3">Private Settlement</h3>
                <p className="text-slate-500">Convert your payment to ZEC for complete privacy</p>
              </div>

              {/* Step 1: Get Wallet */}
              <div className={`absolute inset-0 p-6 flex flex-col items-center justify-center text-center transition-all duration-300 ${tutorialStep === 1 ? 'opacity-100 translate-x-0' : tutorialStep < 1 ? 'opacity-0 translate-x-full pointer-events-none' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <Image src="/images/icons/wallet.png" alt="" width={128} height={128} className="mb-5" />
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-3">Get a Wallet</h3>
                <p className="text-slate-500 mb-5">Download Zashi to get your shielded address</p>
                <a
                  href="https://zashi.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white font-medium hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                >
                  Get Zashi →
                </a>
              </div>

              {/* Step 2: How it works */}
              <div className={`absolute inset-0 p-6 flex flex-col transition-all duration-300 ${tutorialStep === 2 ? 'opacity-100 translate-x-0' : tutorialStep < 2 ? 'opacity-0 translate-x-full pointer-events-none' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-6 text-center">How it works</h3>
                <div className="flex-1 flex flex-col justify-center space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>1.</span>
                    <span className="text-slate-700 pt-1">Enter your Zcash shielded address</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>2.</span>
                    <span className="text-slate-700 pt-1">We swap your funds to ZEC</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>3.</span>
                    <span className="text-slate-700 pt-1">Receive ZEC privately in your wallet</span>
                  </div>
                </div>
              </div>

              {/* Step 3: Benefits */}
              <div className={`absolute inset-0 p-6 flex flex-col transition-all duration-300 ${tutorialStep === 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}>
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-6 text-center">Why private?</h3>
                <div className="flex-1 flex flex-col justify-center space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>
                    <span className="text-slate-700 pt-1">No one can see your balance</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>
                    <span className="text-slate-700 pt-1">Transaction history is hidden</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>
                    <span className="text-slate-700 pt-1">Send or receive again from Loofta Pay anytime</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="p-4 border-t border-gray-100">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (tutorialStep === 0) {
                      setShowPrivacyTutorial(false);
                      setTutorialStep(0);
                    } else {
                      setTutorialStep(s => s - 1);
                    }
                  }}
                  className="flex-1 py-3 rounded-[12px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  {tutorialStep === 0 ? 'Skip' : 'Back'}
                </button>
                <button
                  onClick={() => tutorialStep < 3 ? setTutorialStep(s => s + 1) : (setShowPrivacyTutorial(false), setTutorialStep(0))}
                  className="flex-1 py-3 rounded-[12px] font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                >
                  {tutorialStep === 3 ? 'Get Started' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ClaimPayLayout
        embedInApp={embedInApp}
        from={from}
        topRight={
          user?.id && claim?.created_by === user.id && ["OPEN", "PENDING_DEPOSIT"].includes(String(status || claim?.status || "").toUpperCase()) ? (
            <>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-base md:text-sm font-medium text-red-500 hover:text-gray-400 transition-colors"
              >
                Delete this payment
              </button>
              <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent className="[&_.text-gray-900]:!text-white [&_.text-muted-foreground]:!text-slate-300 [&_.border]:!border-white/10 bg-[#0f0f12] border-white/10">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Delete this payment?</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-300">
                      This will remove the payment link. It won&apos;t be visible to you or anyone else. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-white !text-gray-900 border border-white/20 hover:bg-gray-100">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async (e) => {
                        e.preventDefault();
                        if (!user?.id) return;
                        setDeleting(true);
                        try {
                          const deleteToken = await getAccessToken();
                          const r = await fetch(`/api/claims/${id}`, {
                            method: "DELETE",
                            headers: deleteToken ? { Authorization: `Bearer ${deleteToken}` } : {},
                          });
                          if (!r.ok) {
                            const err = await r.json().catch(() => ({}));
                            toast({ variant: "destructive", title: "Could not delete", description: (err as { error?: string })?.error || "Try again." });
                            setDeleting(false);
                            return;
                          }
                          setShowDeleteConfirm(false);
                          queryClient.setQueryData(["claim", id], undefined);
                          queryClient.invalidateQueries({ queryKey: ["payments", "history"] });
                          toast({ title: "Payment deleted" });
                          router.replace("/");
                        } catch (e) {
                          toast({ variant: "destructive", title: "Could not delete", description: (e as Error)?.message || "Try again." });
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      disabled={deleting}
                      className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null
        }
      >
        <AlertDialog open={showNetworkSwitchPrompt} onOpenChange={setShowNetworkSwitchPrompt}>
          <AlertDialogContent className="[&_.text-gray-900]:!text-white [&_.text-muted-foreground]:!text-slate-300 [&_.border]:!border-white/10 bg-[#0f0f12] border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">
                Switch to {claimExpectedNetwork}?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300">
                This payment link was created on <strong className="text-white">{claimExpectedNetwork}</strong>.
                Switch to view it. You can change your network again anytime in the user menu.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-white/10 text-white border-white/20 hover:bg-white/20">
                Stay on {networkMode}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (claimExpectedNetwork) setNetworkMode(claimExpectedNetwork);
                  setShowNetworkSwitchPrompt(false);
                }}
                className="bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
              >
                Switch to {claimExpectedNetwork}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* Demo Mode Banner */}
        {DEMO_MODE && (
          <div className="mb-4 -mx-6 -mt-6 px-4 py-3 bg-amber-50 border-b border-amber-200 rounded-t-2xl">
            <div className="flex items-center gap-2 text-amber-800">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-base md:text-sm font-medium">Demo Mode - Payments are disabled</span>
            </div>
          </div>
        )}
        {loadingClaim || !privyReady || (authenticated && isInitialRecipientCheck) ? (
          <div className="space-y-5 animate-pulse">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-5 w-36" />
            </div>
            <Skeleton className="h-14 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-12 w-full rounded-xl mt-2" />
          </div>
        ) : !authenticated && claim?.direction !== 'from_recipient' ? (
          <div className="py-16 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 border border-white/10 flex items-center justify-center mb-5">
              <LogIn className="w-7 h-7 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Sign in to view details</h3>
            <p className="text-slate-400 text-base mb-6 max-w-xs">
              This payment may be waiting for you. Sign in to check.
            </p>
            <button
              onClick={() => login()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(to right, #FF1301, #EAB308)" }}
            >
              <LogIn className="w-4 h-4" />
              Sign in
            </button>
          </div>
        ) : claim ? (
          <>
            {!isCreatorView && !isRecipient && claim?.direction !== 'from_recipient' ? (
              <PaymentNotFoundNotice
                message="This link may not be addressed to you, or may no longer exist."
                hint={
                  claim?.recipient_pending_email || claim?.recipient_pending_username
                    ? "It might also be waiting on an email or X handle you haven't added to your account yet."
                    : null
                }
                showLinkButtons={!!(claim?.recipient_pending_email || claim?.recipient_pending_username)}
                hasTwitterLinked={hasTwitterLinked}
                hasEmailLinked={hasEmailLinked}
                onConnectTwitter={() => linkTwitter()}
                onConnectEmail={() => linkEmail()}
                isConfirmingIdentity={isConfirmingIdentity}
                backHref={from === "history" ? "/history" : "/"}
                backLabel={from === "history" ? "← Back to History" : "← Back to Send"}
              />
            ) : isRecipient &&
              !claim?.recipient_pending_email &&
              !claim?.recipient_pending_username &&
              String(status || claim?.status || "").toUpperCase() === "SUCCESS" ? (
              <div className="mt-6 py-6">
                <div className="text-center mb-6">
                  <div className="mb-4 text-6xl">✅</div>
                  <div className={"text-6xl font-sans font-semibold"}>
                    +  ${parseFloat(claim?.amount || "0").toFixed(2)}
                  </div>
                  <div className={"text-xl text-gray-500 mt-3 mb-5"}>
                    from {getSenderDisplay(claim)}
                  </div>
                </div>
                <ClaimDescriptionMessageBox description={claim?.description} />
                {/* Troubleshoot payment (localhost-only debug panel) — disabled for now, keep for later.
                {isClaimPageLocalhost &&
                  !!(claim?.recipient_pending_email || claim?.recipient_pending_username || claim?.claim_burner_address) && (
                    <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-amber-900">Troubleshoot payment</div>
                          <div className="text-base md:text-sm text-amber-800">
                            Check if funds are still in burner wallet or already swept.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={runBurnerTroubleshoot}
                          disabled={burnerDiagLoading}
                          className="inline-flex items-center justify-center rounded-lg bg-amber-500 text-white px-3 py-2 text-base md:text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                        >
                          {burnerDiagLoading ? "Checking..." : "Run check"}
                        </button>
                      </div>
                      {burnerDiag && (
                        <div className="mt-3 text-base md:text-sm text-amber-900 space-y-1">
                          <div>Burner: {burnerDiag.burnerAddress ? `${burnerDiag.burnerAddress.slice(0, 8)}...${burnerDiag.burnerAddress.slice(-6)}` : "none"}</div>
                          <div>Burner USDC: {burnerDiag.burnerUsdc}</div>
                          <div>PER deposit detected: {burnerDiag.perDepositDetected ? "yes" : "no"}</div>
                          <div>PER withdraw attempted: {burnerDiag.perWithdrawAttempted ? "yes" : "no"}</div>
                          {burnerDiag.perDepositAmountRaw !== undefined && (
                            <div>PER deposit amount: {(Number(burnerDiag.perDepositAmountRaw || "0") / 1_000_000).toFixed(6)} USDC</div>
                          )}
                          {burnerDiag.perWithdrawError && (
                            <div className="text-rose-700">PER withdraw error: {burnerDiag.perWithdrawError}</div>
                          )}
                          {burnerDiag.perDebugLog?.length ? (
                            <div className="rounded-md bg-black/5 p-2 text-[11px] text-slate-700 max-h-28 overflow-auto">
                              {burnerDiag.perDebugLog.map((line, idx) => (
                                <div key={idx}>- {line}</div>
                              ))}
                            </div>
                          ) : null}
                          <div>Private mode: {burnerDiag.isPrivate ? "yes" : "no"}</div>
                          <div>Paid with: {burnerDiag.paidWithToken || "-"} / {burnerDiag.paidWithChain || "-"}</div>
                          <div>Recipient wallet: {burnerDiag.recipientWallet ? `${burnerDiag.recipientWallet.slice(0, 8)}...${burnerDiag.recipientWallet.slice(-6)}` : "not available"}</div>
                          <div>Status: {burnerDiag.claimStatus}</div>
                          <div>
                            {Number(burnerDiag.burnerUsdcRaw || "0") > 0
                              ? "Funds are still in burner ATA. Claim/sweep is not completed yet."
                              : burnerDiag.perDepositDetected
                                ? "PER deposit exists. Funds may still be in PER state; withdraw-to-burner was attempted."
                                : burnerDiag.isPrivate
                                  ? "Burner ATA is empty. For MagicBlock PER/private flow, funds may still be in PER deposit state (not visible in burner ATA)."
                                  : "No USDC in burner ATA. Funds may already be swept to recipient wallet."}
                          </div>
                          {!!user?.id && (
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={retryClaimSweep}
                                disabled={retrySweepLoading}
                                className="inline-flex items-center justify-center rounded-lg bg-amber-600 text-white px-3 py-2 text-base md:text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                              >
                                {retrySweepLoading ? "Retrying..." : "Retry claim sweep"}
                              </button>
                              {isClaimPageLocalhost && claim?.created_by === user.id && (
                                <button
                                  type="button"
                                  onClick={reclaimBySender}
                                  disabled={reclaimingSenderFunds}
                                  className="ml-2 inline-flex items-center justify-center rounded-lg bg-slate-800 text-white px-3 py-2 text-base md:text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                                >
                                  {reclaimingSenderFunds ? "Withdrawing..." : "Withdraw from PER"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                */}
                <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
                  {claim?.created_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 text-base md:text-sm">Created</span>
                      <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claim.created_at)}</span>
                    </div>
                  )}
                  {claim?.paid_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 text-base md:text-sm">
                        {claim?.recipient_pending_email || claim?.recipient_pending_username ? "Paid" : "Claimed"}
                      </span>
                      <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claim.paid_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : user?.id && claimAsRecipientMutation.isPending && !claimCompleted ? (
              (() => {
                const amt = parseFloat(claim?.amount || "0").toFixed(2);
                return (
                  <div className="mt-6 py-6 sm:py-10 px-4 text-center overflow-hidden">
                    <motion.div
                      animate={{ y: [0, -14, 0], rotate: [0, -8, 8, 0] }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                      className="text-6xl sm:text-7xl mb-4 select-none"
                    >
                      💸
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-4xl sm:text-5xl font-sans font-semibold text-gray-900 mb-2"
                    >
                      +${amt}
                    </motion.div>
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.15 }}
                      className="text-xl sm:text-2xl font-semibold mb-6 bg-gradient-to-r from-[#FF1301] to-[#EAB308] bg-clip-text text-transparent"
                    >
                      On its way to your wallet ✨
                    </motion.p>
                    <div className="flex justify-center gap-2">
                      {["#FF1301", "#EAB308", "#22c55e"].map((color, i) => (
                        <motion.div
                          key={i}
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.18 }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()
            ) : user?.id && (claimCompleted || claimInitiated || claimAsRecipientMutation.isSuccess) ? (
              (() => {
                const senderLabel =
                  claim?.creator_username ? `@${claim.creator_username}` : (claim?.creator_email || null);
                const amt = parseFloat(claim?.amount || "0").toFixed(2);
                const claimedAt = claim?.paid_at || optimisticClaimedAt;
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="mt-6 py-6 px-4"
                  >
                    <div className="text-center mb-6">
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }}
                        className="mb-3 text-5xl sm:text-6xl select-none"
                      >
                        🎉
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="text-5xl sm:text-6xl font-sans font-semibold text-gray-900 mb-3"
                      >
                        +${amt}
                      </motion.div>
                      {senderLabel && (
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.25 }}
                          className="text-xl text-gray-500 mt-1 mb-5"
                        >
                          from <span className="font-medium text-gray-700">{senderLabel}</span>
                        </motion.p>
                      )}
                    </div>
                    <ClaimDescriptionMessageBox description={claim?.description} />
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2"
                    >
                      {claim?.created_at && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 text-base md:text-sm">Created</span>
                          <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claim.created_at)}</span>
                        </div>
                      )}
                      {claimedAt && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 text-base md:text-sm">Claimed</span>
                          <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claimedAt)}</span>
                        </div>
                      )}
                    </motion.div>
                  </motion.div>
                );
              })()
            ) : isRecipient &&
              !isPendingRecipientClaim &&
              ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CLAIMED"].includes(
                String(status || claim?.status || "").toUpperCase(),
              ) ? (
              (() => {
                const senderLabel =
                  claim?.creator_username ? `@${claim.creator_username}` : (claim?.creator_email || null);
                const amt = parseFloat(claim?.amount || "0").toFixed(2);
                return (
                  <div className="mt-6 py-6 px-4">
                    <div className="text-center mb-6">
                      <div className="mb-4 text-6xl">✅</div>
                      <div className="text-5xl font-bold text-gray-900 mb-3">+ ${amt}</div>
                      {senderLabel && (
                        <p className="text-xl text-gray-500">from <span className="font-medium text-gray-700">{senderLabel}</span></p>
                      )}
                    </div>
                    <ClaimDescriptionMessageBox description={claim?.description} />
                  </div>
                );
              })()
            ) : claim?.recipient_pending_email && !(user?.id && claim?.created_by === user.id) ? (
              <div className="mt-6 text-center py-12 px-4">
                {!user?.id ? (
                  (() => {
                    const senderHasPaid = ["PRIVATE_TRANSFER_PENDING", "SUCCESS", "FUNDED"].includes(
                      String(claim?.status || "").toUpperCase()
                    );
                    return senderHasPaid ? (
                      <>
                        <div className="mb-4 text-6xl">🎁</div>
                        <h3 className="text-2xl font-semibold text-gray-900 mb-2">You received a payment</h3>
                        <p className="text-gray-500 text-base mb-5">
                          Sign in with the email this link was sent to to claim.
                        </p>
                        <button
                          type="button"
                          onClick={() => login({ loginMethods: ["email"], disableSignup: false })}
                          className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition-all min-w-[220px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                        >
                          Sign in to claim
                        </button>
                      </>
                    ) : null;
                  })()
                ) : (
                  <>
                    <div className={"text-6xl font-sans font-semibold"}>
                      + ${parseFloat(claim?.amount || "0").toFixed(2)}
                    </div>
                    <div className={"text-xl text-gray-500 mt-3 mb-5"}>
                      from{" "}
                      {claim?.creator_username
                        ? `@${claim.creator_username}`
                        : claim?.creator_email || "Anonymous"}
                    </div>
                    <div className="text-left max-w-md mx-auto">
                      <ClaimDescriptionMessageBox description={claim?.description} />
                    </div>
                    <div className="flex items-center justify-center gap-2 text-base md:text-sm mb-4">
                      {burnerIsChecking ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                          <span className="text-gray-500">Checking if funds have arrived…</span>
                        </>
                      ) : burnerIsReady ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span className="text-green-600 font-medium">Funds ready — you can claim now.</span>
                        </>
                      ) : (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                          <span className="text-gray-500">
                            {privatePaymentWaitingAfterSenderCopy()}
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setClaimInitiated(true); claimAsRecipientMutation.mutate(); }}
                      disabled={claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady}
                      className={cn(
                        "hidden md:inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition-all min-w-[220px]",
                        "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                        (claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady) &&
                        "opacity-50 cursor-not-allowed hover:opacity-50",
                      )}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Claim to wallet
                      {walletNotReady ? " (setting up wallet…)" : waitingForBurnerFunds ? " (not ready)" : ""}
                    </button>
                    {/* Mobile: sticky above BottomNav (h-16 = 64px) */}
                    <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-[#0f0f12]/95 backdrop-blur-sm border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => { setClaimInitiated(true); claimAsRecipientMutation.mutate(); }}
                        disabled={claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady}
                        className={cn(
                          "w-full flex items-center justify-center gap-2 rounded-xl py-4 font-semibold text-base transition-all",
                          "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                          (claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady) && "opacity-50 cursor-not-allowed hover:opacity-50",
                        )}
                      >
                        {claimAsRecipientMutation.isPending ? (
                          <><Loader2 className="h-5 w-5 animate-spin" /><span>Claiming…</span></>
                        ) : (
                          <><CheckCircle2 className="h-5 w-5" /><span>Claim to wallet{walletNotReady ? " (setting up wallet…)" : waitingForBurnerFunds ? " (not ready)" : ""}</span></>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : isRecipient && claim?.recipient_pending_username ? (
              <div className="mt-6 text-center py-12 px-4">
                <div className="mb-4 text-6xl">📩</div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-2">This payment is for you</h3>
                {["PRIVATE_TRANSFER_PENDING", "SUCCESS", "FUNDED"].includes(String(claim?.status || "").toUpperCase()) ? (
                  !user?.id ? (
                    <>
                      <p className="text-gray-500 text-base md:text-sm mb-5">
                        Sign in with @{claim.recipient_pending_username_value || "username"} on Loofta to claim.
                      </p>
                      <button
                        type="button"
                        onClick={() => login({ disableSignup: false })}
                        className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition-all min-w-[220px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                      >
                        Sign in to claim
                      </button>
                    </>
                  ) : (
                    <>
                      <div className={"text-6xl font-sans font-semibold"}>
                        + ${parseFloat(claim?.amount || "0").toFixed(2)}
                      </div>
                      <div className={"text-xl text-gray-500 mt-3 mb-5"}>
                        from{" "}
                        {claim?.creator_username
                          ? `@${claim.creator_username}`
                          : claim?.creator_email || "Anonymous"}
                      </div>
                      <div className="text-left max-w-md mx-auto">
                        <ClaimDescriptionMessageBox description={claim?.description} />
                      </div>


                      <div className="flex items-center justify-center gap-2 text-base md:text-sm mb-4">
                        {burnerIsChecking ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            <span className="text-gray-500">Checking if funds have arrived…</span>
                          </>
                        ) : burnerIsReady ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-green-600 font-medium">Funds ready — you can claim now.</span>
                          </>
                        ) : (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                            <span className="text-gray-500">
                              {privatePaymentWaitingAfterSenderCopy()}
                            </span>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setClaimInitiated(true); claimAsRecipientMutation.mutate(); }}
                        disabled={claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady}
                        className={cn(
                          "hidden md:inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition-all min-w-[220px]",
                          "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                          (claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady) &&
                          "opacity-50 cursor-not-allowed hover:opacity-50",
                        )}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Claim to wallet
                        {walletNotReady ? " (setting up wallet…)" : waitingForBurnerFunds ? " (not ready)" : ""}
                      </button>
                      {/* Mobile: sticky above BottomNav (h-16 = 64px) */}
                      <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-[#0f0f12]/95 backdrop-blur-sm border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => { setClaimInitiated(true); claimAsRecipientMutation.mutate(); }}
                          disabled={claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 rounded-xl py-4 font-semibold text-base transition-all",
                            "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                            (claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady) && "opacity-50 cursor-not-allowed hover:opacity-50",
                          )}
                        >
                          {claimAsRecipientMutation.isPending ? (
                            <><Loader2 className="h-5 w-5 animate-spin" /><span>Claiming…</span></>
                          ) : (
                            <><CheckCircle2 className="h-5 w-5" /><span>Claim to wallet{walletNotReady ? " (setting up wallet…)" : waitingForBurnerFunds ? " (not ready)" : ""}</span></>
                          )}
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  <p className="text-gray-600 text-base mb-4">
                    {user?.id
                      ? `$${parseFloat(claim?.amount || "0").toFixed(2)} – waiting for the sender to pay.`
                      : "Waiting for the sender to pay. Sign in to see the amount and claim when it’s ready."}
                  </p>
                )}
              </div>
            ) : claim?.recipient_pending_email && user?.id && claim?.created_by === user.id && ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={claim?.recipient_pending_email_value || "email recipient"}
                status={String(status || claim?.status || "").toUpperCase()}
                userId={user?.id}
              />
            ) : claim?.recipient_pending_username && user?.id && claim?.created_by === user.id && ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={`@${claim.recipient_pending_username_value || "username"}`}
                status={String(status || claim?.status || "").toUpperCase()}
                userId={user?.id}
              />
            ) : claim?.recipient_pending_username && !(user?.id && claim?.created_by === user.id) ? (
              (() => {
                const senderHasPaid = ["PRIVATE_TRANSFER_PENDING", "SUCCESS", "FUNDED"].includes(
                  String(claim?.status || "").toUpperCase()
                );
                return (
                  <div className="mt-6 text-center py-12 px-4">
                    <div className="mb-4 text-6xl">🎁</div>
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                      A payment is waiting
                    </h3>
                    <p className="text-gray-600 text-base md:text-sm mb-5">
                      {senderHasPaid
                        ? "Sign in to see if this payment is for you."
                        : "Someone will be able to claim this payment after signing up on Loofta."}
                    </p>
                    {senderHasPaid && (
                      <button
                        type="button"
                        onClick={() => login({ disableSignup: false })}
                        className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-6 py-3 text-white font-semibold hover:opacity-90"
                      >
                        Sign up to claim
                      </button>
                    )}
                  </div>
                );
              })()
            ) : isRecipient ? (
              <div className="mt-6 text-center py-12">
                <div className="mb-4 text-6xl">📩</div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                  This payment is for you
                </h3>
                <p className="text-gray-600 text-base mb-4">
                  ${parseFloat(claim?.amount || "0").toFixed(2)} – waiting for the sender to pay. When they do, it’ll show up here and in your Loofta account.
                </p>
                <Link href={from === "history" ? "/history" : "/"} className="inline-flex items-center gap-2 text-base md:text-sm font-medium text-gray-600 hover:text-gray-900">
                  {from === "history" ? "← Back to History" : "← Back to Send"}
                </Link>
              </div>
            ) : ["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <>
                {/* Payment Complete — hero + share + summary */}
                {(() => {
                  const recipientLabel =
                    (claim as any)?.recipient_pending_username_value
                      ? `@${(claim as any).recipient_pending_username_value}`
                      : claim?.recipient_username
                        ? `@${claim.recipient_username}`
                        : (claim as any)?.recipient_pending_email_value
                          ? (claim as any).recipient_pending_email_value
                          : claim?.recipient_email
                            ? claim.recipient_email
                            : null;
                  const shareId = (claim as any)?.short_id || claim?.id;
                  const claimLink = typeof window !== "undefined"
                    ? `${window.location.origin}/share/${shareId}`
                    : `https://pay.loofta.xyz/share/${shareId}`;
                  const handleCopyLink = async () => {
                    try {
                      await navigator.clipboard.writeText(claimLink);
                      setPaymentCompleteCopied(true);
                      toast({ title: "Link copied" });
                      setTimeout(() => setPaymentCompleteCopied(false), 2000);
                    } catch {
                      toast({ variant: "destructive", title: "Copy failed" });
                    }
                  };
                  const shareToSuffix = recipientLabel ? ` to ${recipientLabel}` : "";
                  const shareText = `$${parseFloat(claim.amount || "0").toFixed(2)} sent${shareToSuffix} via Loofta.`;
                  return (
                    <>
                      {/* Hero */}
                      <div className="mt-4 text-center py-8 space-y-3">
                        <div className="text-5xl mb-2">🎉</div>
                        <h3 className="text-3xl font-semibold text-gray-900">
                          ${parseFloat(claim.amount || "0").toFixed(2)} sent!
                        </h3>
                        {recipientLabel ? (
                          <p className="text-lg text-gray-500">
                            To <span className="font-medium text-gray-900">{recipientLabel}</span>
                          </p>
                        ) : (
                          <p className="text-lg text-gray-500">Payment sent successfully.</p>
                        )}
                        {/* Description / GIF */}
                        {!embedInApp && claim?.description && (
                          <div className="mt-3">
                            <ClaimDescriptionMessageBox description={claim.description} />
                          </div>
                        )}
                        {/* Share row — right under the recipient */}
                        <div className="flex gap-2 pt-2">
                          <div className="flex gap-2 flex-1">
                            <Input
                              readOnly
                              value={claimLink}
                              className="font-mono text-sm flex-1 bg-gray-50"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={handleCopyLink}
                              className="shrink-0 !text-slate-900 border-gray-400 hover:bg-gray-100"
                            >
                              {paymentCompleteCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                          <ShareLinkMenu
                            url={claimLink}
                            title="Payment sent"
                            text={shareText}
                            triggerClassName="px-5 py-2"
                          />
                        </div>
                      </div>
                      {/* Summary */}
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                        {!requiresPrivate ? (
                          <div className="flex items-center justify-between">
                            <span className="text-base md:text-sm text-gray-500">Recipient receives</span>
                            <span className="text-base md:text-sm font-semibold text-gray-900 inline-flex items-center gap-1">
                              <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                              ${parseFloat(claim.amount || "0").toFixed(2)}
                            </span>
                          </div>
                        ) : isFeeOnSender ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-base md:text-sm text-gray-500">Recipient receives</span>
                              <span className="text-base md:text-sm font-semibold text-gray-900 inline-flex items-center gap-1">
                                <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                                ${parseFloat(claim.amount || "0").toFixed(2)}
                              </span>
                            </div>
                            {paidFeeUsdc != null && paidFeeUsdc > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-base md:text-sm text-gray-500">Platform fee</span>
                                <span className="text-base md:text-sm text-gray-700">${paidFeeUsdc.toFixed(4)}</span>
                              </div>
                            )}
                            {paidFeeUsdc != null && (
                              <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                                <span className="text-base md:text-sm font-medium text-gray-500">You paid</span>
                                <span className="text-base md:text-sm font-semibold text-gray-900">
                                  ${(parseFloat(claim.amount || "0") + paidFeeUsdc).toFixed(4)}
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {paidFeeUsdc != null && paidFeeUsdc > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-base md:text-sm text-gray-500">Platform fee (deducted)</span>
                                <span className="text-base md:text-sm text-gray-700">${paidFeeUsdc.toFixed(4)}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className="text-base md:text-sm text-gray-500">Recipient receives</span>
                              <span className="text-base md:text-sm font-semibold text-gray-900 inline-flex items-center gap-1">
                                <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                                ${(parseFloat(claim.amount || "0") - (paidFeeUsdc ?? 0)).toFixed(2)}
                              </span>
                            </div>
                          </>
                        )}
                        {recipientLabel && (
                          <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                            <span className="text-base md:text-sm text-gray-500">Sent to</span>
                            <span className="text-base md:text-sm font-medium text-gray-900">{recipientLabel}</span>
                          </div>
                        )}
                        {claim.paid_at && (
                          <div className="flex items-center justify-between">
                            <span className="text-base md:text-sm text-gray-500">Paid</span>
                            <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claim.paid_at)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
                {/* Troubleshoot payment (localhost-only debug panel) — disabled for now, keep for later.
                {isClaimPageLocalhost &&
                  !!(claim?.recipient_pending_email || claim?.recipient_pending_username || claim?.claim_burner_address) && (
                    <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-amber-900">Troubleshoot payment</div>
                          <div className="text-base md:text-sm text-amber-800">
                            Check if funds are still in burner wallet or already swept.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={runBurnerTroubleshoot}
                          disabled={burnerDiagLoading}
                          className="inline-flex items-center justify-center rounded-lg bg-amber-500 text-white px-3 py-2 text-base md:text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                        >
                          {burnerDiagLoading ? "Checking..." : "Run check"}
                        </button>
                      </div>
                      {burnerDiag && (
                        <div className="mt-3 text-base md:text-sm text-amber-900 space-y-1">
                          <div>Burner: {burnerDiag.burnerAddress ? `${burnerDiag.burnerAddress.slice(0, 8)}...${burnerDiag.burnerAddress.slice(-6)}` : "none"}</div>
                          <div>Burner USDC: {burnerDiag.burnerUsdc}</div>
                          <div>PER deposit detected: {burnerDiag.perDepositDetected ? "yes" : "no"}</div>
                          <div>PER withdraw attempted: {burnerDiag.perWithdrawAttempted ? "yes" : "no"}</div>
                          {burnerDiag.perDepositAmountRaw !== undefined && (
                            <div>PER deposit amount: {(Number(burnerDiag.perDepositAmountRaw || "0") / 1_000_000).toFixed(6)} USDC</div>
                          )}
                          {burnerDiag.perWithdrawError && (
                            <div className="text-rose-700">PER withdraw error: {burnerDiag.perWithdrawError}</div>
                          )}
                          {burnerDiag.perDebugLog?.length ? (
                            <div className="rounded-md bg-black/5 p-2 text-[11px] text-slate-700 max-h-28 overflow-auto">
                              {burnerDiag.perDebugLog.map((line, idx) => (
                                <div key={idx}>- {line}</div>
                              ))}
                            </div>
                          ) : null}
                          <div>Private mode: {burnerDiag.isPrivate ? "yes" : "no"}</div>
                          <div>Paid with: {burnerDiag.paidWithToken || "-"} / {burnerDiag.paidWithChain || "-"}</div>
                          <div>Recipient wallet: {burnerDiag.recipientWallet ? `${burnerDiag.recipientWallet.slice(0, 8)}...${burnerDiag.recipientWallet.slice(-6)}` : "not available"}</div>
                          <div>Status: {burnerDiag.claimStatus}</div>
                          <div>
                            {Number(burnerDiag.burnerUsdcRaw || "0") > 0
                              ? "Funds are still in burner ATA. Claim/sweep is not completed yet."
                              : burnerDiag.perDepositDetected
                                ? "PER deposit exists. Funds may still be in PER state; withdraw-to-burner was attempted."
                                : burnerDiag.isPrivate
                                  ? "Burner ATA is empty. For MagicBlock PER/private flow, funds may still be in PER deposit state (not visible in burner ATA)."
                                  : "No USDC in burner ATA. Funds may already be swept to recipient wallet."}
                          </div>
                          {!!user?.id && (
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={retryClaimSweep}
                                disabled={retrySweepLoading}
                                className="inline-flex items-center justify-center rounded-lg bg-amber-600 text-white px-3 py-2 text-base md:text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                              >
                                {retrySweepLoading ? "Retrying..." : "Retry claim sweep"}
                              </button>
                              {isClaimPageLocalhost && claim?.created_by === user.id && (
                                <button
                                  type="button"
                                  onClick={reclaimBySender}
                                  disabled={reclaimingSenderFunds}
                                  className="ml-2 inline-flex items-center justify-center rounded-lg bg-slate-800 text-white px-3 py-2 text-base md:text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                                >
                                  {reclaimingSenderFunds ? "Withdrawing..." : "Withdraw from PER"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                */}
                {String(status || "").toUpperCase() !== "SUCCESS" && (
                  <div className="mt-6">
                    <PaymentStatusTracker
                      status={status}
                      statusData={statusData}
                      depositReceivedAt={latestIntentData?.depositReceivedAt || statusData?.updatedAt}
                      startedAt={claim.created_at}
                      fromChain={selectedFrom?.chain}
                      toChain={destToken?.chain}
                      depositAddress={deposit?.depositAddress}
                      isPrivate={claim?.is_private === true || privatePayActive}
                      paidAt={claim.paid_at}
                      paymentType={
                        deposit?.isDirect ? 'direct' :
                          deposit?.isCompanionSwap ? 'companion-swap' :
                            'near-intent'
                      }
                      isLooftaPay={
                        claim?.paid_with_token?.toUpperCase() === "USDC" &&
                        (claim?.paid_with_chain?.toLowerCase() === "solana" || claim?.paid_with_chain?.toLowerCase() === "sol")
                      }
                    />
                  </div>
                )}

              </>
            ) : (
              <>
                {!embedInApp && (
                  <div className="mb-3">
                    <div className="text-xl font-sans font-medium text-slate-300">
                      {(claim as { direction?: string } | null)?.direction === "from_sender" ? (
                        <>
                          {"Payment to "}
                          {(claim as { recipient_pending_username_value?: string } | null)?.recipient_pending_username_value
                            ? `@${(claim as { recipient_pending_username_value?: string }).recipient_pending_username_value}`
                            : claim?.recipient_username
                              ? `@${claim.recipient_username}`
                              : (claim as { recipient_pending_email_value?: string } | null)?.recipient_pending_email_value
                                ? (claim as { recipient_pending_email_value?: string }).recipient_pending_email_value
                                : claim?.recipient_email
                                  ? claim.recipient_email
                                  : null}
                        </>
                      ) : (
                        <>
                          {"Payment request from "}
                          {claim?.creator_username
                            ? `@${claim.creator_username}`
                            : claim?.creator_email || "Anonymous"}
                        </>
                      )}
                    </div>
                  </div>
                )}
                {!embedInApp && claim?.description && (
                  <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="text-base md:text-sm text-gray-600 mb-1">Message</div>
                    <div className="text-base text-gray-900 whitespace-pre-wrap break-words">
                      {(() => {
                        const desc = claim.description || '';
                        // Check if description contains GIF URLs (common patterns including Giphy)
                        const gifUrlPattern = /(https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\/[^\s]*)/gi;
                        const parts: string[] = [];
                        let lastIndex = 0;
                        let match;

                        // Reset regex lastIndex
                        gifUrlPattern.lastIndex = 0;

                        while ((match = gifUrlPattern.exec(desc)) !== null) {
                          // Add text before match
                          if (match.index > lastIndex) {
                            parts.push(desc.slice(lastIndex, match.index));
                          }
                          // Add GIF URL
                          parts.push(match[0]);
                          lastIndex = match.index + match[0].length;
                        }

                        // Add remaining text
                        if (lastIndex < desc.length) {
                          parts.push(desc.slice(lastIndex));
                        }

                        // If no matches, return original text
                        if (parts.length === 0) {
                          return desc;
                        }

                        return parts.map((part, idx) => {
                          // Check if this part is a GIF URL
                          if (gifUrlPattern.test(part) || part.match(/https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\//i)) {
                            // Convert Giphy URL to direct image URL if needed
                            let imageUrl = part;
                            if (part.includes('giphy.com') && !part.endsWith('.gif')) {
                              // Extract Giphy ID and use direct GIF URL
                              const giphyIdMatch = part.match(/giphy\.com\/media\/([^\/]+)/);
                              if (giphyIdMatch) {
                                imageUrl = `https://media.giphy.com/media/${giphyIdMatch[1]}/giphy.gif`;
                              } else {
                                // Try to get the original URL
                                imageUrl = part.replace(/\/$/, '') + '.gif';
                              }
                            }
                            return (
                              <img
                                key={idx}
                                src={imageUrl}
                                alt="GIF"
                                className="max-w-full h-auto rounded-lg mt-2 mb-2 block"
                                style={{ maxHeight: '200px', maxWidth: '100%' }}
                              />
                            );
                          }
                          return <span key={idx}>{part}</span>;
                        });
                      })()}
                    </div>
                  </div>
                )}
                {!embedInApp && <div className="text-base mt-2 text-slate-500">{(claim as { direction?: string } | null)?.direction === "from_sender" ? "Amount to send" : "Amount requested"}</div>}
                <div className={embedInApp ? "mt-2 flex items-baseline justify-between" : "mt-1 flex items-baseline justify-between"}>
                  <div className="text-3xl md:text-4xl font-sans font-semibold text-gray-900 leading-none">
                    {destUSD != null ? `$${destUSD.toFixed(2)}` : `—`}
                  </div>
                  <div className="text-base text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                      {destTokenAmount != null ? Number(parseFloat(String(destTokenAmount)).toFixed(4)) : "—"} {claim.to_symbol} {destToken?.chain ? `on ${destToken.chain.charAt(0).toUpperCase() + destToken.chain.slice(1)}` : ""}
                    </span>
                  </div>
                </div>
              </>
            )}

            {!isSenderPendingFundedView && !hidePaySectionForPendingClaimant && !isRecipient && !isCheckingRecipient && !["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED"].includes(String(status || claim?.status || "").toUpperCase()) && (!deposit ? (
              <>
                {/* Private indicator — only when payment is private */}
                {requiresPrivate && (
                  <div className="mt-5 flex gap-2 text-base md:text-sm text-gray-600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0 mt-0.5">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <p className="min-w-0 leading-relaxed">{PRIVATE_PAYMENT_ALL_PRIVATE_LINE}</p>
                  </div>
                )}

                {/* Minimum amount notice */}
                {claimAmountUSD > 0 && claimAmountUSD < 5 && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base md:text-sm text-amber-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    <span>Minimum payment amount is <strong>$5.00 USDC</strong>. This payment link cannot be paid.</span>
                  </div>
                )}


                {/* Payment breakdown */}
                <div className="mt-4">
                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="text-base md:text-sm font-medium font-sans text-gray-700 mb-2">Payment breakdown</div>
                    <div className="space-y-1.5 text-base md:text-sm">
                      {!requiresPrivate ? (
                        /* Non-private: no fees */
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">You pay</span>
                            <span className="font-semibold font-sans text-gray-900">${claimAmountUSD.toFixed(2)}</span>
                          </div>
                          <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                            <span className="font-medium font-sans text-gray-900">Recipient receives</span>
                            <span className="font-semibold font-sans text-lg text-gray-900">${claimAmountUSD.toFixed(2)}</span>
                          </div>
                        </>
                      ) : isFeeOnSender ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Recipient receives</span>
                            <span className="font-semibold font-sans text-gray-900">${claimAmountUSD.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Platform fee</span>
                            <span className="font-medium text-gray-700">~${(privatePayProtocolFee + privatePayGasFee).toFixed(3)}</span>
                          </div>
                          <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                            <span className="font-medium font-sans text-gray-900">You pay</span>
                            <span className="font-semibold font-sans text-lg text-gray-900">${privatePayTotal.toFixed(2)}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">You pay</span>
                            <span className="font-semibold font-sans text-gray-900">${claimAmountUSD.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Platform fee (deducted)</span>
                            <span className="font-medium text-gray-700">~${(privatePayProtocolFee + privatePayGasFee).toFixed(3)}</span>
                          </div>
                          <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                            <span className="font-medium font-sans text-gray-900">Recipient receives</span>
                            <span className="font-semibold font-sans text-lg text-gray-900">~${(claimAmountUSD - (privatePayProtocolFee + privatePayGasFee)).toFixed(2)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {mainnetViewOnly && (
                    <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-base md:text-sm text-amber-300 text-center">
                      You&apos;re viewing mainnet. Payments require{" "}
                      <a href="/app/waitlist" className="underline underline-offset-2 hover:text-amber-200">mainnet beta access</a>.
                    </div>
                  )}
                  {isWrongNetwork && claimExpectedNetwork && (
                    <div className="mt-4 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-base md:text-sm text-orange-400 text-center">
                      This payment link was created on <strong>{claimExpectedNetwork}</strong>. Switch your network to <strong>{claimExpectedNetwork}</strong> to pay.
                    </div>
                  )}

                  <div className="mt-4 flex gap-3">
                    {DEMO_MODE ? (
                      <Button
                        disabled
                        className="w-full rounded-xl"
                        style={{ background: '#9CA3AF' }}
                      >
                        Demo Mode - Payments Disabled
                      </Button>
                    ) : (
                      <GradientActionButton
                        onClick={async () => {
                          if (!authenticated) { login(); return; }
                          setPayWithLooftaError(null);
                          setPayWithWalletError(null);
                          setConfirmingTxSignature(null);
                          setConfirmingTxSource(null);
                          setPerTransferPhase(null);
                          setPendingFeeUsdc(null);
                          setPreBuilding(true);
                          try {
                            const fee = await preBuildFee();
                            if (fee != null) setPendingFeeUsdc(fee);
                          } finally {
                            setPreBuilding(false);
                          }
                          setShowPayNowModal(true);
                        }}
                        disabled={
                          preBuilding
                            ? true
                            : mainnetViewOnly
                              ? true
                              : isWrongNetwork
                                ? true
                                : claimAmountUSD < 5
                                  ? true
                                  : requiresPrivate && !isPrivateMode
                                    ? true
                                    : !authenticated
                                      ? false
                                      : !isPayerWalletReady || preparing || String(status || claim?.status || "").toUpperCase() === "SUCCESS"
                        }
                        loading={preBuilding || preparing || (authenticated && !isPayerWalletReady)}
                        loadingText={preBuilding ? "Calculating fees…" : "Wallet loading…"}
                      >
                        {isWrongNetwork && claimExpectedNetwork ? `Switch to ${claimExpectedNetwork}` : !authenticated ? "Sign in to pay" : "Pay now"}
                      </GradientActionButton>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {(() => {
                  const s = String(status || "").toUpperCase();
                  const isTerminal = s === "FAILED" || s === "REFUNDED";

                  // Check if deadline has expired (only for PENDING_DEPOSIT/INCOMPLETE_DEPOSIT)
                  const isExpired = (s === "PENDING_DEPOSIT" || s === "INCOMPLETE_DEPOSIT") && deposit?.deadline
                    ? new Date(deposit.deadline).getTime() < Date.now()
                    : false;

                  // If expired, show expired message
                  if (isExpired) {
                    return (
                      <div className="mt-6 text-center py-12">
                        <div className="mb-4 text-6xl">🔗</div>
                        <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                          Payment Link Expired
                        </h3>
                        <p className="text-gray-600 text-base mb-4">
                          This payment link has expired. The deadline was {deposit.deadline ? formatUTCTimestamp(deposit.deadline) : 'not set'}.
                        </p>
                        <p className="text-base md:text-sm text-gray-500">
                          Please request a new payment link from the sender.
                        </p>
                      </div>
                    );
                  }

                  // Get deposit address from multiple sources - ALWAYS show for PENDING_DEPOSIT/INCOMPLETE_DEPOSIT
                  const depositAddr = deposit?.depositAddress
                    || statusData?.quoteResponse?.quote?.depositAddress
                    || statusData?.depositAddress
                    || latestIntentData?.depositAddress;
                  const amountToSend = deposit?.minAmountInFormatted
                    || statusData?.quoteResponse?.quote?.amountInFormatted
                    || quote?.amountInFormatted;
                  const timeEstimate = statusData?.quoteResponse?.quote?.timeEstimate
                    || deposit?.timeEstimate;

                  // Debug log
                  if (!depositAddr && statusData) {
                    console.log('[DEBUG] No deposit address found. statusData:', {
                      hasQuoteResponse: !!statusData?.quoteResponse,
                      hasQuote: !!statusData?.quoteResponse?.quote,
                      depositAddress: statusData?.quoteResponse?.quote?.depositAddress,
                      statusDataKeys: Object.keys(statusData || {}),
                    });
                  }

                  // Show status tracker for active payment states (PROCESSING/KNOWN_DEPOSIT_TX only)
                  if (s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX") {
                    return (
                      <>
                        <div className="mt-6">
                          <PaymentStatusTracker
                            status={status}
                            statusData={statusData}
                            depositReceivedAt={latestIntentData?.depositReceivedAt || statusData?.updatedAt}
                            startedAt={deposit?.deadline ? new Date(deposit.deadline).toISOString() : undefined}
                            fromChain={selectedFrom?.chain}
                            toChain={destToken?.chain}
                            depositAddress={depositAddr}
                            timeEstimate={timeEstimate}
                            paymentType={
                              deposit?.isDirect ? 'direct' :
                                deposit?.isCompanionSwap ? 'companion-swap' :
                                  'near-intent'
                            }
                            isPrivate={claim?.is_private === true || privatePayActive}
                            isLooftaPay={
                              claim?.paid_with_token?.toUpperCase() === "USDC" &&
                              (claim?.paid_with_chain?.toLowerCase() === "solana" || claim?.paid_with_chain?.toLowerCase() === "sol")
                            }
                          />
                        </div>
                        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div className="text-lg font-semibold text-slate-200 mb-2">Payment summary</div>
                          <div className="text-base text-gray-700 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">{(claim as { direction?: string } | null)?.direction === "from_sender" ? "Amount paid" : "Amount requested"}</span>
                              <span className="text-lg font-semibold text-gray-900">
                                <span className="inline-flex items-center gap-1">
                                  <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={24} />
                                  {destTokenAmount != null ? roundUpDecimals(String(destTokenAmount), 6) : "—"} {claim.to_symbol}

                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  }
                  if (s === "SUCCESS") return null;
                  if (isTerminal) {
                    return (
                      <>
                        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3">
                          <div className="text-base md:text-sm font-semibold text-red-700">
                            {s === "FAILED" ? "Deposit failed." : "Deposit was refunded."}
                          </div>
                          <div className="text-base md:text-sm  text-red-700/80 mt-1">
                            Please try again with a different token or network.
                          </div>
                        </div>
                      </>
                    );
                  }

                  // For PENDING_DEPOSIT and INCOMPLETE_DEPOSIT - show deposit info FIRST, then status tracker
                  return (
                    <div className="mt-6">
                      {depositAddr ? (
                        <>
                          {/* Amount to Pay - AT THE TOP */}
                          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <div className="text-base text-gray-700 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">Amount to pay</span>
                                <span className="text-lg font-medium text-gray-900 inline-flex items-center gap-2">
                                  <TokenIcon
                                    token={(selectedFrom as any) ?? (destToken as any) ?? undefined}
                                    chain={(selectedFrom?.chain as any) ?? (destToken?.chain as any)}
                                    size={24}
                                  />
                                  <span>
                                    {amountToSend && selectedFrom
                                      ? `${roundUpDecimals(amountToSend, 6)} ${selectedFrom.symbol}`
                                      : quote?.amountInFormatted && selectedFrom
                                        ? `${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                                        : `${roundUpDecimals(claim.amount, 6)} ${claim.to_symbol}`}
                                  </span>
                                  <button
                                    type="button"
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors ml-2"
                                    onClick={async () => {
                                      try {
                                        const amountToCopy = amountToSend && selectedFrom
                                          ? roundUpDecimals(amountToSend, 6)
                                          : quote?.amountInFormatted && selectedFrom
                                            ? roundUpDecimals(quote.amountInFormatted, 6)
                                            : roundUpDecimals(claim.amount, 6);
                                        await navigator.clipboard.writeText(amountToCopy);
                                        toast({ title: "Copied", description: "Amount copied to clipboard." });
                                      } catch {
                                        toast({ variant: "destructive", title: "Copy failed", description: "Could not copy amount. Please try again." });
                                      }
                                    }}
                                    title="Copy amount"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                                      <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                                    </svg>
                                  </button>
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">Deposit address</span>
                                <span className="text-lg font-medium text-gray-900 inline-flex items-center gap-2">
                                  <span className="font-display  text-base md:text-sm break-all">
                                    {depositAddr}
                                  </span>
                                  <button
                                    type="button"
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-md  border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors ml-2"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard.writeText(depositAddr);
                                        toast({ title: "Copied", description: "Deposit address copied to clipboard." });
                                      } catch {
                                        toast({ variant: "destructive", title: "Copy failed", description: "Could not copy address. Please try again." });
                                      }
                                    }}
                                    title="Copy address"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                                      <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                                    </svg>
                                  </button>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Additional Info - Simplified, unified styling */}
                          <div className="mt-4 space-y-2">
                            {/* Payment type info - subtle text only */}
                            {deposit?.isCompanionSwap ? (
                              <div className="text-base md:text-sm text-gray-600">
                                <span className="font-medium text-gray-700">Same-chain swap:</span> Send {selectedFrom?.symbol} to this address. We'll swap to {claim?.to_symbol} and send to recipient.
                                {deposit?.fee && <span className="ml-1 text-gray-500">({deposit.fee} fee)</span>}
                              </div>
                            ) : deposit?.isDirect ? (
                              <div className="text-base md:text-sm text-gray-600">
                                <span className="font-medium text-gray-700">Direct transfer:</span> Send {selectedFrom?.symbol} directly to recipient. Same token, same chain.
                              </div>
                            ) : null}

                            {/* Incomplete deposit - subtle warning */}
                            {String(status || "").toUpperCase() === "INCOMPLETE_DEPOSIT" ? (
                              <div className="text-base md:text-sm text-gray-600 pt-1 border-t border-gray-200">
                                <span className="font-medium text-gray-700">Partial deposit:</span> {(() => {
                                  const depStr = String(statusData?.swapDetails?.depositedAmountFormatted ?? "");
                                  const minStr = String(deposit?.minDepositFormatted ?? "");
                                  const dep = parseFloat(depStr);
                                  const min = parseFloat(minStr);
                                  const sym = selectedFrom?.symbol || claim?.to_symbol || "";
                                  if (Number.isFinite(min) && Number.isFinite(dep)) {
                                    const remaining = Math.max(min - dep, 0);
                                    const topUp = roundUpDecimals(remaining, 6);
                                    return `Deposited ${roundUpDecimals(dep, 6)} ${sym}, need ${topUp} ${sym} more.`;
                                  }
                                  return "Please send the remaining amount.";
                                })()}
                              </div>
                            ) : null}

                            {/* Speed up form - shown when speedUpOpen is true */}
                            {speedUpOpen && (
                              <div className="pt-1 border-t border-gray-200 space-y-2">
                                <div className="text-base md:text-sm text-gray-700 font-medium">Submit transaction hash</div>
                                <div className="flex items-center gap-2">
                                  <Input
                                    value={txInput}
                                    onChange={(e) => setTxInput(e.target.value)}
                                    placeholder="0x... or explorer link"
                                    className="flex-1"
                                  />
                                  <Button
                                    onClick={onSubmitTxHash}
                                    disabled={submittingTx || !txInput}
                                    className="rounded-xl"
                                    style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                                  >
                                    {submittingTx ? "Submitting…" : "Submit"}
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Memo - if exists */}
                            {deposit?.memo ? (
                              <div className="pt-1 border-t border-gray-200">
                                <div className="text-base md:text-sm text-gray-600">
                                  <span className="font-medium text-gray-700">Memo:</span> <span className="font-mono">{deposit.memo}</span>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* Animated Character and Status Message - ABOVE QR CODE */}
                          {(() => {
                            const s = String(status || "PENDING_DEPOSIT").toUpperCase();
                            let statusTitle = "Waiting for Deposit";
                            let statusSubtitle: string | React.ReactNode = "Send the exact amount to the deposit address shown above.";
                            const isProcessing = s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX" || s === "PRIVATE_TRANSFER_PENDING";
                            const isSuccess = s === "SUCCESS";
                            const isWaiting = s === "PENDING_DEPOSIT" || !status;

                            if (s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX") {
                              statusTitle = "Route & swapping";
                              statusSubtitle = "We're routing your funds and executing the swap. This usually takes 1-2 minutes.";
                            } else if (s === "PRIVATE_TRANSFER_PENDING") {
                              statusTitle = "Performing private deposit";
                              statusSubtitle = "Funds are in your wallet. Complete the private transfer to the recipient using the button below.";
                            } else if (s === "INCOMPLETE_DEPOSIT") {
                              statusTitle = "Incomplete Deposit";
                              statusSubtitle = "Please send the remaining amount to complete your payment.";
                            } else if (s === "SUCCESS") {
                              statusTitle = "Payment Complete! 🎉";
                              statusSubtitle = "Your funds have been successfully sent to the recipient.";
                            } else if (s === "REFUNDED") {
                              statusTitle = "Payment Refunded";
                              statusSubtitle = "Your deposit has been refunded. Please check your wallet.";
                            } else if (s === "FAILED") {
                              statusTitle = "Payment Failed";
                              statusSubtitle = "The payment could not be completed. Your funds may be refunded.";
                            }

                            // For PENDING_DEPOSIT, add important info and speed up link to subtitle
                            if (isWaiting && !deposit?.isCompanionSwap && !deposit?.isDirect) {
                              statusSubtitle = (
                                <>
                                  Send the exact amount to the deposit address shown above.
                                  <br />
                                  <span className="text-base font-medium block">Only deposit {selectedFrom?.symbol} from {String(selectedFrom?.chain || "").toUpperCase()} network.</span>
                                  {!speedUpOpen && (
                                    <>
                                      <br />
                                      <button
                                        type="button"
                                        className="text-base md:text-sm text-gray-600 hover:text-gray-900 underline mt-1"
                                        onClick={() => setSpeedUpOpen(true)}
                                      >
                                        Already deposited? Speed up processing
                                      </button>
                                    </>
                                  )}
                                </>
                              );
                            }

                            return (
                              <div className="mb-6 mt-6 text-center">
                                {/* Animated Character */}
                                <div className="mb-4 flex justify-center">
                                  {isProcessing ? (
                                    <motion.div
                                      animate={{ rotate: [0, 10, -10, 10, -10, 0] }}
                                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                      className="text-6xl"
                                    >
                                      ⚡
                                    </motion.div>
                                  ) : isSuccess ? (
                                    <motion.div
                                      initial={{ scale: 0 }}
                                      animate={{ scale: [0, 1.2, 1] }}
                                      transition={{ duration: 0.5 }}
                                      className="text-6xl"
                                    >
                                      🎉
                                    </motion.div>
                                  ) : isWaiting ? (
                                    <motion.div
                                      animate={{ y: [0, -10, 0] }}
                                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                      className="text-6xl"
                                    >
                                      💳
                                    </motion.div>
                                  ) : (
                                    <div className="text-6xl">💳</div>
                                  )}
                                </div>

                                {/* Status Message */}
                                <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                                  {statusTitle}
                                </h3>
                                <div className="text-gray-600 text-base">
                                  {typeof statusSubtitle === 'string' ? statusSubtitle : statusSubtitle}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Progress Bar and Step Counter - BELOW QR CODE */}
                          {(() => {
                            // Calculate steps and progress based on status
                            const s = String(status || "PENDING_DEPOSIT").toUpperCase();
                            let completedSteps = 0;
                            const totalSteps = 5; // deposit, routing, processing, private deposit, success

                            if (s === 'SUCCESS') {
                              completedSteps = 5;
                            } else if (s === 'PRIVATE_TRANSFER_PENDING') {
                              completedSteps = 3; // Route done, performing private deposit step
                            } else if (s === 'PROCESSING' || s === 'KNOWN_DEPOSIT_TX') {
                              completedSteps = 1; // Deposit completed, routing active
                            } else if (s === 'INCOMPLETE_DEPOSIT') {
                              completedSteps = 0; // Deposit active but incomplete
                            } else {
                              completedSteps = 0; // PENDING_DEPOSIT
                            }

                            const progress = (completedSteps / (totalSteps - 1)) * 100; // -1 because success step doesn't count

                            return (
                              <div className="mb-6">
                                {/* Progress Bar */}
                                <div className="mb-2">
                                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${progress}%` }}
                                      transition={{ duration: 0.5, ease: 'easeOut' }}
                                      className="h-full rounded-full"
                                      style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                                    />
                                  </div>
                                </div>
                                {/* Step Counter */}
                                <div className="text-center text-base md:text-sm text-gray-500">
                                  Step {completedSteps} of {totalSteps - 1}
                                </div>
                              </div>
                            );
                          })()}

                          {/* PRIVATE_TRANSFER_PENDING */}
                          {String(status || "").toUpperCase() === "PRIVATE_TRANSFER_PENDING" && claim?.is_private && (
                            <div className="mb-6 p-4 rounded-xl border-2 border-amber-200 bg-amber-50">
                              <p className="text-base md:text-sm text-amber-900">
                                Processing private transfer…
                              </p>
                            </div>
                          )}

                          {/* QR Code and Deposit Address - BELOW STATUS MESSAGE */}
                          <div className="mb-6 hidden">
                            <div className="text-base font-medium text-gray-700 mb-4">Scan to pay</div>
                            <div className="flex flex-col items-center gap-6">
                              {/* QR Code */}
                              <div className="flex items-center justify-center p-6 bg-white rounded-xl border-2 border-gray-200 shadow-sm">
                                <QRCodeSVG
                                  value={depositAddr}
                                  size={100}
                                  level="M"
                                  includeMargin={true}
                                  fgColor="#000000"
                                  bgColor="#ffffff"
                                />
                              </div>


                            </div>
                          </div>


                          {/* Timeline/Steps - BELOW PROGRESS BAR */}
                          <div className="mb-6">
                            <PaymentStatusTracker
                              status={status || "PENDING_DEPOSIT"}
                              statusData={statusData}
                              depositReceivedAt={latestIntentData?.depositReceivedAt || (status === "PROCESSING" ? statusData?.updatedAt : null)}
                              startedAt={deposit?.deadline ? new Date(deposit.deadline).toISOString() : undefined}
                              fromChain={selectedFrom?.chain}
                              toChain={destToken?.chain}
                              depositAddress={depositAddr}
                              timeEstimate={timeEstimate}
                              paymentType={
                                deposit?.isDirect ? 'direct' :
                                  deposit?.isCompanionSwap ? 'companion-swap' :
                                    'near-intent'
                              }
                              isPrivate={claim?.is_private === true || privatePayActive}
                              isLooftaPay={
                                claim?.paid_with_token?.toUpperCase() === "USDC" &&
                                (claim?.paid_with_chain?.toLowerCase() === "solana" || claim?.paid_with_chain?.toLowerCase() === "sol")
                              }
                            />
                          </div>

                          {/* Cancel/Change Token Button - AT THE BOTTOM */}
                          <div className="mt-6 flex justify-center">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setDeposit(null);
                                setStatus(null);
                                setFromSel(undefined);
                                // Reset refund address - will be auto-populated by useEffect
                                setRefundAddress("");
                                setRefundAddressError(null);
                                userCancelled.current = true;
                                useClaimPayStore.getState().clear(id);
                                toast({ title: "Cancelled", description: "You can now choose a different token." });
                              }}
                              className="text-base md:text-sm"
                            >
                              Cancel & Choose Different Token
                            </Button>
                          </div>
                        </>
                      ) : null}
                      {/* Deadline at the very bottom */}
                      {deposit?.deadline ? (
                        <div className="mt-3 text-base md:text-sm text-gray-700">Deadline: <span className="font-medium">{formatUTCTimestamp(deposit.deadline)}</span></div>
                      ) : null}
                    </div>
                  );
                })()}
              </>
            ))}
          </>
        ) : (
          <PaymentNotFoundNotice
            message="This link may have expired, been cancelled, or never existed."
            hint={
              !hasTwitterLinked || !hasEmailLinked
                ? "It might also be waiting on an email or X handle you haven't added to your account yet."
                : null
            }
            showLinkButtons
            hasTwitterLinked={hasTwitterLinked}
            hasEmailLinked={hasEmailLinked}
            onConnectTwitter={() => linkTwitter()}
            onConnectEmail={() => linkEmail()}
            isConfirmingIdentity={isConfirmingIdentity}
          />
        )}
      </ClaimPayLayout>

      {/* Pay Now modal: same centered style as onboarding (emoji + amount + subtitle), then 2 options */}
      <Dialog
        open={showPayNowModal}
        onOpenChange={(open) => {
          if (!open && payNowModalDismissLocked) return;
          setShowPayNowModal(open);
          if (open) {
            setPayWithLooftaError(null);
            setPayWithWalletError(null);
            setConfirmingTxSignature(null);
            setConfirmingTxSource(null);
            setPerTransferPhase(null);
          }
        }}
      >
        <DialogContent
          className={cn(
            "sm:max-w-md p-8 border-white/10 bg-[#0f0f12] text-white shadow-2xl [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.text-muted-foreground]:!text-slate-400 [&_.bg-gray-50]:!bg-white/5 [&_.bg-white]:!bg-white/10 [&_.border-gray-200]:!border-white/10 [&_.ring-offset-background]:!ring-offset-[#0f0f12] [&_.bg-red-50]:!bg-red-500/15 [&_.border-red-200]:!border-red-400/30 [&_.text-red-800]:!text-red-200 [&_.bg-emerald-50]:!bg-emerald-500/15 [&_.border-emerald-200]:!border-emerald-400/30 [&_.bg-emerald-100]:!bg-emerald-500/20 [&_.text-emerald-600]:!text-emerald-300 [&_.bg-orange-50]:!bg-orange-500/15 [&_.border-orange-200]:!border-orange-400/30 [&_.bg-orange-100]:!bg-orange-500/20 [&_.text-orange-600]:!text-orange-300 [&_.text-orange-500]:!text-orange-300 [&_.bg-amber-50]:!bg-amber-500/15 [&_.text-amber-600]:!text-amber-300 [&>*:last-child]:!text-slate-400 [&>*:last-child:hover]:!text-white [&>*:last-child:hover]:!bg-white/10",
            payNowModalDismissLocked && "[&>button.absolute.right-4.top-4]:pointer-events-none [&>button.absolute.right-4.top-4]:opacity-0",
          )}
          aria-describedby={undefined}
          onPointerDownOutside={(e) => { if (payNowModalDismissLocked) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (payNowModalDismissLocked) e.preventDefault(); }}
        >
          <DialogTitle id="pay-now-dialog-title" className="sr-only">
            {confirmingTxSignature
              ? "Transaction on the way"
              : perTransferPhase
                ? "Payment in progress"
                : claim?.amount
                  ? `Pay $${isFeeOnSender ? privatePayTotal.toFixed(2) : claimAmountUSD.toFixed(2)}`
                  : "Pay now"}
          </DialogTitle>
          {confirmingTxSignature ? (
            <>
              <DialogHeader className="flex flex-col items-center justify-center text-center space-y-0 pb-4 sm:text-center" aria-hidden>
                <div className="mb-4 flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                  </div>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 text-center">
                  Transaction on the way
                </h2>
                <p className="pt-2 text-base text-center text-muted-foreground">
                  Your payment is submitted. We're waiting for Solana to confirm — usually 10–30 seconds.
                </p>
                {confirmingTxSource && (
                  <p className="pt-1 text-base md:text-sm text-gray-500">
                    Paying with {confirmingTxSource === "loofta" ? "Loofta balance" : "your wallet"}
                  </p>
                )}
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base md:text-sm font-medium text-gray-900">Signed & sent</p>
                    <p className="text-base md:text-sm text-gray-600">Transaction is on the network</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100">
                    <Send className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base md:text-sm font-medium text-gray-900">Confirming</p>
                    <p className="text-base md:text-sm text-gray-900">Waiting for on-chain confirmation…</p>
                  </div>
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-orange-500" />
                </div>
                <a
                  href={getExplorerTxUrl("solana", confirmingTxSignature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 py-2.5 text-base md:text-sm font-medium text-orange-600 hover:bg-orange-50 hover:border-orange-200 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                  tabIndex={0}
                >
                  View transaction on {getExplorerName("solana")}
                </a>
              </div>
            </>
          ) : (payingWithLoofta || payingWithWallet) && perTransferPhase ? (
            <>
              <DialogHeader className="flex flex-col items-center justify-center text-center space-y-0 pb-4 sm:text-center" aria-hidden>
                <div className="mb-4 flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                  </div>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 text-center">
                  {perTransferPhase.phase === "preparing" && "Preparing payment"}
                  {perTransferPhase.phase === "awaiting_signature" && "Approve in your wallet"}
                  {perTransferPhase.phase === "broadcasting" && "Finishing on-chain steps"}
                </h2>
                <p className="pt-2 text-base md:text-sm text-center text-muted-foreground max-w-sm">
                  {perTransferPhase.phase === "preparing" &&
                    "Setting up MagicBlock session and transactions. Please keep this window open."}
                  {perTransferPhase.phase === "awaiting_signature" && (
                    <>
                      Your wallet may show{" "}
                      <span className="font-medium text-orange-600">
                        {perTransferPhase.walletTransactionCount} transaction
                        {perTransferPhase.walletTransactionCount === 1 ? "" : "s"}
                      </span>{" "}
                      in one approval. Do not close this tab until you finish signing.
                      {payingWithWallet && networkMode === "devnet" && (
                        <span className="block mt-2 text-amber-600 font-medium">
                          Phantom will show a simulation warning — tap "Confirm (unsafe)" to proceed.
                        </span>
                      )}
                    </>
                  )}
                  {perTransferPhase.phase === "broadcasting" && (
                    <>
                      Step {perTransferPhase.index} of {perTransferPhase.total}:{" "}
                      <span className="font-medium text-orange-600">
                        {formatPerTransferStepName(perTransferPhase.step)}
                      </span>
                      . Confirmations can take a few seconds each.
                    </>
                  )}
                </p>
              </DialogHeader>
              <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 text-center text-base md:text-sm text-amber-950">
                Stay on this page until the payment completes.
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="flex flex-col items-center justify-center text-center space-y-0 pb-5 sm:text-center" aria-hidden>
                <div className="mb-3 text-4xl">💳</div>
                <h2 className="text-xl font-semibold text-gray-900 text-center">
                  Pay ${isFeeOnSender
                    ? (pendingFeeUsdc != null ? claimAmountUSD + pendingFeeUsdc : privatePayTotal).toFixed(2)
                    : claimAmountUSD.toFixed(2)}
                </h2>
                <p className="pt-0.5 text-base md:text-sm text-center text-muted-foreground">
                  {isFeeOnSender ? (
                    <>${claimAmountUSD.toFixed(2)} + {pendingFeeUsdc != null ? "" : "~"}$
                      {pendingFeeUsdc != null
                        ? pendingFeeUsdc.toFixed(3)
                        : (privatePayProtocolFee + privatePayGasFee).toFixed(3)}{" "}
                      fee</>
                  ) : (
                    <>fees deducted from recipient</>
                  )}
                </p>
              </DialogHeader>
              <div className="space-y-3">
                {(() => {
                  const needed = isFeeOnSender
                    ? (pendingFeeUsdc != null ? claimAmountUSD + pendingFeeUsdc : privatePayTotal)
                    : claimAmountUSD;
                  const hasEnough = solanaPayment.hasEnoughBalance(needed);
                  const isLoading = solanaPayment.isBalanceLoading;
                  if (!isLoading && !hasEnough) {
                    return (
                      <>
                        <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5">
                          <LooftaIcon className="w-8 h-8 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-white">Loofta wallet</div>
                            <div className="text-base md:text-sm text-amber-400 mt-0.5">
                              ${looftaBalanceUSD.toFixed(2)} available — ${needed.toFixed(2)} needed
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPayNowModal(false);
                            window.dispatchEvent(new CustomEvent("openBalanceModal"));
                          }}
                          className="w-full h-12 rounded-xl font-semibold text-base border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
                        >
                          Add funds to your balance
                        </button>
                      </>
                    );
                  }
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => payWithLooftaBalance()}
                        disabled={!authenticated || !isPayerWalletReady || isLoading}
                        className="w-full flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LooftaIcon className="w-8 h-8 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-white">Loofta wallet</div>
                          <div className="text-base md:text-sm text-slate-400 mt-0.5">
                            {isLoading ? "Loading balance…" : `$${looftaBalanceUSD.toFixed(2)} available`}
                          </div>
                        </div>
                        <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
                      </button>
                      {payWithLooftaError && (
                        <div className="space-y-2">
                          <div className="p-3 rounded-lg bg-red-500/15 border border-red-400/30 text-base md:text-sm text-red-200 [overflow-wrap:anywhere] whitespace-pre-wrap">
                            <strong>Payment failed:</strong> {payWithLooftaError}
                          </div>
                          <button
                            type="button"
                            onClick={() => { setPayWithLooftaError(null); payWithLooftaBalance(false); }}
                            className="w-full py-2.5 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-base md:text-sm text-slate-300 transition-colors"
                          >
                            Try without gas sponsorship
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>


    </>
  );
}

export default function ClaimPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return (
    <React.Suspense>
      <ClaimPayView claimId={id} />
    </React.Suspense>
  );
}


