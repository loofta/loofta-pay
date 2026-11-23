"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, Notice, PageHeader, Pill, Row, Segmented, StatCard, Table, inputCls } from "./ui";
import { post, usd, usePartnerApi } from "./usePartnerApi";
import { notifyTreasuryChanged } from "./useTreasury";

type Stage = "created" | "funded" | "claimed" | "withdrawn" | "cancelled";
type Payout = {
  payment_id: string;
  recipient: string | null;
  name: string | null;
  amount: number;
  stage: Stage;
  batch: string | null;
  updated_at: string;
};

const STAGE: Record<Stage, { label: string; tone: "grey" | "blue" | "amber" | "green" }> = {
  created: { label: "Created", tone: "grey" },
  funded: { label: "Funded", tone: "blue" },
  claimed: { label: "Claimed", tone: "amber" },
  withdrawn: { label: "Withdrawn", tone: "green" },
  cancelled: { label: "Cancelled", tone: "grey" },
};

function updated(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

const TEMPLATE = "minmax(0,1.6fr) 110px minmax(0,1.3fr) 150px 110px 130px";

/** The claim flow for every payout: created, funded, claimed by the recipient, then withdrawn. */
export function ActivityTab({ orgId }: { orgId: string }) {
  const call = usePartnerApi();
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Payout[]>(`partners/${encodeURIComponent(orgId)}/payouts`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [call, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Takes a funded payout back: the money returns to the company wallet. Owners and admins only (the server checks). */
  const cancel = async (r: Payout) => {
    if (!window.confirm(`Take back ${usd(r.amount)} sent to ${r.name ?? r.recipient ?? "this recipient"}? The money returns to your company wallet and they will no longer be able to withdraw it.`)) return;
    setBusy(r.payment_id);
    setError(null);
    setDone(null);
    try {
      const out = await call<{ refunded_usdc: number }>(`partners/${encodeURIComponent(orgId)}/payouts/${encodeURIComponent(r.payment_id)}/cancel`, post());
      setDone(`${usd(out.refunded_usdc)} is back in your company wallet.`);
      load();
      notifyTreasuryChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const count = (s: Stage) => (rows ?? []).filter((r) => r.stage === s).length;

  const shown = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const hay = `${r.name ?? ""} ${r.recipient ?? ""}`.toLowerCase();
        return (filter === "all" || r.stage === filter) && (!q.trim() || hay.includes(q.trim().toLowerCase()));
      }),
    [rows, filter, q],
  );

  return (
    <>
      <PageHeader crumb="Partner portal / Activity" title="Who has claimed" blurb="Follow every payout from created to funded to withdrawn." />
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Created" dot="grey" value={String(count("created"))} />
        <StatCard label="Funded" dot="blue" value={String(count("funded"))} />
        <StatCard label="Claimed" dot="amber" value={String(count("claimed"))} />
        <StatCard label="Withdrawn" dot="green" value={String(count("withdrawn"))} />
      </div>
      {done && (
        <div className="mt-6">
          <Notice kind="ok">{done}</Notice>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4 xl:flex-row">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--pt-ink3,#9C9CA5)]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input className={`${inputCls} pl-11`} placeholder="Search a recipient" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "created", label: "Created" },
            { value: "funded", label: "Funded" },
            { value: "claimed", label: "Claimed" },
            { value: "withdrawn", label: "Withdrawn" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>

      <div className="mt-6">
        {rows === null ? (
          <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">Loading...</p>
        ) : !shown.length ? (
          <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">No payouts match.</p>
        ) : (
          <Table cols={["Recipient", "Amount", "Batch", "Status", "Updated", ""]} template={TEMPLATE}>
            {shown.map((r) => (
              <Row key={r.payment_id} template={TEMPLATE}>
                <div className="min-w-0">
                  <div className="truncate font-medium text-[color:var(--pt-ink,#EDEDEF)]">{r.name ?? r.recipient ?? "Wallet recipient"}</div>
                  {r.name && r.recipient && <div className="truncate font-mono text-[13.5px] text-[color:var(--pt-ink3,#9C9CA5)]">{r.recipient}</div>}
                </div>
                <span>{r.amount.toFixed(2)}</span>
                <span className="truncate text-[color:var(--pt-ink-soft,#DCDCE1)]">{r.batch ?? "-"}</span>
                <span>
                  <Pill tone={STAGE[r.stage].tone} dot>
                    {STAGE[r.stage].label}
                  </Pill>
                </span>
                <span className="text-[color:var(--pt-ink2,#C9C9D0)]">{updated(r.updated_at)}</span>
                <span>
                  {r.stage === "funded" && (
                    <Btn kind="danger" onClick={() => cancel(r)} disabled={busy === r.payment_id} className="!px-3 !py-1.5 !text-[13px]">
                      {busy === r.payment_id ? "Taking back..." : "Take back"}
                    </Btn>
                  )}
                </span>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </>
  );
}
