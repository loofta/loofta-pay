"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, Notice, inputCls } from "./ui";
import { patch, post, usePartnerApi } from "./usePartnerApi";

export type Group = {
  id: string;
  name: string;
  member_count: number;
  linked: boolean;
  source_host: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number | null;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

/** Lines like the recipients import: an email, or platform:handle, then an optional name after a comma. */
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

/**
 * Groups of recipients, like lists in a mailing tool. Pick a group to see who is in it, add people, link it to a URL
 * that returns your list (JSON or CSV) and sync it. The link is a secret, so after it is saved only its host is shown.
 */
export function RecipientGroups({
  base,
  canManage,
  selected,
  onSelect,
  onChanged,
}: {
  base: string;
  canManage: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Called after anything changed, so the list below can reload. */
  onChanged: () => void;
}) {
  const call = usePartnerApi();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<"add" | "link" | "rename" | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(() => {
    call<{ groups: Group[] }>(`${base}/groups`).then((r) => setGroups(r.groups ?? [])).catch((e: Error) => setError(e.message));
  }, [call, base]);
  useEffect(load, [load]);

  const current = groups?.find((g) => g.id === selected) ?? null;
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      const msg = await fn();
      if (msg) setOk(msg);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run("create", async () => {
      const g = await call<Group>(`${base}/groups`, post({ name: newName.trim() }));
      setNewName("");
      setCreating(false);
      onSelect(g.id);
      return `Created ${g.name}.`;
    });

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice kind="error">{error}</Notice>}
      {ok && <Notice kind="ok">{ok}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`rounded-full px-4 py-2 text-[14px] font-medium transition ${selected === null ? "bg-[#1D1D1F] text-white" : "bg-[#F2F2F4] text-[#1D1D1F] hover:bg-[#E8E8ED]"}`}
        >
          Everyone
        </button>
        {(groups ?? []).map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              onSelect(g.id);
              setPanel(null);
            }}
            className={`rounded-full px-4 py-2 text-[14px] font-medium transition ${selected === g.id ? "bg-[#1D1D1F] text-white" : "bg-[#F2F2F4] text-[#1D1D1F] hover:bg-[#E8E8ED]"}`}
          >
            {g.name} <span className={selected === g.id ? "text-white/60" : "text-[#86868B]"}>{g.member_count}</span>
          </button>
        ))}
        {canManage && !creating && (
          <button type="button" onClick={() => setCreating(true)} className="rounded-full border border-dashed border-black/20 px-4 py-2 text-[14px] font-medium text-[#4F4F57] hover:text-[#1D1D1F]">
            + New group
          </button>
        )}
      </div>

      {creating && canManage && (
        <div className="flex flex-wrap items-center gap-2.5">
          <input className={`${inputCls} max-w-xs`} value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} placeholder="Group name, like Top clippers" autoFocus />
          <Btn onClick={create} disabled={busy !== null || !newName.trim()}>{busy === "create" ? "Creating..." : "Create"}</Btn>
          <Btn kind="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
        </div>
      )}

      {current && (
        <div className="flex flex-col gap-4 rounded-2xl bg-[#FAFAFB] p-5 shadow-[0_0_0_1px_#EDEDF0]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-[18px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{current.name}</div>
              <div className="text-[13.5px] text-[#86868B]">
                {current.member_count} {current.member_count === 1 ? "person" : "people"}
                {current.linked ? ` · linked to ${current.source_host}` : " · not linked to a URL"}
                {current.linked && ` · last read ${when(current.last_synced_at)}${current.last_sync_status === "failed" ? " (failed)" : current.last_sync_count != null ? ` (${current.last_sync_count} people)` : ""}`}
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {current.linked && (
                  <Btn kind="ghost" disabled={busy !== null} onClick={() => run("sync", async () => {
                    const r = await call<{ people: number; added: number; removed: number; skipped: number }>(`${base}/groups/${current.id}/sync`, post());
                    return `Read the list: ${r.people} people, ${r.added} added, ${r.removed} removed${r.skipped ? `, ${r.skipped} skipped` : ""}.`;
                  })}>
                    {busy === "sync" ? "Reading..." : "Sync now"}
                  </Btn>
                )}
                <Btn kind="ghost" onClick={() => setPanel(panel === "add" ? null : "add")}>Add people</Btn>
                <Btn kind="ghost" onClick={() => { setUrl(""); setPanel(panel === "link" ? null : "link"); }}>{current.linked ? "Change link" : "Link a URL"}</Btn>
                <Btn kind="ghost" onClick={() => { setName(current.name); setPanel(panel === "rename" ? null : "rename"); }}>Rename</Btn>
                <Btn kind="danger" disabled={busy !== null} onClick={() => {
                  if (!window.confirm(`Delete the group "${current.name}"? The people stay in your recipients.`)) return;
                  void run("delete", async () => {
                    await call(`${base}/groups/${current.id}`, { method: "DELETE" });
                    onSelect(null);
                    return "Group deleted.";
                  });
                }}>Delete</Btn>
              </div>
            )}
          </div>

          {panel === "add" && canManage && (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-[14.5px] text-[#4F4F57]">One per line: an email, or twitter, discord, github or telegram, a colon and the handle. A name after a comma is optional.</p>
              <textarea className={`${inputCls} min-h-[120px] font-mono`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"alice@example.com, Alice\ntwitter:bob"} />
              <div>
                <Btn disabled={busy !== null || !text.trim()} onClick={() => {
                  const { recipients, bad } = parseLines(text);
                  if (bad.length) return setError(`These lines are not valid: ${bad.slice(0, 3).join(" | ")}`);
                  void run("add", async () => {
                    const r = await call<{ added: number; failed: number }>(`${base}/groups/${current.id}/members`, post({ recipients }));
                    setText("");
                    setPanel(null);
                    return `Added ${r.added} to the group${r.failed ? `, ${r.failed} could not be read` : ""}.`;
                  });
                }}>{busy === "add" ? "Adding..." : "Add to the group"}</Btn>
              </div>
            </div>
          )}

          {panel === "link" && canManage && (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-[14.5px] leading-[1.55] text-[#4F4F57]">
                A public https address that returns your list as JSON (an array, or <span className="font-mono">{"{ \"recipients\": [...] }"}</span>) or CSV with a header row. Each person needs an email, or a handle and a platform. Up to 1,000 people. We read it when you press Sync, never more than once a minute. Treat the address as a secret: it is not shown again after you save it.
              </p>
              <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourapp.com/api/clippers.json" autoComplete="off" spellCheck={false} />
              <div className="flex flex-wrap gap-2.5">
                <Btn disabled={busy !== null || !url.trim()} onClick={() => run("link", async () => {
                  await call(`${base}/groups/${current.id}`, patch({ source_url: url.trim() }));
                  setUrl("");
                  setPanel(null);
                  return "Linked. Press Sync now to read it.";
                })}>{busy === "link" ? "Saving..." : "Save the link"}</Btn>
                {current.linked && (
                  <Btn kind="ghost" disabled={busy !== null} onClick={() => run("unlink", async () => {
                    await call(`${base}/groups/${current.id}`, patch({ source_url: "" }));
                    setPanel(null);
                    return "Unlinked.";
                  })}>Unlink</Btn>
                )}
              </div>
            </div>
          )}

          {panel === "rename" && canManage && (
            <div className="flex flex-wrap items-center gap-2.5">
              <input className={`${inputCls} max-w-xs`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <Btn disabled={busy !== null || !name.trim()} onClick={() => run("rename", async () => {
                await call(`${base}/groups/${current.id}`, patch({ name: name.trim() }));
                setPanel(null);
                return "Renamed.";
              })}>Save</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
