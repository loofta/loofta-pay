"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import clsx from "clsx";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Send, Share2 } from "lucide-react";
import { api } from "@/trade/lib/api";
import { fmt } from "@/trade/lib/solana";
import { haptic, openExternal } from "@/trade/lib/telegram";
import { MIN_TAKE_USD, shareCallUrl } from "@/trade/lib/takes";
import { UserSheet } from "@/trade/components/UserSheet";
import { ThreadSheet } from "@/trade/components/ThreadSheet";
import { useVisualViewport } from "@/trade/hooks/useVisualViewport";
import { useWallet } from "@/trade/hooks/useWallet";
import type { LiveTrade } from "@/trade/hooks/useLiveTrades";
import { avatarBackground } from "@/trade/lib/memecoin";
import { Skeleton } from "@/trade/components/ui";

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Live buys and sells, newest first. */
export function TradesList({ trades }: { trades: LiveTrade[] }) {
  const now = useNow();
  if (trades.length === 0) return <div className="card mt-4 px-4 py-8 text-center text-base text-mute">No trades yet.</div>;
  return (
    <div className="card mt-4 divide-y divide-white/5 px-4">
      {trades.slice(0, 30).map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-base font-bold", t.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{t.side === "buy" ? "B" : "S"}</span>
            <div className="min-w-0">
              <div className={clsx("font-display text-base font-bold", t.side === "buy" ? "text-up" : "text-down")}>
                {t.side === "buy" ? "Bought" : "Sold"} ${fmt(t.usd, 2)}
              </div>
              <div className="truncate text-base text-mute">{t.wallet}</div>
            </div>
          </div>
          <span className="shrink-0 text-base text-mute">{ago(t.time, now)}</span>
        </div>
      ))}
    </div>
  );
}

/** The biggest wallets and how much of the coin each one owns. */
export function HoldersList({ mint }: { mint: string }) {
  const [holders, setHolders] = useState<Array<{ wallet: string; pct: number; usd: number | null }> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/backend/mini/holders?mint=${mint}`)
        .then((r) => r.json())
        .then((j: { holders?: Array<{ wallet: string; pct: number; usd: number | null }> }) => alive && setHolders(j.holders ?? []))
        .catch(() => alive && setHolders((p) => p ?? []));
    void load();
    const t = setInterval(() => !document.hidden && void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint]);
  if (holders === null) return <Skeleton className="mt-4 h-64" />;
  // Shares of one supply cannot add up to more than 100%. If they do the data is wrong, so show none of it.
  if (holders.length === 0 || holders.reduce((a, h) => a + h.pct, 0) > 100.5) return <div className="card mt-4 px-4 py-8 text-center text-base text-mute">No holder data yet.</div>;
  const top = holders.slice(0, 10).reduce((a, h) => a + h.pct, 0);
  return (
    <div className="card mt-4 px-4 py-2">
      <p className="py-2 text-base text-mute">The 10 biggest wallets hold {top.toFixed(1)}% of the coin. The more spread out, the better.</p>
      <div className="divide-y divide-white/5">
        {holders.map((h, i) => (
          <div key={h.wallet + i} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-semibold">
                {i + 1}. {h.wallet}
              </span>
              <span className="font-display text-base font-bold">{h.pct.toFixed(2)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, h.pct * 4)}%`, background: "linear-gradient(90deg,#ff2d0a,#f5b70c)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ChatMessage {
  id: string;
  name: string;
  text: string;
  holdingPct: number | null;
  holdingAmount: number | null;
  createdAt: string;
  replyCount?: number;
}

