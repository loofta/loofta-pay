"use client";

import { useToast } from "@/components/ui/use-toast";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppUser = { privy_user_id: string; username: string | null; email: string | null };

export type Payment = {
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
  is_private: boolean | null;
  legacy_claim_id: string | null;
  recipient_user_id: string | null;
  expires_at: string | null;
  sender_user: AppUser | null;
  recipient_user: AppUser | null;
};

export type PaymentIntent = {
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

export type PaymentEvent = {
  id: number;
  payment_id: string;
  created_at: string;
  type: string;
  payload: unknown;
};

export type PaymentDetail = {
  payment: Payment;
  intents: PaymentIntent[];
  events: PaymentEvent[];
  _errors: { intents: string | null; events: string | null };
};

export type EditForm = {
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

export type AnalyticsData = {
  volume_devnet: number;
  volume_mainnet: number;
  volume_devnet_total: number;
  volume_mainnet_total: number;
  tx_devnet_success: number;
  tx_mainnet_success: number;
  tx_mainnet_success_above_5: number;
  users_mainnet_success_above_5: number;
  users_mainnet_success_above_5_list: Array<{
    privyUserId: string;
    username: string | null;
    email: string | null;
    txCount: number;
    totalAmount: number;
  }>;
  users_mainnet_success_above_5_repeat_list: Array<{
    privyUserId: string;
    username: string | null;
    email: string | null;
    txCount: number;
    totalAmount: number;
  }>;
  tx_devnet_total: number;
  tx_mainnet_total: number;
  total_users: number;
  users_with_email: number;
  mainnet_active_users: number;
  mainnet_repeat_users: number;
  funnel_mainnet: {
    users_signed_up: number;
    users_created_link: number;
    users_funded: number;
    users_success: number;
    links_created: number;
    links_funded: number;
    links_success: number;
    links_expired: number;
  };
  waitlist_total: number;
  waitlist_granted: number;
  waitlist_with_twitter: number;
  volume_lottery: number;
  tx_lottery_count: number;
  users_lottery: number;
  volume_deposits: number;
  tx_deposits_count: number;
  volume_withdrawals_devnet: number;
  volume_withdrawals_mainnet: number;
  tx_withdrawals_devnet_count: number;
  tx_withdrawals_mainnet_count: number;
  volume_total_all: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const STATUSES = [
  "OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "FUNDED",
  "PRIVATE_TRANSFER_PENDING", "SUCCESS", "REFUNDED",
  "EXPIRED", "CANCELLED", "DELETED",
];

export const STATUS_STYLE: Record<string, string> = {
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

export const LIMIT = 50;
export const WAITLIST_LIMIT = 25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

export function trunc(s: string | null | undefined, n = 10): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  // Slice to "YYYY-MM-DDTHH:MM" for datetime-local input
  return new Date(iso).toISOString().slice(0, 16);
}

export function solscanUrl(hash: string, isDevnet: boolean): string {
  const base = `https://solscan.io/tx/${hash}`;
  return isDevnet ? `${base}?cluster=devnet` : base;
}

export function txUrl(hash: string | null, chain: string | null, isDevnet: boolean): string {
  if (!hash) return "#";
  const c = (chain ?? "solana").toLowerCase();
  if (c === "solana" || c === "sol") return solscanUrl(hash, isDevnet);
  return getExplorerTxUrl(c, hash);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

export function CopyButton({ value }: { value: string }) {
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

export function TxCell({ hash, chain, isDevnet }: { hash: string | null; chain: string | null; isDevnet: boolean }) {
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

/** Companion smart accounts live on Base — always basescan, unlike TxCell which varies by chain. */
export function AddressCell({ address }: { address: string | null }) {
  if (!address) return <span className="text-gray-600">—</span>;
  const url = `https://basescan.org/address/${address}`;
  return (
    <span className="inline-flex items-center gap-0.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-blue-400 hover:text-blue-200 hover:underline"
        title={address}
      >
        {trunc(address, 14)}
      </a>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <ExternalLink className="w-2.5 h-2.5 text-gray-500 hover:text-gray-300" />
      </a>
      <CopyButton value={address} />
    </span>
  );
}

export function SolAddressCell({ address, isDevnet = false }: { address: string | null; isDevnet?: boolean }) {
  if (!address) return <span className="text-gray-600">—</span>;
  const url = `https://solscan.io/account/${address}${isDevnet ? "?cluster=devnet" : ""}`;
  return (
    <span className="inline-flex items-center gap-0.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-blue-400 hover:text-blue-200 hover:underline"
        title={address}
      >
        {trunc(address, 14)}
      </a>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <ExternalLink className="w-2.5 h-2.5 text-gray-500 hover:text-gray-300" />
      </a>
      <CopyButton value={address} />
    </span>
  );
}

export function UserChip({ user, privyId }: { user: AppUser | null; privyId: string | null }) {
  if (!privyId) return <span className="text-gray-600 text-sm">anon</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
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

export function SortableHeader({ col, label, sortCol, sortDir, onSort }: {
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

export function RecipientCell({ p }: { p: Payment }) {
  const hasUserIdButNoProfile = p.recipient_user_id && !p.recipient_user;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
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

export function DetailPanel({ detail, onCopy }: { detail: PaymentDetail; onCopy: (s: string) => void }) {
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
              <span className="text-gray-500 text-sm w-40 shrink-0">{k}</span>
              <span
                className="font-mono text-sm text-gray-300 break-all cursor-pointer hover:text-white"
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
                <div className="font-mono text-sm space-y-0.5 text-gray-300">
                  <div>@{p.sender_user.username ?? <span className="text-gray-600">no username</span>}</div>
                  <div>{p.sender_user.email ?? <span className="text-gray-600">no email</span>}</div>
                  <div className="text-gray-500 text-[10px] break-all">{p.sender_user.privy_user_id}</div>
                </div>
              </div>
            )}
            {p.recipient_user && (
              <div className="bg-gray-800 rounded p-3">
                <div className="text-[9px] text-gray-500 uppercase mb-1">Recipient</div>
                <div className="font-mono text-sm space-y-0.5 text-gray-300">
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
              <div key={intent.id} className="bg-gray-800 rounded p-3 font-mono text-sm">
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
              <div key={ev.id} className="bg-gray-800 rounded p-2 text-sm">
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
        <p className="text-gray-600 text-sm">No intents or events recorded.</p>
      )}
    </div>
  );
}
