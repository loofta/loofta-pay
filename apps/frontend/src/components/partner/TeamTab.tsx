"use client";

import { useCallback, useEffect, useState } from "react";
import { NiceSelect } from "@/components/ui/NiceSelect";
import { Avatar, Btn, Notice, PageHeader, Pill, Section, inputCls } from "./ui";
import { patch, post, usePartnerApi, type PartnerRole } from "./usePartnerApi";

type Member = { id: string; user_id: string | null; email: string | null; role: PartnerRole; status: "invited" | "active"; invite_expires_at: string | null };

const ROLE_HELP: Record<PartnerRole, string> = {
  owner: "Everything, including your fee wallet and approval limit.",
  admin: "Settings, team, API keys, approve and create batches.",
  payer: "Create and fund batches.",
  viewer: "Read-only.",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TeamTab({ orgId, myRole, myUserId }: { orgId: string; myRole: PartnerRole; myUserId?: string }) {
  const call = usePartnerApi();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PartnerRole>("payer");
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = myRole === "owner" || myRole === "admin";
  const base = `partners/${encodeURIComponent(orgId)}`;

  const load = useCallback(() => {
    call<{ members: Member[] }>(`${base}/members`).then((r) => setMembers(r.members ?? [])).catch((e: Error) => setError(e.message));
  }, [call, base]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    run(async () => {
      const r = await call<{ token: string; email_sent?: boolean }>(`${base}/members/invite`, post({ email, role }));
      setLink(`${window.location.origin}/partner/portal?invite=${encodeURIComponent(r.token)}`);
      setEmailed(r.email_sent ? email : null);
      setEmail("");
    });

  const roleList: Array<{ value: string; label: string }> = [
    ...(myRole === "owner" ? [{ value: "owner", label: "Owner" }, { value: "admin", label: "Admin" }] : []),
    { value: "payer", label: "Payer" },
    { value: "viewer", label: "Viewer" },
  ];

  return (
    <>
      <PageHeader crumb="Partner portal / Team" title="Your team" blurb="Invite teammates to prepare batches and follow activity." />
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      {canManage && (
        <Section title="Invite" desc={ROLE_HELP[role]}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input className={`${inputCls} flex-1`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@acme.com" />
            <NiceSelect className="sm:w-44" buttonClassName="py-3" value={role} onChange={(v) => setRole(v as PartnerRole)} options={roleList} />
            <Btn onClick={invite} disabled={busy || !email.includes("@")}>
              Send invite
            </Btn>
          </div>
          {link && (
            <div className="mt-4 space-y-3">
              <Notice kind="ok">{emailed ? `We emailed the invite to ${emailed}. ` : "We could not email it, so share this link with them. "}The link works once, for 7 days, and only after they sign in with that email.</Notice>
              <input readOnly value={link} className={inputCls} onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
        </Section>
      )}

      <div className={canManage ? "mt-8" : ""}>
        <div className="overflow-hidden rounded-2xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface2,#101012)]">
          <div className="divide-y divide-[color:var(--pt-w10,rgba(255,255,255,0.1))]">
            {members.map((m) => {
              const name = m.email ?? (m.user_id === myUserId ? "You" : "Member");
              return (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div className="flex items-center gap-4">
                    <Avatar name={name} size={40} />
                    <div>
                      <div className="text-[15px] font-medium text-[color:var(--pt-ink,#EDEDEF)]">{name}</div>
                      {m.status === "invited" && <div className="text-[14px] text-[color:var(--pt-ink3,#9C9CA5)]">Invite pending</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {canManage && m.user_id !== myUserId && m.status === "active" ? (
                      <NiceSelect className="w-36" buttonClassName="py-2" value={m.role} disabled={busy} onChange={(v) => void run(() => call(`${base}/members/${m.id}`, patch({ role: v })))} options={roleList} />
                    ) : (
                      <Pill>{cap(m.role)}</Pill>
                    )}
                    {canManage && m.user_id !== myUserId && (
                      <Btn
                        kind="ghost"
                        disabled={busy}
                        onClick={() => void run(() => call(`${base}/${m.status === "invited" ? "invites" : "members"}/${m.id}`, { method: "DELETE" }))}
                      >
                        {m.status === "invited" ? "Revoke" : "Remove"}
                      </Btn>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
