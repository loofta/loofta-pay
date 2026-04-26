"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
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
  ExternalLink, Pencil, AlertTriangle, Copy,
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
  if (!privyId) return <span className="text-gray-600 text-xs">anon</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
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

function RecipientCell({ p }: { p: Payment }) {
  const hasUserIdButNoProfile = p.recipient_user_id && !p.recipient_user;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
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
              <span className="text-gray-500 text-xs w-40 shrink-0">{k}</span>
              <span
                className="font-mono text-xs text-gray-300 break-all cursor-pointer hover:text-white"
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
                <div className="font-mono text-xs space-y-0.5 text-gray-300">
                  <div>@{p.sender_user.username ?? <span className="text-gray-600">no username</span>}</div>
                  <div>{p.sender_user.email ?? <span className="text-gray-600">no email</span>}</div>
                  <div className="text-gray-500 text-[10px] break-all">{p.sender_user.privy_user_id}</div>
                </div>
              </div>
            )}
            {p.recipient_user && (
              <div className="bg-gray-800 rounded p-3">
                <div className="text-[9px] text-gray-500 uppercase mb-1">Recipient</div>
                <div className="font-mono text-xs space-y-0.5 text-gray-300">
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
              <div key={intent.id} className="bg-gray-800 rounded p-3 font-mono text-xs">
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
              <div key={ev.id} className="bg-gray-800 rounded p-2 text-xs">
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
        <p className="text-gray-600 text-xs">No intents or events recorded.</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { authenticated, userId, login, ready } = useAuth();
  const { toast } = useToast();

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
    status: "", expires_at: "", paid_at: "", description: "", recipient_address: "",
  });
  const [saving, setSaving] = useState(false);

  // Keep userId stable in callbacks via ref
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !authenticated || !userId) {
      setCheckingAuth(false);
      return;
    }
    fetch("/api/admin/check", { headers: { "x-privy-user-id": userId } })
      .then((r) => r.json())
      .then((d) => setIsAuthorized(d.isAdmin ?? false))
      .catch(() => setIsAuthorized(false))
      .finally(() => setCheckingAuth(false));
  }, [ready, authenticated, userId]);

  // ── Fetch payments ──────────────────────────────────────────────────────────
  const fetchPayments = useCallback(async (
    page: number,
    opts: { search: string; devnet: "all" | "devnet" | "mainnet"; status: string },
  ) => {
    const uid = userIdRef.current;
    if (!uid) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (opts.search) qs.set("search", opts.search);
      if (opts.devnet !== "all") qs.set("devnet", opts.devnet === "devnet" ? "true" : "false");
      if (opts.status !== "all") qs.set("status", opts.status);

      const res = await fetch(`/api/admin/payments?${qs}`, { headers: { "x-privy-user-id": uid } });
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
  }, [toast]);

  // Auto-fetch on filter change (but NOT on search input change — only on applied search)
  useEffect(() => {
    if (isAuthorized) {
      fetchPayments(1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter });
    }
  }, [isAuthorized, appliedSearch, devnetFilter, statusFilter, fetchPayments]);

  const applySearch = () => setAppliedSearch(searchInput);
  const refresh = () => fetchPayments(currentPage, { search: appliedSearch, devnet: devnetFilter, status: statusFilter });

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
        headers: { "x-privy-user-id": userIdRef.current! },
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
      status:            p.status,
      expires_at:        toLocalDatetime(p.expires_at),
      paid_at:           toLocalDatetime(p.paid_at),
      description:       p.description ?? "",
      recipient_address: p.recipient_address ?? "",
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
      if (editForm.recipient_address !== (editTarget.recipient_address ?? "")) {
        body.recipient_address = editForm.recipient_address || null;
      }
      if (Object.keys(body).length === 0) {
        toast({ title: "No changes" });
        setEditTarget(null);
        return;
      }
      const res = await fetch(`/api/admin/payments/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-privy-user-id": userIdRef.current! },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Saved" });
      setEditTarget(null);
      // Refresh the expanded detail too if open
      if (expandedId === editTarget.id) {
        setExpandedDetail(null);
        setLoadingDetail(true);
        fetch(`/api/admin/payments/${editTarget.id}`, {
          headers: { "x-privy-user-id": userIdRef.current! },
        }).then((r) => r.json()).then(setExpandedDetail).finally(() => setLoadingDetail(false));
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
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  if (!authenticated || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center space-y-4 text-gray-100">
          <Shield className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          {!authenticated ? (
            <Button onClick={login}>Log In</Button>
          ) : (
            <p className="text-sm text-gray-500">Not authorized. UID: {userId}</p>
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
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 font-sans">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="font-bold text-base">Loofta Admin</span>
          <span className="text-gray-600 text-sm hidden sm:block">· payments ≥ 2026-04-25</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
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
            className="pl-9 bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-sm"
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
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-900 text-gray-500 text-[10px] uppercase tracking-wider border-b border-gray-800">
              <th className="w-5 px-2 py-2" />
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Sender</th>
              <th className="px-3 py-2 text-left">Recipient</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Chain</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Net</th>
              <th className="px-3 py-2 text-left">Expires</th>
              <th className="px-3 py-2 text-left">Sender TX</th>
              <th className="px-3 py-2 text-left">Sweep TX</th>
              <th className="px-3 py-2 w-8" />
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
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
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
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-blue-400" />
              Edit Payment
            </DialogTitle>
            <p className="font-mono text-[10px] text-gray-500 break-all">{editTarget?.id}</p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">Expires at</Label>
              <Input
                type="datetime-local"
                value={editForm.expires_at}
                onChange={(e) => setEditForm((f) => ({ ...f, expires_at: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-gray-100"
              />
            </div>

            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">Paid at</Label>
              <Input
                type="datetime-local"
                value={editForm.paid_at}
                onChange={(e) => setEditForm((f) => ({ ...f, paid_at: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-gray-100"
              />
            </div>

            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs"
                rows={2}
                placeholder="Optional message"
              />
            </div>

            <div>
              <Label className="text-gray-400 text-xs mb-1.5 block">Recipient address (Solana)</Label>
              <Input
                value={editForm.recipient_address}
                onChange={(e) => setEditForm((f) => ({ ...f, recipient_address: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-xs"
                placeholder="Solana wallet address"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              className="border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={saving}
              className="bg-blue-700 hover:bg-blue-600 text-white"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
