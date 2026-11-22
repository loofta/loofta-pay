"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Btn, Notice, PageHeader, Pill, Row, Section, Table, inputCls } from "./ui";
import { post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";
import { RecipientGroups } from "./RecipientGroups";
import { NiceSelect } from "@/components/ui/NiceSelect";

type Recipient = {
  id: string;
  display_name: string | null;
  email: string | null;
  handle_platform: string | null;
  handle: string | null;
  external_user_id: string | null;
  paid_usd: number;
  created_at: string;
};

const PLATFORM_LABEL: Record<string, string> = { twitter: "Twitter", discord: "Discord", github: "GitHub", telegram: "Telegram" };

/** One line per person: "email, name" or "platform:handle, name". Anything that does not parse is reported, never guessed. */
function parseLines(text: string) {
  const recipients: Array<Record<string, string>> = [];
  const bad: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [first, ...rest] = line.split(",").map((p) => p.trim());
    const name = rest.join(", ");
    const m = first.match(/^(twitter|discord|github|telegram):(.+)$/i);
    if (m) recipients.push({ handle_platform: m[1].toLowerCase(), handle: m[2].replace(/^@/, ""), ...(name ? { name } : {}) });
    else if (/^\S+@\S+\.\S+$/.test(first)) recipients.push({ email: first, ...(name ? { name } : {}) });
    else bad.push(line);
  }
  return { recipients, bad };
}

const TEMPLATE = "minmax(0,1.3fr) minmax(0,1.4fr) 130px 110px 100px";

