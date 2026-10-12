"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { Repeat } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { PrivacyGlyph } from "@/components/PrivacyGlyph";
import { useBulkClaim } from "@/hooks/useBulkClaim";
import { manrope, sora } from "@/components/home-v4/fonts";

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";
/** Must match ClaimsService.PENDING_SOCIAL_PREFIX (backend claims.service.ts). Format: PENDING_SOCIAL:<platform>:<handle> */
const PENDING_SOCIAL_PREFIX = "PENDING_SOCIAL:";

export type PaymentHistoryClaim = {
  id: string;
  short_id?: string | null;
  amount: string;
  direction: "from_sender" | "from_recipient";
  to_symbol: string;
  to_chain: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  recipient_address?: string;
  recipient_username?: string | null;
  recipient_email?: string | null;
  creator_email: string | null;
  creator_username?: string | null;
  sender_username?: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  claimed_privately?: boolean | null;
  description: string | null;
  is_devnet?: boolean;
  /** Set only for a from_recipient payment (checkout/payment-link) paid by a guest with no
   *  Loofta account — the only sender identity there is to show for one. */
  guest_sender_email?: string | null;
  guest_sender_wallet?: string | null;
  /** Set for a pay to Venmo, Cash App, or Revolut. Opens the receipt instead of /c/[id]. */
  receipt_path?: string | null;
};

function getSenderDisplay(claim: PaymentHistoryClaim, anonymous: string): string {
  if (claim.direction === "from_recipient") {
    if (claim.sender_username) return `@${claim.sender_username}`;
    // No account, so no username — a guest checkout payer's only identity is the email they
    // typed in at checkout (GuestCheckoutPay), stored as guest_sender_email.
    if (claim.guest_sender_email) return claim.guest_sender_email;
    return anonymous;
  }
    if (claim.creator_username) return `@${claim.creator_username}`;
    if (claim.creator_email) return claim.creator_email;
    if (claim.guest_sender_wallet) {
      const w = claim.guest_sender_wallet;
      return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
    }
    return anonymous;
}

function getPayeeDisplay(claim: PaymentHistoryClaim, anonymous: string): string {
  if (claim.direction === "from_recipient") {
    // Payment request links: recipient_username/recipient_address describe the creator's own
    // identity (see sharePreview.ts), not a payer's — the true payee is whoever created the
    // request, resolved server-side into creator_username.
    if (claim.creator_username) return `@${claim.creator_username}`;
    return anonymous;
  }
  if (claim.recipient_username) return `@${claim.recipient_username}`;
  const ra = (claim.recipient_address || "").trim();
  if (ra.startsWith(PENDING_USERNAME_PREFIX)) return `@${ra.slice(PENDING_USERNAME_PREFIX.length).trim()}`;
  if (ra.startsWith(PENDING_EMAIL_PREFIX)) return ra.slice(PENDING_EMAIL_PREFIX.length).trim();
  if (ra.startsWith(PENDING_SOCIAL_PREFIX)) {
    const rest = ra.slice(PENDING_SOCIAL_PREFIX.length);
    const sep = rest.indexOf(":");
    const platform = sep >= 0 ? rest.slice(0, sep).trim() : null;
    const handle = (sep >= 0 ? rest.slice(sep + 1) : rest).trim();
    const cashName = platform === "venmo" ? "Venmo" : platform === "cashapp" ? "Cash App" : platform === "revolut" ? "Revolut" : null;
    if (cashName) return `${handle} on ${cashName}`;
    return platform ? `@${handle} on ${platform}` : `@${handle}`;
  }
  if (claim.recipient_email) return claim.recipient_email;
  return anonymous;
}

type SendAgainTarget = {
  identifier: string;
  method: "email" | "username" | "social";
  platform?: "twitter" | "discord" | "github" | "telegram";
};

const LOO_USERNAME_PREFIX = "loo-";

/**
 * The send form's "username" tab always force-prepends "loo-" before submitting (see
 * handleSend in app/app/page.tsx and the matching input mask) — it can only ever reach
 * loo-prefixed usernames. Anyone whose real username is a raw handle (picked directly from
 * their connected X account at signup, see setup-username/route.ts) can only be reached today
 * through the Twitter tab, which submits the identifier unprefixed. Route accordingly so a
 * resend never submits a mangled "loo-loo-x", or worse, silently lands on a different
 * "loo-x" account than the one actually paid.
 */
function targetForUsername(username: string): SendAgainTarget {
  if (username.startsWith(LOO_USERNAME_PREFIX)) {
    return { identifier: username.slice(LOO_USERNAME_PREFIX.length), method: "username" };
  }
  return { identifier: username, method: "social", platform: "twitter" };
}