function compactUsd(v: number): string {
  return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(v >= 10 ? 0 : 2)}`;
}

function HoldChip({ pct, usd }: { pct: number | null; usd: number | null }) {
  if (pct == null) return null;
  if (pct <= 0) return <span className="rounded-full bg-raised px-2 py-0.5 text-base font-semibold text-mute">no bag</span>;
  const big = pct >= 1;
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-base font-semibold", big ? "bg-[#f5b70c]/20 text-[#f5b70c]" : "bg-up/15 text-up")}>
      holds {usd != null ? compactUsd(usd) : `${pct < 0.01 ? "<0.01" : pct.toFixed(pct < 1 ? 2 : 1)}%`}
    </span>
  );
}

/**
 * Takes on one coin, or on one prediction event when eventId is given. Every take shows how much its author held (or
 * had on the event) when they wrote it. Only people with at least $2 can post. A coin take can be shared as a call.
 */
export function ChatPanel({ mint, name, price, myHoldingUsd, eventId }: { mint: string; name: string; price: number | null; myHoldingUsd: number | null; eventId?: string }) {
  const { userId, getAccessToken } = useWallet();
  const base = eventId ? `/coin-chat/event/${encodeURIComponent(eventId)}` : `/coin-chat/${mint}`;
  const [profile, setProfile] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Writing happens full screen, so the field and keyboard have the whole screen and nothing else gets in the way.
  const [open, setOpen] = useState(false);
  const vv = useVisualViewport();
  const now = useNow(15_000);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ messages: ChatMessage[] }>(base)
        .then((r) => {
          if (!alive) return;
          setOffline(false);
          setMessages(r.messages);
        })
        .catch(() => alive && (setOffline(true), setMessages((p) => p ?? [])));
    void load();
    const t = setInterval(() => !document.hidden && void load(), open ? 2_000 : 4_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [base, open]);

  // Stay pinned to the newest message unless the reader scrolled up. Also when the keyboard opens or closes.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, open, vv.height]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || busy || !userId) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      const token = await getAccessToken();
      const m = await api<ChatMessage>(base, { body: { text: body }, token });
      setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]));
      setText("");
      stick.current = true;
    } catch (e) {
      setError(humanError(e, "Could not send"));
    } finally {
      setBusy(false);
    }
  }, [text, busy, userId, getAccessToken, base]);

  const shareCall = (m: ChatMessage) => {
    haptic("tap");
    openExternal(shareCallUrl(m.id, `${m.name} on ${name}: ${m.text}`));
  };

  const row = (m: ChatMessage) => (
    <div key={m.id} className="flex gap-3">
      <button type="button" onClick={() => setProfile(m.name)} aria-label={`Open ${m.name}'s profile`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-display text-base font-bold text-white" style={{ background: avatarBackground(m.name) }}>
        {m.name.slice(0, 2).toUpperCase()}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setProfile(m.name)} className="font-display text-base font-bold">@{m.name}</button>
          {eventId ? (
            <span className="rounded-full bg-up/15 px-2 py-0.5 text-base font-semibold text-up">bet {compactUsd(m.holdingAmount ?? 0)}</span>
          ) : (
            <HoldChip pct={m.holdingPct} usd={m.holdingAmount != null && price != null ? m.holdingAmount * price : null} />
          )}
          <span className="text-base text-mute">{ago(Date.parse(m.createdAt), now)}</span>
          {!eventId && (
            <button type="button" onClick={() => shareCall(m)} aria-label="Share this call" className="ml-auto grid h-9 w-9 place-items-center rounded-xl bg-raised text-mute">
              <Share2 size={16} />
            </button>
          )}
        </div>
        <p className="mt-0.5 break-words text-base leading-snug">{m.text}</p>
        {!eventId && (
          <button type="button" onClick={() => setThread(m.id)} className="mt-1 text-base font-semibold text-mute">
            {m.replyCount ? `${m.replyCount} ${m.replyCount === 1 ? "reply" : "replies"}` : "Reply"}
          </button>
        )}
      </div>
    </div>
  );

  const gateNote = eventId ? `Needs $${MIN_TAKE_USD} on this market to post` : `Needs $${MIN_TAKE_USD} of ${name} to post`;

  const empty = (
    <>
      {messages === null && <Skeleton className="h-24" />}
      {offline && messages?.length === 0 && <p className="py-6 text-center text-base text-mute">Takes are not switched on yet.</p>}
      {!offline && messages?.length === 0 && <p className="py-6 text-center text-base text-mute">No takes yet. Be the first to share yours.</p>}
    </>
  );

  return (
    <>
      {/* a quiet preview under the chart: the latest messages and a field that opens the full screen chat */}
      <div className="card mt-4 p-4">
        <div className="space-y-4">
          {empty}
          {messages?.slice(-4).map(row)}
        </div>
        {/* Looks and reads like a text field. Tapping it opens the full screen chat with the keyboard already up. */}
        <button type="button" onClick={() => setOpen(true)} disabled={offline} className="mt-4 flex h-14 w-full items-center gap-3 rounded-2xl border border-white/15 bg-bg px-4 text-left text-base text-mute active:scale-[0.99]">
          <span className="flex-1 truncate">Share your take...</span>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised text-ink">
            <Send size={18} />
          </span>
        </button>
        <p className="mt-2 text-base text-mute">{gateNote}{!eventId && myHoldingUsd != null ? ` · you hold ${compactUsd(myHoldingUsd)}` : ""}</p>
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed left-0 z-[80] flex w-full flex-col bg-bg text-white" style={{ top: vv.top, height: vv.height }}>
            <div className="flex items-center gap-3 border-b border-white/10 px-4 pb-3" style={{ paddingTop: vv.keyboard ? "12px" : "calc(var(--safe-top) + 12px)" }}>
              <button type="button" aria-label="Back" onClick={() => setOpen(false)} className="btn3d dark grid h-11 w-11 shrink-0 place-items-center !rounded-2xl">
                <ArrowLeft size={20} />
              </button>
              <div className="min-w-0">
                <div className="truncate font-display text-lg font-bold">{name}</div>
                <div className="text-base text-mute">Takes</div>
              </div>
            </div>

            <div
              ref={list}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
              className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
              style={{ overscrollBehavior: "contain" }}
            >
              {empty}
              {messages?.map(row)}
            </div>

            <div className="border-t border-white/10 bg-bg px-3 pt-3" style={{ paddingBottom: vv.keyboard ? "10px" : "calc(var(--safe-bottom) + 10px)" }}>
              {error && <div className="mb-2 px-1 text-base text-down">{error}</div>}
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={text}
                  maxLength={200}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void send()}
                  enterKeyHint="send"
                  placeholder="Your take"
                  className="h-14 min-w-0 flex-1 rounded-2xl bg-surface px-4 text-base outline-none placeholder:text-mute"
                />
                <button type="button" onClick={send} disabled={busy || !text.trim() || offline} aria-label="Send message" className="btn3d grid h-14 w-14 shrink-0 place-items-center !rounded-2xl">
                  {busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
              <p className="mt-2 px-1 text-base text-mute">{gateNote} · no links</p>
            </div>
          </div>,
          document.body,
        )}
      {thread && <ThreadSheet postId={thread} onClose={() => setThread(null)} onChanged={() => setThread((t) => t)} onProfile={(n) => { setThread(null); setProfile(n); }} />}
      {profile && <UserSheet handle={profile} onClose={() => setProfile(null)} />}
    </>
  );
}
