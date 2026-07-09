"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import {
  Loader2, RefreshCw, Shield, Search, ChevronDown, ChevronRight,
  ExternalLink, Pencil, AlertTriangle, Copy, Zap, BarChart2, SendHorizonal, Mail, AtSign,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppUser = { privy_user_id: string; username: string | null; email: string | null };

type Payment = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  sender_user_id: string | null;
  amount: number | string;
  direction: string;
  recipient_address: string | null;
  recipient_username: string | null;
  recipient_email: string | null;
  burner_address: string | null;
  status: string;
  paid_at: string | null;
  sender_tx_hash: string | null;
  sweep_tx_hash: string | null;
  description: string | null;
  from_chain: string | null;
  from_token: string | null;
  to_chain: string | null;
  to_token: string | null;
  is_devnet: boolean;
  legacy_claim_id: string | null;
  recipient_user_id: string | null;
  expires_at: string | null;
  sender_user: AppUser | null;
  recipient_user: AppUser | null;
};

type PaymentIntent = {
  id: string;
  payment_id: string;
  created_at: string;
  updated_at: string;
  quote_id: string | null;
  deposit_address: string | null;
  memo: string | null;
  deadline: string | null;
  time_estimate: number | null;
  status: string | null;
  from_chain: string | null;
  to_chain: string | null;
  paid_amount: string | null;
  last_status_payload: unknown;
};

type PaymentEvent = {
  id: number;
  payment_id: string;
  created_at: string;
  type: string;
  payload: unknown;
};

type PaymentDetail = {
  payment: Payment;
  intents: PaymentIntent[];
  events: PaymentEvent[];
  _errors: { intents: string | null; events: string | null };
};

type EditForm = {
  status: string;
  expires_at: string;
  paid_at: string;
  description: string;
  recipient_address: string;
  recipient_username: string;
  recipient_email: string;
  recipient_user_id: string;
  created_by: string;
  burner_address: string;
  sender_tx_hash: string;
  sweep_tx_hash: string;
  amount: string;
  direction: string;
  from_chain: string;
  from_token: string;
  to_chain: string;
  to_token: string;
  is_devnet: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = [
  "OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "FUNDED",
  "PRIVATE_TRANSFER_PENDING", "SUCCESS", "REFUNDED",
  "EXPIRED", "CANCELLED", "DELETED",
];

const STATUS_STYLE: Record<string, string> = {
  OPEN:                     "bg-blue-950 text-blue-300 border-blue-700",
  PENDING_DEPOSIT:          "bg-yellow-950 text-yellow-300 border-yellow-700",
  IN_FLIGHT:                "bg-orange-950 text-orange-300 border-orange-700",
  FUNDED:                   "bg-purple-950 text-purple-300 border-purple-700",
  PRIVATE_TRANSFER_PENDING: "bg-violet-950 text-violet-300 border-violet-700",
  SUCCESS:                  "bg-green-950 text-green-300 border-green-700",
  REFUNDED:                 "bg-amber-950 text-amber-300 border-amber-700",
  EXPIRED:                  "bg-gray-800 text-gray-400 border-gray-600",
  CANCELLED:                "bg-gray-800 text-gray-400 border-gray-600",
  DELETED:                  "bg-red-950 text-red-400 border-red-800",
};

const LIMIT = 50;
const WAITLIST_LIMIT = 25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

function fmtFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function trunc(s: string | null | undefined, n = 10): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  // Slice to "YYYY-MM-DDTHH:MM" for datetime-local input
  return new Date(iso).toISOString().slice(0, 16);
}

function solscanUrl(hash: string, isDevnet: boolean): string {
  const base = `https://solscan.io/tx/${hash}`;
  return isDevnet ? `${base}?cluster=devnet` : base;
}

function txUrl(hash: string | null, chain: string | null, isDevnet: boolean): string {
  if (!hash) return "#";
  const c = (chain ?? "solana").toLowerCase();
  if (c === "solana" || c === "sol") return solscanUrl(hash, isDevnet);
  return getExplorerTxUrl(c, hash);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        toast({ title: "Copied", description: trunc(value, 40) });
      }}
      className="ml-1 text-gray-600 hover:text-gray-300 transition-colors"
      title="Copy"
    >
      <Copy className="w-3 h-3 inline" />
    </button>
  );
}

function TxCell({ hash, chain, isDevnet }: { hash: string | null; chain: string | null; isDevnet: boolean }) {
  if (!hash) return <span className="text-gray-600">—</span>;
  const url = txUrl(hash, chain, isDevnet);
  return (
    <span className="inline-flex items-center gap-0.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-blue-400 hover:text-blue-200 hover:underline"
        title={hash}
      >
        {trunc(hash, 10)}
      </a>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <ExternalLink className="w-2.5 h-2.5 text-gray-500 hover:text-gray-300" />
      </a>
      <CopyButton value={hash} />
    </span>
  );
}

function UserChip({ user, privyId }: { user: AppUser | null; privyId: string | null }) {
  if (!privyId) return <span className="text-gray-600 text-sm md:text-xs">anon</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm md:text-xs">
      {user ? (
        <span>
          {user.username && <span className="text-white font-medium">@{user.username}</span>}
          {!user.username && user.email && <span className="text-gray-300">{trunc(user.email, 18)}</span>}
          {!user.username && !user.email && <span className="font-mono text-gray-400">{trunc(privyId, 14)}</span>}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-gray-500">{trunc(privyId, 10)}</span>
          <span className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] rounded border border-orange-700 bg-orange-950 text-orange-400">
            <AlertTriangle className="w-2 h-2" />unreg
          </span>
        </span>
      )}
    </span>
  );
}

function SortableHeader({ col, label, sortCol, sortDir, onSort }: {
  col: string; label: string; sortCol: string; sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const active = sortCol === col;
  return (
    <th className="px-4 py-2.5 cursor-pointer select-none hover:text-gray-200" onClick={() => onSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? "text-blue-400" : "text-gray-700"}>
          {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </span>
    </th>
  );
}

function RecipientCell({ p }: { p: Payment }) {
  const hasUserIdButNoProfile = p.recipient_user_id && !p.recipient_user;
  return (
    <span className="inline-flex items-center gap-1 text-sm md:text-xs">
      {p.recipient_username && <span className="text-white font-medium">@{p.recipient_username}</span>}
      {!p.recipient_username && p.recipient_email && (
        <span className="text-gray-300">{trunc(p.recipient_email, 18)}</span>
      )}
      {!p.recipient_username && !p.recipient_email && p.recipient_address && (
        <span className="font-mono text-gray-400">{trunc(p.recipient_address, 12)}</span>
      )}
      {!p.recipient_username && !p.recipient_email && !p.recipient_address && (
        <span className="text-gray-600">—</span>
      )}
      {hasUserIdButNoProfile && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] rounded border border-orange-700 bg-orange-950 text-orange-400">
          <AlertTriangle className="w-2 h-2" />unreg
        </span>
      )}
    </span>
  );
}

// ─── Expanded detail panel ────────────────────────────────────────────────────