export function RecipientsTab({ orgId, myRole }: { orgId: string; myRole: PartnerRole }) {
  const call = usePartnerApi();
  const base = `partners/${encodeURIComponent(orgId)}`;
  const [list, setList] = useState<Recipient[] | null>(null);
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canImport = myRole === "owner" || myRole === "admin";
  const [groupId, setGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<Recipient[] | null>(null);
  const [groupList, setGroupList] = useState<Array<{ id: string; name: string }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [newGroup, setNewGroup] = useState("");

  const loadGroups = useCallback(() => {
    call<{ groups: Array<{ id: string; name: string }> }>(`${base}/groups`).then((r) => setGroupList(r.groups ?? [])).catch(() => {});
  }, [call, base]);
  useEffect(loadGroups, [loadGroups, groupId]);

  const load = useCallback(() => {
    call<{ recipients: Recipient[] }>(`${base}/recipients`).then((r) => setList(r.recipients ?? [])).catch((e: Error) => setError(e.message));
  }, [call, base]);
  useEffect(load, [load]);

  const loadMembers = useCallback(() => {
    if (!groupId) return setMembers(null);
    call<{ recipients: Recipient[] }>(`${base}/groups/${groupId}/members`).then((r) => setMembers(r.recipients ?? [])).catch((e: Error) => setError(e.message));
  }, [call, base, groupId]);
  useEffect(loadMembers, [loadMembers]);

  const doImport = async () => {
    const { recipients, bad } = parseLines(text);
    if (bad.length) return setError(`These lines are not valid: ${bad.slice(0, 3).join(" | ")}${bad.length > 3 ? " ..." : ""}`);
    if (!recipients.length) return setError("Add at least one recipient.");
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await call(`${base}/recipients/import`, post({ recipients }));
      setOk(`Imported ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.`);
      setText("");
      setImporting(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Adds the ticked people to an existing group, or to a brand new one. A person can sit in any number of groups. */
  const addToGroup = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      let gid = target;
      let gname = groupList.find((g) => g.id === gid)?.name ?? "the group";
      if (gid === "__new") {
        const name = newGroup.trim();
        if (!name) throw new Error("Give the new group a name.");
        const g = await call<{ id: string }>(`${base}/groups`, post({ name }));
        gid = g.id;
        gname = name;
      }
      if (!gid) throw new Error("Pick a group first.");
      await call(`${base}/groups/${gid}/members`, post({ recipient_ids: ids }));
      setOk(`Added ${ids.length} ${ids.length === 1 ? "person" : "people"} to ${gname}.`);
      setPicked(new Set());
      setNewGroup("");
      setTarget("");
      loadGroups();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectable = canImport && !groupId;
  const rowsNow = (groupId ? members : list) ?? [];

  return (
    <>
      <PageHeader crumb="Partner portal / Recipients" title="Your recipients" blurb="Keep a list of the people you pay by email." />
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

      <Section title="Groups" desc="Lists of people you pay together, like audiences in a mailing tool. Link a group to a URL that returns your list and it stays up to date.">
        <RecipientGroups base={base} canManage={canImport} selected={groupId} onSelect={setGroupId} onChanged={() => { load(); loadMembers(); }} />
      </Section>

      <Section
        title={groupId ? "People in this group" : `Recipients${list ? ` (${list.length})` : ""}`}
        desc={groupId ? "Add them to a batch from New batch, under From a group." : "Everyone you have imported or paid."}
        right={
          canImport ? (
            <Btn onClick={() => setImporting((v) => !v)}>{importing ? "Close" : "Import recipients"}</Btn>
          ) : undefined
        }
      >
        {importing && canImport && (
          <div className="mb-8 space-y-4 rounded-2xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface2,#101012)] p-6">
            <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">
              One per line: an email, or a handle as twitter, discord, github or telegram, a colon and the handle. Add a name after a comma if you like.
            </p>
            <textarea className={`${inputCls} min-h-[150px] font-mono`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"alice@example.com, Alice\ntwitter:bob, Bob"} />
            <div className="flex justify-end">
              <Btn onClick={doImport} disabled={busy || !text.trim()}>
                {busy ? "Importing..." : "Import"}
              </Btn>
            </div>
          </div>
        )}

        {(groupId ? members : list) === null ? (
          <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">Loading...</p>
        ) : !(groupId ? members : list)?.length ? (
          <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">No recipients yet. You can also pay anyone directly from the Payouts screen.</p>
        ) : (
          <>
          {selectable && picked.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface2,#101012)] p-4">
              <span className="text-[15px] font-medium text-[color:var(--pt-ink,#EDEDEF)]">{picked.size} selected</span>
              <NiceSelect
                className="w-56"
                buttonClassName="py-2"
                value={target}
                onChange={setTarget}
                placeholder="Choose a group"
                options={[...groupList.map((g) => ({ value: g.id, label: g.name })), { value: "__new", label: "+ New group" }]}
              />
              {target === "__new" && <input className={`${inputCls} sm:w-56`} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name" maxLength={60} />}
              <Btn onClick={addToGroup} disabled={busy || !target}>
                {busy ? "Adding..." : "Add to group"}
              </Btn>
              <button type="button" className="text-[14px] text-[color:var(--pt-ink3,#9A9AA3)] hover:underline" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </div>
          )}
          <Table cols={selectable ? ["", "Name", "Email / handle", "Via", "Paid", "Added"] : ["Name", "Email / handle", "Via", "Paid", "Added"]} template={selectable ? `28px ${TEMPLATE}` : TEMPLATE}>
            {rowsNow.map((r) => {
              const id = r.email ?? (r.handle ? `${r.handle_platform}:${r.handle}` : r.external_user_id ?? "");
              const via = r.email ? "Email" : PLATFORM_LABEL[r.handle_platform ?? ""] ?? "-";
              const name = r.display_name || id;
              return (
                <Row key={r.id} template={selectable ? `28px ${TEMPLATE}` : TEMPLATE}>
                  {selectable && <input type="checkbox" aria-label={`Select ${name}`} className="h-4 w-4 accent-[#EA5B30]" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} />}
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={name} />
                    <span className="truncate font-medium text-[color:var(--pt-ink,#EDEDEF)]">{name}</span>
                  </div>
                  <span className="truncate font-mono text-[13.5px] text-[color:var(--pt-ink2,#C9C9D0)]">{id}</span>
                  <span>
                    <Pill>{via}</Pill>
                  </span>
                  <span>{usd(r.paid_usd)}</span>
                  <span className="text-[color:var(--pt-ink2,#C9C9D0)]">{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}</span>
                </Row>
              );
            })}
          </Table>
          {selectable && (
            <button
              type="button"
              className="mt-3 text-[14px] text-[color:var(--pt-ink3,#9A9AA3)] hover:underline"
              onClick={() => setPicked(picked.size === rowsNow.length ? new Set() : new Set(rowsNow.map((r) => r.id)))}
            >
              {picked.size === rowsNow.length ? "Unselect all" : "Select all"}
            </button>
          )}
          </>
        )}
      </Section>
    </>
  );
}
