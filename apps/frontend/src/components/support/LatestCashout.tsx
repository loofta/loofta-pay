"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePeerCancel } from "@/hooks/usePeerCancel";

type Row = { id: string; platform: string; amount_usdc: number | string; status: string; created_at: string; zkp2p_deposit_id?: string | null };

const STEP: Record<string, { label: string; tone: "wait" | "go" }> = {
  PENDING_BRIDGE: { label: "Getting your cash-out ready", tone: "wait" },
  BRIDGING: { label: "Getting your cash-out ready", tone: "wait" },
  CREATING_DEPOSIT: { label: "Getting your cash-out ready", tone: "wait" },
  DEPOSITED: { label: "Waiting for a buyer to send the money", tone: "go" },
  CANCELLING: { label: "Cancelling", tone: "wait" },
};

/**
 * The person's cash-out that is still running, with a plain status and a Cancel that finishes right here, the whole way.
 * Shows nothing when there is none, so the page stays quiet. Bank and card cash-outs finish on their own screen and are
 * not listed here.
 */
export function LatestCashout() {
  const { getAccessToken } = usePrivy();
  const { cancel } = usePeerCancel();
  const [row, setRow] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return setRow(null);
      const res = await fetch("/api/offramp", { headers: { Authorization: `Bearer ${token}` } });
      const body = res.ok ? await res.json().catch(() => null) : null;
      setRow(body && body.id ? (body as Row) : null);
    } catch {
      setRow(null);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!busy) void load(); }, 15000);
    return () => clearInterval(t);
  }, [load, busy]);

  const doCancel = async () => {
    if (!row) return;
    setBusy(true);
    setConfirming(false);
    setNote(null);
    try {
      await cancel(row.id, row.zkp2p_deposit_id);
      setRow(null);
      setNote("Cancelled. Your money is back in your Loofta wallet.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not cancel. Try again in a minute.");
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (!row) return note ? <p className="mt-4 rounded-2xl bg-[color:var(--pt-surface2,#0E0E12)] px-4 py-3 text-base text-[color:var(--pt-ink2,#C8C6D0)]">{note}</p> : null;
  const step = STEP[row.status] ?? { label: "In progress", tone: "wait" as const };
  const cancelling = busy || row.status === "CANCELLING";
  return (
    <div className="mt-5 rounded-2xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface2,#0E0E12)] p-4">
      <p className="m-0 text-sm font-semibold tracking-[0.14em] text-[color:var(--pt-ink3,#8A8893)]">YOUR CASH-OUT</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-base font-semibold text-[color:var(--pt-ink,#fff)]">${Number(row.amount_usdc).toFixed(2)} via {row.platform}</p>
          <p className="m-0 mt-1 flex items-center gap-2 text-base text-[color:var(--pt-ink2,#C8C6D0)]">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cancelling ? "animate-pulse bg-[#FF8A5C]" : step.tone === "go" ? "bg-[#4ADE80]" : "animate-pulse bg-[#FF7A2A]"}`} aria-hidden />
            {cancelling ? "Cancelling, keep this page open" : step.label}
          </p>
        </div>
        {!cancelling && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] px-3.5 py-2 text-base font-semibold text-[color:var(--pt-ink,#fff)] hover:border-[color:var(--pt-w20,rgba(255,255,255,0.2))]"
          >
            Cancel
          </button>
        )}
      </div>
      {confirming && !cancelling && (
        <div className="mt-3 rounded-xl bg-[color:var(--pt-surface3,#1A1A20)] p-3">
          <p className="m-0 text-base text-[color:var(--pt-ink2,#C8C6D0)]">Cancel this cash-out? Your money goes back to your Loofta wallet. This can take a minute, and you may be asked to approve it.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void doCancel()} className="flex-1 rounded-xl bg-[#FF7A2A] px-3.5 py-2 text-base font-semibold text-black hover:brightness-110">Yes, cancel it</button>
            <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] px-3.5 py-2 text-base font-semibold text-[color:var(--pt-ink,#fff)]">Keep it</button>
          </div>
        </div>
      )}
      {note && <p className="m-0 mt-3 text-base text-[color:var(--pt-warn,#FF8A5C)]">{note}</p>}
    </div>
  );
}