/**
 * Mirrors getPayeeDisplay's parsing, but returns the raw identifier + send method needed to
 * pre-fill the send form (see the `to`/`method`/`platform` query params read in app/app/page.tsx)
 * instead of a display string. Only "sent" rows have a resendable counterparty — you can't
 * re-send money you received.
 */
function getSendAgainTarget(claim: PaymentHistoryClaim): SendAgainTarget | null {
  if (claim.direction === "from_recipient") {
    // Paid request link: the real payee is whoever created the request (see getPayeeDisplay).
    if (claim.creator_username) return targetForUsername(claim.creator_username);
    if (claim.creator_email) return { identifier: claim.creator_email, method: "email" };
    return null;
  }
  if (claim.recipient_username) return targetForUsername(claim.recipient_username);
  const ra = (claim.recipient_address || "").trim();
  if (ra.startsWith(PENDING_USERNAME_PREFIX)) {
    return targetForUsername(ra.slice(PENDING_USERNAME_PREFIX.length).trim());
  }
  if (ra.startsWith(PENDING_EMAIL_PREFIX)) {
    return { identifier: ra.slice(PENDING_EMAIL_PREFIX.length).trim(), method: "email" };
  }
  if (ra.startsWith(PENDING_SOCIAL_PREFIX)) {
    const rest = ra.slice(PENDING_SOCIAL_PREFIX.length);
    const sep = rest.indexOf(":");
    const platform = sep >= 0 ? rest.slice(0, sep).trim() : "";
    const handle = (sep >= 0 ? rest.slice(sep + 1) : rest).trim();
    if (!handle || (platform !== "twitter" && platform !== "discord" && platform !== "github" && platform !== "telegram")) {
      return null;
    }
    return { identifier: handle, method: "social", platform };
  }
  if (claim.recipient_email) return { identifier: claim.recipient_email, method: "email" };
  return null;
}

const REQUEST_LINK_PAID_STATUSES = new Set(["SUCCESS", "PRIVATE_TRANSFER_PENDING"]);

const STATUS_KEYS = ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CANCELLED", "OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "REFUNDED", "EXPIRED"] as const;
type StatusKey = typeof STATUS_KEYS[number];

function getStatusBadgeClass(status: string): string {
  const s = String(status || "").toUpperCase();
  switch (s) {
    case "SUCCESS":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "CANCELLED":
      return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    case "OPEN":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "PENDING_DEPOSIT":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "IN_FLIGHT":
      return "bg-violet-500/20 text-violet-400 border-violet-500/30";
    case "PRIVATE_TRANSFER_PENDING":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "REFUNDED":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "EXPIRED":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-white/10 text-slate-400 border-white/10";
  }
}

const GIF_URL_REGEX = new RegExp(
  "https?://(?:[^\\s/]+\\.)?(?:giphy\\.com|tenor\\.com|gfycat\\.com)/[^\\s]*",
  "gi"
);
const WHITESPACE_REGEX = new RegExp("\\s+", "g");

function stripGifUrlsFromMessage(desc: string): string | null {
  const trimmed = desc.trim();
  if (!trimmed) return null;
  const textOnly = trimmed.replace(GIF_URL_REGEX, "").replace(WHITESPACE_REGEX, " ").trim();
  return textOnly || null;
}

function extractGifUrl(desc: string): string | null {
  const trimmed = (desc || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(GIF_URL_REGEX);
  return match ? match[0] : null;
}

async function fetchPaymentHistory(
  userId: string,
  accessToken?: string | null,
  networkMode?: string,
): Promise<{ sent: PaymentHistoryClaim[]; received: PaymentHistoryClaim[]; sentTotal: number; receivedTotal: number }> {
  const headers: Record<string, string> = accessToken
    ? { authorization: `Bearer ${accessToken}` }
    : {};
  const params = networkMode ? `?network=${networkMode}` : "";
  const r = await fetch(`/api/payments/history${params}`, { headers, cache: "no-store" });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to load history");
  }
  return r.json();
}

const PAYMENT_HISTORY_GC_MS = 5 * 60 * 1000;

