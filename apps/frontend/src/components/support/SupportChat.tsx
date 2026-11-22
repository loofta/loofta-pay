"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientApiBase } from "@/services/api/client";

const BACKEND = clientApiBase();
type Msg = { id: string; sender: "user" | "bot" | "agent"; body: string; created_at: string };
type Faq = { id: string; question: string };

/**
 * A small help bubble. Quick questions are answered at once, anything else goes to an assistant that only knows our
 * public help text, and "Talk to a person" reaches the Loofta team on Telegram. Their answer shows up here.
 */
export function SupportChat({ getAccessToken, orgId }: { getAccessToken: () => Promise<string | null>; orgId: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [faq, setFaq] = useState<Faq[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [human, setHuman] = useState(false);
  const lastRef = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      const res = await fetch(`${BACKEND}/support/${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((Array.isArray(body?.message) ? body.message.join(", ") : body?.message) || "Something went wrong.");
      return body;
    },
    [getAccessToken],
  );

  const poll = useCallback(async () => {
    try {
      const r = (await call(`messages${lastRef.current ? `?after=${encodeURIComponent(lastRef.current)}` : ""}`)) as { messages: Msg[]; mode: "bot" | "human" };
      setHuman(r.mode === "human");
      if (r.messages.length) {
        lastRef.current = r.messages[r.messages.length - 1].created_at;
        setMsgs((cur) => [...cur, ...r.messages.filter((m) => !cur.some((c) => c.id === m.id))]);
      }
    } catch {
      /* keep the last view; the next poll tries again */
    }
  }, [call]);

  // While the window is open, check for new answers every few seconds.
  useEffect(() => {
    if (!open) return;
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, [open, poll]);

  useEffect(() => {
    if (!open || faq.length) return;
    call("faq").then((r: { questions: Faq[] }) => setFaq(r.questions)).catch(() => undefined);
  }, [open, faq.length, call]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, open]);

  const send = async (body: { text?: string; faq?: string; human?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      await call("messages", { method: "POST", body: JSON.stringify({ ...body, org_id: orgId }) });
      setText("");
      await poll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[min(520px,calc(100vh-110px))] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface,#141418)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[color:var(--pt-w10,rgba(255,255,255,0.1))] px-4 py-3">
            <div>
              <p className="m-0 text-base font-semibold text-[color:var(--pt-ink,#fff)]">Help</p>
              <p className="m-0 text-sm text-[color:var(--pt-ink3,#8A8893)]">{human ? "A person is on this chat" : "Quick answers, or a person if you need one"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="rounded-lg px-2 py-1 text-xl leading-none text-[color:var(--pt-ink3,#8A8893)] hover:text-[color:var(--pt-ink,#fff)]">×</button>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {msgs.length === 0 && <p className="m-0 text-base text-[color:var(--pt-ink2,#C8C6D0)]">Hi. Ask a question, or pick one below.</p>}
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-base leading-snug ${m.sender === "user" ? "bg-[#FF6A1F] text-white" : "bg-[color:var(--pt-surface3,#1A1A20)] text-[color:var(--pt-ink,#fff)]"}`}>
                  {m.sender === "agent" && <span className="mb-0.5 block text-sm font-semibold text-[color:var(--pt-ink3,#8A8893)]">Loofta team</span>}
                  {m.body}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[color:var(--pt-w10,rgba(255,255,255,0.1))] px-3 pb-3 pt-2.5">
            {msgs.length === 0 && faq.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {faq.map((f) => (
                  <button key={f.id} type="button" disabled={busy} onClick={() => void send({ faq: f.id })} className="rounded-full border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] px-3 py-1.5 text-left text-sm text-[color:var(--pt-ink2,#C8C6D0)] hover:border-[color:var(--pt-w20,rgba(255,255,255,0.2))] disabled:opacity-50">
                    {f.question}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="m-0 mb-2 text-sm text-red-400">{error}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) void send({ text: text.trim() });
              }}
              className="flex gap-2"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={500}
                placeholder="Write a message"
                className="min-w-0 flex-1 rounded-xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface2,#0E0E12)] px-3 py-2.5 text-base text-[color:var(--pt-ink,#fff)] placeholder:text-[color:var(--pt-ink4,#6E6C78)]"
              />
              <button type="submit" disabled={busy || !text.trim()} className="rounded-xl bg-[#FF6A1F] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-40">Send</button>
            </form>
            {!human && (
              <button type="button" disabled={busy} onClick={() => void send({ human: true, text: text.trim() || undefined })} className="mt-2 w-full text-center text-sm font-semibold text-[#FF6A1F] hover:underline disabled:opacity-50">
                Talk to a person
              </button>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close help" : "Open help"}
        className="flex h-12 items-center gap-2 rounded-full bg-[#FF6A1F] px-4 text-base font-semibold text-white shadow-lg transition hover:brightness-110"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
        Help
      </button>
    </div>
  );
}
