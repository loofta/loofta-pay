"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BatchBuilder, type DraftRow } from "./BatchBuilder";
import { Btn, Notice, PageHeader, Pill, Row, Section, Table } from "./ui";
import { post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";
import { notifyTreasuryChanged, type Treasury, type TreasuryState } from "./useTreasury";
import { ProposalsPanel } from "./WalletTab";
import { useConfirm } from "./ConfirmDialog";

type Item = {
  row_index: number;
  payment_id: string | null;
  recipient_type: string;
  recipient_identifier: string;
  amount: number;
  status: string;
  error: string | null;
  payment_status: string | null;
  withdrawn: boolean;
};
type Batch = {
  id: string;
  status: string;
  label: string | null;
  total_amount: number | string;
  item_count: number;
  failed_count: number;
  rows_hash: string | null;
  created_by_user_id: string | null;
  created_at: string;
  scheduled_for?: string | null;
  scheduled_run_at?: string | null;
  scheduled_error?: string | null;
  funding_in_progress?: boolean;
  items?: Item[];
};

const whenFmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A scheduled batch that has not come due yet waits; one whose run failed needs a person. */
function displayStatus(b: Batch): { label: string; tone: "grey" | "blue" | "amber" | "green" | "red" } {
  if (b.status === "approved" && b.scheduled_for && !b.scheduled_run_at && new Date(b.scheduled_for).getTime() > Date.now()) {
    return { label: `Scheduled ${whenFmt(b.scheduled_for)}`, tone: "blue" };
  }
  if (b.status === "approved" && b.scheduled_error) return { label: "Needs you", tone: "amber" };
  return STATUS[b.status] ?? { label: b.status, tone: "grey" };
}

/** Batches that still need someone to do something, shown before finished ones. */
const ACTIONABLE = new Set(["pending_approval", "approved", "awaiting_funding"]);

const STATUS: Record<string, { label: string; tone: "grey" | "blue" | "amber" | "green" | "red" }> = {
  pending_approval: { label: "Needs approval", tone: "amber" },
  approved: { label: "Ready to fund", tone: "blue" },
  awaiting_funding: { label: "Funding", tone: "blue" },
  executed: { label: "Paid", tone: "green" },
  cancelled: { label: "Cancelled", tone: "grey" },
  rejected: { label: "Rejected", tone: "red" },
};

export function PayoutsTab({ orgId, myRole, myUserId, treasury, goWallet, openBatchId }: { orgId: string; myRole: PartnerRole; myUserId?: string; treasury: Treasury; goWallet: () => void; openBatchId?: string | null }) {
  const call = usePartnerApi();
  const base = `partners/${encodeURIComponent(orgId)}`;

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Batch | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { confirm, dialog } = useConfirm();

  const canCreate = myRole === "owner" || myRole === "admin" || myRole === "payer";
  const canApprove = myRole === "owner" || myRole === "admin";
  const ts = treasury.state;
  const canPropose = !!ts && ts.created && ts.am_member;

  const load = useCallback(() => {
    call<Batch[]>(`${base}/batches`).then((b) => (setBatches(b), setLoaded(true))).catch((e: Error) => (setError(e.message), setLoaded(true)));
  }, [call, base]);
  useEffect(load, [load]);

  // A batch drafted from the partner's own platform arrives as a link: open it straight away, once.
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (!openBatchId || openedFromLink.current) return;
    openedFromLink.current = true;
    call<Batch>(`${base}/batches/${encodeURIComponent(openBatchId)}`).then(setOpen).catch((e: Error) => setError(e.message));
  }, [openBatchId, call, base]);

  const openBatch = async (id: string) => {
    try {
      setOpen(await call<Batch>(`${base}/batches/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => setPicked(new Set()), [open?.id]);

  // Money is on its way (waiting for approval, or being moved to the recipients): keep the batch fresh until it is done.
  const openId = open?.id;
  const inProgress = !!open?.funding_in_progress;
  useEffect(() => {
    if (!openId || !inProgress) return;
    const t = setInterval(() => {
      call<Batch>(`${base}/batches/${openId}`).then((b) => (setOpen((cur) => (cur?.id === b.id ? b : cur)), load())).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [openId, inProgress, call, base, load]);

  /** A payout the company can still take back: funded, not withdrawn, not already taken back. */
  const takeBackable = (i: Item) => i.status === "funded" && !!i.payment_id && !i.withdrawn && i.payment_status !== "CANCELLED";

  /** Sends the money of the chosen payouts (or every funded one) back to the company wallet. */
  const takeBack = async (b: Batch, ids?: string[]) => {
    const rows = (b.items ?? []).filter((i) => takeBackable(i) && (!ids || ids.includes(i.payment_id as string)));
    if (!rows.length) return;
    const total = rows.reduce((a, i) => a + i.amount, 0);
    const many = rows.length === 1 ? "this payout" : `these ${rows.length} payouts`;
    if (!(await confirm({ title: `Take back ${usd(total)}?`, body: `The money of ${many} returns to your company wallet, and ${rows.length === 1 ? "they" : "these people"} will no longer be able to withdraw ${rows.length === 1 ? "it" : "it"}.`, confirmLabel: rows.length === 1 ? "Take back" : `Take back ${rows.length}`, danger: true }))) return;
    return guard("takeback", async () => {
      const out = await call<{ results: Array<{ payment_id: string; ok: boolean; error?: string }>; refunded_usdc: number }>(
        `${base}/batches/${b.id}/cancel-payouts`,
        post(ids ? { payment_ids: ids } : {}),
      );
      const failed = out.results.filter((r) => !r.ok);
      if (out.refunded_usdc > 0) setOk(`${usd(out.refunded_usdc)} is back in your company wallet.${failed.length ? ` ${failed.length} could not be taken back.` : ""}`);
      if (failed.length) setError(failed.map((r) => r.error).filter(Boolean).join(" "));
      setPicked(new Set());
      await openBatch(b.id);
    });
  };

  const guard = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    setOk(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      load();
      notifyTreasuryChanged();
    }
  };

  /** Saves the rows as a draft batch. Returns true once saved, so the builder can clear itself. */
  const createDraft = async (rows: DraftRow[], label: string, scheduledFor?: string): Promise<boolean> => {
    let saved = false;
    await guard("create", async () => {
      if (!rows.length) throw new Error("Add at least one payout.");
      const b = await call<Batch>(
        `${base}/batches`,
        post({
          idempotency_key: idemKey,
          label: label || undefined,
          ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
          rows: rows.map((r) => ({ recipient_type: r.type, recipient_identifier: r.identifier, amount: r.amount, ...(r.message ? { message: r.message } : {}) })),
        }),
      );
      setIdemKey(crypto.randomUUID());
      setOk(
        b.status === "pending_approval"
          ? "Saved. A second member needs to approve it before it can be funded."
          : scheduledFor
            ? `Saved. We will prepare it on ${whenFmt(scheduledFor)} and ask your signers to approve the funding.`
            : "Saved and ready to fund.",
      );
      setOpen(await call<Batch>(`${base}/batches/${b.id}`));
      saved = true;
      setCreating(false);
    });
    return saved;
  };

  const approve = (b: Batch) =>
    guard("approve", async () => {
      await call(`${base}/batches/${b.id}/approve`, post({ rows_hash: b.rows_hash }));
      setOk("Approved.");
      await openBatch(b.id);
    });

  const cancel = (b: Batch) =>
    guard("cancel", async () => {
      await call(`${base}/batches/${b.id}/cancel`, post());
      setOpen(null);
    });

  const removeBatch = async (b: Batch) => {
    if (!(await confirm({ title: "Remove this batch?", body: "It is cancelled, so no money is involved. It disappears from your list.", confirmLabel: "Remove", danger: true }))) return;
    return guard("remove", async () => {
      await call(`${base}/batches/${b.id}`, { method: "DELETE" });
      setOpen(null);
      load();
    });
  };

  /**
   * Prepare (the server creates the burner payouts), then build one proposal per chunk and sign each
   * with this member's wallet. When that signature is enough on its own (a company wallet that needs
   * one approval) the payouts are sent straight away. Otherwise the other signers approve them under
   * Wallet and the last one sends them.
   */
  const fund = (b: Batch) =>
    guard("fund", async () => {
      if (!ts || !ts.created) throw new Error("Create your company wallet first.");
      if (!canPropose) throw new Error("Your Loofta wallet is not a signer of the company wallet.");
      // A big batch is prepared in several rounds. Ask again until every payout exists.
      let prep = await call<{ preparing?: boolean; remaining?: number }>(`${base}/batches/${b.id}/prepare`, post());
      for (let round = 0; prep.preparing && round < 120; round++) {
        setOk(`Preparing the payouts, ${prep.remaining ?? 0} to go...`);
        prep = await call<{ preparing?: boolean; remaining?: number }>(`${base}/batches/${b.id}/prepare`, post());
      }
      if (prep.preparing) throw new Error("Preparing is taking longer than expected. Open the batch again to continue.");
      let made = 0;
      let sent = 0;
      for (let i = 0; i < 60; i++) {
        const built = await call<{ done: boolean; proposal_id?: string; unsigned_transaction?: string }>(`${base}/treasury/batches/${b.id}/proposal`, post());
        if (built.done || !built.unsigned_transaction || !built.proposal_id) break;
        const signature = await treasury.signAndSend(built.unsigned_transaction);
        const after = await call<TreasuryState>(`${base}/treasury/proposals/${built.proposal_id}/confirm`, post({ signature }));
        made++;
        const mine = after.created ? after.proposals.find((p) => p.id === built.proposal_id) : undefined;
        if (mine?.can_execute) {
          const run = await call<{ unsigned_transaction: string }>(`${base}/treasury/proposals/${built.proposal_id}/execute`, post());
          const runSig = await treasury.signAndSend(run.unsigned_transaction);
          await call(`${base}/treasury/proposals/${built.proposal_id}/confirm`, post({ signature: runSig }));
          const view = await call<{ status: string }>(`${base}/batches/${b.id}/confirm`, post({ signatures: [runSig] }));
          sent++;
          if (view.status === "executed") break; // every payout is funded, nothing left to propose
        }
      }
      await treasury.refresh();
      if (!made) throw new Error("Nothing to fund. Check the rows for errors.");
      const fresh = await call<Batch>(`${base}/batches/${b.id}`);
      setOpen(fresh);
      setOk(
        sent !== made
          ? `${made - sent} step${made - sent === 1 ? "" : "s"} waiting for approval. Your signers approve them under Wallet, then they are sent.`
          : fresh.status === "executed"
            ? "Paid. Recipients have been notified."
            : "Sent. The money is being moved to your recipients, this takes under a minute. They are notified when it lands.",
      );
    });

  const showBuilder = canCreate && loaded && (creating || batches.length === 0);
  const solo = !!ts && ts.created && ts.threshold === 1;

  return (
    <>
      {dialog}
      <PageHeader
        crumb="Partner portal / Payouts"
        title="Pay your people"
        blurb={
          showBuilder
            ? "Bring a list of people and amounts. Your signers approve it, then it is sent from your company wallet."
            : "Payouts waiting to be sent come first. Start a new batch whenever you are ready."
        }
        corner={
          canCreate ? (
            showBuilder ? (
              batches.length > 0 && (
                <Btn kind="ghost" onClick={() => setCreating(false)}>
                  Back to payouts
                </Btn>
              )
            ) : (
              <Btn onClick={() => (setOpen(null), setCreating(true))}>New batch</Btn>
            )
          ) : undefined
        }
      />

      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {ok && (
        <div className="mb-6">
          <Notice kind="ok">{ok}</Notice>
        </div>
      )}

      {ts && !ts.created && (
        <div className="mb-8">
          <Notice kind="info">
            You need a company wallet before you can pay people.{" "}
            <button type="button" onClick={goWallet} className="font-semibold text-[#FF6A1F] hover:underline">
              Set it up under Wallet
            </button>
          </Notice>
        </div>
      )}
      {ts && ts.created && ts.proposals.some((p) => p.kind === "payout" && ["active", "approved"].includes(p.status)) && (
        <Section title="Waiting for approval" desc="Your signers approve each step, then it is sent.">
          <ProposalsPanel treasury={treasury} only={(p) => p.kind === "payout" && ["active", "approved"].includes(p.status)} onDone={load} />
        </Section>
      )}

      {showBuilder && <BatchBuilder base={base} onSubmit={createDraft} />}

      {!showBuilder && open && (
        <Section
          title={open.label || "Batch"}
          desc={`${open.item_count} payouts · ${usd(open.total_amount)}`}
          right={<Pill tone={displayStatus(open).tone} dot>{displayStatus(open).label}</Pill>}
        >
          {(() => {
            const pickable = canApprove && !!open.items?.some(takeBackable);
            const template = pickable ? "36px minmax(0,1fr) 120px 200px" : "minmax(0,1fr) 120px 200px";
            return (
              <Table cols={pickable ? ["", "Recipient", "Amount", "Status"] : ["Recipient", "Amount", "Status"]} template={template}>
                {open.items?.map((i) => (
                  <Row key={i.row_index} template={template}>
                    {pickable && (
                      <span>
                        {takeBackable(i) && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${i.recipient_identifier}`}
                            className="h-5 w-5 accent-[#EA5B30]"
                            checked={picked.has(i.payment_id as string)}
                            onChange={(e) =>
                              setPicked((p) => {
                                const next = new Set(p);
                                if (e.target.checked) next.add(i.payment_id as string);
                                else next.delete(i.payment_id as string);
                                return next;
                              })
                            }
                          />
                        )}
                      </span>
                    )}
                    <span className="truncate font-mono text-[13.5px]">{i.recipient_identifier}</span>
                    <span>{i.amount.toFixed(2)}</span>
                    <span className="text-[color:var(--pt-ink2,#C9C9D0)]">
                      {i.error ? i.error : i.withdrawn ? "Withdrawn" : i.payment_status === "CANCELLED" ? "Taken back" : i.status === "funded" ? "Funded" : i.status}
                    </span>
                  </Row>
                ))}
              </Table>
            );
          })()}
          {open.status === "approved" && open.scheduled_for && !open.scheduled_run_at && new Date(open.scheduled_for).getTime() > Date.now() && (
            <div className="mt-5">
              <Notice kind="info">
                Scheduled for {whenFmt(open.scheduled_for)}. We prepare it then and ask your signers to approve the funding. Nothing is sent until they do. Cancel it to change plans.
              </Notice>
            </div>
          )}
          {open.status === "approved" && open.scheduled_error && (
            <div className="mt-5">
              <Notice kind="error">The scheduled run could not prepare this batch: {open.scheduled_error} You can still fund it by hand below.</Notice>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {open.status === "pending_approval" && open.created_by_user_id === myUserId && (
              <span className="mr-auto text-[14px] text-[color:var(--pt-ink2,#C9C9D0)]">You created this batch, so another owner or admin has to approve it.</span>
            )}
            <Btn kind="ghost" onClick={() => setOpen(null)}>
              Close
            </Btn>
            {(open.status === "cancelled" || open.status === "rejected") && canCreate && (
              <Btn kind="danger" onClick={() => void removeBatch(open)} disabled={busy !== null}>
                {busy === "remove" ? "Removing..." : "Remove batch"}
              </Btn>
            )}
            {(open.status === "pending_approval" || open.status === "approved") && canCreate && (
              <Btn kind="danger" onClick={() => cancel(open)} disabled={busy !== null}>
                Cancel batch
              </Btn>
            )}
            {canApprove && !!open.items?.some(takeBackable) && (
              <>
                {picked.size > 0 && (
                  <Btn kind="danger" onClick={() => void takeBack(open, [...picked])} disabled={busy !== null}>
                    {busy === "takeback" ? "Taking back..." : `Take back selected (${picked.size})`}
                  </Btn>
                )}
                <Btn kind="danger" onClick={() => void takeBack(open)} disabled={busy !== null}>
                  {busy === "takeback" ? "Taking back..." : `Take back all (${open.items.filter(takeBackable).length})`}
                </Btn>
              </>
            )}
            {open.status === "pending_approval" && canApprove && open.created_by_user_id !== myUserId && (
              <Btn onClick={() => approve(open)} disabled={busy !== null}>
                Approve batch
              </Btn>
            )}
            {(open.status === "approved" || open.status === "awaiting_funding") && canCreate && (
              <Btn
                onClick={() => fund(open)}
                disabled={busy !== null || !!open.funding_in_progress || !canPropose || (open.status === "approved" && !!open.scheduled_for && !open.scheduled_run_at && new Date(open.scheduled_for).getTime() > Date.now())}
              >
                {busy === "fund" ? "Paying..." : open.funding_in_progress ? "Sending..." : solo ? "Pay now" : "Send for approval"}
              </Btn>
            )}
          </div>
        </Section>
      )}

      {!showBuilder && !open && (
        <Section title="Payouts" desc="Ready to send first, then everything you have drafted or paid.">
          {!loaded ? (
            <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">Loading...</p>
          ) : !batches.length ? (
            <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">No payouts yet.</p>
          ) : (
            <Table cols={["Batch", "Total", "Payouts", "Status"]} template="minmax(0,1fr) 140px 110px 190px">
              {[...batches]
                .sort((x, y) => (ACTIONABLE.has(y.status) ? 1 : 0) - (ACTIONABLE.has(x.status) ? 1 : 0))
                .map((b) => (
                  <Row key={b.id} template="minmax(0,1fr) 140px 110px 190px" onClick={() => void openBatch(b.id)}>
                    <span className="truncate">{b.label || new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span>{usd(b.total_amount)}</span>
                    <span>{b.item_count}</span>
                    <span>
                      <Pill tone={displayStatus(b).tone} dot>
                        {displayStatus(b).label}
                      </Pill>
                    </span>
                  </Row>
                ))}
            </Table>
          )}
        </Section>
      )}
    </>
  );
}