export default function HistoryPage() {
  const t = useTranslations('HistoryPage');
  const locale = useLocale();
  const router = useRouter();
  const { authenticated, userId } = useAuth();
  const { login: privyLogin, getAccessToken } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const { start: startBulkClaim, statuses: bulkClaimStatuses, isRunning: bulkClaimRunning } = useBulkClaim();

  const getStatusLabel = (status: string): string => {
    const key = String(status || "").toUpperCase() as StatusKey;
    if ((STATUS_KEYS as readonly string[]).includes(key)) {
      return t(`status.${key}` as Parameters<typeof t>[0]);
    }
    return status || "—";
  };

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["payments", "history", userId ?? "", networkMode],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      return fetchPaymentHistory(userId!, token, networkMode);
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 30_000,
    gcTime: PAYMENT_HISTORY_GC_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const sent = data?.sent ?? [];
  const received = data?.received ?? [];
  const error = queryError ? (queryError as Error).message ?? "Failed to load" : null;

  const anonymous = t('anonymous');

  // True lifetime totals, computed server-side over every matching row (not just the current
  // page) — summing only the fetched page here previously understated these for anyone with
  // more than a page of history (e.g. a multi-send campaign creating 100+ individual rows).
  const totalSent = data?.sentTotal ?? 0;
  const totalReceived = data?.receivedTotal ?? 0;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "sent" | "received">("all");
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeFilter === "all") return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cardsRef.current && !cardsRef.current.contains(e.target as Node)) {
        setTypeFilter("all");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [typeFilter]);

  const allPayments: { claim: PaymentHistoryClaim; type: "sent" | "received" }[] = useMemo(() => {
    // Require paid_at too — a row can sit at PRIVATE_TRANSFER_PENDING with paid_at still null
    // (the sender's payment never actually completed; an old/abandoned row, not one genuinely
    // waiting to land), and that shouldn't jump the queue as if it were.
    const isUnclaimed = (claim: PaymentHistoryClaim) =>
      String(claim.status).toUpperCase() === "PRIVATE_TRANSFER_PENDING" && !!claim.paid_at;
    const list = [
      ...sent.map((claim) => ({ claim, type: "sent" as const })),
      ...received.map((claim) => ({ claim, type: "received" as const })),
    ].sort((a, b) => {
      const unclaimedDiff = Number(isUnclaimed(b.claim)) - Number(isUnclaimed(a.claim));
      if (unclaimedDiff !== 0) return unclaimedDiff;
      return new Date(b.claim.created_at).getTime() - new Date(a.claim.created_at).getTime();
    });
    return list;
  }, [sent, received]);

  // Received payments funded but not yet swept to the recipient's wallet — same signal the
  // "Unclaimed" sort above relies on, kept as its own list so a "Claim all" action can target
  // exactly these without re-deriving it from allPayments' mixed sent/received shape.
  const unclaimedReceived = useMemo(
    () =>
      received.filter(
        (claim) => String(claim.status).toUpperCase() === "PRIVATE_TRANSFER_PENDING" && !!claim.paid_at,
      ),
    [received],
  );

  const filteredPayments = useMemo(() => {
    let list = allPayments;
    if (typeFilter !== "all") {
      list = list.filter(({ type }) => type === typeFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(({ claim, type }) => {
      const senderOrPayee = type === "sent" ? getPayeeDisplay(claim, anonymous) : getSenderDisplay(claim, anonymous);
      const message = (claim.description || "").toLowerCase();
      return senderOrPayee.toLowerCase().includes(q) || message.includes(q);
    });
  }, [allPayments, searchQuery, typeFilter, anonymous]);

  if (!authenticated) {
    return (
    <div className={`${sora.variable} ${manrope.variable} min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}>
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <div className="min-h-[calc(100vh-var(--header-h,0px))]">
          <SendReceiveTabs activeTab={null} visualOnly />
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <h1 className="text-xl font-medium font-sans text-white mb-2">{t('signInTitle')}</h1>
              <p className="text-slate-400 mb-4">{t('signInPrompt')}</p>
              <button
                type="button"
                onClick={() => privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
                className="rounded-xl px-4 py-2 font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
              >
                {t('signIn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${sora.variable} ${manrope.variable} min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}>
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <div className="min-h-[calc(100vh-var(--header-h,0px))]">
          <SendReceiveTabs activeTab={null} visualOnly />
          <div className="mb-6">
            {loading ? (
              <div className="animate-pulse">
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-full bg-white/10" />
                        <div className="h-2.5 w-20 rounded-full bg-white/10" />
                      </div>
                      <div className="h-8 w-24 rounded-lg bg-white/10" />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div className="h-3 w-28 rounded-full bg-white/10" />
                  <div className="flex gap-1">
                    <div className="w-7 h-7 rounded-lg bg-white/10" />
                    <div className="w-7 h-7 rounded-lg bg-white/10" />
                  </div>
                </div>
                <ul className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="h-3 w-10 rounded-full bg-white/10" />
                        <div className="h-3 w-16 rounded-full bg-white/10" />
                      </div>
                      <div className="h-3 w-32 rounded-full bg-white/10 mb-2" />
                      <div className="flex items-center justify-between">
                        <div className="h-2.5 w-20 rounded-full bg-white/10" />
                        <div className="h-4 w-16 rounded-full bg-white/10" />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : error ? (
              <p className="text-red-400 text-base">{error}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setTypeFilter((prev) => (prev === "sent" ? "all" : "sent"))}
                    className="flex flex-col gap-1.5 rounded-[22px] border p-5 text-left"
                    style={{
                      background: "linear-gradient(160deg,#241709,#151210)",
                      borderColor: typeFilter === "sent" ? "rgba(245,150,12,0.55)" : "rgba(245,150,12,0.22)",
                    }}
                  >
                    <span className="text-sm font-semibold text-[#D9A866]">↑ {t('amountSent')}</span>
                    <span className="text-[28px] font-semibold tracking-[-0.04em] text-white tabular-nums" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>${totalSent.toFixed(2)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTypeFilter((prev) => (prev === "received" ? "all" : "received"))}
                    className="flex flex-col gap-1.5 rounded-[22px] border p-5 text-left"
                    style={{
                      background: "linear-gradient(160deg,#0D2016,#101513)",
                      borderColor: typeFilter === "received" ? "rgba(60,200,120,0.55)" : "rgba(60,200,120,0.22)",
                    }}
                  >
                    <span className="text-sm font-semibold text-[#6FD39A]">↓ {t('amountReceived')}</span>
                    <span className="text-[28px] font-semibold tracking-[-0.04em] text-white tabular-nums" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>${totalReceived.toFixed(2)}</span>
                  </button>
                </div>
                <div className="flex flex-col gap-3 rounded-[30px] border border-white/[0.07] bg-[#141419] p-[22px]">

                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-slate-400 text-base font-medium">{t('recentPayments')}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => refetch()}
                      disabled={isFetching}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                      aria-label={t('refresh')}
                      title={t('refreshList')}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isFetching ? "animate-spin" : ""}>
                        <path d="M21 2v6h-6" />
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M3 22v-6h6" />
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchOpen((o) => !o)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                      aria-label={t('search')}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                      </svg>
                    </button>
                  </div>
                </div>
                {searchOpen && (
                  <input
                    type="search"
                    placeholder={t('searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full mb-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                  />
                )}
                {unclaimedReceived.length > 1 && (() => {
                  const failed = unclaimedReceived.filter((c) => bulkClaimStatuses.get(c.id) === "failed");
                  const hasRunOnce = bulkClaimStatuses.size > 0 && !bulkClaimRunning;
                  const showRetry = hasRunOnce && failed.length > 0;
                  const settledCount = unclaimedReceived.filter((c) => {
                    const s = bulkClaimStatuses.get(c.id);
                    return s === "success" || s === "failed";
                  }).length;
                  const activeBatchSize = bulkClaimRunning ? bulkClaimStatuses.size : unclaimedReceived.length;
                  const currentStep = Math.min(settledCount + 1, activeBatchSize);
                  return (
                    <button
                      type="button"
                      disabled={bulkClaimRunning}
                      onClick={() =>
                        void startBulkClaim(
                          (showRetry ? failed : unclaimedReceived).map((c) => ({
                            id: c.id,
                            short_id: c.short_id ?? null,
                            amount: c.amount,
                          })),
                        )
                      }
                      className="mb-3 w-full flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
                    >
                      {bulkClaimRunning
                        ? t('claimAllProgress', { current: currentStep, total: activeBatchSize })
                        : showRetry
                          ? t('claimAllRetry', { count: failed.length })
                          : t('claimAllTitle', { count: unclaimedReceived.length })}
                    </button>
                  );
                })()}
                {allPayments.length === 0 ? (
                  <p className="text-slate-500 text-base">{t('noPayments')}</p>
                ) : filteredPayments.length === 0 ? (
                  <p className="text-slate-500 text-base">{t('noPaymentsMatch')}</p>
                ) : (
                  <ul className="space-y-2">
                    {filteredPayments.map(({ claim, type }) => {
                      const amount = parseFloat(claim.amount || "0");
                      const senderOrPayee = type === "sent"
                        ? getPayeeDisplay(claim, anonymous)
                        : getSenderDisplay(claim, anonymous);
                      const message = stripGifUrlsFromMessage(claim.description || "");
                      const gifUrl = type === "received" ? extractGifUrl(claim.description || "") : null;
                      const showMessageOrGif = (type === "received" && (message || gifUrl)) || (type === "sent" && message);
                      // A request link (direction=from_recipient) shows up in "sent" from two very
                      // different viewers: the creator's own still-open request (no payer yet — the
                      // "Open" status badge already conveys that, nothing to name) or the actual
                      // payer's completed payment (recipient is the request's creator, always known).
                      const hasKnownCounterparty =
                        !(type === "sent" && claim.direction === "from_recipient") ||
                        REQUEST_LINK_PAID_STATUSES.has(String(claim.status || "").toUpperCase());
                      // Sender cares whether THEY sent it privately; recipient cares whether
                      // privacy was involved on either leg (sent privately or claimed privately).
                      const showPrivacyIcon = type === "sent"
                        ? !!claim.is_private
                        : !!claim.is_private || !!claim.claimed_privately;
                      const sendAgainTarget = type === "sent" && hasKnownCounterparty
                        ? getSendAgainTarget(claim)
                        : null;
                      const sendAgainHref = sendAgainTarget
                        ? `/app?to=${encodeURIComponent(sendAgainTarget.identifier)}&method=${sendAgainTarget.method}${
                            sendAgainTarget.platform ? `&platform=${sendAgainTarget.platform}` : ""
                          }`
                        : null;
                      // Overlays the row's normal status badge while a "Claim all" run is touching
                      // this specific claim, so progress is visible per-row and not just on the bar.
                      const bulkClaimStatus = type === "received" ? bulkClaimStatuses.get(claim.id) : undefined;
                      const statusBadgeClass = bulkClaimStatus
                        ? bulkClaimStatus === "success"
                          ? getStatusBadgeClass("SUCCESS")
                          : bulkClaimStatus === "failed"
                            ? getStatusBadgeClass("EXPIRED")
                            : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : getStatusBadgeClass(claim.status || "");
                      const statusBadgeLabel = bulkClaimStatus
                        ? bulkClaimStatus === "success"
                          ? getStatusLabel("SUCCESS")
                          : bulkClaimStatus === "failed"
                            ? t('claimAllFailedBadge')
                            : t('claimAllClaimingBadge')
                        : getStatusLabel(claim.status || "");
                      return (
                        <li key={`${type}-${claim.id}`} className="overflow-hidden rounded-[18px] border border-white/[0.06] bg-[#0F0F13]">
                          <Link
                            href={claim.receipt_path || `/c/${claim.id}?from=history`}
                            className="block p-3.5 transition-colors hover:bg-white/[0.03]"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] text-base font-semibold"
                                style={{
                                  background: type === "sent" ? "rgba(245,150,12,0.14)" : "rgba(60,200,120,0.14)",
                                  color: type === "sent" ? "#F5A623" : "#5FD38E",
                                }}
                              >
                                {type === "sent" ? "↑" : "↓"}
                              </span>
                              <div className="min-w-0 flex-1">
                                {hasKnownCounterparty && (
                                  <p className="truncate text-base font-semibold text-[#F2EFE8]">
                                    {type === "sent" ? t('to') : t('from')} {senderOrPayee}
                                  </p>
                                )}
                                <p className="text-sm text-[#77757F]">
                                  {new Date(claim.created_at).toLocaleString(locale, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                  {showPrivacyIcon ? " · private" : ""}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className="whitespace-nowrap text-base font-semibold tabular-nums" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", color: type === "sent" ? "#F2EFE8" : "#5FD38E" }}>
                                  {type === "sent" ? "−" : "+"}${Number.isFinite(amount) ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                                </span>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-sm font-bold ${statusBadgeClass}`}>
                                  {statusBadgeLabel}
                                </span>
                              </div>
                            </div>
                            {showMessageOrGif && (
                              <div className="mt-2.5 space-y-2 rounded-xl bg-[#17171D] px-3 py-2.5">
                                {type === "received" && gifUrl && (
                                  <img
                                    src={gifUrl}
                                    alt=""
                                    className="max-h-32 w-full rounded-lg object-cover object-center"
                                  />
                                )}
                                {message && (
                                  <p className="line-clamp-2 text-sm italic text-[#B5B2BC]">"{message}"</p>
                                )}
                              </div>
                            )}
                          </Link>
                          {sendAgainHref && (
                            <button
                              type="button"
                              onClick={() => router.push(sendAgainHref)}
                              className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <Repeat className="h-3.5 w-3.5" />
                              {t('sendAgain')}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
