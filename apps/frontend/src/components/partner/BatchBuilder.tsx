"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Field, Notice, Pill, Row, Section, Segmented, Table, inputCls } from "./ui";
import { usd, usePartnerApi } from "./usePartnerApi";

export const MAX_ROWS = 100;
const MIN_AMOUNT = 1; // the server rejects anything under $1
const MAX_AMOUNT = 10000;
const MAX_FILE_BYTES = 1_000_000;

export type DraftRow = { id: string; type: string; identifier: string; amount: number; message?: string };
type Source = "upload" | "paste" | "saved";
type Saved = { id: string; display_name: string | null; email: string | null; handle_platform: string | null; handle: string | null };

const uid = () => Math.random().toString(36).slice(2, 10);
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Problems with one row, in plain words. Empty means it is ready to pay. */
export function rowProblem(r: DraftRow): string | null {
  if (r.type !== "email") return "Email addresses only";
  if (!EMAIL.test(r.identifier)) return "Not a valid email";
  if (!Number.isFinite(r.amount) || r.amount < MIN_AMOUNT) return `Amount must be at least ${usd(MIN_AMOUNT)}`;
  if (r.amount > MAX_AMOUNT) return `Amount is over ${usd(MAX_AMOUNT)}`;
  if ((r.message ?? "").length > 500) return "Note is too long";
  return null;
}

/** Splits CSV text into rows. Handles quotes, escaped quotes and a comma, semicolon or tab separator. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') (cell += '"', i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) (row.push(cell.trim()), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const HEADERS: Record<string, string[]> = {
  who: ["email", "emails", "emailaddress", "recipient", "recipients", "to", "contact"],
  amount: ["amount", "usd", "usdc", "value", "pay", "payout", "total", "price"],
  note: ["note", "notes", "message", "memo", "description", "reason", "comment"],
};

function parseAmount(raw: string): number {
  return Number(raw.replace(/[$,\s]/g, "").replace(/usdc?$/i, ""));
}

/** One person per line. Only email addresses are accepted; anything else is kept and flagged so it is never silently dropped. */
function toRow(who: string, amountRaw: string, note: string): DraftRow {
  const w = who.trim();
  const amount = parseAmount(amountRaw);
  const message = note.trim() || undefined;
  if (EMAIL.test(w)) return { id: uid(), type: "email", identifier: w.toLowerCase(), amount, message };
  return { id: uid(), type: "unknown", identifier: w, amount, message };
}

