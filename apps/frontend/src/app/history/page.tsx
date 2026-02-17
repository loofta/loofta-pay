"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";

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
  created_by: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  description: string | null;
};

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

export default function HistoryPage() {
  const { authenticated, userId } = useAuth();
  const { login: privyLogin } = usePrivy();
  const [sent, setSent] = useState<PaymentHistoryClaim[]>([]);
  const [received, setReceived] = useState<PaymentHistoryClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || !userId) {
      setSent([]);
      setReceived([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPaymentHistory(userId)
      .then(({ sent: s, received: r }) => {
        if (!cancelled) {
          setSent(s || []);
          setReceived(r || []);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [authenticated, userId]);

  const totalSent = sent
    .filter((c) => String(c.status).toUpperCase() === "SUCCESS")
    .reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0);
  const totalReceived = received
    .filter((c) => String(c.status).toUpperCase() === "SUCCESS")
    .reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0);

  const allPayments: { claim: PaymentHistoryClaim; type: "sent" | "received" }[] = [
    ...sent.map((claim) => ({ claim, type: "sent" as const })),
    ...received.map((claim) => ({ claim, type: "received" as const })),
  ].sort((a, b) => new Date(b.claim.created_at).getTime() - new Date(a.claim.created_at).getTime());

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

              <p className="text-slate-400 text-sm font-medium mb-2">Recent payments</p>
              {allPayments.length === 0 ? (
                <p className="text-slate-500 text-sm">No payments yet.</p>
              ) : (
                <ul className="space-y-2">
                  {allPayments.map(({ claim, type }) => {
                    const isSuccess = String(claim.status).toUpperCase() === "SUCCESS";
                    const amount = parseFloat(claim.amount || "0");
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
