"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Sheet } from "@/trade/components/Sheet";
import { Skeleton } from "@/trade/components/ui";
import { useWallet } from "@/trade/hooks/useWallet";
import { api } from "@/trade/lib/api";
import { humanError } from "@/trade/lib/errors";
import { MIN_TAKE_USD } from "@/trade/lib/takes";
import { haptic } from "@/trade/lib/telegram";

type Msg = { id: string; name: string; text: string; createdAt: string; isUpdate?: boolean; holdingAmount: number | null };
type Thread = { mint: string; root: Msg; replies: Msg[] };

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/**
 * One take and everything said under it. The author answering their own take is an update: it is marked as one and the
 * feed shows it on the original post instead of as a new post. Anyone holding at least $2 of the coin can reply.
 */
export function ThreadSheet({ postId, onClose, onChanged, onProfile }: { postId: string; onClose: () => void; onChanged?: () => void; onProfile?: (name: string) => void }) {
  const { userId, getAccessToken } = useWallet();
  const [t, setT] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Thread>(`/coin-chat/thread/${postId}`)
      .then(setT)
      .catch((e) => setError(humanError(e, "Could not load this thread.")));
  }, [postId]);
  useEffect(() => {
    load();
    const id = setInterval(() => !document.hidden && load(), 6_000);
    return () => clearInterval(id);
  }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy || !t || !userId) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      await api(`/coin-chat/${t.mint}`, { body: { text: body, parentId: t.root.id }, token: await getAccessToken() });
      setText("");
      load();
      onChanged?.();
    } catch (e) {
      setError(humanError(e, "Could not send"));
    } finally {
      setBusy(false);
    }
  };

  const row = (m: Msg, root = false) => (
    <div key={m.id} className={root ? "rounded-2xl bg-[#1c1c22] p-4" : "rounded-2xl border border-white/[0.07] p-3"}>
      <div className="flex flex-wrap items-center gap-2 text-base">
        <button type="button" onClick={() => onProfile?.(m.name)} className="font-display font-bold">@{m.name}</button>
        {m.isUpdate && <span className="rounded-full bg-[#f5b70c]/20 px-2 py-0.5 font-semibold text-[#f5b70c]">update</span>}
        <span className="text-mute">{ago(m.createdAt)}</span>
      </div>
      <p className="mt-1 whitespace-pre-line break-words text-base leading-snug">{m.text}</p>
    </div>
  );

  return (
    <Sheet title="Replies" onClose={onClose}>
      <div className="mt-4 space-y-3">
        {!t && !error && <Skeleton className="h-28" />}
        {error && !t && <div className="rounded-2xl bg-[#1c1c22] p-4 text-center text-base text-mute">{error}</div>}
        {t && row(t.root, true)}
        {t?.replies.length === 0 && <p className="py-2 text-center text-base text-mute">No replies yet.</p>}
        {t?.replies.map((m) => row(m))}
      </div>
      {t && (
        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-white/10 bg-[#141418] px-4 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 8px)" }}>
          {error && t && <div className="mb-2 text-base text-down">{error}</div>}
          <div className="flex items-center gap-2">
            <input
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              enterKeyHint="send"
              placeholder="Reply"
              className="h-14 min-w-0 flex-1 rounded-2xl bg-surface px-4 text-base outline-none placeholder:text-mute"
            />
            <button type="button" onClick={send} disabled={busy || !text.trim()} aria-label="Send reply" className="btn3d grid h-14 w-14 shrink-0 place-items-center !rounded-2xl">
              {busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
          <p className="mt-2 text-base text-mute">Needs ${MIN_TAKE_USD} of the coin to reply · no links</p>
        </div>
      )}
    </Sheet>
  );
}
