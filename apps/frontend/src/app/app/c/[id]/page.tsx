'use client'
import { clientApiBase } from "@/services/api/client";

import React, { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { invalidateAfterRecipientUpdate } from "@/lib/invalidateAfterRecipientUpdate";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { trimDecimals, roundUpDecimals, formatUTCTimestamp } from "@/lib/format";
import { findTokenBySelection } from "@/lib/tokens";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { sora } from "@/components/home-v4/fonts";
import { useClaimPayStore } from "@/store/claimPay";
import { useAuthStore } from "@/store/auth";
import { DescriptionWithGif } from "@/components/DescriptionWithGif";
import { TokenIcon } from "@/components/TokenIcon";
import { InsufficientBalanceCard } from "@/components/app/InsufficientBalanceCard";
import { GuestCheckoutPay } from "@/components/app/GuestCheckoutPay";
import { UNREGISTERED_ACCOUNT_FEE_USD } from "@/lib/unregisteredAccountFee";
import Image from "next/image";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRight, Wallet, LogIn, CheckCircle2, Send, Copy, Check, Mail, AtSign, AlertTriangle, User, ChevronLeft, Landmark, Lock, ShoppingBag, CreditCard, Globe, Users } from "lucide-react";
import { ShareLinkMenu } from "@/components/ShareLinkMenu";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import {
  pajLinkStatus,
  pajListBankAccounts,
  pajGetValue,
  pajListBanks,
  pajConfirmBankAccount,
  pajSaveBankAccount,
  pajSetDefaultBankAccount,
  PajCashApiError,
  type PajSavedBankAccount,
  type PajBank,
  type PajResolvedBankAccount,
} from "@/services/pajCash";
import { computeLooftaFeeUsdc } from "@/lib/pajCashFee";
import { PEER_PLATFORMS } from "@/lib/peerPlatforms";
import { cashoutPayoutUsdc, getPeerEstimate, usdc as peerUsdc } from "@/services/peerCash";
import { SolanaWalletConnectProvider, useWallet, WalletMultiButton } from "@/components/SolanaWalletConnect";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { isGuestSentClaim } from "@/lib/guestSentClaims";
import { getClientGeo } from "@/lib/geo";
import { PajCashLinkFlow } from "@/components/paj-cash/PajCashLinkFlow";
import { BankCombobox } from "@/components/paj-cash/BankCombobox";
const PAJ_CASH_ENABLED = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === "true";

const PAYOUT_METHOD_LABEL: Record<string, string> = {
  wallet: "Loofta wallet",
  external: "External wallet",
  near: "Any crypto",
  venmo: "Venmo",
  cashapp: "Cash App",
  revolut: "Revolut",
  zelle: "Zelle",
  coinbase: "Coinbase",
  paj: "PAJ Cash",
};

const PEER_PAYOUT_METHODS = new Set(["venmo", "cashapp", "revolut", "zelle"]);

function payoutStatusCopy(status: string): string {
  if (status === "in_wallet") return "In your Loofta wallet";
  if (status === "cashing_out") return "Cash out in progress";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Needs attention";
  return "Claimed";
}

