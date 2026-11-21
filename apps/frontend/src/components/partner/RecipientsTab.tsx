"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Btn, Notice, PageHeader, Pill, Row, Section, Table, inputCls } from "./ui";
import { post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";

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

  const load = useCallback(() => {
    call<{ recipients: Recipient[] }>(`${base}/recipients`).then((r) => setList(r.recipients ?? [])).catch((e: Error) => setError(e.message));
  }, [call, base]);
  useEffect(load, [load]);

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

      <Section
        title={`Recipients${list ? ` (${list.length})` : ""}`}
        desc="Everyone you have imported or paid."
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

        {list === null ? (
          <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">Loading...</p>
        ) : !list.length ? (
          <p className="text-[15px] text-[color:var(--pt-ink2,#C9C9D0)]">No recipients yet. You can also pay anyone directly from the Payouts screen.</p>
        ) : (
          <Table cols={["Name", "Email / handle", "Via", "Paid", "Added"]} template={TEMPLATE}>
            {list.map((r) => {
              const id = r.email ?? (r.handle ? `${r.handle_platform}:${r.handle}` : r.external_user_id ?? "");
              const via = r.email ? "Email" : PLATFORM_LABEL[r.handle_platform ?? ""] ?? "-";
              const name = r.display_name || id;
              return (
                <Row key={r.id} template={TEMPLATE}>
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
        )}
      </Section>
    </>
  );
}
