"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWallets } from "@privy-io/react-auth";
import Link from "next/link";

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";

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
  creator_username?: string | null;
  created_by: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  description: string | null;
  /** True when claim was created on devnet/testnet (matches deployment cluster in history API). */
  is_devnet?: boolean;
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

type Direction = "sent" | "received";

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: "Paid",
  CLAIMED: "Paid",
  PRIVATE_TRANSFER_PENDING: "Paid",
  FUNDED: "Paid",
  OPEN: "Open",
  PENDING: "Open",
  PENDING_DEPOSIT: "Open",
  IN_FLIGHT: "In progress",
  PROCESSING: "In progress",
  REFUNDED: "Refunded",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

function statusStyles(status: string): string {
  const s = String(status).toUpperCase();
  if (["SUCCESS", "CLAIMED", "PRIVATE_TRANSFER_PENDING", "FUNDED"].includes(s)) return "bg-green-100 text-green-700";
  if (["IN_FLIGHT", "PROCESSING"].includes(s)) return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-600";
}

function PaymentRow({
  claim,
  direction,
}: {
  claim: PaymentHistoryClaim;
  direction: Direction;
}) {
  const date = claim.paid_at || claim.created_at;
  const statusLabel = STATUS_LABELS[String(claim.status).toUpperCase()] ?? claim.status;
  const isSent = direction === "sent";
  const senderOrPayee = isSent ? getPayeeDisplay(claim) : getSenderDisplay(claim);
  const rawDesc = claim.description?.trim() || "";
  const gifUrlPattern = new RegExp(
    "https?:\\/\\/[^\\s]+(?:\\.gif|giphy\\.com|tenor\\.com|gfycat\\.com|media\\.giphy\\.com)[^\\s]*",
    "gi",
  );
  const whitespacePattern = new RegExp("\\s+", "g");
  const emptyStr = "";
  const singleSpace = " ";
  const message = rawDesc
    ? (rawDesc.replace(gifUrlPattern, emptyStr).replace(whitespacePattern, singleSpace).trim() || null)
    : null;

  const linkClassName =
    "flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors " +
    (isSent ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-green-400");

  return (
    <Link href={`/c/${claim.id}`} className={linkClassName}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">
            {claim.amount} {claim.to_symbol}
          </span>
          {claim.is_private && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-500">
              Private
            </span>
          )}
        </div>
        <p className="mt-1 text-base font-medium text-gray-700">
          {isSent ? "To " : "From "}{senderOrPayee}
        </p>
        {message && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
            <p className="text-base text-gray-700 line-clamp-2 italic">{'"'}{message}{'"'}</p>
          </div>
        )}
        <p className="mt-1 text-sm text-gray-400">
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
          className={`inline-block rounded-full px-2.5 py-1 text-sm font-medium ${statusStyles(claim.status)}`}
        >
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}

export default function PaymentsPage() {
  const { authenticated, userId, ready, login, getAccessToken } = useAuth();
  const { wallets } = useWallets();
  const [tab, setTab] = useState<Tab>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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

    getAccessToken().then((token) => {
      fetch(`/api/payments/history?${params.toString()}`, {
        headers: token ? { authorization: `Bearer ${token}` } : { "x-privy-user-id": userId! },
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

  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allPayments;
    return allPayments.filter(({ claim, direction }) => {
      const senderOrPayee = direction === "sent" ? getPayeeDisplay(claim) : getSenderDisplay(claim);
      const message = (claim.description || "").toLowerCase();
      return senderOrPayee.toLowerCase().includes(q) || message.includes(q);
    });
  }, [allPayments, searchQuery]);

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
      <div className="min-h-[60vh] bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Payment history
            </h1>
            <p className="mt-1 text-gray-500">
              Send and receive payments via your link.
            </p>
          </div>
          {/* Start making payments — shown when not logged in */}
          <div className="rounded-xl bg-white p-6 text-center border border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              Start making payments
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Log in to see your payment history and share your link to get paid.
            </p>
            <button
              type="button"
              onClick={() => login()}
              className="inline-block rounded-lg bg-amber-500 px-5 py-2.5 font-medium text-white hover:bg-amber-600 transition-colors"
            >
              Log in
            </button>
          </div>
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

        {/* Overview cards */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-medium text-gray-500">Received</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              ${totals.received.toFixed(2)}
            </p>
            <p className="text-sm text-gray-400">{received.length} payment(s)</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-medium text-gray-500">Sent</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              ${totals.sent.toFixed(2)}
            </p>
            <p className="text-sm text-gray-400">{sent.length} payment(s)</p>
          </div>
        </div>

        {/* Tabs and search */}
        <div className="flex items-center gap-2 mb-6">
          <div className="flex gap-1 p-1 rounded-lg bg-gray-100 flex-1">
            {(["all", "received", "sent"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
                  }`}
              >
                {t === "all" ? "All" : t === "received" ? "Received" : "Sent"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Search"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            className="w-full mb-4 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
          />
        )}

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm mb-4 border border-red-100">
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
              filteredPayments.map(({ claim, direction }) => (
                <PaymentRow key={claim.id} claim={claim} direction={direction} />
              ))}
            {tab === "received" &&
              filteredPayments
                .filter(({ direction }) => direction === "received")
                .map(({ claim }) => (
                  <PaymentRow key={claim.id} claim={claim} direction="received" />
                ))}
            {tab === "sent" &&
              filteredPayments
                .filter(({ direction }) => direction === "sent")
                .map(({ claim }) => (
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
            {hasAnyPayments && filteredPayments.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 py-8 px-4 text-center">
                <p className="text-sm text-gray-600">No payments match your search.</p>
              </div>
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
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-10 px-4 text-center">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500 max-w-xs mx-auto">{description}</p>
    </div>
  );
}