/** Rows from CSV or pasted text. A header row is detected by name, otherwise columns are who, amount, note. */
export function rowsFromText(text: string): DraftRow[] {
  const table = parseCsv(text);
  if (!table.length) return [];
  const head = table[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const find = (k: string) => head.findIndex((h) => HEADERS[k].includes(h));
  const hasHeader = find("who") >= 0 && find("amount") >= 0;
  const idx = hasHeader
    ? { who: find("who"), amount: find("amount"), note: find("note") }
    : { who: 0, amount: 1, note: 2 };
  return (hasHeader ? table.slice(1) : table).map((c) => toRow(c[idx.who] ?? "", c[idx.amount] ?? "", c[idx.note] ?? ""));
}

const keyOf = (r: DraftRow) => `${r.type}:${r.identifier.toLowerCase()}`;
const TEMPLATE = "email,amount,note\nalice@example.com,25,October bonus\nbob@example.com,40,\n";

function SavedPicker({ base, onAdd }: { base: string; onAdd: (rows: DraftRow[]) => void }) {
  const call = usePartnerApi();
  const [list, setList] = useState<Saved[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("25");
  const [q, setQ] = useState("");

  useEffect(() => {
    call<{ recipients: Saved[] }>(`${base}/recipients`).then((r) => setList(r.recipients ?? [])).catch(() => setList([]));
  }, [call, base]);

  const label = (r: Saved) => r.email ?? "";
  const usable = (list ?? []).filter((r) => label(r));
  const shown = usable.filter((r) => `${r.display_name ?? ""} ${label(r)}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  if (list === null) return <p className="text-[15px] text-[#C9C9D0]">Loading...</p>;
  if (!usable.length) return <p className="text-[15px] text-[#C9C9D0]">No saved recipients yet. Import some under Recipients, or upload a file here.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input className={`${inputCls} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        <Btn kind="ghost" onClick={() => setPicked(new Set(shown.map((r) => r.id)))}>
          Select all
        </Btn>
        <Btn kind="ghost" onClick={() => setPicked(new Set())} disabled={!picked.size}>
          Clear
        </Btn>
      </div>
      <div className="max-h-72 overflow-auto rounded-[14px] border border-white/[0.08]">
        {shown.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-3 border-b border-white/[0.06] px-[18px] py-3 text-[15px] last:border-b-0 hover:bg-white/[0.02]">
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-[#FF6A1F]" />
            <span className="min-w-0 flex-1 truncate font-medium text-[#EDEDEF]">{r.display_name || label(r)}</span>
            <span className="truncate font-mono text-[13.5px] text-[#B4B4BC]">{label(r)}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Field label="Amount for each (USDC)">
          <input className={`${inputCls} w-40`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Btn
          disabled={!picked.size || !(parseAmount(amount) >= MIN_AMOUNT)}
          onClick={() => {
            const pay = parseAmount(amount);
            onAdd(usable.filter((r) => picked.has(r.id)).map((r) => toRow(label(r), String(pay), "")));
            setPicked(new Set());
          }}
        >
          Add {picked.size || ""} to the list
        </Btn>
      </div>
    </div>
  );
}

/**
 * Builds a batch the way a mailing tool builds an audience: bring a file or a list, see every row
 * checked before anything is saved, fix or drop the ones with problems, then continue. Nothing is
 * sent or funded from here: it only prepares the rows for the approval flow.
 */
export function BatchBuilder({ base, onSubmit }: { base: string; onSubmit: (rows: DraftRow[], label: string) => Promise<boolean> }) {
  const [source, setSource] = useState<Source>("upload");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [label, setLabel] = useState("");
  const [paste, setPaste] = useState("");
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const add = useCallback((incoming: DraftRow[]) => {
    setNotice(null);
    setRows((cur) => {
      const room = MAX_ROWS - cur.length;
      if (incoming.length > room) setNotice(`A batch holds up to ${MAX_ROWS} payouts. ${incoming.length - Math.max(room, 0)} were left out, so split the rest into another batch.`);
      return [...cur, ...incoming.slice(0, Math.max(room, 0))];
    });
  }, []);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return setNotice("That file is too large. Keep it under 1 MB.");
    if (!/\.(csv|tsv|txt)$/i.test(f.name) && !f.type.startsWith("text/")) return setNotice("Upload a .csv file. In Excel or Sheets, use Save as CSV.");
    const parsed = rowsFromText(await f.text());
    if (!parsed.length) return setNotice("That file has no rows.");
    add(parsed);
  };

  const dupes = new Map<string, number>();
  for (const r of rows) dupes.set(keyOf(r), (dupes.get(keyOf(r)) ?? 0) + 1);
  const problem = (r: DraftRow) => rowProblem(r) ?? ((dupes.get(keyOf(r)) ?? 0) > 1 ? "Listed more than once" : null);
  const bad = rows.filter((r) => problem(r));
  const good = rows.filter((r) => !problem(r));
  const total = good.reduce((a, r) => a + r.amount, 0);

  const dropProblems = () => {
    const seen = new Set<string>();
    setRows((cur) =>
      cur.filter((r) => {
        if (rowProblem(r)) return false;
        if (seen.has(keyOf(r))) return false; // keep the first of any repeated person
        seen.add(keyOf(r));
        return true;
      }),
    );
  };

  const submit = async () => {
    setBusy(true);
    try {
      const ok = await onSubmit(
        rows.map((r) => ({ ...r })),
        label.trim(),
      );
      if (ok) {
        setRows([]);
        setLabel("");
        setPaste("");
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "loofta-payouts-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section
      title="New batch"
      desc="Bring a list of people and amounts. Every row is checked before anything is saved."
      right={<Segmented<Source> value={source} onChange={setSource} options={[{ value: "upload", label: "Upload file" }, { value: "paste", label: "Paste" }, { value: "saved", label: "Saved recipients" }]} />}
    >
      <div className="flex flex-col gap-6">
        {source === "upload" && (
          <div className="flex flex-col gap-3">
            <div
              onDragOver={(e) => (e.preventDefault(), setDrag(true))}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void readFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => file.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && file.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border border-dashed px-6 py-10 text-center transition ${drag ? "border-[#FF6A1F] bg-[#FF6A1F]/[0.06]" : "border-white/[0.14] bg-[#0F0F11] hover:border-white/25"}`}
            >
              <div className="text-[15px] font-semibold text-[#EDEDEF]">Drop a CSV file here, or click to choose one</div>
              <div className="max-w-xl text-[14.5px] leading-[1.6] text-[#B4B4BC]">
                One person per row: an email address, the amount in USDC (at least $1), and an optional note. A header row is fine, and the columns can be in any order if they are named email, amount and note.
              </div>
              <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => (void readFile(e.target.files?.[0]), (e.target.value = ""))} />
            </div>
            <div>
              <button type="button" onClick={downloadTemplate} className="text-[14.5px] font-medium text-[#FF6A1F] hover:underline">
                Download a template
              </button>
            </div>
          </div>
        )}

        {source === "paste" && (
          <div className="flex flex-col gap-3">
            <textarea
              className={`${inputCls} min-h-[150px] font-mono`}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"alice@example.com, 25, October bonus\nbob@example.com, 40"}
            />
            <div className="flex justify-end">
              <Btn
                disabled={!paste.trim()}
                onClick={() => {
                  const parsed = rowsFromText(paste);
                  if (parsed.length) (add(parsed), setPaste(""));
                }}
              >
                Add to the list
              </Btn>
            </div>
          </div>
        )}

        {source === "saved" && <SavedPicker base={base} onAdd={add} />}

        {notice && <Notice kind="info">{notice}</Notice>}

        {rows.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-[15px] text-[#C9C9D0]">
                <Pill tone="green" dot>
                  {good.length} ready
                </Pill>
                {bad.length > 0 && (
                  <Pill tone="red" dot>
                    {bad.length} need attention
                  </Pill>
                )}
                <span>{usd(total)} in total</span>
              </div>
              <div className="flex gap-2.5">
                {bad.length > 0 && (
                  <Btn kind="ghost" onClick={dropProblems}>
                    Remove problem rows
                  </Btn>
                )}
                <Btn kind="ghost" onClick={() => setRows([])}>
                  Clear list
                </Btn>
              </div>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-[14px]">
              <Table cols={["Recipient", "Amount", "Note", "Check", ""]} template="minmax(0,1.4fr) 120px minmax(0,1fr) minmax(0,1fr) 70px">
                {rows.map((r) => {
                  const p = problem(r);
                  return (
                    <Row key={r.id} template="minmax(0,1.4fr) 120px minmax(0,1fr) minmax(0,1fr) 70px">
                      <span className="truncate font-mono text-[13.5px]">{r.type === "email" ? r.identifier : `${r.type}:${r.identifier}`}</span>
                      <input
                        className="w-24 rounded-lg border border-white/10 bg-[#0F0F11] px-2.5 py-1.5 text-[14.5px] text-[#EDEDEF] focus:border-[#FF6A1F]/55 focus:outline-none"
                        inputMode="decimal"
                        value={Number.isFinite(r.amount) ? String(r.amount) : ""}
                        onChange={(e) => setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, amount: parseAmount(e.target.value) } : x)))}
                        aria-label="Amount"
                      />
                      <span className="truncate text-[#B4B4BC]">{r.message ?? ""}</span>
                      <span className={p ? "text-[#FF8A5C]" : "text-[#5FD49C]"}>{p ?? "Ready"}</span>
                      <button type="button" onClick={() => setRows((cur) => cur.filter((x) => x.id !== r.id))} className="text-right text-[14px] text-[#B4B4BC] hover:text-[#EDEDEF]">
                        Remove
                      </button>
                    </Row>
                  );
                })}
              </Table>
            </div>

            <Field label="Label" optional>
              <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="October creator payouts" maxLength={120} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-2xl text-[14.5px] leading-[1.6] text-[#B4B4BC]">
                Network fees are added in USDC. Each recipient pays Loofta&apos;s withdrawal fee plus your fee when they cash out.
              </p>
              <Btn onClick={submit} disabled={busy || bad.length > 0 || !good.length}>
                {busy ? "Saving..." : `Save batch of ${good.length}`}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
