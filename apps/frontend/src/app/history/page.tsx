"use client";

import { useState, useMemo } from "react";
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

/** For sent: payee label = @username → email → Anonymous (from recipient_address) */
function getPayeeDisplay(claim: PaymentHistoryClaim): string {
  const ra = (claim.recipient_address || "").trim();
  if (ra.startsWith(PENDING_USERNAME_PREFIX)) return `@${ra.slice(PENDING_USERNAME_PREFIX.length).trim()}`;
  if (ra.startsWith(PENDING_EMAIL_PREFIX)) return ra.slice(PENDING_EMAIL_PREFIX.length).trim();
  return "Anonymous";
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

async function fetchPaymentHistory(userId: string): Promise<{ sent: PaymentHistoryClaim[]; received: PaymentHistoryClaim[] }> {
  const r = await fetch("/api/payments/history", {
    headers: { "x-privy-user-id": userId },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to load history");
  }
  return r.json();
}

const PAYMENT_HISTORY_STALE_MS = 60 * 1000; // 1 min cache
const PAYMENT_HISTORY_GC_MS = 5 * 60 * 1000; // 5 min keep in cache

export default function HistoryPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin } = usePrivy();
  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ["payments", "history", userId ?? ""],
    queryFn: () => fetchPaymentHistory(userId!),
    enabled: Boolean(authenticated && userId),
    staleTime: PAYMENT_HISTORY_STALE_MS,
    gcTime: PAYMENT_HISTORY_GC_MS,
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

  const allPayments: { claim: PaymentHistoryClaim; type: "sent" | "received" }[] = useMemo(() => {
    const list = [
      ...sent.map((claim) => ({ claim, type: "sent" as const })),
      ...received.map((claim) => ({ claim, type: "received" as const })),
    ].sort((a, b) => new Date(b.claim.created_at).getTime() - new Date(a.claim.created_at).getTime());
    return list;
  }, [sent, received]);

  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allPayments;
    return allPayments.filter(({ claim, type }) => {
      const senderOrPayee = type === "sent" ? getPayeeDisplay(claim) : getSenderDisplay(claim);
      const message = (claim.description || "").toLowerCase();
      return senderOrPayee.toLowerCase().includes(q) || message.includes(q);
    });
  }, [allPayments, searchQuery]);

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <SendReceiveTabs activeTab={null} visualOnly />
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
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <SendReceiveTabs activeTab="send" visualOnly />

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-6">
          <h1 className="text-lg font-bold text-white mb-4">Payment history</h1>
          {loading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : error ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Amount sent</p>
                  <p className="text-xl font-bold text-white mt-1">${totalSent.toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Amount received</p>
                  <p className="text-xl font-bold text-white mt-1">${totalReceived.toFixed(2)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-slate-400 text-sm font-medium">Recent payments</p>
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
                    const isSuccess = String(claim.status).toUpperCase() === "SUCCESS";
                    const amount = parseFloat(claim.amount || "0");
                    const senderOrPayee = type === "sent" ? getPayeeDisplay(claim) : getSenderDisplay(claim);
                    const message = stripGifUrlsFromMessage(claim.description || "");
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
                          {message && (
                            <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10">
                              <p className="text-sm text-slate-300 line-clamp-2 italic">"{message}"</p>
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
                            <span className={`text-xs font-medium ${isSuccess ? "text-emerald-400" : "text-slate-400"}`}>
                              {isSuccess ? "Paid" : claim.status}
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
  );
}