function DetailPanel({ detail, onCopy }: { detail: PaymentDetail; onCopy: (s: string) => void }) {
  const { payment: p, intents, events, _errors } = detail;

  const rawFields: [string, string | number | boolean | null | undefined][] = [
    ["id",                    p.id],
    ["created_at",            p.created_at],
    ["updated_at",            p.updated_at],
    ["created_by",            p.created_by],
    ["sender_user_id",        p.sender_user_id],
    ["amount",                String(p.amount)],
    ["direction",             p.direction],
    ["recipient_address",     p.recipient_address],
    ["recipient_username",    p.recipient_username],
    ["recipient_email",       p.recipient_email],
    ["recipient_user_id",     p.recipient_user_id],
    ["burner_address",        p.burner_address],
    ["status",                p.status],
    ["paid_at",               p.paid_at],
    ["expires_at",            p.expires_at],
    ["sender_tx_hash",        p.sender_tx_hash],
    ["sweep_tx_hash",         p.sweep_tx_hash],
    ["description",           p.description],
    ["from_chain",            p.from_chain],
    ["from_token",            p.from_token],
    ["to_chain",              p.to_chain],
    ["to_token",              p.to_token],
    ["is_devnet",             String(p.is_devnet)],
    ["legacy_claim_id",       p.legacy_claim_id],
  ];

  return (
    <div className="space-y-5 p-1">
      {/* All fields */}
      <section>
        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">All fields</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
          {rawFields.map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <span className="text-gray-500 text-sm md:text-xs w-40 shrink-0">{k}</span>
              <span
                className="font-mono text-sm md:text-xs text-gray-300 break-all cursor-pointer hover:text-white"
                onClick={() => v != null && onCopy(String(v))}
                title="Click to copy"
              >
                {v == null ? <span className="text-gray-700">null</span> : String(v)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* User profiles */}
      {(p.sender_user || p.recipient_user) && (
        <section>
          <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">User profiles</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {p.sender_user && (
              <div className="bg-gray-800 rounded p-3">
                <div className="text-[9px] text-gray-500 uppercase mb-1">Sender</div>
                <div className="font-mono text-sm md:text-xs space-y-0.5 text-gray-300">
                  <div>@{p.sender_user.username ?? <span className="text-gray-600">no username</span>}</div>
                  <div>{p.sender_user.email ?? <span className="text-gray-600">no email</span>}</div>
                  <div className="text-gray-500 text-[10px] break-all">{p.sender_user.privy_user_id}</div>
                </div>
              </div>
            )}
            {p.recipient_user && (
              <div className="bg-gray-800 rounded p-3">
                <div className="text-[9px] text-gray-500 uppercase mb-1">Recipient</div>
                <div className="font-mono text-sm md:text-xs space-y-0.5 text-gray-300">
                  <div>@{p.recipient_user.username ?? <span className="text-gray-600">no username</span>}</div>
                  <div>{p.recipient_user.email ?? <span className="text-gray-600">no email</span>}</div>
                  <div className="text-gray-500 text-[10px] break-all">{p.recipient_user.privy_user_id}</div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Payment intents */}
      {intents.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Payment intents ({intents.length})
            {_errors.intents && <span className="text-red-400 ml-2">{_errors.intents}</span>}
          </h4>
          <div className="space-y-2">
            {intents.map((intent) => (
              <div key={intent.id} className="bg-gray-800 rounded p-3 font-mono text-sm md:text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">{trunc(intent.id, 16)}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
                    intent.status === "SUCCESS"
                      ? "bg-green-950 text-green-300 border-green-700"
                      : "bg-gray-700 text-gray-400 border-gray-600"
                  }`}>
                    {intent.status ?? "—"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-400">
                  <span>deposit_address <span className="text-gray-200">{trunc(intent.deposit_address, 14)}</span></span>
                  <span>deadline <span className="text-gray-200">{fmtShort(intent.deadline)}</span></span>
                  <span>paid_amount <span className="text-gray-200">{intent.paid_amount ?? "—"}</span></span>
                  <span>chains <span className="text-gray-200">{intent.from_chain ?? "?"} → {intent.to_chain ?? "?"}</span></span>
                  <span>time_estimate <span className="text-gray-200">{intent.time_estimate ?? "—"}s</span></span>
                  <span>quote_id <span className="text-gray-200">{trunc(intent.quote_id, 12)}</span></span>
                </div>
                {intent.memo && (
                  <div className="mt-1 text-gray-500">memo <span className="text-gray-300">{intent.memo}</span></div>
                )}
                {intent.last_status_payload != null && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-300">last_status_payload ▸</summary>
                    <pre className="mt-1 text-[10px] text-gray-400 bg-gray-900 rounded p-2 overflow-auto max-h-48">
                      {JSON.stringify(intent.last_status_payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Payment events */}
      {events.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Events ({events.length})
            {_errors.events && <span className="text-red-400 ml-2">{_errors.events}</span>}
          </h4>
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {events.map((ev) => (
              <div key={ev.id} className="bg-gray-800 rounded p-2 text-sm md:text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 font-mono text-[10px]">{fmtFull(ev.created_at)}</span>
                  <span className="font-semibold text-blue-400">{ev.type}</span>
                </div>
                {ev.payload != null && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-300 font-mono text-[10px]">payload ▸</summary>
                    <pre className="mt-1 text-[10px] text-gray-400 bg-gray-900 rounded p-2 overflow-auto max-h-40">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {intents.length === 0 && events.length === 0 && (
        <p className="text-gray-600 text-sm md:text-xs">No intents or events recorded.</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { authenticated, userId, login, ready } = useAuth();
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const pathname = usePathname(); // /app/[adminHash]
  const outreachUrl = `${pathname}/outreach`;

  // Auth
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Filters — applied state triggers fetch
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [devnetFilter, setDevnetFilter] = useState<"all" | "devnet" | "mainnet">("devnet");
  const [statusFilter, setStatusFilter] = useState("all");

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<PaymentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<Payment | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    status: "", expires_at: "", paid_at: "", description: "",
    recipient_address: "", recipient_username: "", recipient_email: "",
    recipient_user_id: "", created_by: "", burner_address: "",
    sender_tx_hash: "", sweep_tx_hash: "", amount: "",
    direction: "", from_chain: "", from_token: "", to_chain: "", to_token: "",
    is_devnet: false,
  });
  const [saving, setSaving] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<"payments" | "sparks" | "waitlist" | "analytics" | "blink" | "cashout" | "lottery">("payments");

  // Sparks leaderboard
  const [sparksData, setSparksData] = useState<any[]>([]);
  const [sparksLoading, setSparksLoading] = useState(false);
  const [sparksLoaded, setSparksLoaded] = useState(false);
  const [sparksSearch, setSparksSearch] = useState("");

  // Blink campaign
  const [blinkData, setBlinkData] = useState<any[]>([]);
  const [blinkLoading, setBlinkLoading] = useState(false);
  const [blinkLoaded, setBlinkLoaded] = useState(false);
  const [blinkSearch, setBlinkSearch] = useState("");

  // Waitlist
  const [waitlistData, setWaitlistData] = useState<any[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistLoaded, setWaitlistLoaded] = useState(false);
  const [waitlistTotal, setWaitlistTotal] = useState(0);
  const [waitlistPage, setWaitlistPage] = useState(1);
  const [waitlistSearchInput, setWaitlistSearchInput] = useState("");
  const [waitlistSearch, setWaitlistSearch] = useState("");
  const [waitlistAccessFilter, setWaitlistAccessFilter] = useState<"all" | "granted" | "not_granted">("all");
  const [waitlistSortCol, setWaitlistSortCol] = useState("created_at");
  const [waitlistSortDir, setWaitlistSortDir] = useState<"asc" | "desc">("desc");
  const [grantingAccess, setGrantingAccess] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [grantEmailInput, setGrantEmailInput] = useState("");
  const [grantingByEmail, setGrantingByEmail] = useState(false);
  const [grantTwitterInput, setGrantTwitterInput] = useState("");
  const [grantingByTwitter, setGrantingByTwitter] = useState(false);

  // Cash Out (Peer offramp)
  const [cashoutData, setCashoutData] = useState<any[]>([]);
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const [cashoutLoaded, setCashoutLoaded] = useState(false);
  const [cashoutTotal, setCashoutTotal] = useState(0);
  const [cashoutPage, setCashoutPage] = useState(1);
  const [cashoutStatusFilter, setCashoutStatusFilter] = useState("");

  const [lotteryData, setLotteryData] = useState<any[]>([]);
  const [lotteryLoading, setLotteryLoading] = useState(false);
  const [lotteryLoaded, setLotteryLoaded] = useState(false);
  const [lotteryTotal, setLotteryTotal] = useState(0);
  const [lotteryPage, setLotteryPage] = useState(1);
  const [lotteryStatusFilter, setLotteryStatusFilter] = useState("");

  // Gift a Megapot ticket — one field accepts an email, X handle, or Loofta username, same as Send
  const [giftIdentifierInput, setGiftIdentifierInput] = useState("");
  const [giftNumTicketsInput, setGiftNumTicketsInput] = useState("1");
  const [giftNoteInput, setGiftNoteInput] = useState("");
  const [gifting, setGifting] = useState(false);
  const [lastGiftLink, setLastGiftLink] = useState<string | null>(null);
  const [giftsData, setGiftsData] = useState<any[]>([]);
  const [giftsLoading, setGiftsLoading] = useState(false);
  const [giftsLoaded, setGiftsLoaded] = useState(false);
  const [giftsTotal, setGiftsTotal] = useState(0);
  const [giftsPage, setGiftsPage] = useState(1);

  // Megapot referral fees — read-only balance; claiming is manual (see AdminDashboard UI note)
  const [referralFeesBalance, setReferralFeesBalance] = useState<number | null>(null);
  const [referralFeesLoading, setReferralFeesLoading] = useState(false);
  const [referralFeesLoaded, setReferralFeesLoaded] = useState(false);
  const [referralFeesWallet, setReferralFeesWallet] = useState<string | null>(null);
  const [referralFeesBasescanUrl, setReferralFeesBasescanUrl] = useState<string | null>(null);

  // Analytics
  type AnalyticsData = {
    volume_devnet: number;
    volume_mainnet: number;
    volume_devnet_total: number;
    volume_mainnet_total: number;
    tx_devnet_success: number;
    tx_mainnet_success: number;
    tx_devnet_total: number;
    tx_mainnet_total: number;
    total_users: number;
    users_with_email: number;
    waitlist_total: number;
    waitlist_granted: number;
    waitlist_with_twitter: number;
    volume_lottery: number;
    tx_lottery_count: number;
    volume_deposits: number;
    tx_deposits_count: number;
    volume_withdrawals_devnet: number;
    volume_withdrawals_mainnet: number;
    tx_withdrawals_devnet_count: number;
    tx_withdrawals_mainnet_count: number;
    volume_total_all: number;
  };
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

  // Keep userId stable in callbacks via ref
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Resizable columns for payments table (11 data columns, indices 0–10)
  const [colWidths, setColWidths] = useState([110, 80, 140, 150, 90, 120, 140, 55, 110, 90, 90]);
  const resizeRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { colIdx, startX, startW } = resizeRef.current;
      setColWidths(prev => {
        const next = [...prev];
        next[colIdx] = Math.max(50, startW + e.clientX - startX);
        return next;
      });
    };
    const onUp = () => { resizeRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !authenticated || !userId) {
      setCheckingAuth(false);
      return;
    }
    authHeaders()
      .then((headers) => fetch("/api/admin/check", { headers }))
      .then((r) => r.json())
      .then((d) => setIsAuthorized(d.isAdmin ?? false))
      .catch(() => setIsAuthorized(false))
      .finally(() => setCheckingAuth(false));
  }, [ready, authenticated, userId, authHeaders]);

  // ── Fetch payments ──────────────────────────────────────────────────────────
  const fetchPayments = useCallback(async (
    page: number,
    opts: { search: string; devnet: "all" | "devnet" | "mainnet"; status: string },
  ) => {
    if (!userIdRef.current) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (opts.search) qs.set("search", opts.search);
      if (opts.devnet !== "all") qs.set("devnet", opts.devnet === "devnet" ? "true" : "false");
      if (opts.status !== "all") qs.set("status", opts.status);

      const res = await fetch(`/api/admin/payments?${qs}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPayments(data.payments ?? []);
      setTotal(data.total ?? 0);
      setCurrentPage(page);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Load failed", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [toast, authHeaders]);

  // Auto-fetch on filter change (but NOT on search input change — only on applied search)
  useEffect(() => {
    if (isAuthorized) {
      fetchPayments(1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter });
    }
  }, [isAuthorized, appliedSearch, devnetFilter, statusFilter, fetchPayments]);

  const applySearch = () => setAppliedSearch(searchInput);
  const refresh = () => fetchPayments(currentPage, { search: appliedSearch, devnet: devnetFilter, status: statusFilter });

  const fetchSparks = useCallback(async () => {
    setSparksLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/rewards", { headers });
      if (!res.ok) throw new Error("Failed to load");
      setSparksData(await res.json());
      setSparksLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Sparks" });
    } finally {
      setSparksLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchBlink = useCallback(async () => {
    setBlinkLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/blink-campaign", { headers });
      if (!res.ok) throw new Error("Failed to load");
      setBlinkData(await res.json());
      setBlinkLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Blink campaign data" });
    } finally {
      setBlinkLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchWaitlist = useCallback(async (
    page = 1,
    opts: { search: string; access: string; sortCol: string; sortDir: "asc" | "desc" } = { search: "", access: "all", sortCol: "created_at", sortDir: "desc" },
  ) => {
    setWaitlistLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page), limit: String(WAITLIST_LIMIT) });
      if (opts.search) qs.set("search", opts.search);
      if (opts.access !== "all") qs.set("access", opts.access);
      qs.set("sort_col", opts.sortCol);
      qs.set("sort_dir", opts.sortDir);
      const res = await fetch(`/api/admin/waitlist?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setWaitlistData(data.entries ?? []);
      setWaitlistTotal(data.total ?? 0);
      setWaitlistPage(page);
      setWaitlistLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load waitlist" });
    } finally {
      setWaitlistLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/analytics", { headers });
      if (!res.ok) throw new Error("Failed to load analytics");
      setAnalyticsData(await res.json());
      setAnalyticsLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load analytics" });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchCashOuts = useCallback(async (page = 1, status = "") => {
    setCashoutLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/admin/offramp?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load cash outs");
      const data = await res.json();
      setCashoutData(data.data ?? []);
      setCashoutTotal(data.total ?? 0);
      setCashoutPage(page);
      setCashoutLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load cash outs" });
    } finally {
      setCashoutLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchLottery = useCallback(async (page = 1, status = "") => {
    setLotteryLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/admin/lottery?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load lottery tickets");
      const data = await res.json();
      setLotteryData(data.data ?? []);
      setLotteryTotal(data.total ?? 0);
      setLotteryPage(page);
      setLotteryLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load lottery tickets" });
    } finally {
      setLotteryLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchGifts = useCallback(async (page = 1) => {
    setGiftsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/lottery/gifts?page=${page}`, { headers });
      if (!res.ok) throw new Error("Failed to load gifts");
      const data = await res.json();
      setGiftsData(data.data ?? []);
      setGiftsTotal(data.total ?? 0);
      setGiftsPage(page);
      setGiftsLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load gifts" });
    } finally {
      setGiftsLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchReferralFees = useCallback(async () => {
    setReferralFeesLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/lottery/referral-fees", { headers });
      if (!res.ok) throw new Error("Failed to load referral fees");
      const data = await res.json();
      setReferralFeesBalance(data.balanceUsdc ?? 0);
      setReferralFeesWallet(data.referrerWallet ?? null);
      setReferralFeesBasescanUrl(data.basescanWriteUrl ?? null);
      setReferralFeesLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load referral fees" });
    } finally {
      setReferralFeesLoading(false);
    }
  }, [authHeaders, toast]);

  const createGiftTicket = useCallback(async () => {
    const recipientIdentifier = giftIdentifierInput.trim().replace(/^@+/, "");
    const numTickets = parseInt(giftNumTicketsInput, 10);
    if (!recipientIdentifier || !numTickets || numTickets < 1 || numTickets > 100) return;
    const recipientType = recipientIdentifier.includes("@") && recipientIdentifier.includes(".") ? "email" : "handle";
    setGifting(true);
    try {
      const res = await fetch("/api/admin/lottery/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          recipientType,
          recipientIdentifier,
          numTickets,
          note: giftNoteInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed");
      }
      const data = await res.json();
      setLastGiftLink(data.claimUrl);
      toast({ title: `Gifted ${numTickets} ticket${numTickets === 1 ? "" : "s"} to ${recipientIdentifier}` });
      setGiftIdentifierInput("");
      setGiftNoteInput("");
      setGiftNumTicketsInput("1");
      fetchGifts(1);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to create gift", description: err.message });
    } finally {
      setGifting(false);
    }
  }, [giftIdentifierInput, giftNumTicketsInput, giftNoteInput, authHeaders, toast, fetchGifts]);

  // ── Grant access by email ────────────────────────────────────────────────────
  const grantAccessByEmail = useCallback(async () => {
    const email = grantEmailInput.trim();
    if (!email) return;
    setGrantingByEmail(true);
    try {
      const res = await fetch("/api/admin/waitlist/grant-by-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed");
      }
      toast({ title: `Mainnet access granted to ${email}` });
      setGrantEmailInput("");
      fetchWaitlist(waitlistPage, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally {
      setGrantingByEmail(false);
    }
  }, [grantEmailInput, authHeaders, toast, fetchWaitlist, waitlistPage, waitlistSearch, waitlistAccessFilter, waitlistSortCol, waitlistSortDir]);

  // ── Grant access by Twitter username ────────────────────────────────────────
  const grantAccessByTwitter = useCallback(async () => {
    const handle = grantTwitterInput.trim().replace(/^@/, "");
    if (!handle) return;
    setGrantingByTwitter(true);
    try {
      const res = await fetch("/api/admin/waitlist/grant-by-twitter", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ twitterUsername: handle }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed");
      }
      toast({ title: `Mainnet access granted to @${handle}` });
      setGrantTwitterInput("");
      fetchWaitlist(waitlistPage, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally {
      setGrantingByTwitter(false);
    }
  }, [grantTwitterInput, authHeaders, toast, fetchWaitlist, waitlistPage, waitlistSearch, waitlistAccessFilter, waitlistSortCol, waitlistSortDir]);

  // ── Grant / revoke mainnet access ───────────────────────────────────────────
  const grantWaitlistAccess = useCallback(async (id: string, grant: boolean) => {
    setGrantingAccess(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ grant }),
      });
      if (!res.ok) throw new Error(await res.text());
      setWaitlistData((prev) =>
        prev.map((e) => (e.id === id ? { ...e, mainnet_access: grant } : e))
      );
      toast({ title: grant ? "Mainnet access granted" : "Mainnet access revoked" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally {
      setGrantingAccess(null);
    }
  }, [authHeaders, toast]);

  // ── Resend beta access email ─────────────────────────────────────────────────
  const resendBetaEmail = useCallback(async (id: string) => {
    setResendingEmail(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Beta access email resent" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to resend", description: err.message });
    } finally {
      setResendingEmail(null);
    }
  }, [authHeaders, toast]);

  // ── Waitlist sort ────────────────────────────────────────────────────────────
  const handleWaitlistSort = (col: string) => {
    if (waitlistSortCol === col) {
      const next = waitlistSortDir === "asc" ? "desc" : "asc";
      setWaitlistSortDir(next);
      fetchWaitlist(1, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: col, sortDir: next });
    } else {
      setWaitlistSortCol(col);
      setWaitlistSortDir("desc");
      fetchWaitlist(1, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: col, sortDir: "desc" });
    }
  };

  const applyWaitlistSearch = () => {
    setWaitlistSearch(waitlistSearchInput);
    fetchWaitlist(1, { search: waitlistSearchInput, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
  };

  // ── Expand row ──────────────────────────────────────────────────────────────
  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setExpandedDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/payments/${id}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      setExpandedDetail(await res.json());
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load details", description: err.message });
    } finally {
      setLoadingDetail(false);
    }
  }, [expandedId, toast]);

  // ── Edit modal ──────────────────────────────────────────────────────────────
  const openEdit = (p: Payment, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTarget(p);
    setEditForm({
      status:             p.status,
      expires_at:         toLocalDatetime(p.expires_at),
      paid_at:            toLocalDatetime(p.paid_at),
      description:        p.description ?? "",
      recipient_address:  p.recipient_address ?? "",
      recipient_username: p.recipient_username ?? "",
      recipient_email:    p.recipient_email ?? "",
      recipient_user_id:  p.recipient_user_id ?? "",
      created_by:         p.created_by ?? "",
      burner_address:     p.burner_address ?? "",
      sender_tx_hash:     p.sender_tx_hash ?? "",
      sweep_tx_hash:      p.sweep_tx_hash ?? "",
      amount:             String(p.amount ?? ""),
      direction:          p.direction ?? "",
      from_chain:         p.from_chain ?? "",
      from_token:         p.from_token ?? "",
      to_chain:           p.to_chain ?? "",
      to_token:           p.to_token ?? "",
      is_devnet:          p.is_devnet,
    });
  };

  const saveEdit = async () => {
    if (!editTarget || !userIdRef.current) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (editForm.status !== editTarget.status) body.status = editForm.status;
      const newExpiry = editForm.expires_at ? new Date(editForm.expires_at).toISOString() : null;
      if (newExpiry !== editTarget.expires_at) body.expires_at = newExpiry;
      const newPaidAt = editForm.paid_at ? new Date(editForm.paid_at).toISOString() : null;
      if (newPaidAt !== editTarget.paid_at) body.paid_at = newPaidAt;
      if (editForm.description !== (editTarget.description ?? "")) body.description = editForm.description || null;
      if (editForm.recipient_address  !== (editTarget.recipient_address  ?? "")) body.recipient_address  = editForm.recipient_address  || null;
      if (editForm.recipient_username !== (editTarget.recipient_username ?? "")) body.recipient_username = editForm.recipient_username || null;
      if (editForm.recipient_email    !== (editTarget.recipient_email    ?? "")) body.recipient_email    = editForm.recipient_email    || null;
      if (editForm.recipient_user_id  !== (editTarget.recipient_user_id  ?? "")) body.recipient_user_id  = editForm.recipient_user_id  || null;
      if (editForm.created_by         !== (editTarget.created_by         ?? "")) body.created_by         = editForm.created_by         || null;
      if (editForm.burner_address     !== (editTarget.burner_address     ?? "")) body.burner_address     = editForm.burner_address     || null;
      if (editForm.sender_tx_hash     !== (editTarget.sender_tx_hash     ?? "")) body.sender_tx_hash     = editForm.sender_tx_hash     || null;
      if (editForm.sweep_tx_hash      !== (editTarget.sweep_tx_hash      ?? "")) body.sweep_tx_hash      = editForm.sweep_tx_hash      || null;
      if (editForm.direction          !== (editTarget.direction          ?? "")) body.direction          = editForm.direction          || null;
      if (editForm.from_chain         !== (editTarget.from_chain         ?? "")) body.from_chain         = editForm.from_chain         || null;
      if (editForm.from_token         !== (editTarget.from_token         ?? "")) body.from_token         = editForm.from_token         || null;
      if (editForm.to_chain           !== (editTarget.to_chain           ?? "")) body.to_chain           = editForm.to_chain           || null;
      if (editForm.to_token           !== (editTarget.to_token           ?? "")) body.to_token           = editForm.to_token           || null;
      if (editForm.is_devnet !== editTarget.is_devnet) body.is_devnet = editForm.is_devnet;
      const newAmount = parseFloat(editForm.amount);
      if (!isNaN(newAmount) && newAmount !== Number(editTarget.amount)) body.amount = newAmount;
      if (Object.keys(body).length === 0) {
        toast({ title: "No changes" });
        setEditTarget(null);
        return;
      }
      const res = await fetch(`/api/admin/payments/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Saved" });
      setEditTarget(null);
      // Refresh the expanded detail too if open
      if (expandedId === editTarget.id) {
        setExpandedDetail(null);
        setLoadingDetail(true);
        authHeaders().then((h) =>
          fetch(`/api/admin/payments/${editTarget.id}`, { headers: h })
        ).then((r) => r.json()).then(setExpandedDetail).finally(() => setLoadingDetail(false));
      }
      refresh();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const copyText = (s: string) => {
    navigator.clipboard.writeText(s);
    toast({ title: "Copied", description: trunc(s, 40) });
  };

  // ── Auth states ─────────────────────────────────────────────────────────────
  if (!ready || checkingAuth || (authenticated && !userId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f12]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  if (!authenticated || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f12]">
        <div className="text-center space-y-4 text-gray-100">
          <Shield className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          {!authenticated ? (
            <Button onClick={login}>Log In</Button>
          ) : (
            <p className="text-base md:text-sm text-gray-500">Not authorized. UID: {userId}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Stats ───────────────────────────────────────────────────────────────────
  const statusCounts: Record<string, number> = {};
  for (const p of payments) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  }
  const totalPages = Math.ceil(total / LIMIT);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f0f12] text-gray-100 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="font-bold text-base">Loofta Admin</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={
            activeTab === "payments" ? refresh :
            activeTab === "sparks" ? fetchSparks :
            activeTab === "blink" ? fetchBlink :
            activeTab === "analytics" ? fetchAnalytics :
            activeTab === "cashout" ? () => fetchCashOuts(cashoutPage, cashoutStatusFilter) :
            activeTab === "lottery" ? () => { fetchLottery(lotteryPage, lotteryStatusFilter); fetchGifts(giftsPage); fetchReferralFees(); } :
            () => fetchWaitlist(waitlistPage, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir })
          }
          disabled={loading || sparksLoading || waitlistLoading || analyticsLoading || blinkLoading || cashoutLoading || lotteryLoading}
          className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
        >
          {(loading || sparksLoading || waitlistLoading || blinkLoading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-800">
        <button
          type="button"
          onClick={() => setActiveTab("payments")}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors ${activeTab === "payments" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Payments
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("sparks"); if (!sparksLoaded) fetchSparks(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "sparks" ? "border-amber-500 text-amber-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <Zap className="w-3.5 h-3.5" />
          Sparks
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("blink"); if (!blinkLoaded) fetchBlink(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "blink" ? "border-cyan-500 text-cyan-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Blink Campaign
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("waitlist"); if (!waitlistLoaded) fetchWaitlist(1, { search: "", access: "all", sortCol: "created_at", sortDir: "desc" }); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "waitlist" ? "border-green-500 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Waitlist
          {waitlistLoaded && <span className="text-sm md:text-xs bg-green-900/50 text-green-400 rounded px-1.5 py-0.5">{waitlistTotal}</span>}
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("analytics"); if (!analyticsLoaded) fetchAnalytics(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "analytics" ? "border-purple-500 text-purple-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Analytics
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("cashout"); if (!cashoutLoaded) fetchCashOuts(1, ""); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "cashout" ? "border-orange-500 text-orange-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Cash Out
          {cashoutLoaded && <span className="text-sm md:text-xs bg-orange-900/50 text-orange-400 rounded px-1.5 py-0.5">{cashoutTotal}</span>}
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("lottery"); if (!lotteryLoaded) fetchLottery(1, ""); if (!giftsLoaded) fetchGifts(1); if (!referralFeesLoaded) fetchReferralFees(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "lottery" ? "border-teal-500 text-teal-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Lottery Tickets
          {lotteryLoaded && <span className="text-sm md:text-xs bg-teal-900/50 text-teal-400 rounded px-1.5 py-0.5">{lotteryTotal}</span>}
        </button>
        <Link
          href={outreachUrl}
          className="px-4 py-2 text-base md:text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-orange-400 hover:border-orange-500/50 transition-colors flex items-center gap-1.5 ml-auto"
        >
          <SendHorizonal className="w-3.5 h-3.5" />
          Outreach
        </Link>
      </div>

      {/* ── Waitlist tab ── */}
      {activeTab === "waitlist" && (
        <div className="space-y-3">

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-500 pointer-events-none" />
              <Input
                placeholder="Search email, name, privy ID, telegram, twitter…"
                value={waitlistSearchInput}
                onChange={(e) => setWaitlistSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyWaitlistSearch()}
                className="pl-9 bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm"
              />
            </div>
            <Select value={waitlistAccessFilter} onValueChange={(v: "all" | "granted" | "not_granted") => {
              setWaitlistAccessFilter(v);
              fetchWaitlist(1, { search: waitlistSearch, access: v, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
            }}>
              <SelectTrigger className="w-40 bg-gray-900 border-gray-700 text-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
                <SelectItem value="all">All entries</SelectItem>
                <SelectItem value="granted">Access granted</SelectItem>
                <SelectItem value="not_granted">Not granted</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={applyWaitlistSearch} className="bg-blue-700 hover:bg-blue-600 text-white">
              Search
            </Button>
          </div>

          {/* Grant by email */}
          <div className="flex gap-2">
            <Input
              placeholder="Grant mainnet access by email address…"
              value={grantEmailInput}
              onChange={(e) => setGrantEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && grantAccessByEmail()}
              className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm flex-1"
            />
            <Button
              size="sm"
              onClick={grantAccessByEmail}
              disabled={grantingByEmail || !grantEmailInput.trim()}
              className="bg-green-700 hover:bg-green-600 text-white shrink-0"
            >
              {grantingByEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant Access"}
            </Button>
          </div>

          {/* Grant by Twitter username */}
          <div className="flex gap-2">
            <Input
              placeholder="Grant mainnet access by Twitter username (e.g. @handle)…"
              value={grantTwitterInput}
              onChange={(e) => setGrantTwitterInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && grantAccessByTwitter()}
              className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm flex-1"
            />
            <Button
              size="sm"
              onClick={grantAccessByTwitter}
              disabled={grantingByTwitter || !grantTwitterInput.trim()}
              className="bg-sky-700 hover:bg-sky-600 text-white shrink-0"
            >
              {grantingByTwitter ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant Access"}
            </Button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            {waitlistLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
              </div>
            )}
            {!waitlistLoading && waitlistLoaded && (
              <table className="w-full text-sm md:text-xs text-gray-300">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-500 uppercase tracking-wider text-left text-[10px]">
                    <th className="px-4 py-2.5">#</th>
                    <SortableHeader col="display_name" label="Name" sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort} />
                    <SortableHeader col="email" label="Email" sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort} />
                    <th className="px-4 py-2.5">Telegram</th>
                    <th className="px-4 py-2.5">Twitter</th>
                    <SortableHeader col="occupation" label="Occupation" sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort} />
                    <SortableHeader col="payment_volume" label="Volume" sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort} />
                    <th className="px-4 py-2.5">Rails</th>
                    <th className="px-4 py-2.5">Privy ID</th>
                    <SortableHeader col="created_at" label="Applied" sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort} />
                    <SortableHeader col="mainnet_access" label="Mainnet" sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort} />
                  </tr>
                </thead>
                <tbody>
                  {waitlistData.map((e: any, i: number) => (
                    <tr key={e.id} className="border-b border-gray-800/60 hover:bg-gray-900/50">
                      <td className="px-4 py-2.5 text-gray-600 tabular-nums">{(waitlistPage - 1) * WAITLIST_LIMIT + i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-white">{e.display_name || "—"}</td>
                      <td className="px-4 py-2.5">{e.email || "—"}</td>
                      <td className="px-4 py-2.5">{e.telegram_handle || "—"}</td>
                      <td className="px-4 py-2.5">{e.twitter_username || "—"}</td>
                      <td className="px-4 py-2.5">{e.occupation || "—"}</td>
                      <td className="px-4 py-2.5">{e.payment_volume || "—"}</td>
                      <td className="px-4 py-2.5 max-w-[140px] truncate">{Array.isArray(e.withdrawal_rails) ? e.withdrawal_rails.join(", ") : (e.withdrawal_rails || "—")}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-500 max-w-[120px] truncate" title={e.privy_user_id}>{e.privy_user_id || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {e.mainnet_access ? (
                            <button
                              type="button"
                              disabled={grantingAccess === e.id}
                              onClick={() => grantWaitlistAccess(e.id, false)}
                              className="group px-2.5 py-1 rounded-full text-sm md:text-xs font-medium transition-colors disabled:opacity-50 bg-green-900/60 text-green-400 hover:bg-red-900/60 hover:text-red-400"
                            >
                              {grantingAccess === e.id ? "…" : <><span className="group-hover:hidden">Granted</span><span className="hidden group-hover:inline">Revoke</span></>}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={grantingAccess === e.id}
                              onClick={() => grantWaitlistAccess(e.id, true)}
                              className="px-2.5 py-1 rounded-full text-sm md:text-xs font-medium transition-colors disabled:opacity-50 bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
                            >
                              {grantingAccess === e.id ? "…" : "Grant"}
                            </button>
                          )}
                          {e.mainnet_access && e.email && (
                            <button
                              type="button"
                              disabled={resendingEmail === e.id}
                              onClick={() => resendBetaEmail(e.id)}
                              className="px-2.5 py-1 rounded-full text-sm md:text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors disabled:opacity-50"
                              title="Resend beta access email"
                            >
                              {resendingEmail === e.id ? "…" : "✉︎"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {waitlistData.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-600">No entries found</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {!waitlistLoading && !waitlistLoaded && (
              <div className="text-gray-600 text-base md:text-sm py-8 text-center">Click Refresh to load waitlist.</div>
            )}
          </div>

          {/* Pagination */}
          {waitlistTotal > WAITLIST_LIMIT && (
            <div className="flex items-center justify-between text-base md:text-sm text-gray-400">
              <span>{waitlistTotal} total · page {waitlistPage} of {Math.ceil(waitlistTotal / WAITLIST_LIMIT)}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={waitlistPage <= 1 || waitlistLoading}
                  onClick={() => fetchWaitlist(waitlistPage - 1, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir })}
                  className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
                >
                  ← Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={waitlistPage >= Math.ceil(waitlistTotal / WAITLIST_LIMIT) || waitlistLoading}
                  onClick={() => fetchWaitlist(waitlistPage + 1, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir })}
                  className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Cash Out tab ── */}
      {activeTab === "cashout" && (
        <div className="space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={cashoutStatusFilter}
              onChange={(e) => { setCashoutStatusFilter(e.target.value); fetchCashOuts(1, e.target.value); }}
              className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
            >
              <option value="">All statuses</option>
              <option value="PENDING_BRIDGE">Pending Bridge</option>
              <option value="BRIDGING">Bridging</option>
              <option value="DEPOSITED">Deposited — awaiting peer</option>
              <option value="COMPLETE">Complete</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="FAILED">Failed</option>
            </select>
            <span className="text-base text-gray-500">{cashoutTotal} total</span>
          </div>

          {cashoutLoading && (
            <div className="flex items-center gap-2 text-base text-gray-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading cash outs…
            </div>
          )}

          {!cashoutLoading && cashoutLoaded && (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-base text-gray-300">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Platform</th>
                    <th className="text-left px-4 py-2.5">Identifier</th>
                    <th className="text-right px-4 py-2.5">Amount</th>
                    <th className="text-left px-4 py-2.5">Currency</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Deposit ID</th>
                    <th className="text-left px-4 py-2.5 max-w-[120px]">User ID</th>
                  </tr>
                </thead>
                <tbody>
                  {cashoutData.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No cash out requests found.</td></tr>
                  )}
                  {cashoutData.map((row: any) => {
                    const statusColors: Record<string, string> = {
                      COMPLETE: "text-emerald-400",
                      DEPOSITED: "text-blue-400",
                      BRIDGING: "text-amber-400",
                      PENDING_BRIDGE: "text-gray-400",
                      CANCELLED: "text-gray-500",
                      FAILED: "text-red-400",
                      CANCELLING: "text-orange-400",
                    };
                    return (
                      <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                          {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5 font-medium capitalize">{row.platform}</td>
                        <td className="px-4 py-2.5 font-mono">{row.platform_identifier}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">${Number(row.amount_usdc).toFixed(2)}</td>
                        <td className="px-4 py-2.5">{row.currency}</td>
                        <td className={`px-4 py-2.5 font-medium ${statusColors[row.status] ?? "text-gray-400"}`}>{row.status}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-400">
                          {row.zkp2p_deposit_id ?? <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5 max-w-[120px] truncate text-gray-600 font-mono text-sm">{row.user_id}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {cashoutLoaded && cashoutTotal > 50 && (
            <div className="flex items-center gap-3 justify-center pt-1">
              <button
                type="button"
                disabled={cashoutPage <= 1}
                onClick={() => fetchCashOuts(cashoutPage - 1, cashoutStatusFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >← Prev</button>
              <span className="text-base text-gray-500">Page {cashoutPage} of {Math.ceil(cashoutTotal / 50)}</span>
              <button
                type="button"
                disabled={cashoutPage >= Math.ceil(cashoutTotal / 50)}
                onClick={() => fetchCashOuts(cashoutPage + 1, cashoutStatusFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ── Lottery tickets tab ── */}
      {activeTab === "lottery" && (
        <div className="space-y-3">
          {/* Gift a Megapot ticket */}
          <div className="rounded-xl border border-gray-800 p-4 space-y-3">
            <div className="text-base font-semibold text-gray-200">Gift a Megapot ticket</div>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {giftIdentifierInput.includes("@") && giftIdentifierInput.includes(".")
                    ? <Mail className="w-4 h-4" /> : <AtSign className="w-4 h-4" />}
                </span>
                <Input
                  placeholder="Email, X handle, or Loofta username"
                  value={giftIdentifierInput}
                  onChange={(e) => setGiftIdentifierInput(e.target.value.replace(/^@+/, ""))}
                  className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm pl-9 w-full"
                />
              </div>
              <Input
                type="number"
                min={1}
                max={100}
                value={giftNumTicketsInput}
                onChange={(e) => setGiftNumTicketsInput(e.target.value)}
                className="bg-gray-900 border-gray-700 text-gray-100 text-base md:text-sm w-24"
              />
            </div>
            <Textarea
              placeholder="Optional note to include in the email…"
              value={giftNoteInput}
              onChange={(e) => setGiftNoteInput(e.target.value)}
              className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm min-h-[60px]"
            />
            <Button
              size="sm"
              onClick={createGiftTicket}
              disabled={gifting || !giftIdentifierInput.trim()}
              className="bg-teal-700 hover:bg-teal-600 text-white"
            >
              {gifting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Gift ticket(s)"}
            </Button>
            {lastGiftLink && (
              <div className="flex items-center gap-2 text-base md:text-sm text-gray-400">
                <span className="truncate">{lastGiftLink}</span>
                <button type="button" onClick={() => copyText(lastGiftLink)} title="Copy" className="shrink-0">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Megapot referral fees — read-only balance, claim is manual */}
          <div className="rounded-xl border border-gray-800 p-4 space-y-2">
            <div className="text-base font-semibold text-gray-200">Megapot referral fees</div>
            <p className="text-sm text-gray-500">
              Accrues automatically from Loofta-referred tickets (10% of winners&apos; payouts). This backend never
              holds that wallet&apos;s private key — claiming is a manual on-chain action from whatever wallet controls it.
            </p>
            {referralFeesLoading && (
              <div className="flex items-center gap-2 text-base text-gray-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading balance…
              </div>
            )}
            {!referralFeesLoading && referralFeesLoaded && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div>
                  <div className="text-2xl font-semibold text-emerald-400 tabular-nums">
                    ${(referralFeesBalance ?? 0).toFixed(6)}
                  </div>
                  {referralFeesWallet && (
                    <div className="text-sm text-gray-500 font-mono">{referralFeesWallet}</div>
                  )}
                </div>
                {referralFeesBasescanUrl && (
                  <a
                    href={referralFeesBasescanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-base md:text-sm text-teal-400 hover:text-teal-300 underline underline-offset-2"
                  >
                    Claim on Basescan <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Gifts list */}
          {giftsLoaded && giftsData.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-base text-gray-300">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Recipient</th>
                    <th className="text-right px-4 py-2.5">Tickets</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {giftsData.map((row: any) => {
                    const giftStatusColors: Record<string, string> = {
                      unclaimed: "text-amber-400",
                      claimed: "text-emerald-400",
                      cancelled: "text-gray-500",
                      failed: "text-red-400",
                    };
                    return (
                      <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                          {new Date(row.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.recipient_type === "handle" ? `@${row.recipient_identifier}` : row.recipient_identifier}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.num_tickets}</td>
                        <td className={`px-4 py-2.5 font-medium ${giftStatusColors[row.status] ?? "text-gray-400"}`}>
                          {row.status}{row.failure_reason ? ` — ${row.failure_reason}` : ""}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-sm text-gray-500">
                          {row.resulting_ticket_id ?? <span className="text-gray-700">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={lotteryStatusFilter}
              onChange={(e) => { setLotteryStatusFilter(e.target.value); fetchLottery(1, e.target.value); }}
              className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
            >
              <option value="">All statuses</option>
              <option value="pending_send">Pending send</option>
              <option value="sent">Sent</option>
              <option value="bridging">Bridging</option>
              <option value="buying">Buying</option>
              <option value="active">Active (in draw)</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="failed">Failed</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            <span className="text-base text-gray-500">{lotteryTotal} total</span>
          </div>

          {lotteryLoading && (
            <div className="flex items-center gap-2 text-base text-gray-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading lottery tickets…
            </div>
          )}

          {!lotteryLoading && lotteryLoaded && (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-base text-gray-300">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-right px-4 py-2.5">Tickets</th>
                    <th className="text-right px-4 py-2.5">Cost</th>
                    <th className="text-left px-4 py-2.5">Route</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Round</th>
                    <th className="text-right px-4 py-2.5">Win</th>
                    <th className="text-left px-4 py-2.5 max-w-[160px]">User</th>
                  </tr>
                </thead>
                <tbody>
                  {lotteryData.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No lottery tickets found.</td></tr>
                  )}
                  {lotteryData.map((row: any) => {
                    const statusColors: Record<string, string> = {
                      active: "text-blue-400",
                      won: "text-emerald-400",
                      withdrawn: "text-emerald-400",
                      lost: "text-gray-500",
                      failed: "text-red-400",
                      pending_send: "text-gray-400",
                      sent: "text-amber-400",
                      bridging: "text-amber-400",
                      buying: "text-amber-400",
                    };
                    return (
                      <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                          {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.num_tickets}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">${Number(row.cost_usdc).toFixed(2)}</td>
                        <td className="px-4 py-2.5">{row.burner_sol_address ? "Private" : "Public"}</td>
                        <td className={`px-4 py-2.5 font-medium ${statusColors[row.status] ?? "text-gray-400"}`}>{row.status}</td>
                        <td className="px-4 py-2.5 text-gray-400">{row.round_id ?? <span className="text-gray-700">—</span>}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.win_amount_usdc ? <span className="text-emerald-400 font-medium">${Number(row.win_amount_usdc).toFixed(2)}</span> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5 max-w-[160px] truncate">
                          {row.user?.username ? (
                            <span className="text-gray-200">@{row.user.username}</span>
                          ) : row.user?.email ? (
                            <span className="text-gray-300">{row.user.email}</span>
                          ) : (
                            <span className="text-gray-600 font-mono text-sm">{row.user_id}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {lotteryLoaded && lotteryTotal > 50 && (
            <div className="flex items-center gap-3 justify-center pt-1">
              <button
                type="button"
                disabled={lotteryPage <= 1}
                onClick={() => fetchLottery(lotteryPage - 1, lotteryStatusFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >← Prev</button>
              <span className="text-base text-gray-500">Page {lotteryPage} of {Math.ceil(lotteryTotal / 50)}</span>
              <button
                type="button"
                disabled={lotteryPage >= Math.ceil(lotteryTotal / 50)}
                onClick={() => fetchLottery(lotteryPage + 1, lotteryStatusFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ── Analytics tab ── */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          {analyticsLoading && (
            <div className="flex items-center gap-2 text-base md:text-sm text-gray-400 py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…
            </div>
          )}
          {!analyticsLoading && !analyticsLoaded && (
            <div className="text-gray-600 text-base md:text-sm py-12 text-center">Click Refresh to load analytics.</div>
          )}
          {!analyticsLoading && analyticsLoaded && analyticsData && (() => {
            const emailPct = analyticsData.total_users > 0
              ? Math.round((analyticsData.users_with_email / analyticsData.total_users) * 100)
              : 0;
            const twitterFromSparks = sparksLoaded
              ? sparksData.filter((u: any) => u.tasks.find((t: any) => t.key === "connect_twitter")?.completed).length
              : null;
            const twitterPct = twitterFromSparks != null && sparksData.length > 0
              ? Math.round((twitterFromSparks / sparksData.length) * 100)
              : null;

            return (
              <>
                {/* Volume section */}
                <div>
                  <h3 className="text-sm md:text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Transaction Volume</h3>
                  <div className="bg-gray-900 border border-amber-900 rounded-lg p-4 mb-3">
                    <div className="text-[10px] text-amber-400 uppercase tracking-wider mb-1 font-medium">Total Platform Volume</div>
                    <div className="text-3xl font-bold text-white tabular-nums">
                      {analyticsData.volume_total_all.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC · payments + lottery + deposits + withdrawals (mainnet)</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-1 font-medium">Devnet Volume</div>
                      <div className="text-2xl font-bold text-white tabular-nums">
                        {analyticsData.volume_devnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC success</div>
                      <div className="text-sm md:text-xs text-gray-600 mt-0.5">
                        {analyticsData.volume_devnet_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                      </div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-1 font-medium">Devnet Transactions</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.tx_devnet_success.toLocaleString()}</div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">success · {analyticsData.tx_devnet_total.toLocaleString()} total</div>
                    </div>
                    <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                      <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Mainnet Volume</div>
                      <div className="text-2xl font-bold text-white tabular-nums">
                        {analyticsData.volume_mainnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC success</div>
                      <div className="text-sm md:text-xs text-gray-600 mt-0.5">
                        {analyticsData.volume_mainnet_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                      </div>
                    </div>
                    <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                      <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Mainnet Transactions</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.tx_mainnet_success.toLocaleString()}</div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">success · {analyticsData.tx_mainnet_total.toLocaleString()} total</div>
                    </div>
                  </div>
                </div>

                {/* Lottery / deposits / withdrawals volume */}
                <div>
                  <h3 className="text-sm md:text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Lottery, Deposits &amp; Withdrawals</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1 font-medium">Lottery Volume</div>
                      <div className="text-2xl font-bold text-white tabular-nums">
                        {analyticsData.volume_lottery.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC · {analyticsData.tx_lottery_count.toLocaleString()} tickets</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1 font-medium">Deposit Volume</div>
                      <div className="text-2xl font-bold text-white tabular-nums">
                        {analyticsData.volume_deposits.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC · {analyticsData.tx_deposits_count.toLocaleString()} completed</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-1 font-medium">Withdraw Volume (Devnet)</div>
                      <div className="text-2xl font-bold text-white tabular-nums">
                        {analyticsData.volume_withdrawals_devnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC · {analyticsData.tx_withdrawals_devnet_count.toLocaleString()} rows</div>
                    </div>
                    <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                      <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Withdraw Volume (Mainnet)</div>
                      <div className="text-2xl font-bold text-white tabular-nums">
                        {analyticsData.volume_withdrawals_mainnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">USDC · {analyticsData.tx_withdrawals_mainnet_count.toLocaleString()} rows</div>
                    </div>
                  </div>
                </div>

                {/* Users section */}
                <div>
                  <h3 className="text-sm md:text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Users</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1 font-medium">Total Users</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.total_users.toLocaleString()}</div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">registered accounts</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1 font-medium">Email Connected</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{emailPct}%</div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">{analyticsData.users_with_email.toLocaleString()} of {analyticsData.total_users.toLocaleString()} users</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-sky-400 uppercase tracking-wider mb-1 font-medium">X Connected</div>
                      {twitterFromSparks != null ? (
                        <>
                          <div className="text-2xl font-bold text-white tabular-nums">{twitterFromSparks.toLocaleString()}</div>
                          <div className="text-sm md:text-xs text-gray-500 mt-0.5">
                            {twitterPct}% of {sparksData.length} tracked users
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl font-bold text-gray-600">—</div>
                          <div className="text-sm md:text-xs text-gray-600 mt-0.5">load Sparks tab first</div>
                        </>
                      )}
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1 font-medium">Waitlist Applicants</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.waitlist_total.toLocaleString()}</div>
                      <div className="text-sm md:text-xs text-gray-500 mt-0.5">{analyticsData.waitlist_granted.toLocaleString()} granted · {analyticsData.waitlist_with_twitter.toLocaleString()} with X</div>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Sparks tab ── */}
      {activeTab === "sparks" && (
        <div>
          {sparksLoading && (
            <div className="flex items-center gap-2 text-base md:text-sm text-gray-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Sparks…
            </div>
          )}
          {!sparksLoading && sparksLoaded && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <Input
                    placeholder="Search by username or email…"
                    value={sparksSearch}
                    onChange={(e) => setSparksSearch(e.target.value)}
                    className="pl-9 bg-gray-900 border-gray-700 text-sm"
                  />
                </div>
                <span className="text-sm md:text-xs text-gray-500 whitespace-nowrap">
                  {sparksSearch
                    ? `${sparksData.filter((u: any) => {
                        const q = sparksSearch.toLowerCase();
                        return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                      }).length} / ${sparksData.length}`
                    : `${sparksData.length} users`}
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-base md:text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-sm md:text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5">#</th>
                      <th className="text-left px-4 py-2.5">User</th>
                      <th className="text-right px-4 py-2.5">⚡ Sparks</th>
                      <th className="text-center px-3 py-2.5">Email</th>
                      <th className="text-center px-3 py-2.5">X</th>
                      <th className="text-center px-3 py-2.5">1st pay</th>
                      <th className="text-center px-3 py-2.5">Unreg.</th>
                      <th className="text-center px-3 py-2.5">Link paid</th>
                      <th className="text-center px-3 py-2.5">10 pays</th>
                      <th className="text-right px-4 py-2.5">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sparksData
                      .filter((u: any) => {
                        if (!sparksSearch) return true;
                        const q = sparksSearch.toLowerCase();
                        return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                      })
                      .map((u: any, i: number) => {
                        const byKey = Object.fromEntries(u.tasks.map((t: any) => [t.key, t]));
                        return (
                          <tr key={u.privyUserId} className="border-b border-gray-800/60 hover:bg-gray-900/50">
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums">{i + 1}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-white">{u.username ? `@${u.username}` : "—"}</div>
                              <div className="text-sm md:text-xs text-gray-500 truncate max-w-[200px]">{u.email ?? u.privyUserId}</div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-amber-400 tabular-nums">{u.totalSparks.toLocaleString()}</td>
                            {["connect_email","connect_twitter","first_payment","payment_to_unregistered","payment_link_paid","ten_payments"].map((key) => (
                              <td key={key} className="px-3 py-2.5 text-center">
                                {byKey[key]?.completed
                                  ? <span className="text-green-400">✓</span>
                                  : key === "ten_payments" && byKey[key]?.progress > 0
                                    ? <span className="text-amber-400 text-sm md:text-xs">{byKey[key].progress}/10</span>
                                    : <span className="text-gray-700">–</span>}
                              </td>
                            ))}
                            <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums text-sm md:text-xs">
                              {byKey["ten_payments"]?.progress ?? 0}
                            </td>
                          </tr>
                        );
                      })}
                    {sparksData.filter((u: any) => {
                      if (!sparksSearch) return true;
                      const q = sparksSearch.toLowerCase();
                      return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                    }).length === 0 && (
                      <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-600">
                        {sparksSearch ? `No users matching "${sparksSearch}"` : "No data"}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!sparksLoading && !sparksLoaded && (
            <div className="text-gray-600 text-base md:text-sm py-8 text-center">Click Refresh to load Sparks data.</div>
          )}
        </div>
      )}

      {/* ── Blink Campaign tab ── */}
      {activeTab === "blink" && (
        <div>
          {blinkLoading && (
            <div className="flex items-center gap-2 text-base md:text-sm text-gray-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Blink campaign data…
            </div>
          )}
          {!blinkLoading && blinkLoaded && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <Input
                    placeholder="Search by username or email…"
                    value={blinkSearch}
                    onChange={(e) => setBlinkSearch(e.target.value)}
                    className="pl-9 bg-gray-900 border-gray-700 text-sm"
                  />
                </div>
                <span className="text-sm md:text-xs text-gray-500 whitespace-nowrap">
                  {(() => {
                    const qualified = blinkData.filter((u: any) => u.qualified).length;
                    const filtered = blinkSearch
                      ? blinkData.filter((u: any) => {
                          const q = blinkSearch.toLowerCase();
                          return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                        }).length
                      : blinkData.length;
                    return blinkSearch ? `${filtered} / ${blinkData.length}` : `${qualified} qualified / ${blinkData.length} users`;
                  })()}
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-base md:text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 text-sm md:text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5">#</th>
                      <th className="text-left px-4 py-2.5">User</th>
                      <th className="text-center px-3 py-2.5">Passkeys</th>
                      <th className="text-center px-3 py-2.5">Deposits</th>
                      <th className="text-center px-3 py-2.5">Priv. pays</th>
                      <th className="text-center px-3 py-2.5">Qualified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blinkData
                      .filter((u: any) => {
                        if (!blinkSearch) return true;
                        const q = blinkSearch.toLowerCase();
                        return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                      })
                      .sort((a: any, b: any) => {
                        if (b.qualified !== a.qualified) return (b.qualified ? 1 : 0) - (a.qualified ? 1 : 0);
                        const scoreA = (a.hasPasskeys ? 1 : 0) + Math.min(a.depositCount, 2) + Math.min(a.privatePaymentsCount, 2);
                        const scoreB = (b.hasPasskeys ? 1 : 0) + Math.min(b.depositCount, 2) + Math.min(b.privatePaymentsCount, 2);
                        return scoreB - scoreA;
                      })
                      .map((u: any, i: number) => (
                        <tr key={u.privyUserId} className={`border-b border-gray-800/60 hover:bg-gray-900/50 ${u.qualified ? "bg-cyan-950/20" : ""}`}>
                          <td className="px-4 py-2.5 text-gray-600 tabular-nums">{i + 1}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-white">{u.username ? `@${u.username}` : "—"}</div>
                            <div className="text-sm md:text-xs text-gray-500 truncate max-w-[200px]">{u.email ?? u.privyUserId}</div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {u.hasPasskeys ? <span className="text-green-400">✓</span> : <span className="text-gray-700">–</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {u.depositCount >= 2
                              ? <span className="text-green-400">✓ {u.depositCount}</span>
                              : u.depositCount > 0
                                ? <span className="text-amber-400">{u.depositCount}/2</span>
                                : <span className="text-gray-700">0/2</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {u.privatePaymentsCount >= 2
                              ? <span className="text-green-400">✓ {u.privatePaymentsCount}</span>
                              : u.privatePaymentsCount > 0
                                ? <span className="text-amber-400">{u.privatePaymentsCount}/2</span>
                                : <span className="text-gray-700">0/2</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {u.qualified
                              ? <span className="text-cyan-400 font-semibold">✓ Done</span>
                              : <span className="text-gray-700">–</span>}
                          </td>
                        </tr>
                      ))}
                    {blinkData.filter((u: any) => {
                      if (!blinkSearch) return true;
                      const q = blinkSearch.toLowerCase();
                      return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                    }).length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">
                        {blinkSearch ? `No users matching "${blinkSearch}"` : "No data"}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!blinkLoading && !blinkLoaded && (
            <div className="text-gray-600 text-base md:text-sm py-8 text-center">Click Refresh to load Blink campaign data.</div>
          )}
        </div>
      )}

      {/* ── Payments tab ── */}
      {activeTab === "payments" && <>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-2 mb-4 text-sm md:text-xs">
        <span className="text-gray-400">
          Loaded <span className="text-white font-semibold">{payments.length}</span>
          {" "}/ total <span className="text-white font-semibold">{total}</span>
        </span>
        {STATUSES.filter((s) => (statusCounts[s] ?? 0) > 0).map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded border ${STATUS_STYLE[s]}`}>
            {s} {statusCounts[s]}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="user ID · username · email · address · tx hash · payment ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            className="pl-9 bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm"
          />
        </div>
        <Select value={devnetFilter} onValueChange={(v: "all" | "devnet" | "mainnet") => setDevnetFilter(v)}>
          <SelectTrigger className="w-36 bg-gray-900 border-gray-700 text-gray-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
            <SelectItem value="all">All networks</SelectItem>
            <SelectItem value="devnet">Devnet only</SelectItem>
            <SelectItem value="mainnet">Mainnet only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48 bg-gray-900 border-gray-700 text-gray-100">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={applySearch}
          className="bg-blue-700 hover:bg-blue-600 text-white"
        >
          Search
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="text-sm md:text-xs border-collapse" style={{ tableLayout: "fixed", minWidth: 900 }}>
          <thead>
            <tr className="bg-gray-900 text-gray-500 text-[10px] uppercase tracking-wider border-b border-gray-800">
              <th style={{ width: 24 }} className="px-2 py-2" />
              {(["Created","ID","Sender","Recipient","Amount","Chain","Status","Net","Expires","Sender TX","Sweep TX"] as const).map((label, i) => (
                <th
                  key={label}
                  className="px-3 py-2 text-left"
                  style={{ width: colWidths[i], position: "relative", userSelect: "none" }}
                >
                  {label}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); resizeRef.current = { colIdx: i, startX: e.clientX, startW: colWidths[i] }; }}
                  />
                </th>
              ))}
              <th style={{ width: 32 }} className="py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && payments.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-center py-16 text-gray-600">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-center py-16 text-gray-600">No payments found</td>
              </tr>
            ) : (
              payments.map((p) => (
                <React.Fragment key={p.id}>
                  <tr
                    onClick={() => toggleExpand(p.id)}
                    className={`border-b border-gray-800/60 cursor-pointer transition-colors ${
                      expandedId === p.id ? "bg-gray-900" : "hover:bg-gray-900/50"
                    }`}
                  >
                    {/* Expand toggle */}
                    <td className="px-2 py-2 text-gray-600">
                      {expandedId === p.id
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />}
                    </td>

                    {/* Created */}
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap" title={fmtFull(p.created_at)}>
                      {fmtShort(p.created_at)}
                    </td>

                    {/* ID */}
                    <td className="px-3 py-2">
                      <span
                        className="font-mono text-gray-400 hover:text-white cursor-pointer"
                        title={p.id}
                        onClick={(e) => { e.stopPropagation(); copyText(p.id); }}
                      >
                        {p.id.slice(0, 8)}
                      </span>
                    </td>

                    {/* Sender */}
                    <td className="px-3 py-2">
                      <UserChip user={p.sender_user} privyId={p.created_by} />
                    </td>

                    {/* Recipient */}
                    <td className="px-3 py-2">
                      <RecipientCell p={p} />
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      {Number(p.amount).toFixed(2)}{" "}
                      <span className="text-gray-400 font-normal">{p.to_token ?? "USDC"}</span>
                    </td>

                    {/* Chain */}
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {p.from_chain ?? "?"}<span className="text-gray-700 mx-1">→</span>{p.to_chain ?? "sol"}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${STATUS_STYLE[p.status] ?? "bg-gray-800 text-gray-400 border-gray-600"}`}>
                        {p.status}
                      </span>
                    </td>

                    {/* Network */}
                    <td className="px-3 py-2">
                      {p.is_devnet
                        ? <span className="text-[9px] px-1 py-0.5 rounded border border-orange-800 bg-orange-950 text-orange-400">DEV</span>
                        : <span className="text-[9px] px-1 py-0.5 rounded border border-green-800 bg-green-950 text-green-400">MAIN</span>}
                    </td>

                    {/* Expires */}
                    <td
                      className="px-3 py-2 text-gray-400 whitespace-nowrap"
                      title={fmtFull(p.expires_at)}
                    >
                      {p.expires_at
                        ? <span className={new Date(p.expires_at) < new Date() ? "text-red-400" : ""}>{fmtShort(p.expires_at)}</span>
                        : <span className="text-gray-700">—</span>}
                    </td>

                    {/* Sender TX */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <TxCell hash={p.sender_tx_hash} chain={p.from_chain} isDevnet={p.is_devnet} />
                    </td>

                    {/* Sweep TX */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <TxCell hash={p.sweep_tx_hash} chain="solana" isDevnet={p.is_devnet} />
                    </td>

                    {/* Edit */}
                    <td className="px-3 py-2">
                      <button
                        onClick={(e) => openEdit(p, e)}
                        className="text-gray-600 hover:text-gray-200 transition-colors"
                        title="Edit payment"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === p.id && (
                    <tr className="bg-gray-900 border-b border-gray-700">
                      <td colSpan={13} className="px-6 py-4">
                        {loadingDetail && !expandedDetail ? (
                          <div className="flex items-center gap-2 text-gray-500 py-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading details…
                          </div>
                        ) : expandedDetail ? (
                          <DetailPanel detail={expandedDetail} onCopy={copyText} />
                        ) : null}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4 text-base md:text-sm text-gray-400">
          <span>{total} total payments · page {currentPage} of {totalPages}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1 || loading}
              onClick={() => fetchPayments(currentPage - 1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter })}
              className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
            >
              ← Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages || loading}
              onClick={() => fetchPayments(currentPage + 1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter })}
              className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-blue-400" />
              Edit Payment
            </DialogTitle>
            <p className="font-mono text-[10px] text-gray-500 break-all">{editTarget?.id}</p>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-5 py-2">

            {/* ── Status & timing ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Status &amp; timing</p>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">Expires at</Label>
                  <Input type="datetime-local" value={editForm.expires_at}
                    onChange={(e) => setEditForm((f) => ({ ...f, expires_at: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">Paid at</Label>
                  <Input type="datetime-local" value={editForm.paid_at}
                    onChange={(e) => setEditForm((f) => ({ ...f, paid_at: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100" />
                </div>
              </div>
            </div>

            {/* ── Amount & chain ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Amount &amp; chain</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">Amount</Label>
                  <Input type="number" step="any" value={editForm.amount}
                    onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">Direction</Label>
                  <Input value={editForm.direction}
                    onChange={(e) => setEditForm((f) => ({ ...f, direction: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. OUT" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">From chain</Label>
                  <Input value={editForm.from_chain}
                    onChange={(e) => setEditForm((f) => ({ ...f, from_chain: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. sol" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">From token</Label>
                  <Input value={editForm.from_token}
                    onChange={(e) => setEditForm((f) => ({ ...f, from_token: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. USDC" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">To chain</Label>
                  <Input value={editForm.to_chain}
                    onChange={(e) => setEditForm((f) => ({ ...f, to_chain: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. sol" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">To token</Label>
                  <Input value={editForm.to_token}
                    onChange={(e) => setEditForm((f) => ({ ...f, to_token: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. USDC" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="is_devnet"
                  type="checkbox"
                  checked={editForm.is_devnet}
                  onChange={(e) => setEditForm((f) => ({ ...f, is_devnet: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-blue-500"
                />
                <Label htmlFor="is_devnet" className="text-gray-400 text-xs cursor-pointer">Devnet</Label>
              </div>
            </div>

            {/* ── Parties ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Parties</p>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Sender privy ID (created_by)</Label>
                <Input value={editForm.created_by}
                  onChange={(e) => setEditForm((f) => ({ ...f, created_by: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" placeholder="did:privy:…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">Recipient username</Label>
                  <Input value={editForm.recipient_username}
                    onChange={(e) => setEditForm((f) => ({ ...f, recipient_username: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" placeholder="@handle" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1.5 block">Recipient email</Label>
                  <Input type="email" value={editForm.recipient_email}
                    onChange={(e) => setEditForm((f) => ({ ...f, recipient_email: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" placeholder="user@example.com" />
                </div>
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Recipient privy ID</Label>
                <Input value={editForm.recipient_user_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, recipient_user_id: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" placeholder="did:privy:…" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Recipient address (Solana)</Label>
                <Input value={editForm.recipient_address}
                  onChange={(e) => setEditForm((f) => ({ ...f, recipient_address: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" placeholder="Solana wallet address" />
              </div>
            </div>

            {/* ── Blockchain ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Blockchain</p>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Burner address</Label>
                <Input value={editForm.burner_address}
                  onChange={(e) => setEditForm((f) => ({ ...f, burner_address: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" placeholder="Escrow wallet" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Sender TX hash</Label>
                <Input value={editForm.sender_tx_hash}
                  onChange={(e) => setEditForm((f) => ({ ...f, sender_tx_hash: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs mb-1.5 block">Sweep TX hash</Label>
                <Input value={editForm.sweep_tx_hash}
                  onChange={(e) => setEditForm((f) => ({ ...f, sweep_tx_hash: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs" />
              </div>
            </div>

            {/* ── Notes ── */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Notes</p>
              <Label className="text-gray-400 text-xs mb-1.5 block">Description</Label>
              <Textarea value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs"
                rows={2} placeholder="Optional message" />
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}
              className="border-gray-600 text-gray-300 hover:bg-gray-800">
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving} className="bg-blue-700 hover:bg-blue-600 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </>}
    </div>
  );
}