function DepositIcons({ icons }: { icons: { src: string; bg: string }[] }) {
  return (
    <span className="flex shrink-0">
      {icons.map((icon, i) => (
        <span
          key={`${icon.src}-${i}`}
          className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border-2 border-[#141418]"
          style={{ background: icon.bg, marginLeft: i ? -8 : 0 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" className="h-5 w-5 object-contain" />
        </span>
      ))}
    </span>
  );
}

/** Fills the external-wallet field from Phantom, Solflare, or any Wallet Standard wallet. */
function ConnectExternalWalletButton({ onAddress }: { onAddress: (address: string) => void }) {
  const { publicKey, connected } = useWallet();
  useEffect(() => {
    if (connected && publicKey) onAddress(publicKey.toBase58());
  }, [connected, publicKey, onAddress]);
  return (
    <WalletMultiButton
      style={{
        width: "100%",
        height: 44,
        justifyContent: "center",
        borderRadius: 12,
        fontSize: 15,
        fontWeight: 600,
      }}
    />
  );
}
const EVM_CHAIN_SET = new Set(["eth", "ethereum", "arb", "arbitrum", "base", "op", "optimism", "bsc", "avax", "avalanche", "polygon", "matic", "fantom", "ftm", "gnosis", "linea", "scroll", "zksync", "zk", "blast", "pol"]);
function isEvmChainId(chain?: string): boolean { return EVM_CHAIN_SET.has(String(chain || "").toLowerCase()); }
import { usePrivy, useWallets as useEvmWallets, useLinkAccount } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction as usePrivySolanaSignTransaction,
} from "@privy-io/react-auth/solana";
import { isDemoMode } from "@/config/demoMode";
import { getSplAtaBalanceBaseUnits, getUsdcAtaBalanceBaseUnits } from "@/services/solanaBalance";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { getRefundToForChain, isValidAddressForChain } from "@/lib/refundAddresses";
import { getExplorerTxUrl, getExplorerName } from "@/lib/getExplorerTxUrl";
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
import { usePerPrivateTransfer, type PerTransferProgress } from "@/hooks/usePerPrivateTransfer";
import { PrivacyTimingControls } from "@/components/app/PrivacyTimingControls";
import { PrivateWaitingLoader } from "@/components/PrivateWaitingLoader";
import { DEFAULT_SPREAD_MS, formatDelayDuration, randomPrivacySplit } from "@/lib/privacyDelay";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { getSolanaCluster } from "@/lib/solanaCluster";
import { phantomWalletToAnchorWallet, privyStandardWalletToAnchorWallet } from "@/lib/per/signer";
import { PaymentHistoryClaim } from "@/app/app/history/page";
import type { NearToken } from "@/services/nearIntents";
import {
  privatePaymentAllPrivateLine,
  privatePaymentFundsAppearCopy,
  privatePaymentWaitingAfterSenderCopy,
  privateFundsLandedAt,
} from "@/lib/privatePaymentCopy";
import { buildClaimPrivateTransfer } from "@/services/api/claims";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { fetchSolanaFeePayerAddress } from "@/services/solanaSponsor";
import { SocialPlatformIcon, type SocialIconPlatform } from "@/components/SocialPlatformIcon";
import { TELEGRAM_SEND_ENABLED } from "@/lib/socialPlatforms";
import { PrivacyGlyph } from "@/components/PrivacyGlyph";
import { PrivacyConfettiBurst } from "@/components/PrivacyConfettiBurst";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
/** Crypto card (Jam Card pilot) claim destination — UI placeholder only, no real payout wired up
 *  yet. Jam's card network (Visa/Mastercard), partner API, and KYC field requirements are still
 *  unconfirmed (see project_jamcard_pilot_evaluation memory) — flip once that integration exists. */
const SHOW_CRYPTO_CARD_CLAIM = false;

type CryptoClaimMethod = "wallet" | "external" | "anyToken";
type CashClaimMethod = "naira" | "p2p" | "card";
const CRYPTO_CLAIM_METHODS: readonly CryptoClaimMethod[] = ["wallet", "external", "anyToken"];
const CASH_CLAIM_METHODS: readonly CashClaimMethod[] = ["naira", "p2p", "card"];
const CRYPTO_CLAIM_PREF_KEY = "loofta:preferredClaimCryptoMethod";
const CASH_CLAIM_PREF_KEY = "loofta:preferredClaimCashMethod";

/** Per-viewer convenience only (which destination row shows first) — never anything load-bearing,
 *  so a cleared/blocked localStorage just falls back to the given default. */
function readPreferredClaimMethod<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key) as T | null;
    return v && (valid as readonly string[]).includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function rememberPreferredClaimMethod(key: string, method: string) {
  try {
    window.localStorage.setItem(key, method);
  } catch {
    // best-effort only
  }
}

// ─── Dev preview: jump the claim-panel/sender-card UI into any state via ?preview=... ─────────
// Disabled for now (localhost included). Flip this back on to restore the panel and overrides.
// Same pattern as /app/megapot's DevPreviewPanel — localhost-only, overrides local derived
// booleans on the REAL page instead of mocking a separate component, so what you see is the
// actual render path. Visit any real claim link (any [id] works) and append ?preview=<key>.
const CLAIM_DEV_PREVIEW_ENABLED = false;
//
// "Waiting to be paid" and the generic sender view need no override — they're just what a real
// unpaid claim's own link shows by default, before any preview param.
const DEV_PREVIEW_STATES: Record<
  string,
  {
    showBankClaimOption?: boolean;
    canClaimPrivately?: boolean;
    walletNotReady?: boolean;
    waitingForBurnerFunds?: boolean;
    isPrivateMode?: boolean;
    forcePrivatelyPaidNotice?: boolean;
    forceClaimingScreen?: boolean;
  }
> = {
  "recipient-paj": { showBankClaimOption: true, canClaimPrivately: true, walletNotReady: false, waitingForBurnerFunds: false },
  "recipient-no-paj": { showBankClaimOption: false, canClaimPrivately: true, walletNotReady: false, waitingForBurnerFunds: false },
  "recipient-wallet-setup": { showBankClaimOption: true, canClaimPrivately: true, walletNotReady: true, waitingForBurnerFunds: false },
  "recipient-funds-pending": { showBankClaimOption: true, canClaimPrivately: false, walletNotReady: false, waitingForBurnerFunds: true },
  "recipient-claiming": { forceClaimingScreen: true },
  "recipient-paid-public": { showBankClaimOption: false, canClaimPrivately: false, walletNotReady: false, waitingForBurnerFunds: false },
  "recipient-paid-private": { showBankClaimOption: false, canClaimPrivately: false, walletNotReady: false, waitingForBurnerFunds: false, forcePrivatelyPaidNotice: true },
  "sender-public": { isPrivateMode: false },
  "sender-private": { isPrivateMode: true },
};

const DEV_PREVIEW_LINKS: { key: keyof typeof DEV_PREVIEW_STATES; label: string }[] = [
  { key: "recipient-paj", label: "Recipient — has PAJ Cash" },
  { key: "recipient-no-paj", label: "Recipient — no PAJ account" },
  { key: "recipient-wallet-setup", label: "Recipient — wallet setting up" },
  { key: "recipient-funds-pending", label: "Recipient — funds pending" },
  { key: "recipient-claiming", label: "Recipient — payment on its way" },
  { key: "recipient-paid-public", label: "Recipient — sender paid publicly" },
  { key: "recipient-paid-private", label: "Recipient — sender paid privately" },
  { key: "sender-public", label: "Sender — public" },
  { key: "sender-private", label: "Sender — private/incognito" },
];

function DevPreviewPanel() {
  const pathname = usePathname();
  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-1 p-2 rounded-2xl bg-black/85 backdrop-blur border border-white/10 shadow-2xl max-h-[80vh] overflow-y-auto">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1.5 pt-0.5">Preview state (dev)</p>
      <Link
        href={pathname}
        className="text-sm font-medium text-slate-500 hover:text-white hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors"
      >
        Reset (real data)
      </Link>
      {DEV_PREVIEW_LINKS.map((l) => (
        <Link
          key={l.key}
          href={`${pathname}?preview=${l.key}`}
          className="text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/** Small icon-only mark on the top edge of the pay card — the incognito-mode "window chrome
 *  changes" moment (à la Brave/Chrome private windows). Caller wraps this in <AnimatePresence>
 *  and conditionally renders it (rather than this component owning its own AnimatePresence) so
 *  the mount/unmount transition actually animates — AnimatePresence has to stay mounted across
 *  the toggle, not be unmounted along with its child. No label, no glow — just the mask icon;
 *  hover for what it means. An earlier version with a floating ghost mascot, then a labeled
 *  pill, both read as more of a privacy red flag than a reassurance in user feedback. */
function IncognitoCardBadge() {
  // x: "-50%" lives in the animate props (not a `-translate-x-1/2` class) because framer-motion
  // writes its own inline `transform` for y/scale every frame, which was clobbering the
  // Tailwind class's translateX and left the badge visibly off-center.
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.92, x: "-50%" }}
      animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
      exit={{ opacity: 0, y: 8, scale: 0.92, x: "-50%" }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="absolute -top-5 left-1/2 z-10 select-none"
    >
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center justify-center p-1.5 [filter:drop-shadow(0_2px_5px_rgba(0,0,0,0.6))]">
              {/* VenetianMask's own glyph sits low in its viewBox (more empty space above than
                  below) — nudge it up a hair so it reads as optically centered in this badge. */}
              <PrivacyGlyph size={28} opacity={1} className="text-slate-300 -translate-y-px" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8} className="!border-white/10 !bg-[#0a0a0c] !text-slate-200">
            This payment is private
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </motion.div>
  );
}

function ClaimPayLayout({
  embedInApp,
  chrome = "full",
  merchantName,
  merchantLogoUrl,
  merchantLoading = false,
  topRight,
  from,
  incognito,
  children,
}: {
  embedInApp?: boolean;
  chrome?: "full" | "minimal";
  /** Only rendered when chrome="minimal" — the merchant's own branding (Developer settings ->
   *  Branding), snapshotted onto the payment at link-creation time. */
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  /** True until the claim itself has loaded — merchantName/merchantLogoUrl come straight from it,
   *  so both are `undefined` for that whole window, indistinguishable from "this link genuinely
   *  has no merchant branding." Without this, the header flashes the generic Loofta mark/name
   *  first and then swaps to the real branding once it arrives, every single load. */
  merchantLoading?: boolean;
  topRight?: React.ReactNode;
  from?: string | null;
  /** True once the sender has opted into incognito mode for this payment — darkens the whole
   *  card and adds a small "Private" pill peeking over the top, like a browser's private-window
   *  chrome change, instead of only the small toggle row changing. Static and quiet on purpose —
   *  an earlier version pulsed an amber glow and floated a ghost mascot, which read as a privacy
   *  red flag in user feedback rather than a reassurance. */
  incognito?: boolean;
  children: React.ReactNode;
}) {
  const inApp = usePathname()?.startsWith("/app") ?? false;
  const backHref = from === "history"
    ? (inApp ? "/app/history" : "/history")
    : (inApp ? "/app/send?restore=1" : "/send?restore=1");
  const backLabel = from === "history" ? "← Back to History" : "← Back to Send";
  // Memoized so the animate/transition objects keep a stable reference across re-renders — this
  // component re-renders often (background polling queries, etc.) and Framer Motion was
  // restarting the transition from scratch on every single one of those unrelated re-renders.
  const cardBorderAnimation = useMemo(
    () => ({
      boxShadow: incognito
        ? "inset 0 0 0 1px rgba(255,255,255,0.14), 0 10px 30px -14px rgba(0,0,0,0.7)"
        : "0 0 0 0 rgba(0,0,0,0)",
    }),
    [incognito],
  );
  const cardTransition = useMemo(() => ({ duration: 0.4, ease: "easeOut" }), []);

  if (embedInApp) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={backHref} className="inline-flex items-center gap-2 text-base md:text-sm font-medium text-slate-400 hover:text-white transition-colors">
            {backLabel}
          </Link>
          {topRight}
        </div>
        <div className="relative">
          <AnimatePresence>{incognito && <IncognitoCardBadge />}</AnimatePresence>
          <motion.div
            animate={cardBorderAnimation}
            transition={cardTransition}
            className={cn(
              "rounded-xl p-6 text-white transition-colors [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.bg-white]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.border-gray-200]:!border-white/10 [&_.border-gray-100]:!border-white/10 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&_input]:focus-visible:!ring-white/30",
              incognito ? "bg-black/40" : "bg-white/5",
            )}
            data-embed-pay
          >
            {children}
          </motion.div>
        </div>
      </div>
    );
  }
  if (chrome === "minimal") {
    return (
      <div className="min-h-screen w-full bg-slate-50 text-gray-900 [@media(prefers-color-scheme:dark)]:bg-[#0f0f12] [@media(prefers-color-scheme:dark)]:text-slate-100 flex flex-col items-center justify-center">
        <div className="w-full max-w-[900px] px-4 py-10">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              {merchantLoading ? (
                <>
                  <Skeleton className="h-10 w-10 rounded-full bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-muted" />
                  <Skeleton className="h-4 w-24 bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-muted" />
                </>
              ) : (
                <>
                  {merchantLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied URL, not a local/optimizable asset
                    <img
                      src={merchantLogoUrl}
                      alt={merchantName || "Merchant logo"}
                      className="h-10 w-10 rounded-full object-cover border border-gray-200 [@media(prefers-color-scheme:dark)]:border-white/10 shrink-0"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <LooftaIcon className="w-7 h-7 text-orange-500 shrink-0" />
                  )}
                  <span className="text-base font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">{merchantName || "Loofta"}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {topRight}
              <span className="hidden sm:inline-flex items-center gap-1.5 text-base text-emerald-600 [@media(prefers-color-scheme:dark)]:text-emerald-400">
                <Lock className="w-3.5 h-3.5" />
                Secure payment
              </span>
            </div>
          </div>
          <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-[1fr_380px] md:gap-6 md:items-start">
            {children}
          </div>
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
        <div className="relative">
          <AnimatePresence>{incognito && <IncognitoCardBadge />}</AnimatePresence>
          <motion.div
            animate={cardBorderAnimation}
            transition={cardTransition}
            className={cn(
              sora.variable,
              "rounded-[30px] p-7 text-white transition-colors border border-white/[0.07] [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.bg-white]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.border-gray-200]:!border-white/10 [&_.border-gray-100]:!border-white/10 [&_input]:!bg-white/10 [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&_input]:focus-visible:!ring-white/30",
              incognito ? "bg-black/40" : "bg-[#141419]",
            )}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/** Every recipient-identifier type the edit-recipient selector offers — mirrors MultiSendFlow's RECIPIENT_TYPE_OPTIONS. */
type EditRecipientKind = "email" | "username" | "twitter" | "discord" | "github" | "telegram";

const EDIT_RECIPIENT_KIND_OPTIONS: { id: EditRecipientKind; label: string; icon: "user" | "mail" | SocialIconPlatform }[] = [
  { id: "username", label: "Username", icon: "user" },
  { id: "email", label: "Email", icon: "mail" },
  { id: "twitter", label: "Twitter", icon: "twitter" },
  { id: "discord", label: "Discord", icon: "discord" },
  { id: "github", label: "GitHub", icon: "github" },
  // Telegram login is currently broken in production — hidden from this picker until fixed.
  // Editing an EXISTING telegram-pending claim to a different type still works fine either way.
  ...(TELEGRAM_SEND_ENABLED ? [{ id: "telegram" as const, label: "Telegram", icon: "telegram" as const }] : []),
];

function EditRecipientKindIcon({ icon, className }: { icon: "user" | "mail" | SocialIconPlatform; className?: string }) {
  if (icon === "user") return <User className={className} />;
  if (icon === "mail") return <Mail className={className} />;
  return <SocialPlatformIcon platform={icon} className={className} />;
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
  recipientType,
  recipientValue,
  recipientPlatform,
  claimLocked,
  onRecipientUpdated,
  delivered,
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
  /** "email", "username", or "social" — which pending-recipient field is editable. Omit to hide Edit. */
  recipientType?: "email" | "username" | "social";
  /** Current unmasked recipient identifier (creator only) — prefills the edit dialog. */
  recipientValue?: string;
  /** Current platform when recipientType is "social" — prefills the platform selector. */
  recipientPlatform?: string | null;
  /** True while the recipient is actively claiming — Edit is disabled to avoid racing them. */
  claimLocked?: boolean;
  onRecipientUpdated?: () => void;
  /** Recipient already has an account, so the money went straight to their wallet: nothing to claim or edit. */
  delivered?: boolean;
}) {
  const { toast } = useToast();
  const { getAccessToken: getSenderAccessToken } = usePrivy();
  const [copied, setCopied] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [reclaimed, setReclaimed] = useState(false);
  const [canReclaim, setCanReclaim] = useState<boolean | null>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState(recipientValue || "");
  const [editKind, setEditKind] = useState<EditRecipientKind>(
    recipientType === "social"
      ? ((recipientPlatform as EditRecipientKind | undefined) || "discord")
      : (recipientType || "email"),
  );
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const statusUpper = (status || "").toUpperCase();
  const isCancelled = statusUpper === "CANCELLED" || reclaimed;

  function startEditRecipient() {
    setEditValue(recipientValue || "");
    setEditKind(
      recipientType === "social"
        ? ((recipientPlatform as EditRecipientKind | undefined) || "discord")
        : (recipientType || "email"),
    );
    setEditError(null);
    setEditOpen(true);
  }

  const handleSaveRecipient = async () => {
    if (!userId) return;
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditError("Required");
      return;
    }
    const isDirectType = editKind === "email" || editKind === "username";
    const effectiveRecipientType: "email" | "username" | "social" = isDirectType ? editKind : "social";
    setEditSubmitting(true);
    setEditError(null);
    try {
      const backendUrl = clientApiBase();
      const token = await getSenderAccessToken();
      const r = await fetch(`${backendUrl}/claims/${claimId}/recipient`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          recipientType: effectiveRecipientType,
          recipientIdentifier: trimmed,
          ...(!isDirectType ? { platform: editKind } : {}),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.message || `Update failed: ${r.status}`);
      }
      toast({ title: "Recipient updated" });
      setEditOpen(false);
      onRecipientUpdated?.();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setEditSubmitting(false);
    }
  };

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
    const backendUrl = clientApiBase();
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
      : `https://pay.loofta.com/share/${shareId}`;

  const handleReclaim = async () => {
    if (!userId) {
      toast({ variant: "destructive", title: "Sign in to reclaim" });
      return;
    }
    setReclaiming(true);
    try {
      const backendUrl = clientApiBase();
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
  const shareText = delivered
    ? `I sent you $${amount.toFixed(2)} on Loofta${shareRecipientSuffix}. It is already in your wallet.`
    : `You have a payment of $${amount.toFixed(2)} to claim${shareRecipientSuffix}. Sign in or sign up on Loofta to claim it.`;

  const ready = ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(status);
  const recipientKindId: EditRecipientKind | null =
    recipientType === "social"
      ? ((recipientPlatform as EditRecipientKind | undefined) || null)
      : recipientType || null;
  const recipientKindOpt = EDIT_RECIPIENT_KIND_OPTIONS.find((o) => o.id === recipientKindId) ?? (recipientKindId === "telegram" ? { id: "telegram" as const, label: "Telegram", icon: "telegram" as const } : null);
  const recipientIcon: "user" | "mail" | SocialIconPlatform = recipientKindOpt?.icon ?? "user";
  const recipientKindLabel = recipientKindOpt?.label ?? "recipient";
  const recipientDisplay = recipientValue
    ? recipientKindId === "email"
      ? recipientValue
      : `@${recipientValue.replace(/^@/, "")}`
    : recipientLabel || "";

  return (
    <div className="py-2 text-center">
      <div className="space-y-3 py-6 text-center">
        <span className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.08] text-white">
          <EditRecipientKindIcon icon={recipientIcon} className="h-8 w-8" />
        </span>
        <div className="mb-3 font-sans text-5xl font-semibold tabular-nums text-white sm:text-6xl">${amount.toFixed(2)}</div>
        {recipientDisplay && (
          <p className="mb-5 mt-1 text-xl text-slate-400">
            sent to <span className="font-medium text-slate-200">{recipientDisplay}</span>
            {recipientType === "social" ? ` on ${recipientKindLabel}` : recipientType === "username" ? " on Loofta" : ""}
          </p>
        )}
        <p className="text-base text-slate-400">
          {isCancelled
            ? "This payment was cancelled."
            : delivered
              ? "It's already in their Loofta wallet. Nothing to claim."
              : ready
              ? "Send them this link. They claim it on Loofta."
              : "Share this link. They can claim it once the payment lands."}
        </p>
        {!isCancelled && (
          <div className="flex gap-2 pt-2">
            <div className="flex flex-1 gap-2">
              <Input
                readOnly
                value={claimLink}
                aria-label="Share link"
                className="flex-1 border-white/20 bg-white/10 font-mono text-sm text-white"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy link"}
                className="shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <ShareLinkMenu url={claimLink} title="Payment for you" text={shareText} triggerClassName="px-5 py-2" />
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-left">
        <div className="flex items-center justify-between">
          <span className="text-base text-slate-400">Recipient receives</span>
          <span className="text-base font-semibold text-white">${amount.toFixed(2)} USDC</span>
        </div>
        {recipientDisplay && (
          <div className="flex items-center justify-between border-t border-white/10 pt-2">
            <span className="text-base text-slate-400">Sent to</span>
            <span className="text-base font-medium text-white">{recipientDisplay}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-base text-slate-400">Status</span>
          <span className="text-base text-slate-200">{isCancelled ? "Cancelled" : delivered && ready ? "Delivered to their wallet" : ready ? "Paid, waiting to be claimed" : "Waiting for payment"}</span>
        </div>
      </div>
      {/* Edit recipient: only while unclaimed (recipientType present) and not mid-claim.
          `userId` here is documented as "logged-in creator's id, only set when true" — the
          caller is responsible for only passing it when the viewer actually is the creator (see
          call sites below). Same inline dark-themed edit-in-place pattern as the lottery gift
          flow's "Edit recipient", but shown in a modal. */}
      {!isCancelled && !delivered && recipientType && userId && (
        <div className="mt-4 max-w-md mx-auto text-center">
          <button
            type="button"
            onClick={startEditRecipient}
            disabled={!!claimLocked}
            className="mx-auto block text-sm text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Wrong recipient?
          </button>
          {claimLocked && (
            <p className="mt-1 text-sm text-slate-500">
              The recipient is currently claiming this payment, try again in a minute.
            </p>
          )}
          <Dialog open={editOpen} onOpenChange={(o) => { if (!editSubmitting) setEditOpen(o); }}>
            <DialogContent className="max-w-md bg-[#141418] border border-white/10 text-left">
              <DialogHeader>
                <DialogTitle className="text-xl text-slate-100">Wrong recipient?</DialogTitle>
                <DialogDescription className="text-base text-slate-400">
                  No worries. Until they claim it, you can still change the platform and the recipient.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Select value={editKind} onValueChange={(v) => setEditKind(v as EditRecipientKind)}>
                  <SelectTrigger className="h-12 w-[150px] shrink-0 bg-white/[0.03] border-white/10 text-slate-100 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDIT_RECIPIENT_KIND_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className="flex items-center gap-2">
                          <EditRecipientKindIcon icon={opt.icon} className="h-4 w-4 shrink-0" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    {editKind === "email" ? <Mail className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
                  </span>
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(editKind !== "email" ? e.target.value.replace(/^@+/, "") : e.target.value)}
                    placeholder={editKind === "email" ? "name@example.com" : editKind === "username" ? "username" : "handle"}
                    className="w-full h-12 bg-white/[0.03] border border-white/10 text-slate-100 placeholder:text-slate-600 rounded-lg pl-10 pr-3 text-base focus:outline-none focus:border-[#FF7A2A]/60"
                    autoFocus
                  />
                </div>
              </div>
              {editError && <p className="text-sm text-red-400">{editError}</p>}
              <button
                type="button"
                onClick={handleSaveRecipient}
                disabled={editSubmitting || !editValue.trim()}
                className="w-full h-12 rounded-2xl text-base font-semibold text-white bg-gradient-to-r from-[#FF7A2A] to-[#FF5A1F] hover:brightness-110 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {editSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {editSubmitting ? "Updating…" : "Update recipient"}
              </button>
            </DialogContent>
          </Dialog>
        </div>
      )}
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
        <p className="mt-4 text-base text-slate-400">Payment cancelled. Any funds have been returned to your Loofta wallet.</p>
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
    // The error body may still carry a pending-login hint (which sign-in method/platform this
    // payment is waiting on) even though no claim data can be returned to this unconfirmed viewer.
    const errData = await r.json().catch(() => ({} as Record<string, unknown>));
    return {
      claim: null,
      latestIntent: null,
      pendingEmail: !!(errData as { pendingEmail?: boolean }).pendingEmail,
      pendingSocialPlatform: (errData as { pendingSocialPlatform?: string | null }).pendingSocialPlatform ?? null,
    };
  }
  const data = await r.json();
  const c = data.claim || {};
  console.log("[fetchClaim]", {
    claimId: id,
    hasBurner: !!c.claim_burner_address,
    isRegistered: !!(c as { recipient_is_registered?: boolean }).recipient_is_registered,
  });
  return {
    claim: c as { id: string; short_id?: string | null; amount: string; to_symbol: string; to_chain: string; status: string; recipient_address?: string; recipient_username?: string | null; recipient_email?: string | null; recipient_user_id?: string | null; claim_burner_address?: string; recipient_pending_email?: boolean; recipient_pending_email_value?: string; recipient_pending_username?: boolean; recipient_pending_username_value?: string; recipient_pending_social?: boolean; recipient_pending_social_platform?: string | null; recipient_pending_social_value?: string | null; recipient_claim_in_progress?: boolean; created_at?: string; paid_at?: string; creator_email?: string; creator_username?: string | null; created_by?: string | null; description?: string; is_private?: boolean | null; claimed_privately?: boolean | null; paid_with_token?: string; paid_with_chain?: string; sender_tx_hash?: string | null; direction?: "from_sender" | "from_recipient"; is_devnet?: boolean; fee_on_sender?: boolean | null; merchant_name?: string | null; merchant_logo_url?: string | null; is_api_payment?: boolean; private_split?: number | null; private_max_delay_ms?: number | null },
    latestIntent: data.latestIntent || null,
    pendingEmail: false,
    pendingSocialPlatform: null,
  };
}

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";
const SOCIAL_PLATFORM_LABELS: Record<string, string> = { discord: "Discord", github: "GitHub", telegram: "Telegram", twitter: "Twitter" };

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
    const backendUrl = clientApiBase();

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
    const backendUrl = clientApiBase();
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
  return (
    <div className="mb-4">
      <DescriptionWithGif text={description} />
    </div>
  );
}

/** Small logo + name row marking a direction="from_recipient" claim as a merchant payment on the
 *  recipient's own incoming-payment views (already-received cards, claim panel) — same branding
 *  data the payer-side receipt view and checkout header already use, just for the other side. */
// A plain 3-row step list for tracking a NEAR Intents deposit — same spirit as BalanceModal's
// ProgressSteps (icon + label, no per-row countdown, no card-list theatrics), used in place of
// PaymentStatusTracker on the deposit-tracking view below. PaymentStatusTracker's own per-step
// time estimates and animated character read as clutter once the mascot/progress-bar wrapper
// around it is gone, so this replaces it there rather than sitting inside that removed wrapper.
function DepositProgressSteps({ status }: { status: string | null }) {
  const s = String(status || "PENDING_DEPOSIT").toUpperCase();
  const isWaiting = s === "PENDING_DEPOSIT" || s === "INCOMPLETE_DEPOSIT" || !status;
  const isProcessing = s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX";
  const isSent = s === "SUCCESS";

  const steps: { label: string; state: "done" | "active" | "pending" }[] = [
    { label: "Send deposit", state: isWaiting ? "active" : "done" },
    { label: "Processing", state: isProcessing ? "active" : isWaiting ? "pending" : "done" },
    { label: "Sent to recipient", state: isSent ? "done" : "pending" },
  ];

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div
          key={step.label}
          className="flex items-center gap-3 rounded-xl border p-3 border-gray-200 bg-white [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5"
        >
          <div className="shrink-0 w-6 h-6 flex items-center justify-center">
            {step.state === "done" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : step.state === "active" ? (
              <Loader2 className="h-5 w-5 text-orange-500 animate-spin" />
            ) : (
              <span className="w-5 h-5 rounded-full border-2 border-gray-300 [@media(prefers-color-scheme:dark)]:border-white/20 flex items-center justify-center text-xs font-bold text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500">
                {i + 1}
              </span>
            )}
          </div>
          <p className={`text-base font-medium ${step.state === "pending" ? "text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500" : "text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100"}`}>
            {step.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function MerchantPaymentBadge({
  claim,
}: {
  claim: { merchant_name?: string | null; merchant_logo_url?: string | null; is_api_payment?: boolean } | null;
}) {
  // Human "Get Paid" requests are also from_recipient; only API-created links are merchant sales.
  if (!claim?.is_api_payment) return null;
  return (
    <div className="flex items-center justify-center gap-2 mb-3">
      {claim?.merchant_logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied URL, not a local/optimizable asset
        <img
          src={claim.merchant_logo_url}
          alt={claim?.merchant_name || "Merchant logo"}
          className="h-8 w-8 rounded-full object-cover border border-gray-200"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <ShoppingBag className="h-5 w-5 text-gray-400" />
      )}
      <span className="text-base font-medium text-gray-600">
        {claim?.merchant_name || "Merchant payment"}
      </span>
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
}: {
  message: string;
  hint?: string | null;
  showLinkButtons: boolean;
  hasTwitterLinked: boolean;
  hasEmailLinked: boolean;
  onConnectTwitter: () => void;
  onConnectEmail: () => void;
  /** True while refreshIdentityInPlace() is running after Connect X/email, so the "not found"
   *  state doesn't sit there looking frozen while the identity refetch is in flight. */
  isConfirmingIdentity?: boolean;
}) {
  // Never show "Payment not found" while a check that could still overturn it is in flight —
  // saying "not found" and "confirming" at the same time reads as contradictory. The claim
  // page's own back link (in ClaimPayLayout, always rendered above this card) already covers
  // getting back out, so this state doesn't need its own.
  if (isConfirmingIdentity) {
    return (
      <div className="py-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-4xl select-none">
          🔍
        </div>
        <p className="flex items-center gap-2 text-base text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirming your account…
        </p>
      </div>
    );
  }
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
      {showLinkButtons && (!hasTwitterLinked || !hasEmailLinked) && (
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
      )}
    </div>
  );
}

/** Shown instead of PaymentNotFoundNotice when a viewer isn't (yet) confirmed as this payment's
 *  recipient but the payment is pending on a social platform they haven't connected — never
 *  reveals the actual pending handle, just which platform to connect to check. */
function SocialConnectPrompt({
  platform,
  onConnect,
  isConfirmingIdentity,
  platformLinked,
}: {
  platform: string;
  onConnect: () => void;
  isConfirmingIdentity?: boolean;
  /** Whether Privy's own live linkedAccounts already shows this platform connected. This
   *  component only ever renders because the caller determined the platform is NOT linked, so
   *  showing "Confirming…" here without also checking this would be self-contradictory — there is
   *  nothing to confirm for a platform you don't have connected at all. Defaults to false (safe:
   *  never show the spinner) if the caller doesn't pass it. */
  platformLinked?: boolean;
}) {
  const label = SOCIAL_PLATFORM_LABELS[platform] ?? "social";
  const showConfirming = !!isConfirmingIdentity && !!platformLinked;
  return (
    <div className="py-16 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
        <SocialPlatformIcon platform={(platform || "discord") as SocialIconPlatform} className="w-8 h-8 text-white/70" />
      </div>
      <h3 className="text-xl font-semibold text-white mb-3">Is this payment for you?</h3>
      <p className="text-slate-300 text-base mb-8 max-w-xs">
        This was sent to a {label} username. Connect your {label} account to check.
      </p>
      {showConfirming ? (
        <p className="flex items-center gap-2 text-base text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirming your account…
        </p>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className="inline-flex items-center justify-center h-11 rounded-lg bg-white/10 text-white px-5 text-base font-semibold hover:bg-white/20 transition-colors"
        >
          Connect {label}
        </button>
      )}
    </div>
  );
}

/** Shown once a viewer has connected the platform this payment is pending on, while the
 *  backend hasn't yet confirmed them as the recipient — never shows "Payment not found" in
 *  this window, since we already know the platform matched client-side. */
function ConfirmingIdentityNotice() {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
        <Loader2 className="w-8 h-8 text-white/70 animate-spin" />
      </div>
      <h3 className="text-xl font-semibold text-white mb-3">Confirming your account…</h3>
      <p className="text-slate-300 text-base max-w-xs">This only takes a moment.</p>
    </div>
  );
}

// ─── Checkout info (chrome="minimal") — what a payer on a merchant link actually needs to know,
// not the P2P claim-page FAQ below (which talks about "claiming privately", irrelevant to a
// payer who's never claiming anything here). Deliberately doesn't restate a specific fee number —
// that's already live on the left-side breakdown and would drift out of sync with two different
// private-payment mechanisms (balance-based vs. wallet-direct) charging differently. ───────────

const CHECKOUT_INFO_FAQ_ITEMS: { question: string; answer: React.ReactNode }[] = [
  {
    question: "What does \"Pay privately\" do?",
    answer: (
      <>
        <p className="mb-3 flex items-center gap-2">
          <PrivacyGlyph size={20} opacity={1} />
          <span>Shields the amount and your wallet from public view — nobody can trace this payment back to you on-chain.</span>
        </p>
        <p>It runs through MagicBlock&apos;s private ephemeral rollup, either from your Loofta balance (if you&apos;re signed in) or directly from a connected wallet — either way, nothing about it is a plain public transfer. The exact fee is shown on the left before you pay.</p>
      </>
    ),
  },
  {
    question: "What does \"Any token\" mean?",
    answer: (
      <p>Pay with any token on any supported chain — Bitcoin, Ethereum, and dozens more — instead of USDC on Solana. It&apos;s converted automatically before it reaches the merchant; they always receive exactly the amount due.</p>
    ),
  },
  {
    question: "Why sign in to top up instead of paying as a guest?",
    answer: (
      <p>Signing in lets you fund a Loofta balance from any token, a credit card, or Naira — then future payments (here or on any other Loofta checkout) are one tap, no wallet or token conversion needed each time. Paying as a guest works fine too; it just doesn&apos;t save anything for next time.</p>
    ),
  },
];

// ─── Privacy FAQ (same accordion style as send/receive and megapot) ───────────

const CLAIM_PRIVACY_FAQ_ITEMS: { question: string; answer: React.ReactNode }[] = [
  {
    question: "What does the mask icon mean?",
    answer: (
      <>
        <p className="mb-3 flex items-center gap-2 text-slate-300">
          <PrivacyGlyph size={20} opacity={1} />
          <span>It marks a private payment — one where the on-chain link between sender and recipient is hidden.</span>
        </p>
        <p>You&apos;ll see it on a payment card, in the claim confirmation, and next to any row in your history that was sent or claimed privately.</p>
      </>
    ),
  },
  {
    question: "How does a private payment work?",
    answer: (
      <>
        <p className="mb-3">A private transfer runs through <span className="font-medium text-slate-300">MagicBlock</span>&apos;s private ephemeral rollup, which breaks the on-chain link between your wallet and the recipient&apos;s — nobody can trace the payment from one to the other.</p>
        <p>You always pay a freshly generated address, never the recipient&apos;s real wallet directly. Loofta resolves the actual destination and delivers the funds server-side.</p>
      </>
    ),
  },
  {
    question: "What are the fees for a private payment?",
    answer: (
      <>
        <p className="mb-3">The fee is <span className="font-medium text-slate-300">0.002 SOL + 0.1%</span>, converted to USD at the time of transfer — that covers MagicBlock&apos;s private ephemeral rollup end to end.</p>
        <p>There&apos;s no separate network or gas fee on top — that&apos;s the whole cost.</p>
      </>
    ),
  },
  {
    question: "What happens if I pay publicly instead?",
    answer: (
      <p>The recipient can see the address you paid from, and can link it back to you on any future payment. Private avoids that; public doesn&apos;t.</p>
    ),
  },
  {
    question: "Can a recipient claim privately even if I paid publicly?",
    answer: (
      <p>Yes. Every payment can be claimed either way — whoever receives it chooses at claim time, regardless of how it was sent.</p>
    ),
  },
];

export function ClaimPayView({
  claimId,
  embedInApp,
  chrome = "full",
}: {
  claimId: string;
  embedInApp?: boolean;
  /** "minimal": no Loofta page furniture beyond the pay card itself — used by /checkout/[id]
   *  (AppShell already strips the header/footer/bottom-nav for any /checkout* path; this just
   *  adds the small "Powered by Loofta" badge). Every payment/deposit code path below is
   *  identical between "full" and "minimal" — this only ever affects presentation. */
  chrome?: "full" | "minimal";
}) {
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
  // Dev-only: jump the claim-panel/sender-card UI into any state via ?preview=... (see
  // DEV_PREVIEW_STATES / DevPreviewPanel above).
  const previewParam = CLAIM_DEV_PREVIEW_ENABLED && isClaimPageLocalhost ? searchParams.get("preview") : null;
  const previewOverride = previewParam ? DEV_PREVIEW_STATES[previewParam] : undefined;
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
  const hasDiscordLinked = useMemo(
    () => ((user?.linkedAccounts || []) as Array<{ type?: string }>).some((a) => a.type === "discord_oauth" || a.type === "discord"),
    [user?.linkedAccounts],
  );
  const hasGithubLinked = useMemo(
    () => ((user?.linkedAccounts || []) as Array<{ type?: string }>).some((a) => a.type === "github_oauth" || a.type === "github"),
    [user?.linkedAccounts],
  );
  // Telegram isn't a Privy-linked account in this app (see telegram-relay/) — fetched from social_accounts.
  const [telegramHandle, setTelegramHandle] = useState<string | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    void (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch("/api/users/social-handles", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (res.ok) {
          const data = await res.json();
          setTelegramHandle(data?.handles?.telegram ?? null);
        }
      } catch {
        // best-effort
      }
    })();
  }, [authenticated, getAccessToken]);
  const hasTelegramLinked = !!telegramHandle;
  const hasSocialPlatformLinked = (platform: string | null | undefined) => {
    if (platform === "discord") return hasDiscordLinked;
    if (platform === "github") return hasGithubLinked;
    if (platform === "telegram") return hasTelegramLinked;
    if (platform === "twitter") return hasTwitterLinked;
    return false;
  };
  // linkTelegram is HMAC-bot only; Telegram OIDC links through the generic OAuth link.
  const connectTelegram = async () => {
    try {
      await linkOAuth({ provider: "telegram" });
    } catch {
      toast({ variant: "destructive", title: "Couldn't connect Telegram", description: "Try again." });
    }
  };


  // Pre-auth "is this payment for me?" Telegram check — a visitor with no Loofta account yet
  // can't be signed in via connectTelegram (it needs an existing access token to know which
  // account to attach the handle to). Instead, open the relay in "claimId" mode: it verifies
  // ownership of the pending handle against THIS claim specifically and stores a short-lived,
  // claim-scoped proof — no account needed yet. Once verification succeeds, the visitor signs in
  // (any method) and the effect below redeems that proof against the now-known account.
  const [telegramClaimVerified, setTelegramClaimVerified] = useState<boolean | null>(null);
  const openTelegramClaimVerifyRelay = () => {
    const relayBase = process.env.NEXT_PUBLIC_TELEGRAM_RELAY_URL || "https://loofta.com";
    const popup = window.open(`${relayBase}/telegram-relay?claimId=${encodeURIComponent(claimId)}`, "_blank");
    if (!popup) {
      toast({ variant: "destructive", title: "Couldn't open Telegram check", description: "Allow popups and try again." });
      return;
    }
    let attempts = 0;
    const maxAttempts = 600; // ~10 minutes at 1s polling
    const poll = setInterval(() => {
      attempts += 1;
      if (popup.closed) {
        clearInterval(poll);
        fetch(`/api/telegram-relay/verify-claim?claimId=${encodeURIComponent(claimId)}`)
          .then((r) => r.json())
          .then((data) => setTelegramClaimVerified(!!data?.verified))
          .catch(() => setTelegramClaimVerified(false));
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
      }
    }, 1000);
  };
  // Signing in with Telegram links it on the Privy user directly, so persist the verified handle
  // (server re-checks it against Privy) and re-run the recipient check.
  const startTelegramLogin = () => login({ loginMethods: ["telegram"], disableSignup: false });
  const savedLoginTelegramRef = useRef(false);
  useEffect(() => {
    const tgAccount = ((user?.linkedAccounts || []) as Array<{ type?: string; username?: string | null }>).find(
      (a) => a.type === "telegram" || a.type === "telegram_oauth",
    );
    const tgUsername = tgAccount?.username;
    if (!authenticated || !tgUsername || savedLoginTelegramRef.current) return;
    savedLoginTelegramRef.current = true;
    (async () => {
      try {
        const accessToken = await getAccessToken().catch(() => null);
        await fetch("/api/users/save-social-handle", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({ platform: "telegram", handle: tgUsername }),
        });
        setTelegramHandle(tgUsername.replace(/^@/, "").toLowerCase());
      } catch {
        // best-effort
      }
      void refreshIdentityInPlace();
    })();
  }, [authenticated, user, getAccessToken]);
  const attachVerifiedTelegramRef = useRef(false);
  useEffect(() => {
    if (!authenticated || telegramClaimVerified !== true || attachVerifiedTelegramRef.current) return;
    attachVerifiedTelegramRef.current = true;
    (async () => {
      try {
        const accessToken = await getAccessToken().catch(() => null);
        await fetch("/api/telegram-relay/attach-verified", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ claimId }),
        });
      } catch {
        // best-effort — refreshIdentityInPlace below will just keep showing "sign in" if this failed
      }
      void refreshIdentityInPlace();
    })();
  }, [authenticated, telegramClaimVerified, claimId]);
  const connectSocialPlatform = (platform: string | null | undefined) => {
    if (platform === "discord") linkDiscord();
    else if (platform === "github") linkGithub();
    else if (platform === "telegram") void connectTelegram();
    else if (platform === "twitter") linkTwitter();
  };
  const [updatingUsernameToTwitter, setUpdatingUsernameToTwitter] = useState(false);

  // ---------------------------------------------------------------------------------------
  // Recipient-identity recheck: runs silently in the background after sign-in or linking a
  // new account, until the claim + recipient-check genuinely confirm this user (or it gives
  // up) — see refreshIdentityInPlace below, which both the link-success callbacks and the
  // routine-sign-in effect (further down) share, so there's exactly one place that decides
  // when to stop trying and show a genuine "not found".
  //
  // Why retries are needed at all: the backend caches each user's Privy record (linked_accounts)
  // for 5 min (privy-verification.service.ts). Link events fast-path around this (the identity
  // is pushed to our own DB — checked first — before refreshIdentityInPlace runs), but a
  // routine sign-in via a platform that's never been linked before has no such fast path and
  // falls back to a live Privy API call, which can lag briefly behind Privy's own eventual
  // consistency. `identityRefreshInFlightRef` blocks overlapping runs if sign-in and a fresh
  // link event fire close together.
  const identityRefreshInFlightRef = useRef(false);

  const bustPrivyCacheOnce = async () => {
    const token = await getAccessToken();
    const backendUrl = clientApiBase();
    await fetch(`${backendUrl}/users/refresh-privy-cache`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  // True only while refreshIdentityInPlace is actively running — drives a visible
  // "Confirming your account…" state so the brief moment of refetching doesn't look like a
  // frozen "Payment not found" screen with nothing happening.
  const [isConfirmingIdentity, setIsConfirmingIdentity] = useState(false);
  // Set only once refreshIdentityInPlace has exhausted every retry without the backend
  // confirming this viewer as the recipient — the genuine "wrong account" outcome. Kept
  // separate from isConfirmingIdentity so the render logic below (isAwaitingSocialIdentityHint)
  // can derive "still confirming" purely from client-known state (hasSocialPlatformLinked) and
  // never flash back to "not found" just because this async function hasn't started/finished a
  // render tick yet — see that derivation's own comment for why the manual flag alone raced.
  const [identityConfirmGaveUp, setIdentityConfirmGaveUp] = useState(false);

  /**
   * Shared by both triggers: (1) linking/connecting an account (Twitter, email, Discord,
   * GitHub, Telegram) — the identity is already known from the link callback and already
   * written to our own DB (the fast path verifyRecipientIdentityForSendPayment checks first,
   * before any live Privy call — see users.service.ts), so this typically resolves on the
   * very first attempt; and (2) a routine sign-in via the routine-recheck effect further down,
   * where there's no such fast path (nothing was just linked) and the backend may need a
   * moment to catch up to Privy's own eventual consistency, hence more retries. No polling
   * loop that reloads the page — React Query's refetch updates claimQuery/recipientCheckQuery
   * in place and the page re-renders itself from that new data. Always resolves one way or the
   * other: identityConfirmGaveUp is set on exhaustion so the UI never spins forever waiting for
   * an identity that will never match (e.g. a viewer who already has some unrelated Discord
   * account linked from before, which never triggers this function's success path).
   */
  const refreshIdentityInPlace = async () => {
    if (identityRefreshInFlightRef.current) return;
    identityRefreshInFlightRef.current = true;
    setIsConfirmingIdentity(true);
    setIdentityConfirmGaveUp(false);
    try {
      await bustPrivyCacheOnce().catch(() => { });
      // Retrying only helps when a pending identifier could newly resolve via Privy's own
      // eventual-consistency catch-up — a fresh email/social link, or the pending-username
      // Twitter-handle fallback. A claim with none of those pending — a plain registered
      // recipient whose wallet just doesn't match this session — gets a definitive answer on the
      // very first check; nothing about waiting and re-checking changes a fixed wallet-address
      // comparison. Burning the full ~15s retry budget on a check that can only ever return the
      // same answer is exactly what read as "Confirming your account…" taking forever for no
      // reason.
      const worthRetrying = pendingEmailHint || !!pendingSocialPlatformHint || !!claim?.recipient_pending_username;
      const maxAttempts = worthRetrying ? 10 : 1;
      let resolved = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        const [claimResult, recipientResult] = await Promise.all([
          claimQuery.refetch(),
          recipientCheckQuery.refetch(),
        ]);
        resolved = !!claimResult.data?.claim && recipientResult.data?.isRecipient === true;
        if (resolved) break;
      }
      if (!resolved) setIdentityConfirmGaveUp(true);
    } finally {
      identityRefreshInFlightRef.current = false;
      setIsConfirmingIdentity(false);
    }
  };

  const { linkTwitter, linkEmail, linkDiscord, linkGithub, linkOAuth } = useLinkAccount({
    onSuccess: ({ linkedAccount }) => {
      void (async () => {
        // Set this immediately, before the DB save below — Privy's client-side linkedAccounts
        // already reflects the new account at this point (hasDiscordLinked/hasGithubLinked flip
        // true right away), which would otherwise make the "not found" screen flash its plain
        // (non-"Confirming…") text for a moment before refreshIdentityInPlace gets a chance to
        // set this itself.
        setIsConfirmingIdentity(true);
        // Push what Privy's client SDK just confirmed straight into our own DB before
        // rechecking — this is data we already have zero-latency, verified proof of (Privy
        // wouldn't have fired onSuccess otherwise), so there's no reason to wait on our
        // backend's separate live call to Privy's API to independently rediscover it. That
        // live call is exactly what's still subject to Privy's own eventual consistency; this
        // fast path (checked first in verifyRecipientIdentityForSendPayment) sidesteps it for
        // the case where the client already knows the answer.
        const acct = linkedAccount as { type?: string; username?: string | null; name?: string | null };
        const isTwitter = acct?.type === "twitter_oauth" || acct?.type === "twitter" || acct?.type === "x";
        const isDiscord = acct?.type === "discord_oauth" || acct?.type === "discord";
        const isGithub = acct?.type === "github_oauth" || acct?.type === "github";
        const isTelegram = acct?.type === "telegram" || acct?.type === "telegram_oauth";
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
        } else if (isTelegram && handle) {
          try {
            const token = await getAccessToken().catch(() => null);
            await fetch("/api/users/save-social-handle", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ platform: "telegram", handle }),
            });
            setTelegramHandle(handle.toLowerCase());
          } catch {
            // best-effort — the recheck loop below still falls back to the live Privy check
          }
        } else if ((isDiscord || isGithub) && handle) {
          try {
            const token = await getAccessToken().catch(() => null);
            await fetch("/api/users/save-social-handle", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ platform: isDiscord ? "discord" : "github", handle }),
            });
          } catch {
            // best-effort — the recheck loop below still falls back to the live Privy check
          }
        }
        await refreshIdentityInPlace();
      })();
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Couldn't connect", description: String(error) });
    },
  });

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
      await refreshIdentityInPlace();
    } catch {
      toast({ variant: "destructive", title: "Update failed", description: "Try again." });
    } finally {
      setUpdatingUsernameToTwitter(false);
    }
  };

  const networkMode = useAuthStore((s) => s.networkMode);
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode);
  const isOnboardingOpen = useAuthStore((s) => s.isOnboardingOpen);
  const setOpenSettingsModal = useAuthStore((s) => s.setOpenSettingsModal);
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
  const tokenPrize = claim as {
    solana_mint?: string | null;
    token_amount?: string | number | null;
    token_base_units?: string | null;
    token_program?: string | null;
    to_symbol?: string;
  } | null;
  const isTokenPrize = !!tokenPrize?.solana_mint?.trim();
  const tokenPrizeAmount = isTokenPrize ? tokenPrize?.token_amount : null;
  const tokenPrizeSymbol = isTokenPrize ? (tokenPrize?.to_symbol || "tokens") : "USDC";
  const tokenPrizeLogo = isTokenPrize ? `/api/giveaways/token-icon?mint=${encodeURIComponent(tokenPrize!.solana_mint!.trim())}` : null;
  // Which sign-in method/platform this payment is pending on, from the viewer's perspective —
  // populated either from the confirmed claim (once this viewer IS the recipient) or from the
  // API's pending-login hint on a 403/404 (viewer not yet confirmed, so no claim data at all).
  const pendingEmailHint: boolean = !!claim?.recipient_pending_email || !!claimData?.pendingEmail;
  const pendingSocialPlatformHint: string | null = claim?.recipient_pending_social_platform ?? claimData?.pendingSocialPlatform ?? null;
  // Derived (not driven by isConfirmingIdentity) so there's no race: Privy's client-side
  // linkedAccounts — and therefore hasSocialPlatformLinked — can flip true a render or two
  // before the useLinkAccount onSuccess callback actually runs and sets isConfirmingIdentity,
  // which was causing a "Payment not found" flash in that gap. This instead goes straight from
  // "not connected" to "confirming" the instant the client sees the platform as linked, and
  // only falls back to a genuine "not found" once refreshIdentityInPlace has actually given up.
  const isAwaitingSocialIdentityConfirmation =
    !!pendingSocialPlatformHint && hasSocialPlatformLinked(pendingSocialPlatformHint) && !claim && !identityConfirmGaveUp;
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
      const backendUrl = clientApiBase();
      const token = await getAccessToken();
      const r = await fetch(`${backendUrl}/claims/${id}/recipient-check`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return { isRecipient: false };
      const data = await r.json();
      return { isRecipient: data?.isRecipient === true };
    },
    enabled: !!claim && !!user?.id && chrome !== "minimal",
    staleTime: 60_000,
  });
  // Merchant checkout links (chrome="minimal") always show the payer experience, even when the
  // signed-in visitor happens to also be the link's creator (e.g. testing your own checkout link)
  // — never flip into the "payment to yourself, here's how to claim it" recipient view there.
  const isRecipient = chrome !== "minimal" && recipientCheckQuery.data?.isRecipient === true;
  // Merchant/payment-links claims stamp both created_by AND recipient_user_id to the same
  // (merchant) account at creation time (see payment-links.service.ts) — so for this claim type,
  // "I created this link" and "I am the recipient" are the same fact, checkable synchronously off
  // data already on hand, with no dependency on the async recipient-check round trip above. Used
  // as a fallback alongside isRecipient so a slow/failed recipient-check request never strands a
  // merchant on the generic payer view of their own sale.
  const isMerchantRecipientView =
    chrome !== "minimal" && claim?.direction === "from_recipient" && !!user?.id && claim?.created_by === user.id;
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
    !!claim?.recipient_pending_social ||
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
  const claimExpectedBaseUnits = isTokenPrize && tokenPrize?.token_base_units && /^\d+$/.test(tokenPrize.token_base_units)
    ? Number(tokenPrize.token_base_units)
    : Math.round(parseFloat(claim?.amount || "0") * 1_000_000);
  const burnerReadyQuery = useQuery({
    queryKey: ["burner-ready", burnerAddr, claimNetworkMode, claimExpectedBaseUnits, tokenPrize?.solana_mint ?? "usdc"],
    queryFn: async (): Promise<{ balance: number; isReady: boolean }> => {
      if (!burnerAddr) return { balance: 0, isReady: false };
      const balance = isTokenPrize
        ? await getSplAtaBalanceBaseUnits(burnerAddr, tokenPrize!.solana_mint!.trim(), claimNetworkMode, tokenPrize?.token_program || undefined)
        : await getUsdcAtaBalanceBaseUnits(burnerAddr, claimNetworkMode);
      console.info(
        `[BurnerReady] claimId=${id} baseUnits=${balance} expected=${claimExpectedBaseUnits} mint=${tokenPrize?.solana_mint || "usdc"}`,
      );
      return { balance, isReady: claimExpectedBaseUnits > 0 && balance >= claimExpectedBaseUnits };
    },
    // Also poll for a registered-at-creation recipient (e.g. a merchant checkout payment) even
    // though isPendingRecipientClaim is false for them — their claim still routes through this
    // same burner, and without polling burnerIsReady stays permanently false, which used to hide
    // the claim button entirely and strand funds in the burner with no way to sweep them.
    enabled: !!burnerAddr && !!user?.id && (isPendingRecipientClaim || isRecipient || isMerchantRecipientView),
    refetchInterval: 15_000,
    staleTime: 12_000,
  });
  const burnerIsReady = burnerReadyQuery.data?.isReady ?? false;
  const burnerIsChecking = burnerReadyQuery.isLoading || (!burnerReadyQuery.isFetched && !!burnerAddr);
  /** Logged-in pending recipient cannot claim until burner USDC ATA has a balance (or burner address is missing). */
  const waitingForBurnerFunds =
    previewOverride?.waitingForBurnerFunds ??
    (!!user?.id && isPendingRecipientClaim && (!burnerAddr || !burnerIsReady));
  /** True while Privy hasn't finished creating the user's embedded Solana wallet (created async after login). */
  const walletNotReady = previewOverride?.walletNotReady ?? (!!user?.id && !deriveSolanaEmbeddedAddress(user));

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
    // Sender's real cost = MagicBlock's flat gasless relay fee + MagicBlock's own ~10bps
    // (grossed up internally via exactOut — see estimateMagicblockGrossUp server-side).
    const gasFee = 0.20; // flat USDC relay fee charged by MagicBlock
    const magicblockFeeBps = 10; // mirrors MAGICBLOCK_VOLUME_FEE_BPS in magicblock-private-transfer.ts
    const protocolFee = (usd * magicblockFeeBps) / 10_000;
    const feeEstimate = gasFee + protocolFee;
    return { total: usd + feeEstimate, protocolFee, gasFee, feeEstimate };
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
    const refetchBoth = () => {
      queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      queryClient.refetchQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
      queryClient.invalidateQueries({ queryKey: ["solanaPaymentBalance"] });
      queryClient.refetchQueries({ queryKey: ["solanaPaymentBalance"] });
    };
    // Fire immediately too — the delayed retries below exist for on-chain indexing lag, but an
    // already-fresh balance (or a claim that lands fast) shouldn't wait 2s minimum to reflect.
    refetchBoth();
    const delaysMs = [2_000, 5_000, 10_000, 20_000, 35_000, 55_000, 80_000, 110_000];
    for (const delay of delaysMs) {
      setTimeout(refetchBoth, delay);
    }
  };
  const claimAsRecipientMutation = useMutation({
    mutationFn: async (opts?: { claimPrivately?: boolean; destinationAddress?: string; claimToNaira?: boolean; split?: number; maxDelayMs?: number; payoutMethod?: string; payoutStatus?: string; payoutEtaLabel?: string | null; payoutDetail?: string | null }) => {
      const backendUrl = clientApiBase();
      console.info("[Claim] Initiating claim for:", id, "user:", user?.id?.slice(0, 12), "opts:", opts);
      const claimToken = await getAccessToken();
      const claimResp = await fetch(`${backendUrl}/claims/${id}/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(claimToken ? { Authorization: `Bearer ${claimToken}` } : {}),
        },
        body: JSON.stringify(opts ?? {}),
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
        return { claimed: true, sweepTxHash: claimData?.sweepTxHash, sweptAmount: claimData?.sweptAmount, feeAmountUsdc: claimData?.feeAmountUsdc };
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
    onSuccess: (data: { claimed?: boolean; sweepTxHash?: string; sweptAmount?: string; swept?: boolean; feeAmountUsdc?: number } | undefined, _vars, context) => {
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
      // The unclaimed-nudge toast reads a filtered view of this same history data under its own
      // query key — without this it keeps showing an already-claimed payment until something
      // else happens to refetch it (e.g. a full page reload).
      queryClient.invalidateQueries({ queryKey: ["payments", "unclaimed-nudge"] });
      refreshWalletBalances();
    },
    onError: (error: unknown, _vars, context: any) => {
      // Roll back optimistic claim data.
      setOptimisticClaimedAt(null);
      // claimInitiated drives the optimistic success celebration below — it was set true right
      // before this mutation fired, so a genuine failure must clear it, or the success screen
      // and the error toast show at the same time with no way to tell which one is real.
      setClaimInitiated(false);
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
  /** Every payment now routes through a burner and is claimed explicitly — the recipient always
   *  gets a choice of destination (own wallet or a pasted external address) and, unless the
   *  payment already arrived privately, whether to upgrade this claim to a private transfer. */
  const [externalClaimAddress, setExternalClaimAddress] = useState("");
  const [externalClaimRiskStatus, setExternalClaimRiskStatus] = useState<"idle" | "checking" | "safe" | "unsafe">("idle");
  useEffect(() => {
    const raw = externalClaimAddress.trim();
    if (!raw || !isValidAddressForChain(raw, "solana")) { setExternalClaimRiskStatus("idle"); return; }
    setExternalClaimRiskStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/risk/address?address=${encodeURIComponent(raw)}&network=solana`);
        const data = await res.json().catch(() => ({}));
        setExternalClaimRiskStatus(data.safe !== false ? "safe" : "unsafe");
      } catch {
        setExternalClaimRiskStatus("idle");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [externalClaimAddress]);
  // "Claim in Naira" — only fetched once we know the caller is the recipient, to avoid firing
  // PAJ Cash calls for every claim-page visit (including the sender's own share view).
  const [pajDefaultBankAccount, setPajDefaultBankAccount] = useState<PajSavedBankAccount | null>(null);
  const [pajLinked, setPajLinked] = useState(false);
  // Optimistic default: assume Nigeria until getClientGeo() (cached after the first call, see
  // lib/geo.ts) proves otherwise, so the "set up a bank account" discovery link below doesn't
  // wait on a network round trip to appear for the Nigerian majority of its audience.
  const [pajNigeria, setPajNigeria] = useState(true);
  const [nairaQuote, setNairaQuote] = useState<number | null>(null);
  useEffect(() => {
    if (!PAJ_CASH_ENABLED || !isRecipient || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const status = await pajLinkStatus(accessToken);
        if (cancelled) return;
        setPajLinked(status.linked);
        if (status.linked) {
          const accounts = await pajListBankAccounts(accessToken);
          if (!cancelled) setPajDefaultBankAccount(accounts.find((a) => a.is_default) ?? null);
        }
      } catch {
        // leave hidden — claim-to-wallet remains the primary path regardless
      }
      try {
        const geo = await getClientGeo();
        if (!cancelled) setPajNigeria(geo.countryCode === "NG");
      } catch {
        // default to non-prominent placement
      }
    })();
    return () => { cancelled = true; };
  }, [isRecipient, user?.id, getAccessToken]);
  useEffect(() => {
    if (!pajDefaultBankAccount || !claim?.amount) { setNairaQuote(null); return; }
    const netAmountUsdc = parseFloat(claim.amount) - computeLooftaFeeUsdc(parseFloat(claim.amount));
    if (!(netAmountUsdc > 0)) { setNairaQuote(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const q = await pajGetValue("offramp", netAmountUsdc, "NGN", accessToken);
        if (!cancelled) setNairaQuote(q.fiatAmount);
      } catch {
        if (!cancelled) setNairaQuote(null);
      }
    })();
    return () => { cancelled = true; };
  }, [pajDefaultBankAccount, claim?.amount, getAccessToken]);

  // Hush-like: every recipient sees crypto vs cash (Peer Venmo/Cash App/Revolut/Zelle + optional
  // Naira). Naira stays gated inside the cash menu — only show it when PAJ is enabled and the
  // recipient already has a default bank, is in Nigeria by IP, or already started a PAJ link.
  // Preview override keeps the old `showBankClaimOption` name for ?preview= keys.
  const showBankClaimOption = isTokenPrize ? false : (previewOverride?.showBankClaimOption ?? isRecipient);
  const showNairaClaimMethod =
    PAJ_CASH_ENABLED && (!!pajDefaultBankAccount || pajNigeria || pajLinked);
  // Once the recipient picks "Claim to wallet", drop into the original public/private choice —
  // "Claim to bank" no longer shows alongside it, matching the pre-bank-option flow exactly.
  const [walletClaimChosen, setWalletClaimChosen] = useState(false);
  // "Claim to cash" tile reveal — sits alongside walletClaimChosen (both start false, showing the
  // crypto/cash picker) but never sets it, so picking "Cash" then backing out still lands on the
  // same picker rather than needing a third state to reconstruct it.
  const [cashOptionsOpen, setCashOptionsOpen] = useState(false);
  // Recipient's own private-claim timing. Same defaults as a send: random split, 10-minute
  // spread, collapsed under Advanced options until they change it.
  const [claimPrivateSplit, setClaimPrivateSplit] = useState(randomPrivacySplit);
  const [claimPrivateDelayMs, setClaimPrivateDelayMs] = useState(DEFAULT_SPREAD_MS);
  const [claimPrivateInfoOpen, setClaimPrivateInfoOpen] = useState(false);
  // Off by default — same default as the old two-button layout's primary action being the public
  // claim, "Claim privately" was the opt-in secondary button. The switch just exposes the same
  // choice inline instead of as a separate button + confirm modal.
  const [claimPrivatelyChosen, setClaimPrivatelyChosen] = useState(false);
  const handleToggleClaimPrivately = (checked: boolean) => {
    setClaimPrivatelyChosen(checked);
    if (checked) setPrivacyBurstKey(Date.now());
  };
  // Which crypto/cash destination row is expanded inline (back-button pattern, same as
  // cashOptionsOpen above) — null shows the row list. Rows are ordered with whichever method the
  // recipient last actually claimed through shown first (readPreferredClaimMethod/
  // rememberPreferredClaimMethod), a per-browser convenience only — never anything load-bearing.
  const [cryptoMenuStep, setCryptoMenuStep] = useState<CryptoClaimMethod | null>(null);
  const [cashMenuStep, setCashMenuStep] = useState<"venmo" | "cashapp" | "revolut" | "zelle" | "coinbase" | "paj" | null>(null);
  const [peerHandle, setPeerHandle] = useState("");
  const [peerEtaLabel, setPeerEtaLabel] = useState<string | null>(null);
  const [peerEtaLoading, setPeerEtaLoading] = useState(false);
  const [payoutReceipt, setPayoutReceipt] = useState<{
    method: string;
    status: string;
    eta: string | null;
    detail: string | null;
  } | null>(null);
  const [preferredCryptoMethod, setPreferredCryptoMethod] = useState<CryptoClaimMethod>("wallet");
  const [preferredCashMethod, setPreferredCashMethod] = useState<CashClaimMethod>("p2p");
  useEffect(() => {
    setPreferredCryptoMethod(readPreferredClaimMethod(CRYPTO_CLAIM_PREF_KEY, "wallet", ["wallet", "external", "anyToken"] as const));
    setPreferredCashMethod(readPreferredClaimMethod(CASH_CLAIM_PREF_KEY, "p2p", ["naira", "p2p", "card"] as const));
  }, []);

  useEffect(() => {
    const method = (claim as { claim_payout_method?: string | null } | null)?.claim_payout_method;
    if (!method || method === "wallet") return;
    setPayoutReceipt({
      method,
      status: (claim as { claim_payout_status?: string | null }).claim_payout_status || "pending",
      eta: (claim as { claim_payout_eta_label?: string | null }).claim_payout_eta_label || null,
      detail: (claim as { claim_payout_detail?: string | null }).claim_payout_detail || null,
    });
  }, [claim]);

  const peerPlatform = PEER_PLATFORMS.find((p) => p.id === cashMenuStep) ?? null;
  useEffect(() => {
    if (!peerPlatform) { setPeerEtaLabel(null); return; }
    const amount = parseFloat(claim?.amount || "0");
    if (!(amount > 0)) return;
    let cancelled = false;
    setPeerEtaLoading(true);
    const timer = setTimeout(() => {
      getPeerEstimate(peerUsdc(amount), "USD", peerPlatform.processorName, true)
        .then((est) => { if (!cancelled) setPeerEtaLabel(est.eta?.label ?? null); })
        .catch(() => { if (!cancelled) setPeerEtaLabel(null); })
        .finally(() => { if (!cancelled) setPeerEtaLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [peerPlatform, claim?.amount]);

  const keepClaimCard = !!payoutReceipt && payoutReceipt.method !== "wallet";
  const peerCashoutReceipt = payoutReceipt && PEER_PAYOUT_METHODS.has(payoutReceipt.method) ? payoutReceipt : null;

  const openPeerReceive = (platformId: string, identifier: string, amountUsd: number, autoStart: boolean) => {
    window.dispatchEvent(new CustomEvent("openBalanceModal", {
      detail: {
        tab: "withdraw",
        method: "peer",
        peerPay: { platformId, identifier, amountUsd, intent: "receive", autoStart },
      },
    }));
  };

  const persistPayout = async (next: { method: string; status: string; eta: string | null; detail: string | null }) => {
    setPayoutReceipt(next);
    try {
      const backendUrl = clientApiBase();
      const token = await getAccessToken();
      await fetch(`${backendUrl}/claims/${id}/payout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          method: next.method,
          status: next.status,
          etaLabel: next.eta,
          detail: next.detail,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["claim", id], exact: true });
    } catch {
      // The receipt still shows from local state. The claim POST stamps the same fields.
    }
  };

  const openCoinbaseOfframp = async () => {
    const address = deriveSolanaEmbeddedAddress(user);
    if (!address) {
      toast({ variant: "destructive", title: "Wallet still setting up", description: "Try again in a moment." });
      return;
    }
    const accessToken = await getAccessToken();
    const sessionRes = await fetch("/api/coinbase/offramp-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ walletAddress: address, blockchains: ["solana"] }),
    });
    if (!sessionRes.ok) {
      const err = await sessionRes.json().catch(() => ({})) as { error?: string; detail?: string };
      throw new Error(err.detail || err.error || "Could not open Coinbase");
    }
    const { token: sessionToken } = await sessionRes.json();
    if (!sessionToken) throw new Error("Could not open Coinbase");
    const params = new URLSearchParams();
    params.set("appId", "68e3c83a-3d5a-49aa-a8fa-7ef26d824de1");
    params.set("sessionToken", sessionToken);
    params.set("defaultNetwork", "solana");
    params.set("defaultAsset", "USDC");
    params.set("redirectUrl", window.location.href);
    if (user?.id) params.set("partnerUserRef", user.id.slice(0, 50));
    window.open(`https://pay.coinbase.com/v3/sell/input?${params.toString()}`, "_blank");
  };

  // Inline "set up a bank account" dialog — shown when "Claim to bank" is clicked but no default
  // account exists yet, instead of bouncing the recipient away to the withdraw modal mid-claim.
  // If the recipient already has bank accounts saved from a previous withdrawal, offer to set one
  // of those as default before falling back to the add-a-new-account form.
  const [nairaSetupOpen, setNairaSetupOpen] = useState(false);
  // Confirm step shown after a default account is resolved (picked, added, or already set) and
  // before actually claiming — always shows the live ₦ rate first, never auto-claims.
  const [nairaClaimConfirmOpen, setNairaClaimConfirmOpen] = useState(false);
  const [nairaSetupStep, setNairaSetupStep] = useState<"link" | "bank">("link");
  const [nairaBankStep, setNairaBankStep] = useState<"pick" | "add">("add");
  const [nairaExistingAccounts, setNairaExistingAccounts] = useState<PajSavedBankAccount[]>([]);
  const [nairaAccountsLoading, setNairaAccountsLoading] = useState(false);
  const [nairaSettingDefaultId, setNairaSettingDefaultId] = useState<string | null>(null);
  const [nairaBanks, setNairaBanks] = useState<PajBank[]>([]);
  const [nairaBankId, setNairaBankId] = useState<string | null>(null);
  const [nairaAccountNumber, setNairaAccountNumber] = useState("");
  const [nairaResolved, setNairaResolved] = useState<PajResolvedBankAccount | null>(null);
  const [nairaResolving, setNairaResolving] = useState(false);
  const [nairaSaving, setNairaSaving] = useState(false);

  const openNairaSetup = () => {
    setNairaSetupStep(pajLinked ? "bank" : "link");
    setNairaSetupOpen(true);
  };

  // Load the recipient's already-saved bank accounts (from a previous withdrawal, or an earlier
  // "claim to bank" that never finished) as soon as we reach the "bank" step, so we can offer to
  // set one as default instead of always asking them to re-add one from scratch.
  useEffect(() => {
    if (!nairaSetupOpen || nairaSetupStep !== "bank") return;
    let cancelled = false;
    setNairaAccountsLoading(true);
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const accounts = await pajListBankAccounts(accessToken);
        if (cancelled) return;
        setNairaExistingAccounts(accounts);
        setNairaBankStep(accounts.length > 0 ? "pick" : "add");
      } catch {
        if (!cancelled) setNairaBankStep("add");
      } finally {
        if (!cancelled) setNairaAccountsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nairaSetupOpen, nairaSetupStep, getAccessToken]);

  useEffect(() => {
    if (!nairaSetupOpen || nairaSetupStep !== "bank" || nairaBankStep !== "add" || nairaBanks.length > 0) return;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        setNairaBanks(await pajListBanks(accessToken));
      } catch (err: unknown) {
        const msg = err instanceof PajCashApiError ? err.message : "Could not load banks.";
        toast({ variant: "destructive", title: "PAJ Cash", description: msg });
      }
    })();
  }, [nairaSetupOpen, nairaSetupStep, nairaBankStep, nairaBanks.length, getAccessToken, toast]);

  const handleNairaPickExisting = async (accountId: string) => {
    setNairaSettingDefaultId(accountId);
    try {
      const accessToken = await getAccessToken();
      const updated = await pajSetDefaultBankAccount(accountId, accessToken);
      setPajDefaultBankAccount(updated);
      setNairaSetupOpen(false);
      setNairaClaimConfirmOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not set default account.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setNairaSettingDefaultId(null);
    }
  };

  const handleNairaResolve = async () => {
    if (!nairaBankId || !nairaAccountNumber.trim()) return;
    setNairaResolving(true);
    setNairaResolved(null);
    try {
      const accessToken = await getAccessToken();
      setNairaResolved(await pajConfirmBankAccount(nairaBankId, nairaAccountNumber.trim(), accessToken));
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not resolve this account.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setNairaResolving(false);
    }
  };

  const handleNairaSaveAndClaim = async () => {
    if (!nairaBankId || !nairaResolved) return;
    setNairaSaving(true);
    try {
      const accessToken = await getAccessToken();
      const bankName = nairaBanks.find((b) => b.id === nairaBankId)?.name ?? nairaResolved.bank.name;
      const saved = await pajSaveBankAccount(nairaBankId, bankName, nairaResolved.accountNumber, accessToken);
      // saveAccount only auto-defaults a user's very first account — explicitly promote it
      // here too, since the whole point of this flow is "use this account for Naira claims".
      const defaulted = saved.is_default ? saved : await pajSetDefaultBankAccount(saved.id, accessToken);
      setPajDefaultBankAccount(defaulted);
      setNairaSetupOpen(false);
      setNairaClaimConfirmOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not save this account.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setNairaSaving(false);
    }
  };

  const renderNairaSetupDialog = () => (
    <Dialog open={nairaSetupOpen} onOpenChange={(open) => setNairaSetupOpen(open)}>
      <DialogContent className="border-white/10 bg-[#0f0f12] text-white sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up Naira payouts</DialogTitle>
          <DialogDescription className="text-slate-400">
            {nairaSetupStep === "bank" && nairaBankStep === "pick"
              ? "Choose which bank account should receive your Naira claims."
              : "Link your PAJ Cash account and add a bank account to claim this payment straight to Naira."}
          </DialogDescription>
        </DialogHeader>
        {nairaSetupStep === "link" ? (
          <PajCashLinkFlow
            dark
            prefillEmail={user?.email?.address ?? null}
            getAccessToken={getAccessToken}
            onBack={() => setNairaSetupOpen(false)}
            onLinked={() => { setPajLinked(true); setNairaSetupStep("bank"); }}
          />
        ) : nairaAccountsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : nairaBankStep === "pick" ? (
          <div className="space-y-2">
            {nairaExistingAccounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => handleNairaPickExisting(acc.id)}
                disabled={nairaSettingDefaultId === acc.id}
                className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border-2 border-white/10 bg-white/5 text-left transition-all hover:bg-white/10 hover:border-white/20 disabled:opacity-50"
              >
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white">{acc.account_name}</p>
                  <p className="text-base mt-0.5 text-slate-400">{acc.bank_name} · {acc.account_number}</p>
                </div>
                {nairaSettingDefaultId === acc.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
                ) : (
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setNairaBankStep("add")}
              className="w-full p-4 rounded-xl border-2 border-dashed border-white/20 text-base font-medium text-slate-300 transition-all hover:bg-white/5"
            >
              + Add a new bank account
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {nairaExistingAccounts.length > 0 && (
              <button
                type="button"
                onClick={() => setNairaBankStep("pick")}
                className="flex items-center gap-1 text-base font-medium text-slate-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to your saved accounts
              </button>
            )}
            <div>
              <Label className="text-slate-300">Bank</Label>
              <div className="mt-1">
                <BankCombobox
                  dark
                  banks={nairaBanks}
                  value={nairaBankId}
                  onChange={(bankId) => { setNairaBankId(bankId); setNairaResolved(null); }}
                  disabled={nairaBanks.length === 0}
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300">Account number</Label>
              <Input
                inputMode="numeric"
                placeholder="0123456789"
                value={nairaAccountNumber}
                onChange={(e) => { setNairaAccountNumber(e.target.value); setNairaResolved(null); }}
                className="mt-1 font-mono text-base bg-white/10 border-white/20 text-white placeholder:text-slate-400"
              />
            </div>
            {nairaResolved ? (
              <div className="rounded-xl border-2 border-white/10 bg-white/5 p-4">
                <p className="text-base text-slate-400">Account holder</p>
                <p className="text-base font-semibold text-white">{nairaResolved.accountName}</p>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={handleNairaResolve}
                disabled={nairaResolving || !nairaBankId || !nairaAccountNumber.trim()}
                className="w-full border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white"
              >
                {nairaResolving ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Looking up account…</span>
                ) : "Look up account"}
              </Button>
            )}
            {nairaResolved && (
              <Button
                onClick={handleNairaSaveAndClaim}
                disabled={nairaSaving}
                className="w-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] hover:opacity-90 text-white disabled:opacity-50"
              >
                {nairaSaving ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Saving & claiming…</span>
                ) : "Save & claim in Naira"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  /** Always shown before actually claiming to Naira — never auto-claims the moment a default
   *  account is resolved. Shows the live ₦ rate (nairaQuote, fetched from PAJ's own quote
   *  endpoint) and the Loofta fee breakdown so the recipient sees exactly what they'll get. */
  const renderNairaClaimConfirmDialog = () => {
    const grossUsd = parseFloat(claim?.amount || "0") || 0;
    const feeUsd = computeLooftaFeeUsdc(grossUsd);
    const netUsd = grossUsd - feeUsd;
    return (
      <Dialog open={nairaClaimConfirmOpen} onOpenChange={(open) => setNairaClaimConfirmOpen(open)}>
        <DialogContent
          className={cn(
            "border-white/10 bg-[#0f0f12] text-white",
            "left-0 right-0 top-0 [transform:none] h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col data-[state=open]:!zoom-in-100 data-[state=open]:!animate-none",
            "sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-md sm:rounded-2xl sm:border sm:p-7 sm:gap-4 sm:overflow-y-auto sm:flex-none sm:block",
            "[&>button]:h-12 [&>button]:w-12 [&>button]:rounded-full [&>button_svg]:h-5 [&>button_svg]:w-5",
          )}
        >
          {/* Drag handle — mobile only */}
          <div className="sm:hidden flex justify-center pt-5 pb-2 shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div
            className="sm:contents px-6 pb-6 sm:p-0 space-y-5 sm:space-y-4"
            style={{ flex: "1 1 0", height: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            <DialogHeader className="pb-0 pt-2 sm:pt-0">
              <DialogTitle className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Claim in Naira</DialogTitle>
              <DialogDescription className="text-base font-medium mt-0.5 text-slate-400">
                {pajDefaultBankAccount ? `To ${pajDefaultBankAccount.bank_name} ····${pajDefaultBankAccount.account_number.slice(-4)}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="flex items-center justify-between text-base text-slate-400">
                <span>Claim amount</span>
                <span className="font-sans text-slate-200">${grossUsd.toFixed(2)}</span>
              </div>
              {feeUsd > 0 && (
                <div className="flex items-center justify-between text-base text-slate-400">
                  <span>Loofta fee</span>
                  <span className="font-sans text-slate-200">- ${feeUsd.toFixed(2)}</span>
                </div>
              )}
              <div className="h-px bg-white/10 my-1" />
              <div className="flex items-center justify-between text-lg font-semibold">
                <span className="text-white">You&apos;ll receive</span>
                <span className="font-sans text-amber-300">
                  {nairaQuote != null ? `≈ ₦${nairaQuote.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : <Loader2 className="h-4 w-4 animate-spin inline" />}
                </span>
              </div>
              <div className="text-right text-sm text-slate-500">${netUsd.toFixed(2)} USDC after fees</div>
            </div>

          </div>

          {/* Mobile: pinned to the bottom like the main claim CTA */}
          <div className="shrink-0 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[#0f0f12]/95 border-t border-white/10 sm:border-0 sm:bg-transparent sm:p-0 sm:mt-2">
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setNairaClaimConfirmOpen(false)}
                disabled={claimActionDisabled}
                className="flex-1 h-14 sm:h-12 rounded-xl text-lg sm:text-base font-semibold border border-white/10 text-slate-300 hover:bg-white/[0.06] transition-all disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const pajDetail = pajDefaultBankAccount ? `${pajDefaultBankAccount.bank_name} ····${pajDefaultBankAccount.account_number.slice(-4)}` : "Naira bank";
                  const pajReceipt = { method: "paj", status: "cashing_out", eta: "Usually within a few minutes", detail: pajDetail };
                  setNairaClaimConfirmOpen(false);
                  setPayoutReceipt(pajReceipt);
                  setClaimInitiated(true);
                  claimAsRecipientMutation.mutate({
                    claimToNaira: true,
                    payoutMethod: "paj",
                    payoutStatus: "cashing_out",
                    payoutEtaLabel: pajReceipt.eta,
                    payoutDetail: pajDetail,
                  }, {
                    onSuccess: () => { void persistPayout(pajReceipt); },
                    onError: () => setPayoutReceipt(null),
                  });
                }}
                disabled={claimActionDisabled || nairaQuote == null}
                className="flex-1 h-14 sm:h-12 rounded-xl text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                Confirm & claim
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  /** Redundant to offer once the payment already arrived privately — the burner's incoming leg
   *  already broke any on-chain link back to the sender, so a plain public sweep out reveals
   *  nothing new (see the Context section of the universal-claim plan). */
  const canClaimPrivately = isTokenPrize
    ? false
    : (previewOverride?.canClaimPrivately ?? !claim?.is_private);
  const claimActionDisabled = claimAsRecipientMutation.isPending || waitingForBurnerFunds || walletNotReady;
  /** Recipient pays this fee out of the claimed amount when upgrading a public burner to a
   *  private claim (exact-in) — mirrors sweepClaimBurnerPrivately's math server-side. Estimate
   *  only; the real amount comes back from the claim response. */
  const estimateClaimPrivatelyNet = (usd: number) => {
    const gasFee = 0.20;
    const bps = 10;
    const afterRelay = Math.max(0, usd - gasFee);
    const protocolFee = (afterRelay * bps) / 10_000;
    const feeEstimate = gasFee + protocolFee;
    return { net: Math.max(0, usd - feeEstimate), feeEstimate };
  };
  const confirmPrivateClaimAmount = parseFloat(claim?.amount || "0") || 0;
  const confirmPrivateClaimEstimate = estimateClaimPrivatelyNet(confirmPrivateClaimAmount);
  const renderPeerReceiveClaim = () => {
    if (!peerCashoutReceipt) return null;
    const platform = PEER_PLATFORMS.find((p) => p.id === peerCashoutReceipt.method);
    const name = platform?.name ?? "Revolut";
    const amountUsd = parseFloat(claim?.amount || "0") || 0;
    const receiveUsd = cashoutPayoutUsdc(amountUsd);
    const feeUsd = Math.max(0, amountUsd - receiveUsd);
    const sending = claimAsRecipientMutation.isPending;
    return (
      <div className="w-full max-w-md mx-auto text-left">
        <div className="flex items-center gap-3 pr-2">
          {platform?.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={platform.logo} alt="" className="h-12 w-12 rounded-2xl object-cover shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[28px] font-bold tracking-[-0.04em] leading-none text-white">To {name}</p>
            <p className="text-base font-medium mt-1 text-[#8A8893]">You receive ${receiveUsd.toFixed(2)}</p>
          </div>
        </div>
        {sending && (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <span className="relative block h-7 w-7" aria-hidden>
              <span className="absolute inset-0 rounded-full border-[1.5px] border-white/15" />
              <span className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-white animate-spin" />
            </span>
            <p className="text-sm text-[#8A8893]">Sending to {name}</p>
          </div>
        )}
        <div className={cn("rounded-2xl border border-white/10 bg-[#0E0E12] px-4 py-3.5 space-y-2", sending ? "mt-6" : "mt-8")}>
          <div className="flex items-center justify-between">
            <span className="text-base text-[#B5B2BC]">This payment</span>
            <span className="text-base font-semibold text-white">${amountUsd.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base text-[#B5B2BC]">Fill incentive</span>
            <span className="text-base text-slate-300">${feeUsd.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 pt-2">
            <span className="text-base text-[#B5B2BC]">You receive</span>
            <span className="text-xl font-semibold text-white">${receiveUsd.toFixed(2)}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={sending || !peerCashoutReceipt.detail}
          onClick={() => openPeerReceive(peerCashoutReceipt.method, peerCashoutReceipt.detail || "", amountUsd, true)}
          className="mt-3 w-full h-12 rounded-xl font-semibold text-base bg-gradient-to-r from-orange-500 to-red-500 text-white disabled:opacity-60"
        >
          {sending ? "Sending…" : `Cash out to ${name}`}
        </button>
      </div>
    );
  };

  /** Plain claim into the Loofta wallet, then the existing Withdraw sheet opens on the chosen rail. */
  const claimThenWithdraw = (method: "crypto" | "cash") => {
    setClaimInitiated(true);
    claimAsRecipientMutation.mutate(
      {},
      {
        onSuccess: () => {
          window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "withdraw", ...(method === "cash" ? { method } : {}) } }));
        },
      },
    );
  };

  /** Shared claim panel — replaces the old single hardcoded "claim to wallet" button (and the
   *  first-claim-only "claim privately" button) with the full set of choices, for every claim. */
  const renderClaimPanel = (mobile: boolean) => {
    if (keepClaimCard && payoutReceipt) {
      if (PEER_PAYOUT_METHODS.has(payoutReceipt.method)) {
        return (
          <div className={mobile ? "w-full" : "hidden md:flex flex-col w-full max-w-md mx-auto"}>
            {renderPeerReceiveClaim()}
          </div>
        );
      }
      const method = payoutReceipt.method;
      const resume = () => {
        const amountUsd = parseFloat(claim?.amount || "0");
        if (method === "coinbase") {
          openCoinbaseOfframp().catch((err: unknown) => {
            toast({ variant: "destructive", title: "Coinbase", description: err instanceof Error ? err.message : "Could not open Coinbase" });
          });
        } else if (method === "near") {
          window.dispatchEvent(new CustomEvent("openBalanceModal", {
            detail: { tab: "withdraw", method: "near", amountUsd },
          }));
        } else if (method === "paj") {
          window.dispatchEvent(new CustomEvent("openBalanceModal", {
            detail: { tab: "withdraw", method: "paj", amountUsd },
          }));
        }
      };
      return (
        <div className={mobile ? "w-full" : "hidden md:flex flex-col w-full max-w-md mx-auto"}>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-200">{PAYOUT_METHOD_LABEL[method] || "Cash out"}</span>
              <span className="text-sm font-medium text-amber-300">
                {claimAsRecipientMutation.isPending
                  ? "Claiming…"
                  : method === "near"
                    ? "In your Loofta wallet"
                    : payoutStatusCopy(payoutReceipt.status)}
              </span>
            </div>
            {payoutReceipt.detail && (
              <p className="text-sm text-slate-400 truncate">{payoutReceipt.detail}</p>
            )}
            {payoutReceipt.eta && (
              <p className="text-sm text-slate-300">{payoutReceipt.eta}</p>
            )}
            {method !== "external" && (
              <button
                type="button"
                onClick={resume}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-white/10 hover:bg-white/15"
              >
                {method === "near" ? "Pick a token" : payoutReceipt.status === "completed" ? "View cash out" : "Continue cash out"}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
    <div className={mobile ? "w-full" : "hidden md:flex flex-col w-full max-w-md mx-auto"}>
      {previewOverride?.forcePrivatelyPaidNotice && (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-base text-slate-300 mb-3">
          <PrivacyGlyph size={16} opacity={1} />
          <span>This payment was sent privately</span>
        </div>
      )}
      {showBankClaimOption && !walletClaimChosen ? (
        !cashOptionsOpen ? (
          <>
            <button
              type="button"
              onClick={() => claimThenWithdraw("crypto")}
              disabled={claimActionDisabled}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-xl font-semibold transition-all",
                mobile ? "py-5 text-base" : "py-4 text-base",
                "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                claimActionDisabled && "opacity-50 cursor-not-allowed hover:opacity-50",
              )}
            >
              {!(walletNotReady || waitingForBurnerFunds) && <Wallet className={mobile ? "h-5 w-5" : "h-4 w-4"} />}
              <span>Claim {isTokenPrize ? tokenPrizeSymbol : "in crypto"}{walletNotReady ? " (setting up wallet…)" : waitingForBurnerFunds ? " (not ready)" : ""}</span>
            </button>

            <div className="flex items-center gap-3 my-3.5 w-full">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-base font-medium tracking-widest text-slate-500 uppercase">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={() => claimThenWithdraw("cash")}
              disabled={claimActionDisabled}
              className={cn(
                "w-full rounded-2xl p-[1.5px] bg-gradient-to-r from-orange-500 via-amber-400 to-red-500 transition-opacity",
                claimActionDisabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-90",
              )}
            >
              <span
                className={cn(
                  "flex flex-col items-stretch gap-3 rounded-[calc(1rem-1.5px)] bg-[#0f0f12] font-semibold text-slate-100 transition-colors px-4",
                  mobile ? "py-4 text-base" : "py-3.5 text-base",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 shrink-0" />
                    <span>Claim to cash</span>
                  </span>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-medium text-amber-300">Easiest</span>
                </span>
                <span className="grid grid-cols-3 gap-x-2 gap-y-3">
                  {[
                    ...PEER_PLATFORMS.map((p) => ({ id: p.id, name: p.name, logo: p.logo })),
                    { id: "coinbase", name: "Coinbase", logo: "/images/icons/coinbase-logo.png" },
                    { id: "paj", name: "PAJ Cash", logo: "/images/icons/paj-cash-logo.svg" },
                  ].map((p) => (
                    <span key={p.id} className="flex flex-col items-center gap-1.5">
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/5 border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.logo} alt="" className="h-7 w-7 object-contain" />
                      </span>
                      <span className="text-sm font-normal text-slate-400">{p.name}</span>
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </>
        ) : (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => (cashMenuStep ? setCashMenuStep(null) : setCashOptionsOpen(false))}
              className="flex items-center gap-1 text-base font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>

            {cashMenuStep === null && (
              <div className="space-y-2.5">
                {PEER_PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setPeerHandle(""); setCashMenuStep(p.id as "venmo" | "cashapp" | "revolut" | "zelle"); }}
                    disabled={claimActionDisabled}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left font-semibold text-slate-100 transition-all hover:border-white/20 hover:bg-white/10",
                      mobile ? "py-4" : "py-3.5",
                      claimActionDisabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <DepositIcons icons={[{ src: p.logo, bg: p.id === "venmo" ? "#3D95CE" : p.id === "cashapp" ? "#00D632" : p.id === "revolut" ? "#191C1F" : "#6D1ED4" }]} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-base">{p.name}</span>
                      <span className="block text-base font-normal text-slate-500">Cash out to {p.name}</span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCashMenuStep("coinbase")}
                  disabled={claimActionDisabled}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left font-semibold text-slate-100 hover:bg-white/10",
                    mobile ? "py-4" : "py-3.5",
                    claimActionDisabled && "opacity-50",
                  )}
                >
                  <DepositIcons icons={[{ src: "/images/icons/coinbase-logo.png", bg: "#0052FF" }]} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-base">Coinbase</span>
                    <span className="block text-base font-normal text-slate-500">Sell USDC to your bank</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setCashMenuStep("paj")}
                  disabled={claimActionDisabled}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left font-semibold text-slate-100 hover:bg-white/10",
                    mobile ? "py-4" : "py-3.5",
                    claimActionDisabled && "opacity-50",
                  )}
                >
                  <DepositIcons icons={[{ src: "/images/icons/paj-cash-logo.svg", bg: "#111" }]} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-base">PAJ Cash</span>
                    <span className="block text-base font-normal text-slate-500">Nigerian bank transfer</span>
                  </span>
                </button>
              </div>
            )}

            {peerPlatform && (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                  <p className="text-base font-semibold text-slate-100">Cash out to {peerPlatform.name}</p>
                  <p className="text-base text-slate-500 leading-relaxed">
                    Claims into your Loofta wallet first, then opens Withdraw so you can cash out from there.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClaimInitiated(true);
                    claimAsRecipientMutation.mutate(
                      {},
                      {
                        onSuccess: () => {
                          window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "withdraw" } }));
                        },
                      },
                    );
                  }}
                  disabled={claimActionDisabled}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 rounded-xl font-semibold transition-all",
                    mobile ? "py-4 text-base" : "py-3",
                    "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                    claimActionDisabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {claimAsRecipientMutation.isPending ? "Claiming…" : `Claim & cash out to ${peerPlatform.name}`}
                </button>
              </div>
            )}

            {cashMenuStep === "coinbase" && (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-base font-semibold text-slate-100">Coinbase</p>
                  <p className="text-base text-slate-500 mt-1">Claims into your Loofta wallet, then opens Coinbase so you can sell to your bank. Usually a few minutes.</p>
                </div>
                <button
                  type="button"
                  disabled={claimActionDisabled}
                  onClick={() => {
                    const receipt = { method: "coinbase", status: "in_wallet", eta: "Finish the sale in Coinbase", detail: "Coinbase" };
                    setClaimInitiated(true);
                    claimAsRecipientMutation.mutate(
                      { payoutMethod: "coinbase", payoutStatus: "in_wallet", payoutEtaLabel: receipt.eta, payoutDetail: receipt.detail },
                      {
                        onSuccess: () => {
                          void persistPayout(receipt);
                          openCoinbaseOfframp().catch((err: unknown) => {
                            toast({ variant: "destructive", title: "Coinbase", description: err instanceof Error ? err.message : "Could not open Coinbase" });
                          });
                        },
                      },
                    );
                  }}
                  className="w-full rounded-xl py-3 font-semibold text-white bg-gradient-to-r from-[#FF1301] to-[#EAB308] disabled:opacity-50"
                >
                  {claimAsRecipientMutation.isPending ? "Claiming…" : "Claim & open Coinbase"}
                </button>
              </div>
            )}

            {cashMenuStep === "paj" && (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-base font-semibold text-slate-100">PAJ Cash</p>
                  <p className="text-base text-slate-500 mt-1">
                    {pajDefaultBankAccount
                      ? `Pays ${pajDefaultBankAccount.bank_name} ····${pajDefaultBankAccount.account_number.slice(-4)}. Usually within a few minutes.`
                      : "Link PAJ Cash and a Nigerian bank account, then this claim pays out in Naira."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={claimActionDisabled}
                  onClick={() => {
                    if (!PAJ_CASH_ENABLED && !pajLinked && !pajDefaultBankAccount) {
                      toast({ title: "PAJ Cash", description: "Naira payouts are turned on for this claim. We’ll link your bank next." });
                    }
                    if (pajDefaultBankAccount) setNairaClaimConfirmOpen(true);
                    else openNairaSetup();
                  }}
                  className="w-full rounded-xl py-3 font-semibold text-white bg-gradient-to-r from-[#FF1301] to-[#EAB308] disabled:opacity-50"
                >
                  {pajDefaultBankAccount ? "Review Naira payout" : "Set up PAJ Cash"}
                </button>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="space-y-2.5">
          {showBankClaimOption && cryptoMenuStep === null && (
            <button
              type="button"
              onClick={() => setWalletClaimChosen(false)}
              className="flex items-center gap-1 text-base font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}
          {cryptoMenuStep !== null && (
            <button
              type="button"
              onClick={() => setCryptoMenuStep(null)}
              className="flex items-center gap-1 text-base font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}

          {cryptoMenuStep === null && (
            <div className="space-y-2.5">
              {[...CRYPTO_CLAIM_METHODS]
                .filter((methodKey) => !(isTokenPrize && methodKey === "anyToken"))
                .sort((a, b) => (a === preferredCryptoMethod ? -1 : b === preferredCryptoMethod ? 1 : 0))
                .map((methodKey) => {
                  if (methodKey === "wallet") {
                    return (
                      <button
                        key="wallet"
                        type="button"
                        onClick={() => setCryptoMenuStep("wallet")}
                        disabled={claimActionDisabled}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left font-semibold text-slate-100 transition-all hover:border-white/20 hover:bg-white/10",
                          mobile ? "py-4" : "py-3.5",
                          claimActionDisabled && "opacity-50 cursor-not-allowed hover:border-white/10 hover:bg-white/5",
                        )}
                      >
                        <DepositIcons icons={[{ src: "/images/usdc.svg", bg: "#2775CA" }, { src: "/images/logo/solana-mark.svg", bg: "#111" }]} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-base">{isTokenPrize ? `${tokenPrizeSymbol} on Solana` : "USDC on Solana"}</span>
                          <span className="block text-base font-normal text-slate-500">{isTokenPrize ? "The prize token, into your Loofta wallet" : "Loofta wallet · fastest"}</span>
                        </span>
                      </button>
                    );
                  }
                  if (methodKey === "external") {
                    return (
                      <button
                        key="external"
                        type="button"
                        onClick={() => setCryptoMenuStep("external")}
                        disabled={claimActionDisabled}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left font-semibold text-slate-100 transition-all hover:border-white/20 hover:bg-white/10",
                          mobile ? "py-4" : "py-3.5",
                          claimActionDisabled && "opacity-50 cursor-not-allowed hover:border-white/10 hover:bg-white/5",
                        )}
                      >
                        <DepositIcons icons={[{ src: "/images/sol.png", bg: "#14F195" }]} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-base">External wallet</span>
                          <span className="block text-base font-normal text-slate-500">Any Solana address</span>
                        </span>
                      </button>
                    );
                  }
                  return (
                    <button
                      key="anyToken"
                      type="button"
                      onClick={() => setCryptoMenuStep("anyToken")}
                      disabled={claimActionDisabled}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left font-semibold text-slate-100 transition-all hover:border-white/20 hover:bg-white/10",
                        mobile ? "py-4" : "py-3.5",
                        claimActionDisabled && "opacity-50 cursor-not-allowed hover:border-white/10 hover:bg-white/5",
                      )}
                    >
                      <DepositIcons icons={[{ src: "/images/sol.png", bg: "#14F195" }, { src: "/images/btc.svg", bg: "#F7931A" }]} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-base">Any crypto</span>
                        <span className="block text-base font-normal text-slate-500">Any chain, via NEAR Intents</span>
                      </span>
                    </button>
                  );
                })}
            </div>
          )}

          {cryptoMenuStep === "wallet" && (
            <>
              {canClaimPrivately && (
                <IncognitoModeToggle
                  checked={claimPrivatelyChosen}
                  onCheckedChange={handleToggleClaimPrivately}
                  onLabel="Claim privately"
                  offLabel="Claim privately"
                  ariaLabel="Claim this payment privately"
                  className="mb-3"
                />
              )}

              <AnimatePresence initial={false}>
                {claimPrivatelyChosen && canClaimPrivately && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2 mb-3">
                      <div className="flex items-center justify-between text-base text-slate-400">
                        <span>Claim amount</span>
                        <span className="font-sans text-slate-200">${confirmPrivateClaimAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-base text-slate-400">
                        <span>Privacy fee</span>
                        <span className="font-sans text-slate-200">- ${confirmPrivateClaimEstimate.feeEstimate.toFixed(2)}</span>
                      </div>
                      <div className="h-px bg-white/10 my-1" />
                      <div className="flex items-center justify-between text-lg font-semibold">
                        <span className="text-white">You&apos;ll receive</span>
                        <span className="font-sans text-amber-300">${confirmPrivateClaimEstimate.net.toFixed(2)}</span>
                      </div>
                    </div>
                    <PrivacyTimingControls
                      idPrefix="claim-privacy"
                      split={claimPrivateSplit}
                      onSplitChange={setClaimPrivateSplit}
                      delayMs={claimPrivateDelayMs}
                      onDelayMsChange={setClaimPrivateDelayMs}
                      amountUsd={confirmPrivateClaimAmount}
                      infoOpen={claimPrivateInfoOpen}
                      onInfoOpenChange={setClaimPrivateInfoOpen}
                      theme="dark"
                      className="mb-3"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={() => {
                  rememberPreferredClaimMethod(CRYPTO_CLAIM_PREF_KEY, "wallet");
                  setClaimInitiated(true);
                  claimAsRecipientMutation.mutate(
                    claimPrivatelyChosen && canClaimPrivately
                      ? { claimPrivately: true, split: claimPrivateSplit, maxDelayMs: claimPrivateDelayMs }
                      : {},
                  );
                }}
                disabled={claimActionDisabled}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-xl font-semibold transition-all",
                  mobile ? "py-4 text-base" : "py-3",
                  "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                  claimActionDisabled && "opacity-50 cursor-not-allowed hover:opacity-50",
                )}
              >
                {claimAsRecipientMutation.isPending ? (
                  <><Loader2 className={mobile ? "h-5 w-5 animate-spin" : "h-4 w-4 animate-spin"} /><span>Claiming…</span></>
                ) : (
                  <>
                    <CheckCircle2 className={mobile ? "h-5 w-5" : "h-4 w-4"} />
                    <span>Confirm claim{walletNotReady ? " (setting up wallet…)" : waitingForBurnerFunds ? " (not ready)" : ""}</span>
                  </>
                )}
              </button>
            </>
          )}

          {cryptoMenuStep === "external" && (
            <div className="space-y-3">
              <SolanaWalletConnectProvider rpcUrl={getSolanaHttpRpc()}>
                <ConnectExternalWalletButton onAddress={setExternalClaimAddress} />
              </SolanaWalletConnectProvider>
              <Input
                placeholder="Or paste a Solana address"
                value={externalClaimAddress}
                onChange={(e) => setExternalClaimAddress(e.target.value)}
                className="font-mono text-base"
              />
              {externalClaimRiskStatus === "checking" && (
                <p className="text-base flex items-center gap-1.5 text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Checking address…
                </p>
              )}
              {externalClaimRiskStatus === "safe" && (
                <p className="text-base flex items-center gap-1.5 text-emerald-500 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Address compliant
                </p>
              )}
              {externalClaimRiskStatus === "unsafe" && (
                <p className="text-base flex items-center gap-1.5 text-red-500 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Address flagged — claim blocked
                </p>
              )}

              {canClaimPrivately && (
                <IncognitoModeToggle
                  checked={claimPrivatelyChosen}
                  onCheckedChange={handleToggleClaimPrivately}
                  onLabel="Claim privately"
                  offLabel="Claim privately"
                  ariaLabel="Claim this payment privately"
                />
              )}

              <AnimatePresence initial={false}>
                {claimPrivatelyChosen && canClaimPrivately && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
                      <div className="flex items-center justify-between text-base text-slate-400">
                        <span>Claim amount</span>
                        <span className="font-sans text-slate-200">${confirmPrivateClaimAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-base text-slate-400">
                        <span>Privacy fee</span>
                        <span className="font-sans text-slate-200">- ${confirmPrivateClaimEstimate.feeEstimate.toFixed(2)}</span>
                      </div>
                      <div className="h-px bg-white/10 my-1" />
                      <div className="flex items-center justify-between text-lg font-semibold">
                        <span className="text-white">You&apos;ll receive</span>
                        <span className="font-sans text-amber-300">${confirmPrivateClaimEstimate.net.toFixed(2)}</span>
                      </div>
                    </div>
                    <PrivacyTimingControls
                      idPrefix="claim-external-privacy"
                      split={claimPrivateSplit}
                      onSplitChange={setClaimPrivateSplit}
                      delayMs={claimPrivateDelayMs}
                      onDelayMsChange={setClaimPrivateDelayMs}
                      amountUsd={confirmPrivateClaimAmount}
                      infoOpen={claimPrivateInfoOpen}
                      onInfoOpenChange={setClaimPrivateInfoOpen}
                      theme="dark"
                      className="mt-3"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={() => {
                  rememberPreferredClaimMethod(CRYPTO_CLAIM_PREF_KEY, "external");
                  const dest = externalClaimAddress.trim();
                  const short = dest.length > 10 ? `${dest.slice(0, 4)}…${dest.slice(-4)}` : dest;
                  const externalReceipt = {
                    method: "external",
                    status: "completed",
                    eta: claimPrivatelyChosen ? "Private delivery" : "Direct to this wallet",
                    detail: short,
                  };
                  setPayoutReceipt(externalReceipt);
                  setClaimInitiated(true);
                  claimAsRecipientMutation.mutate(
                    {
                      ...(claimPrivatelyChosen && canClaimPrivately
                        ? { claimPrivately: true, destinationAddress: dest, split: claimPrivateSplit, maxDelayMs: claimPrivateDelayMs }
                        : { destinationAddress: dest }),
                      payoutMethod: "external",
                      payoutStatus: "completed",
                      payoutEtaLabel: externalReceipt.eta,
                      payoutDetail: short,
                    },
                    {
                      onSuccess: () => { void persistPayout(externalReceipt); },
                      onError: () => setPayoutReceipt(null),
                    },
                  );
                }}
                disabled={claimActionDisabled || externalClaimRiskStatus !== "safe"}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-base transition-all",
                  "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                  (claimActionDisabled || externalClaimRiskStatus !== "safe") && "opacity-50 cursor-not-allowed hover:opacity-50",
                )}
              >
                {claimAsRecipientMutation.isPending ? "Claiming…" : "Claim to this address"}
              </button>
            </div>
          )}

          {cryptoMenuStep === "anyToken" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-base font-semibold text-slate-100 mb-1">Any crypto</p>
                <p className="text-base text-slate-500 leading-relaxed">
                  Claims into your Loofta wallet, then opens NEAR Intents so you can send it as any token on any chain. You can claim that first hop privately.
                </p>
              </div>
              {canClaimPrivately && (
                <IncognitoModeToggle
                  checked={claimPrivatelyChosen}
                  onCheckedChange={handleToggleClaimPrivately}
                  onLabel="Claim privately"
                  offLabel="Claim privately"
                  ariaLabel="Claim this payment privately"
                />
              )}
              <button
                type="button"
                onClick={() => {
                  rememberPreferredClaimMethod(CRYPTO_CLAIM_PREF_KEY, "anyToken");
                  const privately = claimPrivatelyChosen && canClaimPrivately;
                  const receipt = {
                    method: "near",
                    status: "in_wallet",
                    eta: null as string | null,
                    detail: "Pick the token and chain",
                  };
                  setClaimInitiated(true);
                  claimAsRecipientMutation.mutate(
                    {
                      ...(privately ? { claimPrivately: true, split: claimPrivateSplit, maxDelayMs: claimPrivateDelayMs } : {}),
                      payoutMethod: "near",
                      payoutStatus: "in_wallet",
                      payoutDetail: receipt.detail,
                    },
                    {
                      onSuccess: () => {
                        void persistPayout(receipt);
                        const amountUsd = parseFloat(claim?.amount || "0");
                        window.dispatchEvent(new CustomEvent("openBalanceModal", {
                          detail: { tab: "withdraw", method: "near", amountUsd },
                        }));
                      },
                    },
                  );
                }}
                disabled={claimActionDisabled}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-xl font-semibold transition-all",
                  mobile ? "py-4 text-base" : "py-3",
                  "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-md hover:opacity-90",
                  claimActionDisabled && "opacity-50 cursor-not-allowed hover:opacity-50",
                )}
              >
                {claimAsRecipientMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /><span>Claiming…</span></>
                ) : (
                  <><Globe className="h-4 w-4" /><span>Claim &amp; pick a token</span></>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
  };
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
      const backendUrl = clientApiBase();
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
      const backendUrl = clientApiBase();
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
        toast({ title: "Claim sweep completed", description: isTokenPrize ? `${data.sweptAmount} ${tokenPrizeSymbol} moved to your wallet.` : `$${data.sweptAmount} USDC moved to your wallet.` });
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
      const backendUrl = clientApiBase();
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

  // Checkout-only: once the payer's own side of the payment lands (SUCCESS or
  // PRIVATE_TRANSFER_PENDING — the latter is what a freshly-paid claim shows immediately,
  // before the async recipient sweep completes; from the payer's point of view they're done
  // either way), tell whoever opened this checkout. Popup mode: postMessage, matching what
  // PayButton's onSuccess already listens for. Redirect/same-tab mode: navigate to ?callback=
  // (set by PayButton) with the outcome appended, so the merchant's own page can show it.
  const checkoutSettledNotifiedRef = React.useRef(false);
  useEffect(() => {
    if (chrome !== "minimal" || checkoutSettledNotifiedRef.current) return;
    const effectiveStatus = String(status || claim?.status || "").toUpperCase();
    if (effectiveStatus !== "SUCCESS" && effectiveStatus !== "PRIVATE_TRANSFER_PENDING") return;
    checkoutSettledNotifiedRef.current = true;

    const paymentId = claim?.short_id || id;
    if (typeof window !== "undefined" && window.opener) {
      try {
        window.opener.postMessage({ type: "loofta-payment-success", paymentId }, "*");
      } catch {
        /* opener from a different origin closed/unreachable — nothing else to do */
      }
      return;
    }
    const callback = searchParams.get("callback");
    if (callback) {
      try {
        const dest = new URL(decodeURIComponent(callback));
        dest.searchParams.set("payment", "success");
        dest.searchParams.set("short_id", paymentId);
        window.location.href = dest.toString();
      } catch {
        /* malformed callback URL — stay put rather than navigating somewhere broken */
      }
    }
  }, [chrome, status, claim?.status, claim?.short_id, id, searchParams]);

  // Covers the plain "already claimed" view (isRecipient + SUCCESS, no pending flags) —
  // reachable directly via optimistic status updates or a fresh page load without ever
  // passing through the claimCompleted branch above, so it needs its own refresh trigger.
  const staticSuccessBalanceRefreshedRef = React.useRef(false);
  useEffect(() => {
    const alreadyClaimedStatically =
      isRecipient &&
      !claim?.recipient_pending_email &&
      !claim?.recipient_pending_username &&
      !claim?.recipient_pending_social &&
      String(status || claim?.status || "").toUpperCase() === "SUCCESS";
    if (!alreadyClaimedStatically || staticSuccessBalanceRefreshedRef.current) return;
    staticSuccessBalanceRefreshedRef.current = true;
    refreshWalletBalances();
  }, [isRecipient, claim?.recipient_pending_email, claim?.recipient_pending_username, claim?.recipient_pending_social, status, claim?.status]);

  const [statusData, setStatusData] = useState<any>(null);
  const [paidFeeUsdc, setPaidFeeUsdc] = useState<number | null>(null);
  const [paidFeeBreakdown, setPaidFeeBreakdown] = useState<{ looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number } | null>(null);
  const [speedUpOpen, setSpeedUpOpen] = useState<boolean>(false);
  const [txInput, setTxInput] = useState<string>("");
  const [submittingTx, setSubmittingTx] = useState<boolean>(false);
  const [isPrivateMode, setIsPrivateMode] = useState<boolean>(false);
  const [privacyInfoOpen, setPrivacyInfoOpen] = useState<boolean>(false);
  // Same split/delay timing-obfuscation sliders as /fomo and GuestCheckoutPay — only consumed by
  // the authenticated Pay Now flow below (perTransfer), see the PrivacyTimingControls block.
  // Initialized from ?split=&delayMs= when the sender already chose these on the Send form
  // (app/app/page.tsx's privacyQuery()) instead of resetting to 1/0 here.
  const [privateSplit, setPrivateSplit] = useState<number>(() => {
    const v = Number(searchParams.get("split"));
    return Number.isFinite(v) && v >= 1 ? Math.min(15, Math.round(v)) : randomPrivacySplit();
  });
  const [privateDelayMs, setPrivateDelayMs] = useState<number>(() => {
    const v = Number(searchParams.get("delayMs"));
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SPREAD_MS;
  });
  // Keep the spread locked to ?delayMs= on the link. A later client navigation that only
  // changes the query (or a slider edit that rewrites it) has to move this state too —
  // the initializer above runs once, so without this the banner stays on the first value.
  useEffect(() => {
    const raw = searchParams.get("delayMs");
    if (raw == null) return;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) setPrivateDelayMs(v);
  }, [searchParams]);
  // Fall back to the claim's own persisted choice (private_split / private_max_delay_ms) once it
  // loads, for anyone who lands here WITHOUT the sender's ?split=&delayMs= — a recipient, or the
  // guest sender themselves revisiting the link later. The URL still wins on first render (it's
  // available before the claim query resolves, and reflects the choice this exact session just
  // made), this only fills the gap for every other visit.
  useEffect(() => {
    if (!claim) return;
    if (searchParams.get("split") == null) {
      const v = Number((claim as { private_split?: number | null }).private_split);
      if (Number.isFinite(v) && v >= 1) setPrivateSplit(Math.min(15, Math.round(v)));
    }
    if (searchParams.get("delayMs") == null) {
      const v = Number((claim as { private_max_delay_ms?: number | null }).private_max_delay_ms);
      if (Number.isFinite(v) && v >= 0) setPrivateDelayMs(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim]);
  // The link's ?delayMs= is the delay this payment was created with. It wins over a saved
  // value so the banner and the "funds are landing" notice always quote that same wait.
  const urlDelayRaw = searchParams.get("delayMs");
  const urlDelayMs = urlDelayRaw == null ? null : Number(urlDelayRaw);
  const savedDelayRaw = (claim as { private_max_delay_ms?: number | null } | null)?.private_max_delay_ms;
  const savedDelayMs = Number(savedDelayRaw);
  // History drops ?delayMs=. Remember it on this browser so a later visit still
  // knows when the private payment actually lands.
  const [rememberedDelayMs, setRememberedDelayMs] = useState<number | null>(null);
  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem(`loofta-pay-delay:${id}`);
      if (raw == null) return;
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0) setRememberedDelayMs(v);
    } catch { /* private mode / blocked storage */ }
  }, [id]);
  const delayFromUrl = urlDelayMs != null && Number.isFinite(urlDelayMs) && urlDelayMs >= 0 ? urlDelayMs : null;
  const delayFromClaim = savedDelayRaw != null && Number.isFinite(savedDelayMs) && savedDelayMs >= 0 ? savedDelayMs : null;
  // URL and the saved payment win. The slider default (10 min) must not flash over a
  // longer delay that is still loading. Once the payment is loaded and has no saved
  // delay, the slider value — default or what the sender just picked — is the real one.
  const knownDelayMs = delayFromUrl ?? delayFromClaim ?? rememberedDelayMs ?? (claim ? privateDelayMs : null);
  const landingDelayMs = knownDelayMs ?? 0;
  useEffect(() => {
    if (!id || knownDelayMs == null) return;
    try { localStorage.setItem(`loofta-pay-delay:${id}`, String(knownDelayMs)); } catch { /* ignore */ }
  }, [id, knownDelayMs]);
  // Flip "Paid" to "Claimed" when the private delay elapses, without a refresh.
  const [receiptNowMs, setReceiptNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!claim?.is_private || !claim?.paid_at) return;
    if (privateFundsLandedAt(claim.paid_at, knownDelayMs, Date.now())) return;
    const timer = setInterval(() => setReceiptNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [claim?.is_private, claim?.paid_at, knownDelayMs]);
  const setSpreadDelayMs = (ms: number) => {
    setPrivateDelayMs(ms);
    const params = new URLSearchParams(searchParams.toString());
    params.set("delayMs", String(ms));
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  };
  // Dev-only: jump straight into the private/public sender card via ?preview=sender-private|
  // sender-public (see DEV_PREVIEW_STATES) — an effect rather than a lazy useState initializer
  // since previewOverride isn't available until after the localhost-detection effect runs on
  // mount (isClaimPageLocalhost starts false).
  useEffect(() => {
    if (previewOverride?.isPrivateMode === undefined) return;
    setIsPrivateMode(previewOverride.isPrivateMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewParam]);
  /** Confetti burst from the bottom of the screen — the celebratory "entering incognito mode"
   *  moment, separate from the small "Private" badge that lives on the card itself. Non-null key
   *  mounts one <PrivacyConfettiBurst>; it clears itself via onDone. */
  const [privacyBurstKey, setPrivacyBurstKey] = useState<number | null>(null);
  const handleTogglePrivateMode = (checked: boolean) => {
    setIsPrivateMode(checked);
    if (checked) setPrivacyBurstKey(Date.now());
  };
  const [openPrivacyFaq, setOpenPrivacyFaq] = useState<number | null>(null);
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
  /** Actual fee confirmed by onTxBuilt — replaces the estimate once the tx is built. */
  const [pendingFeeUsdc, setPendingFeeUsdc] = useState<number | null>(null);
  /** True while silently pre-building tx to get real fee before modal opens. */
  const [preBuilding, setPreBuilding] = useState(false);
  /** When set, we're waiting for on-chain confirmation; show tracker UI in Pay Now modal. */
  const [confirmingTxSignature, setConfirmingTxSignature] = useState<string | null>(null);
  const [confirmingTxSource, setConfirmingTxSource] = useState<"loofta" | null>(null);
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
    confirmingTxSignature !== null || payingWithLoofta || perTransferPhase !== null;

  // fee_on_sender: true (default) = fees charged on top of amount; false = fees deducted from amount
  const isFeeOnSender = (claim as any)?.fee_on_sender !== false;
  // requiresPrivate: false only when claim was explicitly created as non-private
  const requiresPrivate = claim ? (claim as any).is_private !== false : true;
  const privateRequired = requiresPrivate;
  const privatePayActive = requiresPrivate;
  // Effective privacy for this payment: forced when the claim requires it, otherwise the payer's own choice via the switch.
  const payingPrivately = requiresPrivate || isPrivateMode;
  // Mirrors the ternary below that actually picks GuestCheckoutPay vs the authenticated Pay Now
  // button — used to decide where the "Pay privately" switch renders (see the block right above
  // that ternary): inside GuestCheckoutPay itself (under the selected option) when this is true,
  // above the whole section otherwise.
  // Also true for a claim the guest (unauthenticated) Send flow created (create-from-*-guest,
  // created_by null) once its own visitor isn't logged in either — same payment surface a
  // merchant checkout link uses (chrome="minimal"), just reached from the main Send form instead
  // of a payment link. An authenticated visitor still gets the normal Pay Now button below,
  // never gated behind this — checkoutAuthenticated stays plain `authenticated` for them since
  // the session-unlock dance right below only matters once showGuestCheckout is actually true
  // for someone who IS logged in, which a guest-created claim's own creator never is.
  const isGuestCreatedClaim = !claim?.created_by;
  const showGuestCheckout = !DEMO_MODE && !!claim?.claim_burner_address && (chrome === "minimal" || (isGuestCreatedClaim && !authenticated));
  const isCreatorView = !!user?.id && claim?.created_by === user.id;
  // Guest sender returning from the one-step Send flow: no account to match, only this device's
  // local record (see markGuestSentClaim). Read after mount so SSR/hydration agree.
  const [sentByThisGuestDevice, setSentByThisGuestDevice] = useState(false);
  useEffect(() => {
    setSentByThisGuestDevice(isGuestSentClaim(id));
  }, [id]);
  const isGuestSenderPaidView =
    sentByThisGuestDevice &&
    !authenticated &&
    isGuestCreatedClaim &&
    claim?.direction !== "from_recipient" &&
    ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CLAIMED"].includes(String(status || claim?.status || "").toUpperCase());

  // Checkout never trusts an ambient Privy session on load — the visitor has to explicitly click
  // Login before "Pay with Loofta balance" becomes available, and that unlock expires after 15
  // minutes, so testing the guest flow (or someone else's checkout link) never silently inherits
  // whatever account happened to already be signed in on this browser/domain. sessionStorage (not
  // localStorage) so it also resets on its own the moment the tab/window closes. Scoped entirely
  // to chrome="minimal" — every other page keeps using Privy's real `authenticated` unchanged.
  const CHECKOUT_SESSION_TTL_MS = 15 * 60_000;
  const CHECKOUT_SESSION_STORAGE_KEY = "loofta-checkout-unlocked-at";
  const [checkoutUnlockedAt, setCheckoutUnlockedAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(CHECKOUT_SESSION_STORAGE_KEY);
    return raw ? Number(raw) : null;
  });
  // Only exists to force a re-render once the 15-min TTL elapses while the tab stays open — its
  // value is never read, checkoutSessionActive below just re-evaluates Date.now() fresh.
  const [, forceCheckoutSessionRecheck] = useState(0);
  useEffect(() => {
    if (!showGuestCheckout || checkoutUnlockedAt == null) return;
    const remaining = CHECKOUT_SESSION_TTL_MS - (Date.now() - checkoutUnlockedAt);
    if (remaining <= 0) return;
    const t = setTimeout(() => forceCheckoutSessionRecheck((v) => v + 1), remaining + 50);
    return () => clearTimeout(t);
  }, [showGuestCheckout, checkoutUnlockedAt]);
  const checkoutSessionActive =
    checkoutUnlockedAt != null && Date.now() - checkoutUnlockedAt < CHECKOUT_SESSION_TTL_MS;
  const unlockCheckoutSession = () => {
    const now = Date.now();
    setCheckoutUnlockedAt(now);
    if (typeof window !== "undefined") window.sessionStorage.setItem(CHECKOUT_SESSION_STORAGE_KEY, String(now));
  };
  // Set right before calling Privy's login() when there was no session to unlock yet — the effect
  // below unlocks checkout the moment `authenticated` flips true as a result of that login.
  const pendingCheckoutLoginRef = React.useRef(false);
  useEffect(() => {
    if (authenticated && pendingCheckoutLoginRef.current) {
      pendingCheckoutLoginRef.current = false;
      unlockCheckoutSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);
  const handleCheckoutLogin = () => {
    if (!authenticated) {
      pendingCheckoutLoginRef.current = true;
      login();
      return;
    }
    // Already has a live Privy session from elsewhere on the site — no modal needed, this click is
    // just the explicit "yes, use it here" checkout requires.
    unlockCheckoutSession();
  };
  const checkoutAuthenticated = showGuestCheckout ? authenticated && checkoutSessionActive : authenticated;

  // Has the sender ever completed a public (non-private) payment to this same recipient before?
  // If so, a private payment now can't undo that — the recipient already knows their wallet
  // address. Only meaningful for a registered recipient (recipient_user_id set); a still-pending
  // one can't have received anything yet.
  const exposureCheckQuery = useQuery({
    queryKey: ["claim", id, "exposure-check", claim?.recipient_user_id],
    queryFn: async () => {
      const backendUrl = clientApiBase();
      const token = await getAccessToken();
      const r = await fetch(
        `${backendUrl}/claims/exposure-check?recipientUserId=${encodeURIComponent(claim!.recipient_user_id!)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!r.ok) return { hasPaidPublicly: false };
      const data = await r.json();
      return { hasPaidPublicly: data?.hasPaidPublicly === true };
    },
    enabled: isCreatorView && !!claim?.recipient_user_id,
    staleTime: 60_000,
  });
  const hasPaidRecipientPublicly = exposureCheckQuery.data?.hasPaidPublicly === true;

  // True only once both queries have settled AND this render is actually showing (or would
  // show) the "Payment not found" empty state — mirrors the two PaymentNotFoundNotice render
  // conditions below: claim is null (genuine 404), or claim loaded but this viewer isn't its
  // recognized recipient (and isn't the creator, and this isn't a Pay Now/payment-request view).
  const isPaymentNotFoundView =
    !loadingClaim &&
    !isCheckingRecipient &&
    (!claim || (!isCreatorView && !isRecipient && claim?.direction !== "from_recipient"));

  // Re-check recipient status the first time this page is actually showing "Payment not
  // found" while signed in — otherwise a stale cached/pre-login snapshot can make an
  // already-matching account keep showing as "not the recipient". Gated on
  // isPaymentNotFoundView so this never runs on Pay Now / creator / already-resolved views,
  // where isRecipient can never become true and the retries would just poll for nothing.
  //
  // Also gated on authRecheckWorthTrying: when the claim was sent to a specific social handle
  // (pendingSocialPlatformHint) and the client already knows — from Privy's own live
  // linkedAccounts, zero-latency — that this platform isn't connected yet, a live recheck can
  // only fail. Without this gate, an authenticated visitor who simply hasn't clicked "Connect"
  // yet was made to sit through refreshIdentityInPlace's full ~15s doomed retry loop (10
  // attempts x 1.5s) before the Connect button even appeared, which read as "stuck on
  // Confirming your account…" even though it did eventually resolve.
  //
  // Fires AT MOST ONCE per page load: `authRecheckFiredRef` only ever gets set, never reset, so
  // flapping of `authenticated` or `isPaymentNotFoundView` (e.g. Privy re-validating its
  // session) can't re-trigger it. Shares refreshIdentityInPlace with the link-success
  // callbacks — same in-flight guard, same identityConfirmGaveUp terminal state, no reload.
  const authRecheckWorthTrying = !pendingSocialPlatformHint || hasSocialPlatformLinked(pendingSocialPlatformHint);
  const authRecheckFiredRef = useRef(false);
  useEffect(() => {
    if (!authenticated || authRecheckFiredRef.current) return;
    if (!isPaymentNotFoundView) return;
    if (!authRecheckWorthTrying) return;
    authRecheckFiredRef.current = true;
    void refreshIdentityInPlace();
  }, [authenticated, isPaymentNotFoundView, authRecheckWorthTrying]);
  const isSenderPendingFundedView =
    isCreatorView &&
    isPendingRecipientClaim &&
    ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CLAIMED"].includes(String(status || claim?.status || "").toUpperCase());
  /** Only hide payer UI for the intended recipient (pending claim flow). Do not hide for anonymous/other payers when recipient_is_registered is set. */
  const hidePaySectionForPendingClaimant =
    isPendingRecipientClaim && isRecipient && !isCreatorView;
  /** Dark card treatment is scoped to the payer actively viewing the pay form — not the
   *  loading skeleton (payingPrivately defaults true before `claim` loads), not the recipient's
   *  claim view, not the success screen. Mirrors the exact condition gating the pay section below. */
  const showingPrivatePayForm =
    !!claim &&
    payingPrivately &&
    !isSenderPendingFundedView &&
    !hidePaySectionForPendingClaimant &&
    !isRecipient &&
    !isCheckingRecipient &&
    !["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED", "IN_FLIGHT"].includes(String(status || claim?.status || "").toUpperCase());
  /** Same dark card treatment, mirrored for the recipient's side: viewing a payment that
   *  was genuinely sent privately (claim.is_private), whether still pending claim or already
   *  claimed — the "someone went out of their way to hide this from the public chain" fact is
   *  true for the whole time the recipient looks at it, not just while the sender is paying. */
  const showingPrivateRecipientView = !!claim && claim.is_private === true && isRecipient;

  // Sync the toggle to the claim's declared privacy preference once it loads: forced on when
  // the claim requires private payments, forced off when the creator explicitly asked for a
  // non-private link. Waits for `claim` so the pre-load placeholder (requiresPrivate defaults
  // true) doesn't get treated as the claim's real preference.
  useEffect(() => {
    if (!claim) return;
    setIsPrivateMode(privateRequired);
  }, [claim, privateRequired]);

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

  // Server truth wins once it reports a terminal state. The hydration effect above seeds `status`
  // from useClaimPayStore — a localStorage-persisted cache keyed only by claim id, with no
  // expiry — so a non-terminal status (e.g. IN_FLIGHT) cached from an earlier, abandoned visit to
  // this exact claim can otherwise sit there indefinitely and permanently shadow a real SUCCESS
  // from the server on every future load, surviving hard refreshes and dev-server restarts alike.
  // Only firing on terminal claim.status values (not e.g. PENDING_DEPOSIT) avoids clobbering a
  // legitimate optimistic status set moments ago, ahead of the next claim refetch.
  useEffect(() => {
    const fresh = String(claim?.status || "").toUpperCase();
    const TERMINAL = new Set(["SUCCESS", "CLAIMED", "FAILED", "REFUNDED", "EXPIRED", "CANCELLED"]);
    if (TERMINAL.has(fresh) && status !== fresh) {
      console.log("[Claim] Overriding stale local status with server status:", { claimId: id, stale: status, fresh });
      setStatus(fresh);
      useClaimPayStore.getState().setStatus(id, fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim?.status, id]);


  // Hydrate from latest-intent cache (skip if user manually cancelled)
  useEffect(() => {
    // Don't re-hydrate if user cancelled this session (userCancelled.current) — or, surviving a
    // refresh where that ref has already reset, if this exact intent's deposit address is the one
    // they cancelled (see the "Cancel & choose a different token" button, which persists it to
    // dismissedDepositAddress precisely so a reload can't resurrect the intent it just dismissed).
    if (userCancelled.current) return;

    const d: any = latestIntentData;
    if (!d) return;
    const dismissedAddr = useClaimPayStore.getState().byId[id]?.dismissedDepositAddress;
    if (dismissedAddr && d?.depositAddress === dismissedAddr) return;
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
    // A cancelled deposit is still PENDING_DEPOSIT server-side (Cancel only clears local/persisted
    // UI state, not the backend intent) — without this, a refresh would sync that status straight
    // back in even with the deposit-address hydration above suppressed, since this effect reacts
    // to claim.status directly and has no address of its own to compare against.
    const dismissedAnyDeposit = !!useClaimPayStore.getState().byId[id]?.dismissedDepositAddress;
    const isDismissiblePending = mappedStatus === "PENDING_DEPOSIT" || mappedStatus === "INCOMPLETE_DEPOSIT";
    if (dismissedAnyDeposit && isDismissiblePending && !status) return;
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
      const backendUrl = clientApiBase();
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
          split: privateSplit,
          maxDelayMs: landingDelayMs,
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
        // Broadcast may have gone out (broadcastedSignature/onSignature above already saved it
        // for support to look up if needed), but we could not confirm it landed — don't upgrade
        // status or claim success on an unconfirmed/failed broadcast. Just fail honestly, same
        // as before this flow grew a "maybe it's just slow" optimistic branch: that branch
        // ended up marking a broadcast that never landed as PRIVATE_TRANSFER_PENDING and telling
        // the user it was sent — see incident 2026-07-30, claim 49fe1d56.
        console.warn("[PrivateTransfer] Confirmation failed:", confirmErr?.message, { broadcastedSignature });
        throw confirmErr;
      }

      console.log("[PrivateTransfer] PER transfer signature:", signature);
      toast({
        title: "Transfer submitted!",
        description: `Your private transfer is processing — ${privatePaymentFundsAppearCopy(landingDelayMs)}`,
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
      // We just confirmed this signature and wrote SUCCESS ourselves — the backend may still
      // report PRIVATE_TRANSFER_PENDING for burner-routed recipients, so pre-mark this hash as
      // already handled to stop the txHashRecoveryRef effect from re-polling/re-confirming it
      // right after the refetch below (that effect is for genuinely stale reloads, not this).
      txHashRecoveryRef.current = signature;
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
  // $0.10 claim fee for an email or social handle that does not have an account yet.
  // A Loofta username (pending or registered) is not charged. Applies to public and private.
  const claimFeeUsd = (
    claim?.recipient_pending_email ||
    claim?.recipient_pending_social
  ) ? UNREGISTERED_ACCOUNT_FEE_USD : 0;
  const chargeClaimFee = claimFeeUsd > 0;
  // The big price is what leaves the payer's wallet.
  const headlineUsd = destUSD == null
    ? null
    : (payingPrivately && isFeeOnSender ? privatePayTotal : destUSD) + (chargeClaimFee ? claimFeeUsd : 0);
  const headlineTokenAmount = headlineUsd != null && destToken?.price && destToken.price > 0
    ? headlineUsd / destToken.price
    : destTokenAmount;
  const looftaBalanceUSD = solanaPayment.balanceUSD;
  // Sender owes gross USDC (base + privacy fee); check that, not just base.
  // Privy wallets can take a moment to hydrate after login; guard Pay Now until the signer is present.
  const senderAddress = solanaPayment.senderAddress;
  const isPayerWalletReady = !authenticated || !senderAddress || !!solanaStandardWallets?.find((w) => w.address === senderAddress);

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
    // Set the in-flight guard synchronously, before any `await`, so a second click during the
    // burner refetch below (or any other async step) can't start a second concurrent payment —
    // that race is what let a single tap build+broadcast two competing MagicBlock transfers.
    if (payingWithLoofta) return;
    setPayingWithLoofta(true);
    const isPending =
      !!(claim as { recipient_pending_username?: boolean; recipient_pending_email?: boolean; recipient_pending_social?: boolean })?.recipient_pending_username ||
      !!(claim as { recipient_pending_email?: boolean })?.recipient_pending_email ||
      !!(claim as { recipient_pending_social?: boolean })?.recipient_pending_social;
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
      setPayingWithLoofta(false);
      return;
    }
    const baseAmount = parseFloat(claim.amount) || 0;
    if (baseAmount <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Claim amount must be greater than 0." });
      setPayingWithLoofta(false);
      return;
    }
    // Amount to send: claim amount only (no Privacy Cash gross-up for private mode)
    const amountUSD = baseAmount;
    const senderAddress = solanaPayment.senderAddress;
    if (!senderAddress) {
      toast({ variant: "destructive", title: "Wallet not ready", description: "Your Loofta Solana wallet was not found. Try logging in again." });
      setPayingWithLoofta(false);
      return;
    }
    setShowPayNowModal(true);
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
      const payPrivately = payingPrivately;
      let sig: string;
      if (payPrivately) {
        // Saved immediately after broadcast, before confirmation polling — mirrors onPayPrivately's
        // recovery pattern below. Confirmation polling can time out (e.g. MagicBlock's own
        // randomized private-delivery delay) on a transfer that already landed; without this we'd
        // otherwise have no way to distinguish "actually failed" from "just slow to confirm", and
        // showing a hard failure here risks the user retrying into a genuine double-send.
        let broadcastedSignature: string | null = null;
        try {
          sig = await perTransfer(anchorWallet, {
            privyUserId: user.id,
            accessToken: looFtaToken,
            claimId: claim.id,
            onProgress: setPerTransferPhase,
            isBurnerRecipient: isBurnerForLoofta,
            gasless,
            // Same delay the banner quotes: ?delayMs= on this link, or the value saved on the payment.
            split: privateSplit,
            maxDelayMs: landingDelayMs,
            onTxBuilt: ({ feeAmountUsdc, feeBreakdown }) => {
              looftaFeeUsdc = feeAmountUsdc;
              looftaFeeBreakdown = feeBreakdown ?? null;
              setPaidFeeUsdc(feeAmountUsdc);
              setPendingFeeUsdc(feeAmountUsdc);
              if (feeBreakdown) setPaidFeeBreakdown(feeBreakdown);
            },
            onSignature: async (broadcastSig) => {
              broadcastedSignature = broadcastSig;
              const statusToken = await getAccessToken().catch(() => null);
              updateClaimStatus(claim.id, "IN_FLIGHT", { txHash: broadcastSig }, statusToken).catch((e) =>
                console.warn("[PayWithLoofta] Failed to save tx hash early:", e),
              );
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
        } catch (confirmErr: any) {
          // See the matching branch in onPayPrivately for the full incident writeup (claim
          // 49fe1d56, 2026-07-30). Fail honestly on any unconfirmed/failed broadcast — do not
          // upgrade status or claim success.
          console.warn("[PayWithLoofta] Confirmation failed:", confirmErr?.message, { broadcastedSignature });
          throw confirmErr;
        }
      } else {
        // Not private: plain SPL USDC transfer, gasless via our backend fee payer (same
        // sponsorship model as the private path, just no MagicBlock PER session).
        setPerTransferPhase({ phase: "awaiting_signature", walletTransactionCount: 1 });
        sig = await sendUsdcWithBackendFeePayer({
          senderAddress,
          recipientAddress: effectiveRecipient,
          amountUSDC: amountUSD,
          connection,
          wallet,
          privyUserId: user.id,
          signTransaction: privySolanaSignTransaction,
          chain,
          accessToken: looFtaToken,
          network: networkMode === "mainnet" ? "mainnet" : "devnet",
          // Explicit, network-matched mint — without this it silently fell back to
          // getUsdcMint()'s own env-based cluster detection (NEXT_PUBLIC_SOLANA_CLUSTER),
          // independent of this account's networkMode toggle. When those two disagreed, the
          // ATA-creation instruction was built for the wrong-network USDC mint, causing
          // "IncorrectProgramId" during the Token program CPI for any recipient without an
          // existing USDC token account (recipients who already had one skipped that
          // instruction entirely, which is why this stayed hidden).
          usdcMint: getUsdcMintForMode(networkMode === "mainnet" ? "mainnet" : "devnet"),
          claimId: claim.id,
          looftaFeeUsdc: claimFeeUsd > 0 ? claimFeeUsd : undefined,
        });
      }
      setPerTransferPhase(null);
      setConfirmingTxSignature(sig);
      setConfirmingTxSource("loofta");

      const confirmed = await waitForConfirmation(connection, sig, 90_000);
      if (!confirmed) {
        throw new Error(
          "Transaction did not confirm in time. Check Solscan for status — do not mark as paid until the transaction confirms."
        );
      }

      // Email / social private payments also take the flat $0.10 claim fee. MagicBlock's
      // transfer can't carry that leg, so it is a second sponsored USDC transfer to the fee
      // payer. The claim amount already landed — a failed fee transfer must not fail the payment.
      if (payPrivately && chargeClaimFee) {
        try {
          const feeWallet = await fetchSolanaFeePayerAddress(user.id, looFtaToken);
          if (feeWallet) {
            await sendUsdcWithBackendFeePayer({
              senderAddress,
              recipientAddress: feeWallet,
              amountUSDC: claimFeeUsd,
              connection,
              wallet,
              privyUserId: user.id,
              signTransaction: privySolanaSignTransaction,
              chain,
              accessToken: looFtaToken,
              network: networkMode === "mainnet" ? "mainnet" : "devnet",
              usdcMint: getUsdcMintForMode(networkMode === "mainnet" ? "mainnet" : "devnet"),
            });
          }
        } catch (feeErr) {
          console.warn("[PayWithLoofta] claim fee transfer failed after private pay", feeErr);
        }
      }

      console.info("[PayWithLoofta] Updating claim status → SUCCESS, tx:", sig);
      await updateClaimStatus(
        claim.id,
        "SUCCESS",
        {
          txHash: sig,
          paidWith: payPrivately ? "USDC (Loofta / Private)" : "USDC (Loofta)",
          isPrivate: payPrivately,
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
      // Same reasoning as onPayPrivately: pre-mark this hash as handled so the txHashRecoveryRef
      // effect doesn't re-poll/re-confirm it once the refetch below brings back the backend's
      // (possibly downgraded to PRIVATE_TRANSFER_PENDING for burner-routed recipients) status.
      txHashRecoveryRef.current = sig;
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
        description: payPrivately
          ? `$${amountUSD.toFixed(2)} USDC sent privately. ${privatePaymentFundsAppearCopy(landingDelayMs)}`
          : `$${amountUSD.toFixed(2)} USDC sent.`,
      });
    } catch (e: any) {
      // Full raw error (may include RPC URLs, signatures) stays in the console for debugging —
      // never in the toast/inline banner, which end users see.
      console.error("[PayWithLoofta] Error:", e);
      const rawMessage = e?.message || "Could not send from Loofta balance. Try again.";
      const message = privatePayErrorMessageForUser(rawMessage, getSolanaCluster());
      setPayWithLooftaError(message);
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
        // is_private was already set correctly at claim-creation time — don't overwrite it here.
        // This recovery path fires for any pending claim with a saved tx hash regardless of
        // whether the original send was public or private.
        await updateClaimStatus(id, "SUCCESS", {
          txHash,
          paidWith: "USDC (Private)",
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

  // Opens the Pay Now modal, which pays from the signed-in user's own Loofta balance. Shared by
  // the normal "Pay now" button and, on checkout links, the balance readout GuestCheckoutPay
  // shows instead of its "Pay with Loofta" login button once the visitor is already authenticated.
  async function handlePayWithLooftaBalance() {
    if (!authenticated) {
      login();
      return;
    }
    setPayWithLooftaError(null);
    setConfirmingTxSignature(null);
    setConfirmingTxSource(null);
    setPerTransferPhase(null);
    setPendingFeeUsdc(null);
    setPreBuilding(true);
    try {
      if (payingPrivately) {
        const fee = await preBuildFee();
        if (fee != null) setPendingFeeUsdc(fee);
      }
    } finally {
      setPreBuilding(false);
    }
    setShowPayNowModal(true);
  }

  // One-step Send (app/app/page.tsx, home SendWidget): ?pay=1 opens the Pay Now modal as soon as
  // the creator's wallet is ready. Stripped from the URL right away so a refresh doesn't reopen it.
  const autoPayRequested = searchParams.get("pay") === "1";
  const autoPayFiredRef = React.useRef(false);
  useEffect(() => {
    if (!autoPayRequested || autoPayFiredRef.current) return;
    if (!authenticated || !claim || !isCreatorView || !isPayerWalletReady || !solanaPayment.senderAddress) return;
    autoPayFiredRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pay");
    const qs = params.toString();
    router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    const currentStatus = String(status || claim.status || "").toUpperCase();
    const blocked =
      isWrongNetwork ||
      (payingPrivately && claimAmountUSD < 1) ||
      ["SUCCESS", "IN_FLIGHT", "PRIVATE_TRANSFER_PENDING", "CLAIMED"].includes(currentStatus);
    if (!blocked) void handlePayWithLooftaBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPayRequested, authenticated, claim, isCreatorView, isPayerWalletReady, solanaPayment.senderAddress]);

  const resumePayAfterTopUpRef = React.useRef(false);
  useEffect(() => {
    const onClosed = () => {
      if (!resumePayAfterTopUpRef.current) return;
      resumePayAfterTopUpRef.current = false;
      void solanaPayment.refreshBalance();
      setShowPayNowModal(true);
    };
    window.addEventListener("balanceModalClosed", onClosed);
    return () => window.removeEventListener("balanceModalClosed", onClosed);
  }, [solanaPayment]);

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

  const claimPayerLegSettled =
    !!claim?.paid_at ||
    ["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED", "IN_FLIGHT"].includes(String(status || claim?.status || "").toUpperCase());

  function getSenderDisplay(claim: PaymentHistoryClaim): string {
    // creator_username/creator_email correctly identify the sender ONLY for direction ===
    // "from_sender" (the creator sent this to someone). For "from_recipient" (a payment request
    // or checkout link), the creator is the RECIPIENT, not the sender — using creator_username
    // there shows the merchant's own name as if they paid themselves. Real bug, not cosmetic:
    // this is the "+$X.XX from Y" card, seen live on payment 1352b7e4-c2f3-4e31-9bca-45ff88acc151
    // showing "from @looftaxyz" on a payment looftaxyz *received*, paid by a guest with no
    // account — sender_username/guest_sender_email were correct in the database the whole time.
    const c = claim as PaymentHistoryClaim & { direction?: string; sender_username?: string | null; guest_sender_email?: string | null; guest_sender_wallet?: string | null };
    const walletLabel = (w: string) => (w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);
    if (c.direction === "from_recipient") {
      if (c.sender_username) return `@${c.sender_username}`;
      if (c.guest_sender_email) return c.guest_sender_email;
      if (c.guest_sender_wallet) return walletLabel(c.guest_sender_wallet);
      return "Anonymous";
    }
    if (claim.creator_username) return `@${claim.creator_username}`;
    if (claim.creator_email) return claim.creator_email;
    if (c.guest_sender_wallet) return walletLabel(c.guest_sender_wallet);
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
      {privacyBurstKey != null && <PrivacyConfettiBurst key={privacyBurstKey} onDone={() => setPrivacyBurstKey(null)} />}
      {renderNairaSetupDialog()}
      {renderNairaClaimConfirmDialog()}

      <ClaimPayLayout
        embedInApp={embedInApp}
        chrome={chrome}
        merchantName={(claim as { merchant_name?: string | null } | null)?.merchant_name}
        merchantLogoUrl={(claim as { merchant_logo_url?: string | null } | null)?.merchant_logo_url}
        merchantLoading={!claim}
        from={from}
        incognito={showingPrivatePayForm || showingPrivateRecipientView}
        topRight={
          chrome !== "minimal" && user?.id && claim?.created_by === user.id && ["OPEN", "PENDING_DEPOSIT"].includes(String(status || claim?.status || "").toUpperCase()) ? (
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
                          router.replace(window.location.pathname.startsWith("/app") ? "/app/history" : "/history");
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
          chrome === "minimal" ? (
            <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-[1fr_380px] md:gap-6 md:[grid-column:1/-1] animate-pulse">
              <div className="space-y-4">
                <Skeleton className="h-52 w-full rounded-2xl bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-muted" />
                <Skeleton className="h-32 w-full rounded-2xl bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-muted" />
              </div>
              <div className="space-y-4">
                <Skeleton className="h-14 w-full rounded-xl bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-muted" />
                <Skeleton className="h-64 w-full rounded-2xl bg-gray-200 [@media(prefers-color-scheme:dark)]:bg-muted" />
              </div>
            </div>
          ) : (
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
          )
        ) : !authenticated && claim?.direction !== 'from_recipient' && !showGuestCheckout ? (
          <div className="py-16 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 border border-white/10 flex items-center justify-center mb-5">
              {pendingSocialPlatformHint ? (
                <SocialPlatformIcon platform={pendingSocialPlatformHint as SocialIconPlatform} className="w-7 h-7 text-slate-400" />
              ) : (
                <LogIn className="w-7 h-7 text-slate-400" />
              )}
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Sign in to view details</h3>
            <p className="text-slate-400 text-base mb-6 max-w-xs">
              {pendingSocialPlatformHint === "telegram"
                ? "This was sent to a Telegram username. Sign in with Telegram to check."
                : pendingSocialPlatformHint
                  ? `This was sent to a ${SOCIAL_PLATFORM_LABELS[pendingSocialPlatformHint] ?? "social"} username. Sign in with ${SOCIAL_PLATFORM_LABELS[pendingSocialPlatformHint] ?? "that account"} to check.`
                  : "This payment may be waiting for you. Sign in to check."}
            </p>
            <button
              onClick={() => {
                if (pendingEmailHint) login({ loginMethods: ["email"], disableSignup: false });
                else if (pendingSocialPlatformHint === "discord") login({ loginMethods: ["discord"], disableSignup: false });
                else if (pendingSocialPlatformHint === "github") login({ loginMethods: ["github"], disableSignup: false });
                else if (pendingSocialPlatformHint === "telegram") startTelegramLogin();
                else login();
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(to right, #FF1301, #EAB308)" }}
            >
              <LogIn className="w-4 h-4" />
              {pendingSocialPlatformHint
                ? `Sign in with ${SOCIAL_PLATFORM_LABELS[pendingSocialPlatformHint] ?? "account"}`
                : "Sign in"}
            </button>
          </div>
        ) : claim ? (
          <>
            {/* A claim that already paid out has nothing left to authorize — never show "Payment
                not found" for it just because this viewer's raw identity check failed (e.g. a
                returning Telegram-relay recipient landing on their second, unlinked Privy user id
                — see the 2026-07-24 Td2mutpu incident). The receipt view below already re-checks
                SUCCESS on its own, so this only needs to stop routing settled claims into the
                not-found branch. */}
            {isGuestSenderPaidView ? (
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={
                  claim?.recipient_pending_email_value ||
                  (claim?.recipient_pending_username_value ? `@${claim.recipient_pending_username_value}` : undefined) ||
                  (claim?.recipient_pending_social_value
                    ? `@${claim.recipient_pending_social_value} on ${claim.recipient_pending_social_platform ?? "social"}`
                    : undefined)
                }
                status={String(status || claim?.status || "").toUpperCase()}
              />
            ) : !isCreatorView && !isRecipient && claim?.direction !== 'from_recipient' && !showGuestCheckout
              && String(status || claim?.status || "").toUpperCase() !== "SUCCESS" ? (
              claim?.recipient_pending_social && !hasSocialPlatformLinked(claim.recipient_pending_social_platform) ? (
                <SocialConnectPrompt
                  platform={claim.recipient_pending_social_platform ?? "discord"}
                  onConnect={() => connectSocialPlatform(claim.recipient_pending_social_platform)}
                  isConfirmingIdentity={isConfirmingIdentity}
                  platformLinked={hasSocialPlatformLinked(claim.recipient_pending_social_platform)}
                />
              ) : (
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
                />
              )
            ) : chrome !== "minimal" &&
              !isRecipient &&
              !isMerchantRecipientView &&
              (claim as { merchant_name?: string | null; direction?: string })?.merchant_name &&
              claim?.direction === "from_recipient" &&
              // Not just exact "SUCCESS" — guest checkout now settles to PRIVATE_TRANSFER_PENDING
              // (the payer's leg is done, the merchant still has to claim), and this receipt is
              // written from the payer's point of view either way: their payment went through.
              ["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED", "IN_FLIGHT"].includes(
                String(status || claim?.status || "").toUpperCase(),
              ) ? (
              // Receipt view: /c/[id] opened by whoever PAID a merchant checkout link (e.g. the
              // "View receipt" link from checkout's own success card), not the merchant. The
              // "+$X.XX from Y" card right below is written from the recipient's point of view —
              // wrong for a payer looking at their own purchase, same reasoning as checkout's own
              // success state. The merchant (isRecipient) still gets that card as-is below; it's
              // already correct framing for them ("+$X.XX from [payer]").
              <div className="mt-6 py-6 text-center">
                {(claim as { merchant_logo_url?: string | null }).merchant_logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied URL, not a local/optimizable asset
                  <img
                    src={(claim as { merchant_logo_url?: string | null }).merchant_logo_url as string}
                    alt={(claim as { merchant_name?: string | null }).merchant_name || "Merchant logo"}
                    className="h-14 w-14 rounded-full object-cover border border-gray-200 mx-auto mb-4"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="mb-4 text-5xl">🧾</div>
                )}
                <p className="text-base text-gray-500 mb-1">Receipt from</p>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">
                  {(claim as { merchant_name?: string | null }).merchant_name}
                </h3>
                <div className="text-5xl font-sans font-semibold text-gray-900 mb-2">
                  ${parseFloat(claim?.amount || "0").toFixed(2)}
                </div>
                {claim?.paid_at && (
                  <p className="text-base text-gray-500">Paid {formatUTCTimestamp(claim.paid_at)}</p>
                )}
                <div className="mt-4 max-w-md mx-auto">
                  <ClaimDescriptionMessageBox description={claim?.description} />
                </div>
              </div>
            ) : chrome !== "minimal" && (isRecipient || String(status || claim?.status || "").toUpperCase() === "SUCCESS") &&
              // The sender of someone else's payment gets the "sent" view below, never the receiver card.
              !(isCreatorView && !isRecipient && claim?.direction !== "from_recipient") &&
              !claim?.recipient_pending_email &&
              !claim?.recipient_pending_username &&
              !claim?.recipient_pending_social &&
              String(status || claim?.status || "").toUpperCase() === "SUCCESS" &&
              // Status can be prematurely SUCCESS while the burner still holds unswept funds
              // (sender's client posts an optimistic status update before the recipient claims)
              // — burnerIsReady=true means funds are still sitting there, so don't show "already
              // received" in that case; fall through to the claim panel instead.
              !burnerIsReady && !keepClaimCard ? (
              <div className="mt-6 py-6">
                <div className="text-center mb-6">
                  {claim?.direction === "from_recipient" && (
                    <MerchantPaymentBadge claim={claim} />
                  )}
                  <div className="mb-4 text-6xl">✅</div>
                  <div className={"text-6xl font-sans font-semibold"}>
                    +  ${parseFloat(claim?.amount || "0").toFixed(2)}
                  </div>
                  <div className={"text-xl text-gray-500 mt-3 mb-5"}>
                    from {getSenderDisplay(claim)}
                  </div>
                  {claim?.naira_claim_bank_name && (
                    <p className="text-base text-emerald-600 font-medium">
                      Claimed to {claim.naira_claim_bank_name} ····{claim.naira_claim_bank_last4}
                    </p>
                  )}
                </div>
                <ClaimDescriptionMessageBox description={claim?.description} />
                {(() => {
                  const shareId = claim?.short_id || claim?.id;
                  const claimLink = typeof window !== "undefined"
                    ? `${window.location.origin}/share/${shareId}`
                    : `https://pay.loofta.com/share/${shareId}`;
                  const shareText = `$${parseFloat(claim?.amount || "0").toFixed(2)} on Loofta.`;
                  const copyShareLink = async () => {
                    try {
                      await navigator.clipboard.writeText(claimLink);
                      setPaymentCompleteCopied(true);
                      toast({ title: "Link copied" });
                      setTimeout(() => setPaymentCompleteCopied(false), 2000);
                    } catch {
                      toast({ variant: "destructive", title: "Copy failed" });
                    }
                  };
                  return (
                    <>
                    <div className="flex gap-2 mb-4">
                      <div className="flex gap-2 flex-1 min-w-0">
                        <Input
                          readOnly
                          value={claimLink}
                          aria-label="Share link"
                          className="font-mono text-sm flex-1 bg-gray-50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={copyShareLink}
                          aria-label={paymentCompleteCopied ? "Copied" : "Copy link"}
                          className="shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20"
                        >
                          {paymentCompleteCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <ShareLinkMenu
                        url={claimLink}
                        title="Payment on Loofta"
                        text={shareText}
                        triggerClassName="px-5 py-2"
                      />
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
                {(() => {
                  // Private: "Claimed" is when the funds have landed (paid_at + the
                  // sender's delay), not the moment the sender's transaction confirmed.
                  const landedAt = claim?.is_private
                    ? privateFundsLandedAt(claim?.paid_at, knownDelayMs, receiptNowMs)
                    : (claim?.paid_at ?? null);
                  const stillLanding = !!claim?.is_private && !!claim?.paid_at && !landedAt;
                  return (
                    <>
                      <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
                        {claim?.created_at && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-base md:text-sm">Created</span>
                            <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claim.created_at)}</span>
                          </div>
                        )}
                        {claim?.is_private && claim?.paid_at && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-base md:text-sm">Paid</span>
                            <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(claim.paid_at)}</span>
                          </div>
                        )}
                        {landedAt && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-base md:text-sm">Claimed</span>
                            <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(landedAt)}</span>
                          </div>
                        )}
                      </div>
                      {stillLanding && (
                        <div className="flex items-start gap-2 text-base md:text-sm text-gray-500 mb-2">
                          <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0 mt-0.5" />
                          <span>{privatePaymentFundsAppearCopy(knownDelayMs)}</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : user?.id && (claimAsRecipientMutation.isPending || previewOverride?.forceClaimingScreen) && !claimCompleted && !keepClaimCard && !PEER_PAYOUT_METHODS.has(claimAsRecipientMutation.variables?.payoutMethod ?? "") ? (
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
                      On its way to your {claimAsRecipientMutation.variables?.claimToNaira ? "bank" : "wallet"} ✨
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
            ) : user?.id && (claimCompleted || claimInitiated || claimAsRecipientMutation.isSuccess) && !keepClaimCard ? (
              (() => {
                const senderLabel =
                  claim?.creator_username ? `@${claim.creator_username}` : (claim?.creator_email || null);
                const amt = parseFloat(claim?.amount || "0").toFixed(2);
                const paidAt = claim?.paid_at || null;
                const landedAt = claim?.is_private
                  ? privateFundsLandedAt(optimisticClaimedAt || paidAt, knownDelayMs, receiptNowMs)
                  : (optimisticClaimedAt || paidAt);
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
                      {claimAsRecipientMutation.variables?.claimToNaira && pajDefaultBankAccount && (
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.25 }}
                          className="text-base text-gray-500 mt-1"
                        >
                          Your Naira payout to {pajDefaultBankAccount.bank_name} ····{pajDefaultBankAccount.account_number.slice(-4)} is on its way.
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
                      {claim?.is_private && paidAt && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 text-base md:text-sm">Paid</span>
                          <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(paidAt)}</span>
                        </div>
                      )}
                      {landedAt && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 text-base md:text-sm">Claimed</span>
                          <span className="text-base md:text-sm text-gray-700">{formatUTCTimestamp(landedAt)}</span>
                        </div>
                      )}
                    </motion.div>
                    {claim?.is_private && (optimisticClaimedAt || paidAt) && !landedAt && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.35 }}
                        className="text-base md:text-sm text-gray-500 text-center"
                      >
                        {privatePaymentFundsAppearCopy(landingDelayMs)}
                      </motion.p>
                    )}
                  </motion.div>
                );
              })()
            ) : (isRecipient || isMerchantRecipientView) &&
              !isPendingRecipientClaim &&
              // PRIVATE_TRANSFER_PENDING deliberately excluded — by this codebase's own design
              // (see confirmClaimPaid's comment in GuestCheckoutPay.tsx) that status means "payer's
              // leg settled, recipient still has to claim/sweep it out," never "already received."
              // Including it here previously showed "Claimed" the moment the sender's payment
              // started landing — worse, a split/delayed private transfer can sit at
              // PRIVATE_TRANSFER_PENDING with only PART of its amount in the burner for the whole
              // delivery window, during which burnerIsReady is ALSO false (balance < expected, not
              // because it was swept) — the two different reasons for !burnerIsReady (genuinely
              // swept vs. still delivering) were being conflated as one, and a payment that hadn't
              // even fully arrived yet, let alone been claimed, read as "Claimed" (2026-09-30).
              ["SUCCESS", "CLAIMED"].includes(
                String(status || claim?.status || "").toUpperCase(),
              ) &&
              // Same reasoning as the receipt-view branch above: SUCCESS can be premature while
              // the burner still holds unswept funds. Don't tell a merchant "already received"
              // while their money is still sitting in the burner — fall through to the claim
              // panel below instead.
              !burnerIsReady && !keepClaimCard ? (
              (() => {
                const senderLabel = getSenderDisplay(claim);
                const amt = parseFloat(claim?.amount || "0").toFixed(2);
                return (
                  <div className="mt-6 py-6 px-4">
                    <div className="text-center mb-6">
                      {claim?.direction === "from_recipient" && (
                        <MerchantPaymentBadge claim={claim} />
                      )}
                      <div className="mb-4 text-6xl">✅</div>
                      <div className="text-5xl font-bold text-gray-900 mb-3">+ ${amt}</div>
                      {senderLabel && (
                        <p className="text-xl text-gray-500">from <span className="font-medium text-gray-700">{senderLabel}</span></p>
                      )}
                      {claim?.naira_claim_bank_name && (
                        <p className="text-base text-emerald-600 font-medium mt-2">
                          Claimed to {claim.naira_claim_bank_name} ····{claim.naira_claim_bank_last4}
                        </p>
                      )}
                    </div>
                    <ClaimDescriptionMessageBox description={claim?.description} />
                  </div>
                );
              })()
            ) : claim?.recipient_pending_email && !(user?.id && claim?.created_by === user.id) ? (
              <div className="mt-6 text-center pt-12 pb-6 px-4">
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
                          <span className="text-green-600 font-medium">{keepClaimCard ? "Claimed — status is on the receipt below." : "Funds ready — you can claim now."}</span>
                        </>
                      ) : (
                        <PrivateWaitingLoader isPrivate={claim?.is_private} delayMs={landingDelayMs} startedAt={claim?.paid_at ?? claim?.created_at} />
                      )}
                    </div>
                    {/* Extra top space grounds the button group at the bottom of the card instead of
                        crowding the status line right above it. */}
                    <div className="mt-10">{renderClaimPanel(false)}</div>
                    {/* Mobile: sticky above BottomNav (h-16 = 64px) */}
                    <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-[#0f0f12]/95 backdrop-blur-sm border-t border-white/10">
                      {renderClaimPanel(true)}
                    </div>
                  </>
                )}
              </div>
            ) : isRecipient && claim?.recipient_pending_username ? (
              <div className="mt-6 text-center pt-12 pb-6 px-4">
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
                            <span className="text-green-600 font-medium">{keepClaimCard ? "Claimed — status is on the receipt below." : "Funds ready — you can claim now."}</span>
                          </>
                        ) : (
                          <PrivateWaitingLoader isPrivate={claim?.is_private} delayMs={landingDelayMs} startedAt={claim?.paid_at ?? claim?.created_at} />
                        )}
                      </div>
                      {/* Extra top space grounds the button group at the bottom of the card instead of
                        crowding the status line right above it. */}
                      <div className="mt-10">{renderClaimPanel(false)}</div>
                      {/* Mobile: sticky above BottomNav (h-16 = 64px) */}
                      <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-[#0f0f12]/95 backdrop-blur-sm border-t border-white/10">
                        {renderClaimPanel(true)}
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
            ) : claim?.recipient_pending_email && user?.id && claim?.created_by === user.id && claim?.direction !== "from_recipient" && chrome !== "minimal" && ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={claim?.recipient_pending_email_value || "email recipient"}
                status={String(status || claim?.status || "").toUpperCase()}
                userId={user?.id}
                recipientType="email"
                recipientValue={claim?.recipient_pending_email_value}
                claimLocked={!!claim?.recipient_claim_in_progress}
                onRecipientUpdated={() => invalidateAfterRecipientUpdate(queryClient, id, user?.id)}
              />
            ) : claim?.recipient_pending_username && user?.id && claim?.created_by === user.id && claim?.direction !== "from_recipient" && chrome !== "minimal" && ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={`@${claim.recipient_pending_username_value || "username"}`}
                status={String(status || claim?.status || "").toUpperCase()}
                userId={user?.id}
                recipientType="username"
                recipientValue={claim?.recipient_pending_username_value}
                claimLocked={!!claim?.recipient_claim_in_progress}
                onRecipientUpdated={() => invalidateAfterRecipientUpdate(queryClient, id, user?.id)}
              />
            ) : claim?.recipient_pending_social && user?.id && claim?.created_by === user.id && claim?.direction !== "from_recipient" && chrome !== "minimal" && ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={`@${claim.recipient_pending_social_value || "handle"} on ${claim.recipient_pending_social_platform ?? "social"}`}
                status={String(status || claim?.status || "").toUpperCase()}
                userId={user?.id}
                recipientType="social"
                recipientValue={claim?.recipient_pending_social_value ?? undefined}
                recipientPlatform={claim?.recipient_pending_social_platform}
                claimLocked={!!claim?.recipient_claim_in_progress}
                onRecipientUpdated={() => invalidateAfterRecipientUpdate(queryClient, id, user?.id)}
              />
            ) : (claim as { recipient_is_registered?: boolean })?.recipient_is_registered &&
              user?.id && claim?.created_by === user.id && claim?.direction !== "from_recipient" && chrome !== "minimal" &&
              ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              // Recipient resolved to a registered account immediately at creation (e.g. a Telegram/
              // username/email handle that already matched an existing user) — still editable up
              // until it's actually claimed, same as the pending-recipient cases above. claimLocked
              // additionally covers "already SUCCESS" here since, unlike the pending cases, a
              // resolved recipient's claim can reach SUCCESS while still carrying no PENDING_*
              // prefix for updateClaimRecipient's own guard to react to.
              <ClaimPageSenderShareView
                claimId={id}
                shortCode={claim?.short_id}
                amount={parseFloat(claim?.amount || "0")}
                recipientLabel={claim?.recipient_username ? `@${claim.recipient_username}` : "recipient"}
                status={String(status || claim?.status || "").toUpperCase()}
                userId={user?.id}
                recipientType="username"
                recipientValue={claim?.recipient_username ?? undefined}
                delivered
                claimLocked={!!claim?.recipient_claim_in_progress || String(status || claim?.status || "").toUpperCase() === "SUCCESS"}
                onRecipientUpdated={() => invalidateAfterRecipientUpdate(queryClient, id, user?.id)}
              />
            ) : isRecipient && claim?.recipient_pending_social ? (
              <div className="mt-6 text-center pt-12 pb-6 px-4">
                <div className="mb-4 text-6xl">🎁</div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-2">This payment is for you</h3>
                {["PRIVATE_TRANSFER_PENDING", "SUCCESS", "FUNDED"].includes(String(claim?.status || "").toUpperCase()) ? (
                  !user?.id ? (
                    <>
                      <p className="text-gray-500 text-base md:text-sm mb-5">
                        {claim.recipient_pending_social_platform === "telegram" && telegramClaimVerified === true
                          ? "Telegram confirmed — sign in to finish."
                          : `Sign in with your ${SOCIAL_PLATFORM_LABELS[claim.recipient_pending_social_platform ?? ""] ?? "social"} account to claim.`}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const platform = claim?.recipient_pending_social_platform;
                          if (platform === "discord") login({ loginMethods: ["discord"], disableSignup: false });
                          else if (platform === "github") login({ loginMethods: ["github"], disableSignup: false });
                          else if (platform === "telegram") startTelegramLogin();
                          else login({ disableSignup: false });
                        }}
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
                            <span className="text-green-600 font-medium">{keepClaimCard ? "Claimed — status is on the receipt below." : "Funds ready — you can claim now."}</span>
                          </>
                        ) : (
                          <PrivateWaitingLoader isPrivate={claim?.is_private} delayMs={landingDelayMs} startedAt={claim?.paid_at ?? claim?.created_at} />
                        )}
                      </div>
                      {/* Extra top space grounds the button group at the bottom of the card instead of
                        crowding the status line right above it. */}
                      <div className="mt-10">{renderClaimPanel(false)}</div>
                      {/* Mobile: sticky above BottomNav (h-16 = 64px) */}
                      <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-[#0f0f12]/95 backdrop-blur-sm border-t border-white/10">
                        {renderClaimPanel(true)}
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
            ) : claim?.recipient_pending_social && !isRecipient && !(user?.id && claim?.created_by === user.id) ? (
              (() => {
                const senderHasPaid = ["PRIVATE_TRANSFER_PENDING", "SUCCESS", "FUNDED"].includes(
                  String(claim?.status || "").toUpperCase()
                );
                return (
                  <div className="mt-6 text-center pt-12 pb-6 px-4">
                    <div className="mb-4 text-6xl">🎁</div>
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">This payment is for you</h3>
                    {senderHasPaid ? (
                      !user?.id ? (
                        <>
                          <p className="text-gray-500 text-base md:text-sm mb-5">
                            {claim?.recipient_pending_social_platform === "telegram" && telegramClaimVerified === true
                              ? "Telegram confirmed — sign in to finish."
                              : `Connect your ${claim?.recipient_pending_social_platform ?? "social"} account (@${claim?.recipient_pending_social_value || "handle"}) on Loofta to claim.`}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const platform = claim?.recipient_pending_social_platform;
                              if (platform === "discord") login({ loginMethods: ["discord"], disableSignup: false });
                              else if (platform === "github") login({ loginMethods: ["github"], disableSignup: false });
                              else if (platform === "telegram") startTelegramLogin();
                              else login({ disableSignup: false });
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition-all min-w-[220px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                          >
                            Sign in to claim
                          </button>
                        </>
                      ) : (
                        <SocialConnectPrompt
                          platform={claim?.recipient_pending_social_platform ?? "discord"}
                          onConnect={() => connectSocialPlatform(claim?.recipient_pending_social_platform)}
                          isConfirmingIdentity={isConfirmingIdentity}
                          platformLinked={hasSocialPlatformLinked(claim?.recipient_pending_social_platform)}
                        />
                      )
                    ) : (
                      <p className="text-gray-600 text-base mb-4">
                        {user?.id
                          ? `$${parseFloat(claim?.amount || "0").toFixed(2)} – waiting for the sender to pay.`
                          : "Waiting for the sender to pay. Sign in to see the amount and claim when it’s ready."}
                      </p>
                    )}
                  </div>
                );
              })()
            ) : claim?.recipient_pending_username && !(user?.id && claim?.created_by === user.id) ? (
              (() => {
                const senderHasPaid = ["PRIVATE_TRANSFER_PENDING", "SUCCESS", "FUNDED"].includes(
                  String(claim?.status || "").toUpperCase()
                );
                return (
                  <div className="mt-6 text-center pt-12 pb-6 px-4">
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
            ) : peerCashoutReceipt ? (
              <div className="mt-6 px-2 pb-4">
                {renderPeerReceiveClaim()}
              </div>
            ) : (isRecipient || isMerchantRecipientView) &&
              (!["SUCCESS", "CLAIMED"].includes(String(claim?.status || "").toUpperCase()) ||
                // Merchant/registered-at-creation recipient whose status went SUCCESS before
                // they claimed — same "still in burner" case the two branches above defer here
                // for. isPendingRecipientClaim is false for this claim type, so it never hits the
                // isCreatorView "payment to yourself" P2P copy below.
                (!isPendingRecipientClaim && burnerIsReady) ||
                keepClaimCard) ? (
              <div className="mt-6 text-center pt-12 pb-6 px-4">
                {claim?.direction === "from_recipient" && (
                  <MerchantPaymentBadge claim={claim} />
                )}
                <div className="text-6xl font-sans font-semibold inline-flex items-center justify-center gap-3">
                  {tokenPrizeLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tokenPrizeLogo} alt="" className="h-12 w-12 rounded-full object-cover bg-white/10" />
                  ) : null}
                  {tokenPrizeAmount != null && String(tokenPrizeAmount) !== ""
                    ? `+ ${tokenPrizeAmount} ${tokenPrizeSymbol}`
                    : `${claimPayerLegSettled ? "+ " : ""}$${parseFloat(claim?.amount || "0").toFixed(2)}`}
                </div>
                <div className="text-xl text-gray-500 mt-3 mb-5">
                  {isCreatorView && claim?.direction !== "from_recipient" ? (
                    "Payment to yourself — you're logged in as the account that created this link."
                  ) : claim?.direction === "from_recipient" && !claimPayerLegSettled ? (
                    // sender_user_id is stamped when someone merely builds the pay transaction, so
                    // an unpaid request can carry a stranger's name. Never call them the payer.
                    "Waiting for payment"
                  ) : (
                    <>from {getSenderDisplay(claim)}</>
                  )}
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
                      <span className="text-green-600 font-medium">{keepClaimCard ? "Claimed — status is on the receipt below." : "Funds ready — you can claim now."}</span>
                    </>
                  ) : (
                    <PrivateWaitingLoader isPrivate={claim?.is_private} delayMs={landingDelayMs} startedAt={claim?.paid_at ?? claim?.created_at} />
                  )}
                </div>
                {/* Extra top space grounds the button group at the bottom of the card instead of
                        crowding the status line right above it. */}
                <div className="mt-10">{renderClaimPanel(false)}</div>
                {/* Mobile: sticky above BottomNav (h-16 = 64px) */}
                <div className="md:hidden fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-[#0f0f12]/95 backdrop-blur-sm border-t border-white/10">
                  {renderClaimPanel(true)}
                </div>
              </div>
            ) : chrome !== "minimal" && !isRecipient && !isMerchantRecipientView && ["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED", "IN_FLIGHT"].includes(String(status || claim?.status || "").toUpperCase()) ? (
              <>
                {/* Payment Complete — hero + share + summary. This is the PAYER's own "I sent it"
                    view (share link, "sent to X", "Recipient receives") — never the recipient's
                    (they get the "already received"/claim branches above) and never checkout's
                    (chrome="minimal" has its own dedicated success card). IN_FLIGHT included: the
                    sender's debit already happened (broadcast tx confirmed or awaiting
                    confirmation) — "sent" is factually true even before the recipient-side leg
                    settles. Showing the default Pay Now view instead (pre-fix behavior) let a
                    sender who already broadcast see "Amount to send" again and risk a genuine
                    double payment. */}
                {(() => {
                  const recipientLabel =
                    (claim as any)?.recipient_pending_username_value
                      ? `@${(claim as any).recipient_pending_username_value}`
                      : claim?.recipient_username
                        ? `@${claim.recipient_username}`
                        : (claim as any)?.recipient_pending_social_value
                          ? `@${(claim as any).recipient_pending_social_value} on ${(claim as any)?.recipient_pending_social_platform ?? "social"}`
                          : (claim as any)?.recipient_pending_email_value
                            ? (claim as any).recipient_pending_email_value
                            : claim?.recipient_email
                              ? claim.recipient_email
                              : null;
                  const shareId = (claim as any)?.short_id || claim?.id;
                  const claimLink = typeof window !== "undefined"
                    ? `${window.location.origin}/share/${shareId}`
                    : `https://pay.loofta.com/share/${shareId}`;
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
                          +${parseFloat(claim.amount || "0").toFixed(2)}
                        </motion.div>
                        {recipientLabel && (
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.25 }}
                            className="text-xl text-gray-500 mt-1 mb-5"
                          >
                            sent to <span className="font-medium text-gray-700">{recipientLabel}</span>
                          </motion.p>
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
                                <span className="text-base md:text-sm text-gray-500">Privacy fee</span>
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
                                <span className="text-base md:text-sm text-gray-500">Privacy fee, from what they receive</span>
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
                        <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                          <span className="text-base md:text-sm text-gray-500">Status link</span>
                          <a
                            href={claimLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-base md:text-sm font-medium text-gray-900 underline-offset-2 hover:underline"
                          >
                            Open
                          </a>
                        </div>
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
              </>
            ) : (
              <>
                {!embedInApp && chrome !== "minimal" && (
                  <div className="mb-5 flex items-center gap-3.5">
                    {(claim as { direction?: string } | null)?.direction === "from_sender" && (
                      <div
                        className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[17px] bg-[radial-gradient(120%_120%_at_28%_18%,#FFFFFF_0%,#ECEAF0_45%,#BDBAC6_100%)] text-2xl font-extrabold text-[#16161C] shadow-[inset_0_2px_4px_rgba(255,255,255,0.5),0_4px_0_#8C8898]"
                        style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}
                      >
                        @
                      </div>
                    )}
                    <div className="min-w-0">
                    {claim?.direction === "from_recipient" && (claim as { is_api_payment?: boolean }).is_api_payment && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-sm font-medium text-slate-300 mb-1.5">
                        <ShoppingBag className="w-3 h-3" /> Merchant payment
                      </span>
                    )}
                    {(claim as { direction?: string } | null)?.direction === "from_sender" && (
                      <div className="text-sm font-semibold text-[#8A8893]">Payment to</div>
                    )}
                    <div className="truncate text-xl font-bold text-white" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>
                      {(claim as { direction?: string } | null)?.direction === "from_sender" ? (
                        <>
                          {(claim as { recipient_pending_username_value?: string } | null)?.recipient_pending_username_value
                            ? `@${(claim as { recipient_pending_username_value?: string }).recipient_pending_username_value}`
                            : claim?.recipient_username
                              ? `@${claim.recipient_username}`
                              : (claim as { recipient_pending_social_value?: string } | null)?.recipient_pending_social_value ? (
                                <span className="inline-flex items-center gap-1.5 align-middle">
                                  <SocialPlatformIcon
                                    platform={((claim as { recipient_pending_social_platform?: string } | null)?.recipient_pending_social_platform ?? "github") as SocialIconPlatform}
                                    className="h-4 w-4 shrink-0"
                                  />
                                  @{(claim as { recipient_pending_social_value?: string }).recipient_pending_social_value}
                                </span>
                              )
                                : (claim as { recipient_pending_email_value?: string } | null)?.recipient_pending_email_value
                                  ? (claim as { recipient_pending_email_value?: string }).recipient_pending_email_value
                                  : claim?.recipient_email
                                    ? claim.recipient_email
                                    : null}
                        </>
                      ) : claim?.direction === "from_recipient" && (isRecipient || isMerchantRecipientView) ? (
                        // The merchant viewing their own sale — "Payment request from yourself"
                        // reads as nonsense here, this is money coming IN, not a request they owe.
                        "Payment received"
                      ) : claim?.direction === "from_recipient" ? (
                        <>
                          {"Payment request from "}
                          {(claim as { merchant_name?: string | null }).merchant_name ||
                            (claim?.creator_username ? `@${claim.creator_username}` : claim?.creator_email || "Anonymous")}
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
                  </div>
                )}
                {chrome === "minimal" ? (
                  <div className="rounded-2xl p-5 bg-white border border-gray-200 shadow-sm [@media(prefers-color-scheme:dark)]:bg-[#17171b] [@media(prefers-color-scheme:dark)]:border-white/10">
                    {!embedInApp && claim?.description && (
                      <div className="mb-3 pb-3 border-b border-gray-100 [@media(prefers-color-scheme:dark)]:border-white/10">
                        <div className="text-base uppercase tracking-wide font-semibold text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 mb-1">What you&apos;re paying for</div>
                        <div className="text-base text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100 whitespace-pre-wrap break-words">
                          {(() => {
                            const desc = claim.description || '';
                            const gifUrlPattern = /(https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\/[^\s]*)/gi;
                            const parts: string[] = [];
                            let lastIndex = 0;
                            let match;
                            gifUrlPattern.lastIndex = 0;
                            while ((match = gifUrlPattern.exec(desc)) !== null) {
                              if (match.index > lastIndex) {
                                parts.push(desc.slice(lastIndex, match.index));
                              }
                              parts.push(match[0]);
                              lastIndex = match.index + match[0].length;
                            }
                            if (lastIndex < desc.length) {
                              parts.push(desc.slice(lastIndex));
                            }
                            if (parts.length === 0) {
                              return desc;
                            }
                            return parts.map((part, idx) => {
                              if (gifUrlPattern.test(part) || part.match(/https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\//i)) {
                                let imageUrl = part;
                                if (part.includes('giphy.com') && !part.endsWith('.gif')) {
                                  const giphyIdMatch = part.match(/giphy\.com\/media\/([^\/]+)/);
                                  if (giphyIdMatch) {
                                    imageUrl = `https://media.giphy.com/media/${giphyIdMatch[1]}/giphy.gif`;
                                  } else {
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
                    {!embedInApp && <div className="text-base uppercase tracking-wide font-semibold text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">{(claim as { direction?: string } | null)?.direction === "from_sender" ? "Amount to send" : "Amount to pay"}</div>}
                    <div className="mt-1 flex items-baseline justify-between">
                      <div className="text-3xl md:text-4xl font-sans font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100 leading-none">
                        {headlineUsd != null ? `$${headlineUsd.toFixed(2)}` : `—`}
                      </div>
                      <div className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                          {headlineTokenAmount != null ? Number(parseFloat(String(headlineTokenAmount)).toFixed(4)) : "—"} {claim.to_symbol} {destToken?.chain ? `on ${destToken.chain.charAt(0).toUpperCase() + destToken.chain.slice(1)}` : ""}
                        </span>
                      </div>
                    </div>
                    {/* Payment breakdown — merged into this same card for guest checkout. Mirrors
                        the shared breakdown block below (kept for chrome="full") and the same
                        three-way payingPrivately/isFeeOnSender logic: free by default, the real
                        MagicBlock privacy fee (estimatePrivateTotal) once private payment is on.
                        Kept visible after payment too on checkout (chrome="minimal") — the left
                        column should read the same before and after paying, not lose its breakdown
                        the moment status flips; the right column is what changes on success (see
                        the dedicated success card further down). */}
                    {!isSenderPendingFundedView && !hidePaySectionForPendingClaimant && !isRecipient && !isCheckingRecipient && (chrome === "minimal" || !["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED", "IN_FLIGHT"].includes(String(status || claim?.status || "").toUpperCase())) && (
                      <div className="mt-4 pt-4 border-t border-gray-100 [@media(prefers-color-scheme:dark)]:border-white/10">
                        <div className="text-base uppercase tracking-wide font-semibold font-sans text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 mb-2">Payment breakdown</div>
                        <div className="space-y-1.5 text-base">
                          {!payingPrivately ? (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">You pay</span>
                                <span className="font-semibold font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">${(headlineUsd ?? claimAmountUSD).toFixed(2)}</span>
                              </div>
                              {chargeClaimFee && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Claim fee</span>
                                  <span className="font-medium text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-300">${claimFeeUsd.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Network fee</span>
                                <span className="font-medium text-emerald-600 [@media(prefers-color-scheme:dark)]:text-emerald-400">Free</span>
                              </div>
                              <div className="pt-2 border-t border-gray-200 [@media(prefers-color-scheme:dark)]:border-white/10 flex items-center justify-between">
                                <span className="font-medium font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">Merchant receives</span>
                                <span className="font-semibold font-sans text-lg text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">${claimAmountUSD.toFixed(2)}</span>
                              </div>
                            </>
                          ) : isFeeOnSender ? (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Merchant receives</span>
                                <span className="font-semibold font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">${claimAmountUSD.toFixed(2)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Privacy fee</span>
                                <span className="font-medium text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-300">${(privatePayProtocolFee + privatePayGasFee).toFixed(2)}</span>
                              </div>
                              {chargeClaimFee && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Claim fee</span>
                                  <span className="font-medium text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-300">${claimFeeUsd.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="pt-2 border-t border-gray-200 [@media(prefers-color-scheme:dark)]:border-white/10 flex items-center justify-between">
                                <span className="font-medium font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">You pay</span>
                                <span className="font-semibold font-sans text-lg text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">${(headlineUsd ?? privatePayTotal).toFixed(2)}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">You pay</span>
                                <span className="font-semibold font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">${(claimAmountUSD + (chargeClaimFee ? claimFeeUsd : 0)).toFixed(2)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Privacy fee, from what they receive</span>
                                <span className="font-medium text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-300">~${(privatePayProtocolFee + privatePayGasFee).toFixed(3)}</span>
                              </div>
                              {chargeClaimFee && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Claim fee</span>
                                  <span className="font-medium text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-300">${claimFeeUsd.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="pt-2 border-t border-gray-200 [@media(prefers-color-scheme:dark)]:border-white/10 flex items-center justify-between">
                                <span className="font-medium font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">Merchant receives</span>
                                <span className="font-semibold font-sans text-lg text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">~${(claimAmountUSD - (privatePayProtocolFee + privatePayGasFee)).toFixed(2)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={embedInApp ? "mt-2" : "mt-1"}>
                      <div
                        className="text-[56px] font-bold leading-none tracking-[-0.05em] text-white"
                        style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}
                      >
                        {headlineUsd != null ? `$${headlineUsd.toFixed(2)}` : `—`}
                      </div>
                    </div>
                    {!embedInApp && claim?.description && (
                      <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
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
                  </>
                )}
              </>
            )}

            {/* Checkout's own success state — deliberately not the shared "+$X.XX from Y" card
                further up (that one's written from the recipient's point of view: "you received
                money", wrong framing for the buyer looking at their own purchase). Occupies the
                same right-column slot the payment-method tiles were in, so this is what "keep the
                column" plays out as: same layout, buyer-appropriate content once it's paid. The
                receipt link goes to /c/[id] — the payer's own view of this same payment, styled as
                a receipt (business logo/name, amount, date), separate from the merchant's own
                payment-received view of the identical row. */}
            {chrome === "minimal" && ["SUCCESS", "PRIVATE_TRANSFER_PENDING"].includes(String(status || claim?.status || "").toUpperCase()) && (
              <div className="mt-4 flex gap-3 md:mt-0 md:[grid-column:2] md:[grid-row:1/-1] md:self-start">
                <div className="w-full rounded-2xl p-6 bg-white border border-gray-200 shadow-sm text-center [@media(prefers-color-scheme:dark)]:bg-[#17171b] [@media(prefers-color-scheme:dark)]:border-white/10">
                  <div className="mb-3 text-5xl">✅</div>
                  <h3 className="text-lg font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100 mb-1">Payment successful</h3>
                  <p className="text-base text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400 mb-5">
                    ${parseFloat(claim?.amount || "0").toFixed(2)} paid to {(claim as { merchant_name?: string | null } | null)?.merchant_name || "the merchant"}
                  </p>
                  <Link
                    href={`/c/${id}`}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                  >
                    View receipt
                  </Link>
                </div>
              </div>
            )}

            {!isSenderPendingFundedView && !hidePaySectionForPendingClaimant && !isRecipient && !isCheckingRecipient && !["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED", "IN_FLIGHT"].includes(String(status || claim?.status || "").toUpperCase()) && (!deposit ? (
              <>
                {/* Private indicator — only when payment is private. Shown on checkout regardless
                    of auth state, driving the fee breakdown above either way. Note it only drives
                    that breakdown for a guest, though — MagicBlock privacy is an authenticated-
                    account feature, and GuestCheckoutPay's own payment methods (USDC on Solana,
                    the NEAR Intents bridge) don't read isPrivateMode at all, so an unauthenticated
                    visitor can flip this on and see private pricing without it changing how their
                    actual payment goes out. Only the authenticated "Pay now" balance flow (via the
                    Pay Now modal below) genuinely pays privately when this is on.
                    On the GuestCheckoutPay path (showGuestCheckout) this is skipped here entirely —
                    GuestCheckoutPay renders its own copy of the switch, above its token/method
                    selection, instead of up top on this card. */}
                {showGuestCheckout || requiresPrivate ? null : (
                  <IncognitoModeToggle checked={isPrivateMode} onCheckedChange={handleTogglePrivateMode} className="mt-5" />
                )}

                {/* Same split/delay timing-obfuscation sliders as /fomo and GuestCheckoutPay —
                    only actually consumed by the authenticated Pay Now flow (payWithLooftaBalance
                    → perTransfer → buildPrivateTransferForPayer), so only shown once logged in;
                    for a signed-in guest this toggle is cosmetic (see the comment above), and
                    these sliders would be too. */}
                {!showGuestCheckout && !requiresPrivate && isPrivateMode && authenticated && (
                  <div className="mt-4">
                    <PrivacyTimingControls
                      idPrefix="paynow"
                      split={privateSplit}
                      onSplitChange={setPrivateSplit}
                      delayMs={landingDelayMs}
                      onDelayMsChange={setSpreadDelayMs}
                      amountUsd={claimAmountUSD}
                      infoOpen={privacyInfoOpen}
                      onInfoOpenChange={setPrivacyInfoOpen}
                      theme="auto"
                    />
                  </div>
                )}

                {/* Wallet-exposure nudge — this recipient has already seen this sender's wallet
                    address via a past public payment, so paying privately now doesn't undo that. */}
                {/*      {hasPaidRecipientPublicly && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-base md:text-sm text-amber-800 leading-relaxed">
                        You paid this person publicly before, so they already know your wallet address. For more confidentiality, you can rotate to a new wallet.
                      </p>
                      <button
                        type="button"
                        onClick={() => setOpenSettingsModal(true)}
                        className="mt-1.5 text-base md:text-sm font-semibold text-amber-800 hover:text-amber-900 underline underline-offset-2"
                      >
                        Withdraw &amp; rotate wallet
                      </button>
                    </div>
                  </div>
                )} */}

                {/* Minimum amount notice */}
                {payingPrivately && claimAmountUSD > 0 && claimAmountUSD < 1 && (
                  <div className={chrome === "minimal" ? "mt-4 md:mt-0 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base md:text-sm text-amber-700" : "mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base md:text-sm text-amber-700"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    <span>A private payment needs at least <strong>$1.00 USDC</strong>. This payment link cannot be paid privately.</span>
                  </div>
                )}


                {/* Payment breakdown — chrome="full" only; for chrome="minimal" this is rendered
                    merged into the amount card above instead (see the block right after the
                    amount row), so it isn't duplicated here. */}
                {chrome !== "minimal" && (
                <div className="mt-4">
                  <div className="p-[18px] rounded-[18px] bg-[#0E0E12] border border-white/[0.06]">
                    <div className="text-sm tracking-[0.16em] font-medium text-[#77757F] mb-3" style={{ fontFamily: "var(--font-home-mono), ui-monospace, monospace" }}>BREAKDOWN</div>
                    <div className="space-y-1.5 text-base [@media(prefers-color-scheme:dark)]:[&_.text-gray-600]:text-slate-400 [@media(prefers-color-scheme:dark)]:[&_.text-gray-700]:text-slate-300 [@media(prefers-color-scheme:dark)]:[&_.text-gray-900]:text-slate-100 [@media(prefers-color-scheme:dark)]:[&_.border-gray-200]:border-white/10">
                      {!payingPrivately ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">You pay</span>
                            <span className="font-semibold font-sans text-gray-900">${(headlineUsd ?? claimAmountUSD).toFixed(2)}</span>
                          </div>
                          {chargeClaimFee && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Claim fee</span>
                              <span className="font-medium text-gray-700">${claimFeeUsd.toFixed(2)}</span>
                            </div>
                          )}
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
                            <span className="text-gray-600">Privacy fee</span>
                            <span className="font-medium text-gray-700">${(privatePayProtocolFee + privatePayGasFee).toFixed(2)}</span>
                          </div>
                          {chargeClaimFee && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Claim fee</span>
                              <span className="font-medium text-gray-700">${claimFeeUsd.toFixed(2)}</span>
                            </div>
                          )}
                          <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                            <span className="font-medium font-sans text-gray-900">You pay</span>
                            <span className="font-semibold font-sans text-lg text-gray-900">${(headlineUsd ?? privatePayTotal).toFixed(2)}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">You pay</span>
                            <span className="font-semibold font-sans text-gray-900">${(claimAmountUSD + (chargeClaimFee ? claimFeeUsd : 0)).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Privacy fee, from what they receive</span>
                            <span className="font-medium text-gray-700">~${(privatePayProtocolFee + privatePayGasFee).toFixed(3)}</span>
                          </div>
                          {chargeClaimFee && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Claim fee</span>
                              <span className="font-medium text-gray-700">${claimFeeUsd.toFixed(2)}</span>
                            </div>
                          )}
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
                </div>
                )}

                <div className={chrome === "minimal" ? "mt-4 flex gap-3 md:mt-0 md:[grid-column:2] md:[grid-row:1/-1] md:self-start" : "mt-4 flex gap-3"}>
                    {DEMO_MODE ? (
                      <Button
                        disabled
                        className="w-full rounded-xl"
                        style={{ background: '#9CA3AF' }}
                      >
                        Demo Mode - Payments Disabled
                      </Button>
                    ) : showGuestCheckout && claim?.claim_burner_address ? (
                      <div className="w-full flex flex-col gap-2">
                        <div className="w-full rounded-2xl p-5 bg-white border border-gray-200 shadow-sm [@media(prefers-color-scheme:dark)]:bg-[#17171b] [@media(prefers-color-scheme:dark)]:border-white/10">
                          <GuestCheckoutPay
                            claimId={id}
                            burnerAddress={claim.claim_burner_address}
                            amountUsd={claimAmountUSD}
                            platformFeeUsd={claimFeeUsd}
                            onLogin={handleCheckoutLogin}
                            authenticated={checkoutAuthenticated}
                            looftaBalanceUSD={checkoutAuthenticated ? looftaBalanceUSD : undefined}
                            onPayWithLoofta={handlePayWithLooftaBalance}
                            isPrivateMode={isPrivateMode}
                            onTogglePrivateMode={handleTogglePrivateMode}
                            requiresPrivate={requiresPrivate}
                            initialSplit={privateSplit}
                            initialDelayMs={knownDelayMs ?? privateDelayMs}
                            onSettled={() => {
                              // Not "SUCCESS" — a guest payment always lands in the burner, never the
                              // recipient's real wallet, so it still needs an explicit claim. Setting
                              // SUCCESS here unconditionally used to re-poison the local + persisted
                              // status back to "done, nothing to claim" on every settlement, regardless
                              // of what the PATCH request actually told the server (see
                              // confirmClaimPaid in GuestCheckoutPay.tsx).
                              setStatus("PRIVATE_TRANSFER_PENDING");
                              useClaimPayStore.getState().setStatus(id, "PRIVATE_TRANSFER_PENDING");
                              claimQuery.refetch();
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-center gap-1.5 text-base text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500 pt-2">
                          <span className="leading-none">Powered by</span>
                          <span className="relative inline-block h-3 w-16 shrink-0">
                            <Image src="/loofta.svg" alt="Loofta" fill className="object-contain object-left [@media(prefers-color-scheme:dark)]:hidden" />
                            <Image src="/loofta-white.svg" alt="Loofta" fill className="hidden object-contain object-left [@media(prefers-color-scheme:dark)]:block" />
                          </span>
                        </div>
                      </div>
                    ) : (
                      <GradientActionButton
                        onClick={handlePayWithLooftaBalance}
                        disabled={
                          preBuilding
                            ? true
                            : mainnetViewOnly
                              ? true
                              : isWrongNetwork
                                ? true
                                : payingPrivately && claimAmountUSD < 1
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
                        {isWrongNetwork && claimExpectedNetwork
                          ? `Switch to ${claimExpectedNetwork}`
                          : !authenticated
                            ? "Sign in to pay"
                            : "Pay now"}
                      </GradientActionButton>
                    )}
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
                      <div className="mt-6 text-center py-12 rounded-2xl border border-gray-200 bg-white shadow-sm [@media(prefers-color-scheme:dark)]:bg-[#17171b] [@media(prefers-color-scheme:dark)]:border-white/10">
                        <div className="mb-4 text-6xl">🔗</div>
                        <h3 className="text-2xl font-semibold text-gray-900 mb-2 [@media(prefers-color-scheme:dark)]:text-slate-100">
                          Payment Link Expired
                        </h3>
                        <p className="text-gray-600 text-base mb-4 [@media(prefers-color-scheme:dark)]:text-slate-400">
                          This payment link has expired. The deadline was {deposit.deadline ? formatUTCTimestamp(deposit.deadline) : 'not set'}.
                        </p>
                        <p className="text-base md:text-sm text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-500">
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

                  // Show status tracker for active payment states (PROCESSING/KNOWN_DEPOSIT_TX only).
                  // No separate "Payment summary" card here anymore — the amount/breakdown card
                  // above (now visible regardless of deposit state) already covers it, and having
                  // both showed the same amount twice.
                  if (s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX") {
                    return (
                      <div className="mt-6">
                        <DepositProgressSteps status={status} />
                      </div>
                    );
                  }
                  if (s === "SUCCESS") return null;

                  // Shared by this terminal-state retry button and the "Cancel & choose a
                  // different token" button further below — same reset either way: forget this
                  // deposit attempt (locally and in the persisted claimPay store) and let the
                  // hydrate-from-latestIntent effect above sit dormant for it (dismissedDepositAddress),
                  // so a refresh doesn't resurrect the exact attempt that just failed/refunded.
                  const resetForRetry = (toastTitle: string, toastDescription: string) => {
                    setDeposit(null);
                    setStatus(null);
                    setFromSel(undefined);
                    setRefundAddress("");
                    setRefundAddressError(null);
                    userCancelled.current = true;
                    useClaimPayStore.getState().clear(id);
                    if (depositAddr) {
                      useClaimPayStore.getState().setDismissedDepositAddress(id, depositAddr);
                    }
                    toast({ title: toastTitle, description: toastDescription });
                  };

                  if (isTerminal) {
                    return (
                      <div className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm p-5 text-center [@media(prefers-color-scheme:dark)]:bg-[#17171b] [@media(prefers-color-scheme:dark)]:border-white/10">
                        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 [@media(prefers-color-scheme:dark)]:bg-amber-500/15">
                          <AlertTriangle className="h-5 w-5 text-amber-600 [@media(prefers-color-scheme:dark)]:text-amber-400" />
                        </div>
                        <p className="text-base font-semibold text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100">
                          {s === "FAILED" ? "Deposit failed" : "Deposit was refunded"}
                        </p>
                        <p className="text-base text-gray-500 mt-1 mb-4 [@media(prefers-color-scheme:dark)]:text-slate-400">
                          {s === "FAILED"
                            ? "Something went wrong before your deposit could be routed. Nothing was charged."
                            : "The route couldn't be completed, so your funds were sent back to your wallet."}
                        </p>
                        <Button
                          type="button"
                          onClick={() => resetForRetry("Let's try again", "Choose a different token or network below.")}
                          className="bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                        >
                          Try again
                        </Button>
                      </div>
                    );
                  }

                  // For PENDING_DEPOSIT and INCOMPLETE_DEPOSIT - show deposit info FIRST, then status tracker
                  return (
                    <div className="mt-6">
                      {depositAddr ? (
                        <>
                          {/* Amount to Pay - AT THE TOP */}
                          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5">
                            <div className="text-base text-gray-700 space-y-2 [@media(prefers-color-scheme:dark)]:text-slate-300">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Amount to pay</span>
                                <span className="text-lg font-medium text-gray-900 inline-flex items-center gap-2 [@media(prefers-color-scheme:dark)]:text-slate-100">
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
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors ml-2 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:bg-white/10 [@media(prefers-color-scheme:dark)]:text-slate-300 [@media(prefers-color-scheme:dark)]:hover:bg-white/20"
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
                                <span className="text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">Deposit address</span>
                                <span className="text-lg font-medium text-gray-900 inline-flex items-center gap-2 [@media(prefers-color-scheme:dark)]:text-slate-100">
                                  <span className="font-display  text-base md:text-sm break-all">
                                    {depositAddr}
                                  </span>
                                  <button
                                    type="button"
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-md  border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors ml-2 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:bg-white/10 [@media(prefers-color-scheme:dark)]:text-slate-300 [@media(prefers-color-scheme:dark)]:hover:bg-white/20"
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

                          {/* Status line — one plain line, no mascot/progress-bar duplication.
                              DepositProgressSteps below is the single place progress is shown;
                              PROCESSING/KNOWN_DEPOSIT_TX/SUCCESS/FAILED/REFUNDED already return
                              earlier in this switch, so only PENDING_DEPOSIT, INCOMPLETE_DEPOSIT,
                              and PRIVATE_TRANSFER_PENDING are ever reachable here. */}
                          {String(status || "").toUpperCase() === "PRIVATE_TRANSFER_PENDING" && claim?.is_private ? (
                            <div className="mb-6 p-4 rounded-xl border-2 border-amber-200 bg-amber-50 [@media(prefers-color-scheme:dark)]:border-amber-500/30 [@media(prefers-color-scheme:dark)]:bg-amber-500/10">
                              <p className="text-base font-medium text-amber-900 [@media(prefers-color-scheme:dark)]:text-amber-200">Complete your private transfer</p>
                              <p className="text-base text-amber-900/80 mt-1 [@media(prefers-color-scheme:dark)]:text-amber-200/70">Funds are in your wallet — finish the private transfer to the recipient using the button below.</p>
                            </div>
                          ) : !deposit?.isCompanionSwap && !deposit?.isDirect && (
                            <div className="mb-6 flex items-center justify-between gap-3">
                              <p className="text-base text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400">
                                Send the exact amount above to the deposit address, from{" "}
                                <span className="font-medium text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-200">{String(selectedFrom?.chain || "").toUpperCase()}</span> only.
                              </p>
                              {!speedUpOpen && (
                                <button
                                  type="button"
                                  className="shrink-0 text-base text-gray-600 hover:text-gray-900 underline [@media(prefers-color-scheme:dark)]:text-slate-400 [@media(prefers-color-scheme:dark)]:hover:text-slate-100"
                                  onClick={() => setSpeedUpOpen(true)}
                                >
                                  Already deposited?
                                </button>
                              )}
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
                            <DepositProgressSteps status={status || "PENDING_DEPOSIT"} />
                          </div>

                          {/* Cancel/Change Token Button - AT THE BOTTOM */}
                          <div className="mt-6 flex justify-center">
                            <Button
                              variant="outline"
                              onClick={() => resetForRetry("Cancelled", "You can now choose a different token.")}
                              className="text-base md:text-sm bg-white border-gray-300 text-gray-700 hover:bg-gray-50 [@media(prefers-color-scheme:dark)]:bg-white/5 [@media(prefers-color-scheme:dark)]:border-white/20 [@media(prefers-color-scheme:dark)]:text-slate-200 [@media(prefers-color-scheme:dark)]:hover:bg-white/10"
                            >
                              Cancel & choose a different token
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
        ) : pendingSocialPlatformHint && !hasSocialPlatformLinked(pendingSocialPlatformHint) ? (
          <SocialConnectPrompt
            platform={pendingSocialPlatformHint}
            onConnect={() => connectSocialPlatform(pendingSocialPlatformHint)}
            isConfirmingIdentity={isConfirmingIdentity}
            platformLinked={hasSocialPlatformLinked(pendingSocialPlatformHint)}
          />
        ) : isAwaitingSocialIdentityConfirmation ? (
          <ConfirmingIdentityNotice />
        ) : (
          <PaymentNotFoundNotice
            message="This link may have expired, been cancelled, or never existed."
            hint={
              !pendingSocialPlatformHint && (!hasTwitterLinked || !hasEmailLinked)
                ? "It might also be waiting on an email or X handle you haven't added to your account yet."
                : null
            }
            showLinkButtons={!pendingSocialPlatformHint}
            hasTwitterLinked={hasTwitterLinked}
            hasEmailLinked={hasEmailLinked}
            onConnectTwitter={() => linkTwitter()}
            onConnectEmail={() => linkEmail()}
            isConfirmingIdentity={isConfirmingIdentity}
          />
        )}
      </ClaimPayLayout>

      {/* FAQ — checkout gets its own, payer-relevant explainer (light theme, matches checkout's
          card); the regular claim page keeps the original privacy FAQ (dark theme, matches that
          page). Same accordion mechanics either way, same style as send/receive and megapot.
          This section is a sibling AFTER </ClaimPayLayout> closes, so it sits on the outer page
          div's own always-dark bg-[#0f0f12] — not inside ClaimPayLayout's chrome="minimal" light
          wrapper. Needs its own matching light/dark background here, or the light-mode text above
          renders on a dark page background (looked like black-on-black). */}
      <section
        id="how-privacy-works"
        className={
          chrome === "minimal"
            ? "md:pb-16 px-4 pt-2 pb-24 bg-slate-50 [@media(prefers-color-scheme:dark)]:bg-[#0f0f12]"
            : "md:pb-16 px-4 mt-2 pb-24"
        }
      >
        <div className="max-w-xl mx-auto">
          <h2 className={
            chrome === "minimal"
              ? "text-3xl md:text-4xl font-medium font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100 text-center mb-8 md:mb-10"
              : "text-3xl md:text-4xl font-medium font-sans text-white text-center mb-8 md:mb-10"
          }>
            {chrome === "minimal" ? "About this checkout" : "How private payments work"}
          </h2>
          <div className="flex flex-col gap-4">
            {(chrome === "minimal" ? CHECKOUT_INFO_FAQ_ITEMS : CLAIM_PRIVACY_FAQ_ITEMS).map((item, index) => (
              <div
                key={index}
                className={
                  chrome === "minimal"
                    ? "rounded-[20px] border border-gray-200 bg-white [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5 overflow-hidden"
                    : "rounded-[20px] border border-white/10 bg-white/5 overflow-hidden"
                }
              >
                <button type="button" onClick={() => setOpenPrivacyFaq(openPrivacyFaq === index ? null : index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left">
                  <span className={
                    chrome === "minimal"
                      ? "text-lg md:text-xl font-semibold font-sans text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-200"
                      : "text-lg md:text-xl font-semibold font-sans text-slate-200"
                  }>{item.question}</span>
                  <motion.span className="text-4xl text-orange-500 shrink-0 ml-4"
                    animate={{ rotate: openPrivacyFaq === index ? 45 : 0 }} transition={{ duration: 0.2 }}>
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {openPrivacyFaq === index && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden">
                      <div className={
                        chrome === "minimal"
                          ? "px-6 pb-5 text-lg text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-400 leading-relaxed"
                          : "px-6 pb-5 text-lg text-slate-400 leading-relaxed"
                      }>{item.answer}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pay Now modal: same centered style as onboarding (emoji + amount + subtitle), then 2 options */}
      <Dialog
        open={showPayNowModal}
        onOpenChange={(open) => {
          if (!open && payNowModalDismissLocked) return;
          setShowPayNowModal(open);
          if (open) {
            setPayWithLooftaError(null);
            setConfirmingTxSignature(null);
            setConfirmingTxSource(null);
            setPerTransferPhase(null);
          }
        }}
      >
        <DialogContent
          className={cn(
            sora.variable,
            "sm:max-w-[520px] p-7 rounded-[30px] border-white/10 bg-[#121217] text-white shadow-[0_40px_120px_rgba(0,0,0,0.7)] [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.text-muted-foreground]:!text-slate-400 [&_.bg-gray-50]:!bg-white/5 [&_.bg-white]:!bg-white/10 [&_.border-gray-200]:!border-white/10 [&_.ring-offset-background]:!ring-offset-[#121217] [&_.bg-red-50]:!bg-red-500/15 [&_.border-red-200]:!border-red-400/30 [&_.text-red-800]:!text-red-200 [&_.bg-emerald-50]:!bg-emerald-500/15 [&_.border-emerald-200]:!border-emerald-400/30 [&_.bg-emerald-100]:!bg-emerald-500/20 [&_.text-emerald-600]:!text-emerald-300 [&_.bg-orange-50]:!bg-orange-500/15 [&_.border-orange-200]:!border-orange-400/30 [&_.bg-orange-100]:!bg-orange-500/20 [&_.text-orange-600]:!text-orange-300 [&_.text-orange-500]:!text-orange-300 [&_.bg-amber-50]:!bg-amber-500/15 [&_.text-amber-600]:!text-amber-300 [&>*:last-child]:!text-slate-400 [&>*:last-child:hover]:!text-white [&>*:last-child:hover]:!bg-white/10",
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
                  ? `Pay $${payingPrivately && isFeeOnSender ? privatePayTotal.toFixed(2) : claimAmountUSD.toFixed(2)}`
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
                  {payingPrivately && landingDelayMs > 0 && (
                    <> It can then take {formatDelayDuration(landingDelayMs)} to actually appear.</>
                  )}
                </p>
                {confirmingTxSource && (
                  <p className="pt-1 text-base md:text-sm text-gray-500">
                    Paying with Loofta balance
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
          ) : payingWithLoofta && perTransferPhase ? (
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
              {(() => {
                const needed = (payingPrivately && isFeeOnSender
                  ? (pendingFeeUsdc != null ? claimAmountUSD + pendingFeeUsdc : privatePayTotal)
                  : claimAmountUSD) + (chargeClaimFee ? claimFeeUsd : 0);
                const feeAmount = pendingFeeUsdc != null
                  ? pendingFeeUsdc
                  : privatePayProtocolFee + privatePayGasFee;
                const payTo =
                  claim?.recipient_username
                    ? `@${claim.recipient_username}`
                    : (claim as { recipient_pending_username_value?: string } | null)?.recipient_pending_username_value
                      ? `@${(claim as { recipient_pending_username_value?: string }).recipient_pending_username_value}`
                      : (claim as { recipient_pending_email_value?: string } | null)?.recipient_pending_email_value
                        || claim?.recipient_email
                        || ((claim as { recipient_pending_social_value?: string } | null)?.recipient_pending_social_value
                          ? `@${(claim as { recipient_pending_social_value?: string }).recipient_pending_social_value}`
                          : "recipient");
                const recipientGets = payingPrivately && !isFeeOnSender
                  ? Math.max(0, claimAmountUSD - feeAmount)
                  : claimAmountUSD;
                const hasEnough = solanaPayment.hasEnoughBalance(needed);
                const isLoading = solanaPayment.isBalanceLoading;
                const soraFace = { fontFamily: "var(--font-home-sora), Sora, sans-serif" } as const;
                return (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-3.5">
                      <div
                        className="grid h-[52px] w-[52px] place-items-center rounded-[17px] bg-[radial-gradient(120%_120%_at_28%_18%,#FFFFFF_0%,#ECEAF0_45%,#BDBAC6_100%)] text-2xl font-extrabold text-[#16161C] shadow-[inset_0_2px_4px_rgba(255,255,255,0.5),0_4px_0_#8C8898]"
                        style={soraFace}
                      >
                        @
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold text-[#8A8893]">Payment to</span>
                        <span className="truncate text-xl font-bold text-white" style={soraFace}>{payTo}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <span className="text-[56px] font-bold leading-none tracking-[-0.05em] text-white" style={soraFace}>
                        ${needed.toFixed(2)}
                      </span>
                      <span className="pb-1 text-sm text-[#8A8893]">USDC on Solana</span>
                    </div>
                    {payingPrivately && (
                      <div className="rounded-2xl border border-[rgba(255,90,26,0.25)] bg-[rgba(255,90,26,0.08)] px-4 py-3.5 text-sm leading-normal text-[#E6C9B8]">
                        {privatePaymentFundsAppearCopy(landingDelayMs).replace(/^Funds/, "This payment is private. Funds")}
                      </div>
                    )}
                    <div className="flex flex-col gap-3 rounded-[18px] border border-white/[0.06] bg-[#0E0E12] p-[18px]">
                      <span className="text-sm tracking-[0.16em] text-[#77757F]" style={{ fontFamily: "var(--font-home-mono), ui-monospace, monospace" }}>BREAKDOWN</span>
                      <div className="flex justify-between text-[15px]">
                        <span className="text-[#B5B2BC]">Recipient receives</span>
                        <span className="font-bold">${recipientGets.toFixed(2)}</span>
                      </div>
                      {payingPrivately && (
                        <div className="flex justify-between gap-3 text-[15px]">
                          <span className="text-[#B5B2BC]">{isFeeOnSender ? "Privacy fee" : "Privacy fee, from what they receive"}</span>
                          <span className="font-bold">${feeAmount.toFixed(2)}</span>
                        </div>
                      )}
                      {chargeClaimFee && (
                        <div className="flex justify-between text-[15px]">
                          <span className="text-[#B5B2BC]">Claim fee</span>
                          <span className="font-bold">${claimFeeUsd.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="h-px bg-white/[0.07]" />
                      <div className="flex justify-between text-[17px]">
                        <span className="font-bold">You pay</span>
                        <span className="font-bold" style={soraFace}>${needed.toFixed(2)}</span>
                      </div>
                      <p className="text-sm text-[#8A8893]">
                        {isLoading ? "Loading balance…" : `$${looftaBalanceUSD.toFixed(2)} in your Loofta wallet`}
                      </p>
                    </div>
                    {!isLoading && !hasEnough ? (
                      <InsufficientBalanceCard
                        balanceUSD={looftaBalanceUSD}
                        neededUSD={needed}
                        showFeesLabel={false}
                        onBeforeTopUp={() => {
                          resumePayAfterTopUpRef.current = true;
                          setShowPayNowModal(false);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => payWithLooftaBalance()}
                        disabled={!authenticated || !isPayerWalletReady || isLoading || payingWithLoofta}
                        className="w-full rounded-[18px] py-[18px] text-center text-[17px] font-semibold text-white shadow-[0_14px_40px_rgba(255,70,10,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ ...soraFace, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)" }}
                      >
                        {payingWithLoofta ? "Paying…" : "Pay now"}
                      </button>
                    )}
                    {payWithLooftaError && (
                      <div className="space-y-2">
                        <div className="rounded-lg border border-red-400/30 bg-red-500/15 p-3 text-sm text-red-200 [overflow-wrap:anywhere] whitespace-pre-wrap">
                          <strong>Payment failed:</strong> {payWithLooftaError}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setPayWithLooftaError(null); payWithLooftaBalance(false); }}
                          className="w-full rounded-xl border border-white/20 bg-white/5 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/10"
                        >
                          Try without gas sponsorship
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>

      {CLAIM_DEV_PREVIEW_ENABLED && isClaimPageLocalhost && chrome !== "minimal" && <DevPreviewPanel />}
    </>
  );
}

function ClaimPayPageFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-screen">
      <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      <p className="text-base text-white/40">Redirecting to payment...</p>
    </div>
  );
}

export default function ClaimPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return (
    <React.Suspense fallback={<ClaimPayPageFallback />}>
      <ClaimPayView claimId={id} />
    </React.Suspense>
  );
}


