"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";

export type PaymentHistoryClaim = {
  id: string;
  amount: string;
  to_symbol: string;
  to_chain: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  recipient_address: string;
  recipient_username?: string | null;
  creator_email: string | null;
  creator_username?: string | null;
  created_by: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  description: string | null;
};

/** For received: sender label = @username → email → Anonymous */
function getSenderDisplay(claim: PaymentHistoryClaim): string {
  if (claim.creator_username) return `@${claim.creator_username}`;
  if (claim.creator_email) return claim.creator_email;
  return "Anonymous";
}

/** For sent: payee label = @recipient_username → PENDING_USERNAME → email → Anonymous */
function getPayeeDisplay(claim: PaymentHistoryClaim): string {
  if (claim.recipient_username) return `@${claim.recipient_username}`;
  const ra = (claim.recipient_address || "").trim();
  if (ra.startsWith(PENDING_USERNAME_PREFIX)) return `@${ra.slice(PENDING_USERNAME_PREFIX.length).trim()}`;
  if (ra.startsWith(PENDING_EMAIL_PREFIX)) return ra.slice(PENDING_EMAIL_PREFIX.length).trim();
  return "Anonymous";
}

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: "Paid",
  CANCELLED: "Cancelled",
  OPEN: "Open",
  PENDING_DEPOSIT: "Pending",
  IN_FLIGHT: "In progress",
  REFUNDED: "Refunded",
  EXPIRED: "Expired",
};

function getStatusLabel(status: string): string {
  return (STATUS_LABELS[String(status || "").toUpperCase()] ?? status) || "—";
}

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
    case "REFUNDED":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "EXPIRED":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-white/10 text-slate-400 border-white/10";
  }
}

const GIF_URL_REGEX = new RegExp(
  "https?://[^\\s]+(?:\\.gif|giphy\\.com|tenor\\.com|gfycat\\.com|media\\.giphy\\.com)[^\\s]*",
  "gi"
);
const WHITESPACE_REGEX = new RegExp("\\s+", "g");

function stripGifUrlsFromMessage(desc: string): string | null {
  const trimmed = desc.trim();
  if (!trimmed) return null;
  const textOnly = trimmed.replace(GIF_URL_REGEX, "").replace(WHITESPACE_REGEX, " ").trim();
  return textOnly || null;
}

/** Extract first GIF URL from description (for showing in list). */
function extractGifUrl(desc: string): string | null {
  const trimmed = (desc || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(GIF_URL_REGEX);
  return match ? match[0] : null;
}

async function fetchPaymentHistory(userId: string): Promise<{ sent: PaymentHistoryClaim[]; received: PaymentHistoryClaim[] }> {
  const r = await fetch("/api/payments/history", {
    headers: { "x-privy-user-id": userId },
    cache: "no-store",
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to load history");
  }
  return r.json();
}

const PAYMENT_HISTORY_GC_MS = 5 * 60 * 1000; // 5 min keep in cache

export default function HistoryPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin } = usePrivy();
  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["payments", "history", userId ?? ""],
    queryFn: () => fetchPaymentHistory(userId!),
    enabled: Boolean(authenticated && userId),
    staleTime: 0,
    gcTime: PAYMENT_HISTORY_GC_MS,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const sent = data?.sent ?? [];
  const received = data?.received ?? [];
  const error = queryError ? (queryError as Error).message ?? "Failed to load" : null;

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
    const list = [
      ...sent.map((claim) => ({ claim, type: "sent" as const })),
      ...received.map((claim) => ({ claim, type: "received" as const })),
    ].sort((a, b) => new Date(b.claim.created_at).getTime() - new Date(a.claim.created_at).getTime());
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
      const senderOrPayee = type === "sent" ? getPayeeDisplay(claim) : getSenderDisplay(claim);
      const message = (claim.description || "").toLowerCase();
      return senderOrPayee.toLowerCase().includes(q) || message.includes(q);
    });
  }, [allPayments, searchQuery, typeFilter]);

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="min-h-[calc(100vh-var(--header-h,0px))]">
              <div className="hidden md:block">
                <SendReceiveTabs activeTab={null} visualOnly />
              </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
            <h1 className="text-xl font-bold text-white mb-2">Payment history</h1>
            <p className="text-slate-400 mb-4">
              Log in to see payments you sent and received.
            </p>
            <button
              type="button"
              onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
              className="rounded-xl px-4 py-2 font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
            >
              Sign in
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
                <SendReceiveTabs activeTab="send" visualOnly />
            </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-6">
          <h1 className="text-lg font-bold text-white mb-4">Payment history</h1>
          {loading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : (
            <>
              <div ref={cardsRef} className="grid grid-cols-2 gap-4 mb-6">
                <button
                  type="button"
                  onClick={() => setTypeFilter((prev) => (prev === "sent" ? "all" : "sent"))}
                  className={`rounded-xl border p-4 text-left transition-colors hover:bg-white/10 ${
                    typeFilter === "sent"
                      ? "bg-amber-500/10 border-amber-400/30 ring-2 ring-amber-400/30"
                      : "bg-white/5 border-white/10"
                  }`}
                >
                  <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Amount sent</p>
                  <p className="text-xl font-bold text-white mt-1">${totalSent.toFixed(2)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter((prev) => (prev === "received" ? "all" : "received"))}
                  className={`rounded-xl border p-4 text-left transition-colors hover:bg-white/10 ${
                    typeFilter === "received"
                      ? "bg-emerald-500/10 border-emerald-400/30 ring-2 ring-emerald-400/30"
                      : "bg-white/5 border-white/10"
                  }`}
                >
                  <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Amount received</p>
                  <p className="text-xl font-bold text-white mt-1">${totalReceived.toFixed(2)}</p>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-slate-400 text-sm font-medium">Recent payments</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                    aria-label="Refresh"
                    title="Refresh list"
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
                    aria-label="Search"
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
                  placeholder="Search by sender, payee or message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full mb-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                />
              )}
              {allPayments.length === 0 ? (
                <p className="text-slate-500 text-sm">No payments yet.</p>
              ) : filteredPayments.length === 0 ? (
                <p className="text-slate-500 text-sm">No payments match your search.</p>
              ) : (
                <ul className="space-y-2">
                  {filteredPayments.map(({ claim, type }) => {
                    const amount = parseFloat(claim.amount || "0");
                    const senderOrPayee = type === "sent" ? getPayeeDisplay(claim) : getSenderDisplay(claim);
                    const message = stripGifUrlsFromMessage(claim.description || "");
                    const gifUrl = type === "received" ? extractGifUrl(claim.description || "") : null;
                    const showMessageOrGif = (type === "received" && (message || gifUrl)) || (type === "sent" && message);
                    return (
                      <li key={`${type}-${claim.id}`}>
                        <Link
                          href={`/c/${claim.id}`}
                          className="block rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-semibold ${type === "sent" ? "text-amber-400" : "text-emerald-400"}`}>
                              {type === "sent" ? "Sent" : "Received"}
                            </span>
                            <span className="text-white font-semibold">
                              {type === "sent" ? "-" : "+"}${amount.toFixed(2)} {claim.to_symbol}
                            </span>
                          </div>
                          <div className="mt-1.5 text-sm font-medium text-slate-300">
                            {type === "sent" ? "To " : "From "}{senderOrPayee}
                          </div>
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
                                <p className="text-sm text-slate-300 line-clamp-2 italic">"{message}"</p>
                              )}
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-xs text-slate-500">
                              {new Date(claim.created_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(claim.status || "")}`}
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
