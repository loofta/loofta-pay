"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Btn, Notice, PageHeader, Pill, Row, Section, StatCard, Table } from "./ui";
import { post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";

type KycRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  kyc_status: "requested" | "in_progress" | "passed" | "failed";
  kyc_requested_at: string | null;
  kyc_passed_at: string | null;
  kyc_fee_usd: number | null;
};
type Overview = {
  enabled: boolean;
  available: boolean;
  fee_usd: number;
  counts: { requested: number; in_progress: number; passed: number; failed: number };
  owed_usd: number;
  recipients: KycRow[];
};
type Candidate = { id: string; display_name: string | null; email: string | null };

const STATUS: Record<KycRow["kyc_status"], { label: string; tone: "grey" | "blue" | "green" | "red" }> = {
  requested: { label: "Requested", tone: "grey" },
  in_progress: { label: "In progress", tone: "blue" },
  passed: { label: "Verified", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};
const TEMPLATE = "minmax(0,1.3fr) minmax(0,1.4fr) 130px 80px 110px";

/** Identity checks (zkMe) for recipients, on request. Prepared for the withdraw flow; nothing blocks a withdrawal yet. */
export function KycTab({ orgId, myRole }: { orgId: string; myRole: PartnerRole }) {
  const call = usePartnerApi();
  const base = `partners/${encodeURIComponent(orgId)}`;
  const [data, setData] = useState<Overview | null>(null);
  const [people, setPeople] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRequest = myRole === "owner" || myRole === "admin";

  const load = useCallback(() => {
    call<Overview>(`${base}/kyc`).then(setData).catch((e: Error) => setError(e.message));
    call<{ recipients: Candidate[] }>(`${base}/recipients`).then((r) => setPeople(r.recipients ?? [])).catch(() => {});
  }, [call, base]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      setOk(await fn());
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const request = () =>
    run(async () => {
      const r = await call<{ requested: number; skipped: number; emailed: number }>(`${base}/kyc/request`, post({ recipient_ids: [...picked] }));
      setPicked(new Set());
      return `Requested ${r.requested} check${r.requested === 1 ? "" : "s"} and emailed ${r.emailed}.${r.skipped ? ` ${r.skipped} skipped (no email, or already checked).` : ""}`;
    });
  const resend = (id: string) =>
    run(async () => {
      const r = await call<{ emailed: number }>(`${base}/kyc/resend`, post({ recipient_ids: [id] }));
      return r.emailed ? "Email sent again." : "The email could not be sent.";
    });
  const refresh = () =>
    run(async () => {
      const r = await call<{ checked: number; updated: number }>(`${base}/kyc/refresh`, post());
      return `Checked ${r.checked}, ${r.updated} changed.`;
    });

  const already = new Set((data?.recipients ?? []).filter((r) => r.kyc_status !== "failed").map((r) => r.id));
  const candidates = people.filter((p) => p.email && !already.has(p.id));
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader crumb="Partner portal / KYC" title="Identity checks" blurb="Ask the people you pay to verify who they are. They get an email, and cannot withdraw until they pass. Only on request, only for the people you pick." />
      {error && <div className="mb-6"><Notice kind="error">{error}</Notice></div>}
      {ok && <div className="mb-6"><Notice kind="ok">{ok}</Notice></div>}

      {!data ? (
        <p className="text-[15px] text-[#6E6E73]">Loading...</p>
      ) : (
        <>
          <Section
            title="Verification"
            desc={`People you ask must verify their identity before they can withdraw the money you send them. They get an email, verify through zkMe (they share proof they passed, not their documents), and the withdraw page unlocks once they pass. Each person you request costs ${usd(data.fee_usd)}.`}
            right={<Pill tone={data.enabled ? "green" : "grey"}>{data.enabled ? "On" : "Off"}</Pill>}
          >
            {!data.enabled && (
              <Notice kind="info">
                Identity checks are off for your organization. This is not self-service yet. To turn them on, message Loofta on{" "}
                <a className="underline" href="https://t.me/looftaxyz" target="_blank" rel="noreferrer">Telegram (looftaxyz)</a> or email{" "}
                <a className="underline" href="mailto:hello@loofta.xyz">hello@loofta.xyz</a>.
              </Notice>
            )}
            {data.enabled && (
              <div className="grid gap-4 sm:grid-cols-4">
                <StatCard label="Verified" value={String(data.counts.passed)} />
                <StatCard label="In progress" value={String(data.counts.requested + data.counts.in_progress)} />
                <StatCard label="Failed" value={String(data.counts.failed)} />
                <StatCard label="Cost so far" value={usd(data.owed_usd)} hint={`${usd(data.fee_usd)} per person`} />
              </div>
            )}
          </Section>

          {data.enabled && (
            <>
              {canRequest && (
                <Section title="Ask for a check" desc="Pick recipients. Only people with an email can be checked.">
                  {candidates.length === 0 ? (
                    <p className="text-[15px] text-[#6E6E73]">Everyone with an email has already been asked. Import more recipients to add people.</p>
                  ) : (
                    <>
                      <div className="max-h-64 overflow-auto rounded-2xl border border-[#E5E5EA] p-2">
                        {candidates.map((p) => (
                          <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-black/[0.04]">
                            <input type="checkbox" className="h-4 w-4 accent-[#EA5B30]" checked={picked.has(p.id)} onChange={() => togglePick(p.id)} />
                            <span className="truncate text-[15px] text-[#1D1D1F]">{p.display_name || p.email}</span>
                            <span className="truncate font-mono text-[13px] text-[#6E6E73]">{p.display_name ? p.email : ""}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Btn disabled={busy || picked.size === 0} onClick={request}>
                          {busy ? "Working..." : `Request ${picked.size || ""} check${picked.size === 1 ? "" : "s"}`.replace("  ", " ")}
                        </Btn>
                        {picked.size > 0 && <span className="text-[14px] text-[#6E6E73]">{usd(picked.size * data.fee_usd)}</span>}
                      </div>
                    </>
                  )}
                </Section>
              )}

              <Section
                title={`Checks (${data.recipients.length})`}
                right={canRequest && data.recipients.length > 0 ? <Btn kind="ghost" disabled={busy} onClick={refresh}>Refresh status</Btn> : undefined}
              >
                {data.recipients.length === 0 ? (
                  <p className="text-[15px] text-[#6E6E73]">No checks requested yet.</p>
                ) : (
                  <Table cols={["Name", "Email", "Status", "Cost", ""]} template={TEMPLATE}>
                    {data.recipients.map((r) => {
                      const s = STATUS[r.kyc_status];
                      const name = r.display_name || r.email || "Recipient";
                      return (
                        <Row key={r.id} template={TEMPLATE}>
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={name} />
                            <span className="truncate font-medium">{name}</span>
                          </div>
                          <span className="truncate font-mono text-[13.5px]">{r.email}</span>
                          <span><Pill tone={s.tone}>{s.label}</Pill></span>
                          <span>{usd(r.kyc_fee_usd)}</span>
                          <span>
                            {canRequest && (r.kyc_status === "requested" || r.kyc_status === "in_progress") && (
                              <button type="button" disabled={busy} className="text-[13.5px] text-[#6E6E73] hover:underline disabled:opacity-40" onClick={() => void resend(r.id)}>
                                Email again
                              </button>
                            )}
                          </span>
                        </Row>
                      );
                    })}
                  </Table>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}
