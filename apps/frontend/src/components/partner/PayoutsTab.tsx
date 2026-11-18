"use client";

import { useCallback, useEffect, useState } from "react";
import { BatchBuilder, type DraftRow } from "./BatchBuilder";
import { Btn, Notice, PageHeader, Pill, Row, Section, Table } from "./ui";
import { post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";
import type { Treasury, TreasuryState } from "./useTreasury";
import { ProposalsPanel } from "./WalletTab";

type Item = {
  row_index: number;
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
  items?: Item[];
};

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

export function PayoutsTab({ orgId, myRole, myUserId, treasury, goWallet }: { orgId: string; myRole: PartnerRole; myUserId?: string; treasury: Treasury; goWallet: () => void }) {
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

  const canCreate = myRole === "owner" || myRole === "admin" || myRole === "payer";
  const canApprove = myRole === "owner" || myRole === "admin";
  const ts = treasury.state;
  const canPropose = !!ts && ts.created && ts.am_member;

  const load = useCallback(() => {
    call<Batch[]>(`${base}/batches`).then((b) => (setBatches(b), setLoaded(true))).catch((e: Error) => (setError(e.message), setLoaded(true)));
  }, [call, base]);
  useEffect(load, [load]);

  const openBatch = async (id: string) => {
    try {
      setOpen(await call<Batch>(`${base}/batches/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
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
    }
  };

  /** Saves the rows as a draft batch. Returns true once saved, so the builder can clear itself. */
  const createDraft = async (rows: DraftRow[], label: string): Promise<boolean> => {
    let saved = false;
    await guard("create", async () => {
      if (!rows.length) throw new Error("Add at least one payout.");
      const b = await call<Batch>(
        `${base}/batches`,
        post({
          idempotency_key: idemKey,
          label: label || undefined,
          rows: rows.map((r) => ({ recipient_type: r.type, recipient_identifier: r.identifier, amount: r.amount, ...(r.message ? { message: r.message } : {}) })),
        }),
      );
      setIdemKey(crypto.randomUUID());
      setOk(b.status === "pending_approval" ? "Saved. A second member needs to approve it before it can be funded." : "Saved and ready to fund.");
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
      await call(`${base}/batches/${b.id}/prepare`, post());
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
      setOk(
        sent === made
          ? "Paid. Recipients have been notified."
          : `${made - sent} step${made - sent === 1 ? "" : "s"} waiting for approval. Your signers approve them under Wallet, then they are sent.`,
      );
      await openBatch(b.id);
    });

  const showBuilder = canCreate && loaded && (creating || batches.length === 0);
  const solo = !!ts && ts.created && ts.threshold === 1;

  return (
    <>
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
          right={<Pill tone={STATUS[open.status]?.tone ?? "grey"} dot>{STATUS[open.status]?.label ?? open.status}</Pill>}
        >
          <Table cols={["Recipient", "Amount", "Status"]} template="minmax(0,1fr) 120px 200px">
            {open.items?.map((i) => (
              <Row key={i.row_index} template="minmax(0,1fr) 120px 200px">
                <span className="truncate font-mono text-[13.5px]">{i.recipient_identifier}</span>
                <span>{i.amount.toFixed(2)}</span>
                <span className="text-[#C9C9D0]">{i.error ? i.error : i.withdrawn ? "Withdrawn" : i.status === "funded" ? "Funded" : i.status}</span>
              </Row>
            ))}
          </Table>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {open.status === "pending_approval" && open.created_by_user_id === myUserId && (
              <span className="mr-auto text-[14px] text-[#C9C9D0]">You created this batch, so another owner or admin has to approve it.</span>
            )}
            <Btn kind="ghost" onClick={() => setOpen(null)}>
              Close
            </Btn>
            {(open.status === "pending_approval" || open.status === "approved") && canCreate && (
              <Btn kind="danger" onClick={() => cancel(open)} disabled={busy !== null}>
                Cancel batch
              </Btn>
            )}
            {open.status === "pending_approval" && canApprove && open.created_by_user_id !== myUserId && (
              <Btn onClick={() => approve(open)} disabled={busy !== null}>
                Approve batch
              </Btn>
            )}
            {(open.status === "approved" || open.status === "awaiting_funding") && canCreate && (
              <Btn onClick={() => fund(open)} disabled={busy !== null || !canPropose}>
                {busy === "fund" ? "Paying..." : solo ? "Pay now" : "Send for approval"}
              </Btn>
            )}
          </div>
        </Section>
      )}

      {!showBuilder && (
        <Section title="Payouts" desc="Ready to send first, then everything you have drafted or paid.">
          {!loaded ? (
            <p className="text-[15px] text-[#C9C9D0]">Loading...</p>
          ) : !batches.length ? (
            <p className="text-[15px] text-[#C9C9D0]">No payouts yet.</p>
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
                      <Pill tone={STATUS[b.status]?.tone ?? "grey"} dot>
                        {STATUS[b.status]?.label ?? b.status}
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
