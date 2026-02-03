"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWallets } from "@privy-io/react-auth";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";

type Tab = "all" | "received" | "sent";

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

type Direction = "sent" | "received";

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: "Paid",
  OPEN: "Open",
  PENDING_DEPOSIT: "Waiting",
  IN_FLIGHT: "In progress",
  REFUNDED: "Refunded",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

function PaymentRow({
  claim,
  direction,
}: {
  claim: PaymentHistoryClaim;
  direction: Direction;
}) {
  const date = claim.paid_at || claim.created_at;
  const statusLabel = STATUS_LABELS[String(claim.status).toUpperCase()] ?? claim.status;
  const isSuccess = claim.status === "SUCCESS";

  return (
    <Link
      href={`/c/${claim.id}`}
      className="flex items-center gap-4 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm hover:border-gray-300 hover:shadow transition-all duration-200"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">
            {claim.amount} {claim.to_symbol}
          </span>
          {claim.is_private && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Private
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-gray-500">
          {direction === "sent" ? "To " : "From "}
          {direction === "sent"
            ? `${claim.recipient_address.slice(0, 6)}...${claim.recipient_address.slice(-4)}`
            : claim.creator_email || "—"}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          {new Date(date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      <div className="shrink-0">
        <span
          className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${isSuccess ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
            }`}
        >
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}

export default function PaymentsPage() {
  const { authenticated, userId, ready, login } = useAuth();
  const { wallets } = useWallets();
  const username = useAuthStore((s) => s.username ?? null);
  const [tab, setTab] = useState<Tab>("all");
  const [sent, setSent] = useState<PaymentHistoryClaim[]>([]);
  const [received, setReceived] = useState<PaymentHistoryClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const walletAddresses = useMemo(() => {
    const list: string[] = [];
    if (!wallets) return list;
    for (const w of wallets) {
      const addr = (w as { address?: string }).address;
      if (addr) list.push(addr);
    }
    return list;
  }, [wallets]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (walletAddresses.length > 0) {
      params.set("walletAddresses", walletAddresses.join(","));
    }

    fetch(`/api/payments/history?${params.toString()}`, {
      headers: { "x-privy-user-id": userId },
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "Please log in" : "Failed to load payments");
        return res.json();
      })
      .then((data: { sent: PaymentHistoryClaim[]; received: PaymentHistoryClaim[] }) => {
        if (!cancelled) {
          setSent(data.sent || []);
          setReceived(data.received || []);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, userId, walletAddresses.join(",")]);

  const allPayments = useMemo(() => {
    const withDir = [
      ...sent.map((c) => ({ claim: c, direction: "sent" as const })),
      ...received.map((c) => ({ claim: c, direction: "received" as const })),
    ];
    withDir.sort(
      (a, b) =>
        new Date(b.claim.paid_at || b.claim.created_at).getTime() -
        new Date(a.claim.paid_at || a.claim.created_at).getTime()
    );
    return withDir;
  }, [sent, received]);

  const totals = useMemo(() => {
    const sum = (arr: PaymentHistoryClaim[]) =>
      arr
        .filter((c) => c.status === "SUCCESS")
        .reduce((acc, c) => acc + Number(c.amount) || 0, 0);
    return {
      sent: sum(sent),
      received: sum(received),
    };
  }, [sent, received]);

  if (!ready) {
    return (
      <div className="min-h-[60vh] bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="animate-pulse h-9 bg-gray-200 rounded-lg w-56 mb-8" />
          <div className="animate-pulse h-32 bg-gray-100 rounded-2xl mb-8" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-[60vh] bg-gradient-to-b from-gray-50 to-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment history</h1>
          <p className="text-gray-600 mb-8">Log in to see payments you sent and received.</p>
          <button
            type="button"
            onClick={() => login()}
            className="w-full max-w-xs mx-auto px-6 py-3.5 rounded-2xl font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-lg hover:shadow-xl transition-all"
          >
            Log in
          </button>
        </div>
      </div>
    );
  }

  const hasAnyPayments = allPayments.length > 0;

  return (
    <div className="min-h-[60vh] bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Payment history
          </h1>
          <p className="mt-1 text-gray-500">
            Payments you sent and received via your link.
          </p>
        </div>

        {/* Start making payments — onboarding-style */}
        <div className="mb-8 rounded-[24px] bg-white p-8 text-center shadow-lg border border-gray-100">
          <div className="mb-6 text-5xl">💳</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Start making payments
          </h2>
          <p className="text-base text-gray-600 mb-6">
            {username
              ? "Share your payment link so others can pay you, or open a link to pay someone."
              : "Set up your username and share your link from the account menu to get paid."}
          </p>
          {username ? (
            <Link
              href={`/link/${username}`}
              className="inline-block rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-semibold text-white shadow-md hover:from-amber-600 hover:to-orange-600 hover:shadow-lg transition-all"
            >
              Your payment link
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => useAuthStore.getState().setOpenShareModal(true)}
              className="inline-block rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-semibold text-white shadow-md hover:from-amber-600 hover:to-orange-600 hover:shadow-lg transition-all"
            >
              Share my link
            </button>
          )}
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Received</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              ${totals.received.toFixed(2)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">{received.length} payment(s)</p>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sent</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              ${totals.sent.toFixed(2)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">{sent.length} payment(s)</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-gray-100 mb-6">
          {(["all", "received", "sent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
                }`}
            >
              {t === "all" ? "All" : t === "received" ? "Received" : "Sent"}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm mb-4 border border-red-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {tab === "all" &&
              allPayments.map(({ claim, direction }) => (
                <PaymentRow key={claim.id} claim={claim} direction={direction} />
              ))}
            {tab === "received" &&
              received.map((claim) => (
                <PaymentRow key={claim.id} claim={claim} direction="received" />
              ))}
            {tab === "sent" &&
              sent.map((claim) => (
                <PaymentRow key={claim.id} claim={claim} direction="sent" />
              ))}
            {tab === "all" && !hasAnyPayments && (
              <EmptyState
                title="No payments yet"
                description="When you send or receive payments via your link, they’ll show up here. Start by sharing your payment link."
              />
            )}
            {tab === "received" && received.length === 0 && (
              <EmptyState
                title="No received payments"
                description="Payments others send to you will appear here. Share your link to get paid."
              />
            )}
            {tab === "sent" && sent.length === 0 && (
              <EmptyState
                title="No sent payments"
                description="Payments you make via payment links will appear here."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 py-12 px-6 text-center">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500 max-w-xs mx-auto">{description}</p>
    </div>
  );
}
