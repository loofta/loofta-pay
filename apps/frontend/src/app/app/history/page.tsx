"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { PrivacyGlyph } from "@/components/PrivacyGlyph";

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
};

function getSenderDisplay(claim: PaymentHistoryClaim, anonymous: string): string {
  if (claim.direction === "from_recipient") {
    if (claim.sender_username) return `@${claim.sender_username}`;
    return anonymous;
  }
  if (claim.creator_username) return `@${claim.creator_username}`;
  if (claim.creator_email) return claim.creator_email;
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
    return platform ? `@${handle} on ${platform}` : `@${handle}`;
  }
  if (claim.recipient_email) return claim.recipient_email;
  return anonymous;
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
): Promise<{ sent: PaymentHistoryClaim[]; received: PaymentHistoryClaim[] }> {
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

function IconBubble({
  active,
  variant,
  children,
}: {
  active: boolean;
  variant: "sent" | "received";
  children: React.ReactNode;
}) {
  const base =
    "inline-flex h-8 w-8 items-center justify-center rounded-full shrink-0 border transition-colors";
  const styles = active
    ? "text-white border-white/10"
    : variant === "received"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
      : "bg-amber-500/10 text-amber-300 border-amber-500/20";

  return (
    <span aria-hidden="true" className={`${base} ${styles}`}>
      <span className="flex items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{children}</span>
    </span>
  );
}

export default function HistoryPage() {
  const t = useTranslations('HistoryPage');
  const locale = useLocale();
  const { authenticated, userId } = useAuth();
  const { login: privyLogin, getAccessToken } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);

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

  const totalSent = sent
    .filter((c) => String(c.status).toUpperCase() === "SUCCESS")
    .reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0);
  const totalReceived = received
    .filter((c) => String(c.status).toUpperCase() === "SUCCESS")
    .reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0);

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
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="min-h-[calc(100vh-var(--header-h,0px))]">
            <div className="hidden md:block">
              <SendReceiveTabs activeTab={null} visualOnly />
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <h1 className="text-xl font-medium font-sans text-white mb-2">{t('signInTitle')}</h1>
              <p className="text-slate-400 mb-4">{t('signInPrompt')}</p>
              <button
                type="button"
                onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
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
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <div className="min-h-[calc(100vh-var(--header-h,0px))]">
          <div className="hidden md:block">
            <SendReceiveTabs activeTab={null} visualOnly />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 mb-6">
            <h1 className="text-lg font-medium font-sans text-white mb-4">{t('title')}</h1>
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
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {/* SENT */}
                  <button
                    type="button"
                    onClick={() => setTypeFilter((prev) => (prev === "sent" ? "all" : "sent"))}
                    className={[
                      "rounded-2xl border p-4 text-left transition-colors hover:bg-white/10",
                      typeFilter === "sent"
                        ? "bg-amber-500/10 border-amber-400/30 ring-2 ring-amber-400/30"
                        : "bg-amber-500/5 border-amber-500/20",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <IconBubble active={typeFilter === "sent"} variant="sent">
                        <ArrowUp />
                      </IconBubble>
                      <p className="text-slate-300 text-base font-medium uppercase tracking-wide">
                        {t('amountSent')}
                      </p>
                    </div>
                    <p className="text-3xl font-sans font-semibold text-white mt-2 tabular-nums">
                      ${totalSent.toFixed(2)}
                    </p>
                  </button>
                  {/* RECEIVED */}
                  <button
                    type="button"
                    onClick={() => setTypeFilter((prev) => (prev === "received" ? "all" : "received"))}
                    className={[
                      "rounded-2xl border p-4 text-left transition-colors hover:bg-white/10",
                      typeFilter === "received"
                        ? "bg-emerald-500/10 border-emerald-400/30 ring-2 ring-emerald-400/30"
                        : "bg-emerald-500/5 border-emerald-500/20",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <IconBubble active={typeFilter === "received"} variant="received">
                        <ArrowDown />
                      </IconBubble>
                      <p className="text-slate-300 text-base font-medium uppercase tracking-wide">
                        {t('amountReceived')}
                      </p>
                    </div>
                    <p className="text-3xl font-sans font-semibold text-white mt-2 tabular-nums">
                      ${totalReceived.toFixed(2)}
                    </p>
                  </button>
                </div>

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
                      return (
                        <li key={`${type}-${claim.id}`}>
                          <Link
                            href={`/c/${claim.id}?from=history`}
                            className="block rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`flex items-center gap-1.5 text-base font-semibold ${type === "sent" ? "text-amber-400" : "text-emerald-400"}`}>
                                {type === "sent" ? t('sent') : t('received')}
                                {showPrivacyIcon && (
                                  <span aria-label="Private" className="inline-flex text-slate-400">
                                    <PrivacyGlyph size={14} opacity={0.9} />
                                  </span>
                                )}
                              </span>
                              <span className="text-white font-semibold font-sans">
                                {type === "sent" ? "-" : "+"}${amount.toFixed(2)} {claim.to_symbol}
                              </span>
                            </div>
                            {hasKnownCounterparty && (
                              <div className="mt-1.5 text-base font-medium text-slate-300">
                                {type === "sent" ? t('to') : t('from')} {senderOrPayee}
                              </div>
                            )}
                            {showMessageOrGif && (
                              <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 space-y-2">
                                {type === "received" && gifUrl && (
                                  <img
                                    src={gifUrl}
                                    alt=""
                                    className="rounded-lg w-full max-h-32 object-cover object-center"
                                  />
                                )}
                                {message && (
                                  <p className="text-base sm:text-sm text-slate-300 line-clamp-2 italic">"{message}"</p>
                                )}
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2 mt-2">
                              <span className="text-base sm:text-sm text-slate-500">
                                {new Date(claim.created_at).toLocaleDateString(locale, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${getStatusBadgeClass(claim.status || "")}`}
                              >
                                {getStatusLabel(claim.status || "")}
                              </span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
