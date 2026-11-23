"use client";

// Self-contained, same pattern as EarnTab.tsx. Companies that applied for a partner account: approve, reject, pause.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";

interface PartnerRow {
  id: string;
  org_id: string;
  name: string;
  status: "pending" | "active" | "rejected" | "suspended";
  website: string | null;
  contact_email: string | null;
  legal_name: string | null;
  country: string | null;
  use_case: string | null;
  review_note: string | null;
  applied_at: string;
  reviewed_at: string | null;
  batches: number;
  has_api_key: boolean;
  has_company_wallet: boolean;
}

const FILTERS = ["pending", "active", "rejected", "suspended"] as const;
type Filter = (typeof FILTERS)[number];

/** Loofta's own fee on every partner withdrawal: a flat amount plus a percentage. Applies to new withdrawals at once. */
function LooftaFeeCard({ headers }: { headers: () => Promise<Record<string, string>> }) {
  const [flat, setFlat] = useState("");
  const [pct, setPct] = useState("");
  const [saved, setSaved] = useState<{ flat: string; pct: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (body: { flat_usd: number; bps: number }) => {
    const f = String(body.flat_usd);
    const p = String(Math.round(Number(body.bps)) / 100);
    setFlat(f);
    setPct(p);
    setSaved({ flat: f, pct: p });
  };

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/partner-fees", { headers: await headers(), cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (on && res.ok) apply(body);
      } catch {
        /* leave the fields empty */
      }
    })();
    return () => {
      on = false;
    };
  }, [headers]);

  const dirty = !!saved && (saved.flat !== flat || saved.pct !== pct);
  const save = async () => {
    const flatUsd = Number(flat);
    const bps = Math.round(Number(pct) * 100);
    if (!Number.isFinite(flatUsd) || flatUsd < 0 || !Number.isFinite(bps) || bps < 0) {
      setMsg({ ok: false, text: "Enter a number for both." });
      return;
    }
    if (!window.confirm(`Charge $${flatUsd} plus ${bps / 100}% on every partner withdrawal from now on?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/partner-fees", { method: "PUT", headers: await headers(), body: JSON.stringify({ flat_usd: flatUsd, bps }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(", ") : body?.message || "Could not save");
      apply(body);
      setMsg({ ok: true, text: "Saved. New withdrawals use it now." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const input = "block w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-base md:text-sm text-slate-100";
  const example = (Number(flat || 0) + (100 * Number(pct || 0)) / 100).toFixed(2);
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div>
        <div className="text-lg font-semibold text-slate-100">Loofta withdrawal fee</div>
        <div className="text-base md:text-sm text-gray-500">Charged on every partner withdrawal, on every route. The flat part is taken once per withdrawal.</div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-base md:text-sm text-gray-400">
          Flat (USD)
          <input value={flat} onChange={(e) => setFlat(e.target.value)} inputMode="decimal" className={input} aria-label="Flat fee in USD" />
        </label>
        <label className="space-y-1 text-base md:text-sm text-gray-400">
          Percent
          <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className={input} aria-label="Percent fee" />
        </label>
        <button disabled={busy || !dirty} onClick={save} className="rounded-lg bg-orange-500/20 px-4 py-2 text-base md:text-sm font-semibold text-orange-300 hover:bg-orange-500/30 disabled:opacity-40">
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      <div className="text-base md:text-sm text-gray-500">Limits: up to $2 flat and 3%. On a $100 withdrawal this is ${example}.</div>
      {msg && <div className={`text-base md:text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</div>}
    </div>
  );
}

export function PartnersTab() {
  const { getAccessToken } = usePrivy();
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const headers = useCallback(async () => {
    const token = await getAccessToken().catch(() => null);
    return { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }, [getAccessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/partners?status=${filter}`, { headers: await headers(), cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || "Could not load companies");
      setRows(body.partners ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row: PartnerRow, action: "approve" | "reject" | "suspend" | "reinstate") => {
    const note = (notes[row.id] ?? "").trim();
    if ((action === "reject" || action === "suspend") && !note) {
      setError("Add a short note first. It is kept in the audit log and a rejected company sees it.");
      return;
    }
    if (action === "approve" && !window.confirm(`Approve ${row.name}? They can then create a company wallet, API keys and payouts.`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/partners/${row.id}/${action}`, { method: "POST", headers: await headers(), body: JSON.stringify({ note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(", ") : body?.message || "Failed");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <LooftaFeeCard headers={headers} />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-base md:text-sm font-medium capitalize ${filter === f ? "bg-orange-500/20 text-orange-300" : "bg-white/5 text-gray-400 hover:text-gray-200"}`}
          >
            {f}
          </button>
        ))}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
      </div>
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-base md:text-sm text-red-300">{error}</div>}
      {!loading && rows.length === 0 && <div className="text-base md:text-sm text-gray-500">No {filter} companies.</div>}
      {rows.map((r) => (
        <div key={r.id} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-lg font-semibold text-slate-100">{r.name}</div>
            <div className="text-base md:text-sm text-gray-500">Applied {new Date(r.applied_at).toLocaleString()}</div>
          </div>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-1 text-base md:text-sm">
            <dt className="text-gray-500">Website</dt>
            <dd className="break-all text-gray-200">{r.website ? <a className="text-orange-300 hover:underline" href={r.website} target="_blank" rel="noopener noreferrer">{r.website}</a> : "none"}</dd>
            <dt className="text-gray-500">Contact</dt>
            <dd className="text-gray-200">{r.contact_email ?? "none"}</dd>
            <dt className="text-gray-500">Legal name</dt>
            <dd className="text-gray-200">{r.legal_name ?? "none"}{r.country ? `, ${r.country}` : ""}</dd>
            <dt className="text-gray-500">What they pay for</dt>
            <dd className="whitespace-pre-wrap text-gray-200">{r.use_case ?? "Created before applications existed"}</dd>
            <dt className="text-gray-500">Activity</dt>
            <dd className="text-gray-200">{r.batches} batches, {r.has_api_key ? "has API key" : "no API key"}, {r.has_company_wallet ? "has company wallet" : "no company wallet"}</dd>
            {r.review_note && (<><dt className="text-gray-500">Note</dt><dd className="text-gray-200">{r.review_note}</dd></>)}
          </dl>
          <input
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
            placeholder="Note (needed to reject or pause, shown to a rejected company)"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-base md:text-sm text-slate-100 placeholder:text-gray-600"
          />
          <div className="flex flex-wrap gap-2">
            {r.status === "pending" && (
              <>
                <button disabled={busyId === r.id} onClick={() => act(r, "approve")} className="rounded-lg bg-emerald-500/20 px-4 py-2 text-base md:text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">Approve</button>
                <button disabled={busyId === r.id} onClick={() => act(r, "reject")} className="rounded-lg bg-red-500/15 px-4 py-2 text-base md:text-sm font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50">Reject</button>
              </>
            )}
            {r.status === "active" && (
              <button disabled={busyId === r.id} onClick={() => act(r, "suspend")} className="rounded-lg bg-red-500/15 px-4 py-2 text-base md:text-sm font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50">Pause company</button>
            )}
            {(r.status === "suspended" || r.status === "rejected") && (
              <button disabled={busyId === r.id} onClick={() => act(r, "reinstate")} className="rounded-lg bg-emerald-500/20 px-4 py-2 text-base md:text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">{r.status === "rejected" ? "Approve after all" : "Reinstate"}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
