"use client";

import { useState } from "react";
import { NiceSelect } from "@/components/ui/NiceSelect";
import { Btn, CodeBox, CopyIcon, Notice, PageHeader, Pill, Row, Section, StatCard, Table } from "./ui";
import { post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";
import type { Treasury, TreasuryProposal } from "./useTreasury";

const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;
const STATUS: Record<TreasuryProposal["status"], { label: string; tone: "grey" | "blue" | "amber" | "green" | "red" }> = {
  draft: { label: "Not sent", tone: "grey" },
  active: { label: "Needs approval", tone: "amber" },
  approved: { label: "Ready to run", tone: "blue" },
  executed: { label: "Done", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  cancelled: { label: "Cancelled", tone: "grey" },
  stale: { label: "Out of date", tone: "grey" },
};

function describe(p: TreasuryProposal): string {
  if (p.kind === "payout") return `Pay ${p.summary.payouts ?? 0} people, ${usd(p.summary.total_usdc)} plus ${usd(p.summary.gas_usdc)} network fees${p.summary.label ? ` · ${p.summary.label}` : ""}`;
  const parts = (p.summary.actions ?? []).map((a) =>
    a.type === "add_member" ? `Add ${a.name ?? short(a.wallet)}` : a.type === "remove_member" ? `Remove ${a.name ?? short(a.wallet)}` : `Require ${a.role} approvals`,
  );
  return parts.join(", ") || "Change signers";
}

/** What the team needs to act on: approve or reject, then run once enough have approved. */
export function ProposalsPanel({ treasury, onDone, only }: { treasury: Treasury; onDone?: () => void; only?: (p: TreasuryProposal) => boolean }) {
  const call = usePartnerApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const s = treasury.state;
  if (!s || !s.created) return null;
  const list = s.proposals.filter((p) => (only ? only(p) : true));
  if (!list.length) return null;

  const run = async (p: TreasuryProposal, action: "approve" | "reject" | "execute") => {
    setBusy(p.id + action);
    setError(null);
    setOk(null);
    try {
      const done = await treasury.act(`proposals/${p.id}/${action}`);
      // Running a payout proposal moved the money: have the server read the chain and mark those payouts funded.
      if (action === "execute" && p.kind === "payout" && p.batch_id && treasury.base) {
        await call(`${treasury.base.replace(/\/treasury$/, "")}/batches/${p.batch_id}/confirm`, post({ signatures: [done.signature] }));
      }
      setOk(action === "execute" ? "Done." : action === "approve" ? "Approved." : "Rejected.");
      await treasury.refresh();
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice kind="error">{error}</Notice>}
      {ok && <Notice kind="ok">{ok}</Notice>}
      {list.map((p) => (
        <div key={p.id} className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] bg-[color:var(--pt-surface,#121214)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-[15px] font-medium text-[color:var(--pt-ink,#EDEDEF)]">{describe(p)}</div>
            <Pill tone={STATUS[p.status].tone} dot>
              {STATUS[p.status].label}
            </Pill>
          </div>
          <div className="text-[14px] text-[color:var(--pt-ink2b,#B4B4BC)]">
            {p.approvals_count} of {p.approvals_needed} approvals{p.approvals.length ? ` · ${p.approvals.join(", ")}` : ""}
          </div>
          {p.status === "stale" && <div className="text-[14px] text-[color:var(--pt-ink2b,#B4B4BC)]">The signers or approvals needed changed after this was created, so it can no longer run. Create it again.</div>}
          <div className="flex flex-wrap justify-end gap-2.5">
            {p.can_approve && (
              <>
                <Btn kind="danger" disabled={busy !== null} onClick={() => void run(p, "reject")}>
                  Reject
                </Btn>
                <Btn disabled={busy !== null} onClick={() => void run(p, "approve")}>
                  {busy === p.id + "approve" ? "Approving..." : "Approve"}
                </Btn>
              </>
            )}
            {p.can_execute && (
              <Btn disabled={busy !== null} onClick={() => void run(p, "execute")}>
                {busy === p.id + "execute" ? "Running..." : p.kind === "payout" ? "Send the payouts" : "Apply the change"}
              </Btn>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WalletTab({ orgId, myRole, treasury }: { orgId: string; myRole: PartnerRole; treasury: Treasury }) {
  const call = usePartnerApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);
  const s = treasury.state;
  const isOwner = myRole === "owner";
  const canManage = myRole === "owner" || myRole === "admin";

  const guard = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    setOk(null);
    try {
      await fn();
      await treasury.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    guard("create", async () => {
      await call(`partners/${encodeURIComponent(orgId)}/treasury/create`, post());
      setOk("Your company wallet is ready.");
    });

  const change = (name: string, body: Record<string, unknown>, done: string) =>
    guard(name, async () => {
      await treasury.act("config", body);
      setOk(done);
    });

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <PageHeader
        crumb="Partner portal / Wallet"
        title="Company wallet"
        blurb="A shared wallet your team controls. Money only moves when enough of your signers approve, and Loofta can never move it."
      />
      {(error || treasury.error) && (
        <div className="mb-6">
          <Notice kind="error">{error ?? treasury.error}</Notice>
        </div>
      )}
      {ok && (
        <div className="mb-6">
          <Notice kind="ok">{ok}</Notice>
        </div>
      )}

      {!s ? (
        <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">Loading...</p>
      ) : !s.created ? (
        <Section title="Create your company wallet" desc="Your own Loofta wallet becomes the first signer, and you can add teammates and choose how many approvals are needed afterwards.">
          <div className="space-y-4">
            <p className="max-w-2xl text-[15px] leading-7 text-[color:var(--pt-ink2,#C9C9D0)]">
              Loofta pays the one-off setup cost{s.creation_fee_sol !== null ? ` (about ${s.creation_fee_sol} SOL)` : ""}. Loofta is not a signer, so only you and the people you add can move the money.
            </p>
            {s.can_create ? (
              <div className="flex justify-end">
                <Btn onClick={create} disabled={busy !== null || !s.my_wallet}>
                  {busy === "create" ? "Creating..." : "Create company wallet"}
                </Btn>
              </div>
            ) : (
              <Notice kind="info">Only an owner can create the company wallet.</Notice>
            )}
          </div>
        </Section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="USDC" value={usd(s.usdc)} hint="Available to pay out" />
            <StatCard label="Approvals needed" value={`${s.threshold} of ${s.members.filter((m) => m.can_vote).length}`} hint="Signers who can approve" />
            <StatCard label="Network fees" value="In USDC" hint="A few cents per payout step" />
          </div>

          <Section title="Needs attention" desc="Approve a payout or change, then run it once enough signers have approved.">
            {s.proposals.some((p) => ["active", "approved", "stale"].includes(p.status)) ? (
              <ProposalsPanel treasury={treasury} only={(p) => ["active", "approved", "stale"].includes(p.status)} />
            ) : (
              <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">Nothing is waiting for approval.</p>
            )}
          </Section>

          <Section title="Deposit address" desc="Send USDC on Solana to this address to fund payouts. You do not need SOL.">
            <CodeBox plain title="Company wallet · Solana" value={s.vault} copied={copied} onCopy={() => copy(s.vault)} />
            <div className="mt-3">
              <Btn kind="ghost" onClick={() => void treasury.refresh()}>
                <CopyIcon /> Refresh balance
              </Btn>
            </div>
          </Section>

          <Section title="Signers" desc="People whose own Loofta wallet can approve. A payer can propose payouts but not approve them.">
            <Table cols={["Signer", "Wallet", "Can", ""]} template="minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 110px">
              {s.members.map((m) => (
                <Row key={m.wallet} template="minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 110px">
                  <span className="truncate font-medium">{m.is_me ? "You" : m.name ?? "Team member"}</span>
                  <span className="truncate font-mono text-[13.5px] text-[color:var(--pt-ink2,#C9C9D0)]">{short(m.wallet)}</span>
                  <span className="text-[color:var(--pt-ink2,#C9C9D0)]">{[m.can_initiate && "propose", m.can_vote && "approve", m.can_execute && "run"].filter(Boolean).join(", ")}</span>
                  <span className="text-right">
                    {canManage && m.member_id && !m.is_me && (
                      <Btn kind="ghost" disabled={busy !== null || !s.am_member} onClick={() => void change("remove" + m.wallet, { remove_member_ids: [m.member_id] }, "Proposed. The change applies once enough signers approve it.")}>
                        Remove
                      </Btn>
                    )}
                  </span>
                </Row>
              ))}
            </Table>
            {canManage && s.addable.length > 0 && (
              <div className="mt-5 flex flex-col gap-3">
                {s.addable.map((a) => (
                  <div key={a.member_id} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] bg-[color:var(--pt-surface,#121214)] px-5 py-3.5">
                    <div className="text-[15px] text-[color:var(--pt-ink,#EDEDEF)]">
                      {a.name ?? "Team member"} <span className="text-[color:var(--pt-ink3,#9C9CA5)]">· {a.role}</span>
                    </div>
                    <Btn disabled={busy !== null || !s.am_member} onClick={() => void change("add" + a.member_id, { add_member_ids: [a.member_id] }, "Proposed. They become a signer once enough signers approve.")}>
                      {busy === "add" + a.member_id ? "Proposing..." : "Add as signer"}
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {isOwner && (
            <Section title="Approvals needed" desc="How many signers must approve before money moves. Changing this is itself approved by the current signers.">
              <div className="flex flex-wrap items-center gap-3">
                <NiceSelect
                  className="w-48"
                  value={threshold ?? s.threshold}
                  onChange={(n) => setThreshold(Number(n))}
                  options={Array.from({ length: Math.max(1, s.members.filter((m) => m.can_vote).length) }, (_, i) => i + 1).map((n) => ({ value: n, label: `${n} approval${n === 1 ? "" : "s"}` }))}
                />
                <Btn
                  disabled={busy !== null || !s.am_member || (threshold ?? s.threshold) === s.threshold}
                  onClick={() => void change("threshold", { threshold: threshold ?? s.threshold }, "Proposed. It applies once enough signers approve.")}
                >
                  {busy === "threshold" ? "Proposing..." : "Propose change"}
                </Btn>
              </div>
            </Section>
          )}

          {!s.am_member && <Notice kind="info">Your Loofta wallet is not a signer yet. Ask an owner to add you to be able to approve and run payouts.</Notice>}
        </>
      )}
    </>
  );
}
