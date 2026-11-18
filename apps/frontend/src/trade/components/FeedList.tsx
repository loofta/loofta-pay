"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { PersonAvatar } from "@/trade/components/PersonAvatar";
import { ProfileSheet } from "@/trade/components/ProfileSheet";
import { UserSheet } from "@/trade/components/UserSheet";
import { ThreadSheet } from "@/trade/components/ThreadSheet";
import { Avatar, Skeleton } from "@/trade/components/ui";
import { useWallet } from "@/trade/hooks/useWallet";
import type { CoinRef } from "@/trade/lib/coin";
import { coinFromPost, fetchFeed, fetchProfile, type CommentPost, type FeedPost, type MiniProfile, type PredictionPost, type TradePost } from "@/trade/lib/feed";
import { tailPost } from "@/trade/lib/rewards";
import { fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const money = (v: number) => (Math.abs(v) >= 1000 ? `$${fmt(v, 0)}` : `$${fmt(v, 2)}`);

function Post({ p, onOpen, onTail, onProfile, onThread, mine }: { p: CommentPost; onOpen: (c: CoinRef) => void; onTail: (p: CommentPost) => void; onProfile: (name: string) => void; onThread: (id: string) => void; mine: boolean }) {
  const up = (p.pnl?.usd ?? 0) >= 0;
  const fresh = Date.now() - new Date(p.createdAt).getTime() < 24 * 3600 * 1000;
  return (
    <div role="button" tabIndex={0} onClick={() => { haptic("tap"); onOpen(coinFromPost(p)); }} onKeyDown={(e) => e.key === "Enter" && onOpen(coinFromPost(p))} className="block w-full cursor-pointer rounded-[24px] border border-white/[0.07] bg-[#141419] p-4 text-left active:scale-[0.99]">
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`Open ${p.name}'s profile`} onClick={(e) => { e.stopPropagation(); onProfile(p.name); }}>
          <PersonAvatar avatar={p.avatar} name={p.name} size={44} />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); onProfile(p.name); }} className="block max-w-full truncate text-left font-display text-base font-bold">{p.name}</button>
          <div className="text-base text-mute">
            {ago(p.createdAt)}
            {p.holdingPct != null && p.holdingPct > 0 ? ` · held ${p.holdingPct < 0.01 ? "<0.01" : p.holdingPct.toFixed(p.holdingPct < 1 ? 2 : 1)}% when posting` : ""}
          </div>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-line break-words text-base leading-snug">{p.text}</p>
      {p.update && (
        <div className="mt-3 rounded-2xl border border-[#f5b70c]/25 bg-[#f5b70c]/[0.06] p-3">
          <div className="flex items-center gap-2 text-base">
            <span className="rounded-full bg-[#f5b70c]/20 px-2 py-0.5 font-semibold text-[#f5b70c]">Update</span>
            <span className="text-mute">{ago(p.update.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-line break-words text-base leading-snug">{p.update.text}</p>
        </div>
      )}
      <button type="button" onClick={(e) => { e.stopPropagation(); haptic("tap"); onThread(p.id); }} className="mt-3 text-base font-semibold text-mute">
        {p.replyCount > 0 ? `${p.replyCount} ${p.replyCount === 1 ? "reply" : "replies"}` : "Reply"}
      </button>

      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-[#1c1c22] p-3">
        <Avatar mint={p.coin.mint} symbol={p.coin.symbol} src={p.coin.icon} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-bold">{p.coin.name}</div>
          <div className="truncate text-base text-mute">{p.coin.symbol}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-base font-bold">{p.coin.mcap != null ? `$${fmt(p.coin.mcap, 0)}` : p.coin.usd != null ? `$${fmt(p.coin.usd, 6)}` : "-"}</div>
          {p.coin.change24h != null && <div className={clsx("text-base font-semibold", p.coin.change24h >= 0 ? "text-up" : "text-down")}>{`${p.coin.change24h >= 0 ? "+" : ""}${p.coin.change24h.toFixed(1)}%`}</div>}
        </div>
      </div>

      {(p.position || p.pnl) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
          {p.position && (
            <span className="text-mute">
              Holds <span className="font-semibold text-ink">{p.position.usd != null ? money(p.position.usd) : fmt(p.position.amount)}</span>
            </span>
          )}
          {p.pnl && (
            <span className="text-mute">
              PnL{" "}
              <span className={clsx("font-semibold", up ? "text-up" : "text-down")}>
                {up ? "+" : "-"}
                {money(Math.abs(p.pnl.usd))} ({up ? "+" : "-"}
                {Math.abs(p.pnl.pct).toFixed(0)}%)
              </span>
            </span>
          )}
        </div>
      )}
      {fresh && !mine && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onTail(p); }} className="btn3d mt-3 h-12 w-full text-base">
          Tail {p.name}
        </button>
      )}
    </div>
  );
}

/** A coin someone bought. */
function TradeRow({ p, onOpen }: { p: TradePost; onOpen: (c: CoinRef) => void }) {
  return (
    <button type="button" onClick={() => { haptic("tap"); onOpen(coinFromPost(p)); }} className="flex w-full items-center gap-3 rounded-[24px] border border-white/[0.07] bg-[#141419] p-4 text-left active:scale-[0.99]">
      <PersonAvatar avatar={p.avatar} name={p.name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="text-base">
          <span className="font-display font-bold">{p.name}</span> <span className="text-mute">bought</span> <span className="font-display font-bold text-up">{money(p.amountUsd)}</span> <span className="text-mute">of</span> <span className="font-display font-bold">{p.coin.symbol}</span>
        </div>
        <div className="text-base text-mute">{ago(p.createdAt)}</div>
      </div>
      <Avatar mint={p.coin.mint} symbol={p.coin.symbol} src={p.coin.icon} size={40} />
    </button>
  );
}

/** A prediction or combo someone placed. */
function PredictionRow({ p, onOpen }: { p: PredictionPost; onOpen: (eventId: string) => void }) {
  const open = p.eventId ? () => { haptic("tap"); onOpen(p.eventId!); } : undefined;
  return (
    <button type="button" onClick={open} disabled={!open} className="block w-full rounded-[24px] border border-white/[0.07] bg-[#141419] p-4 text-left active:scale-[0.99] disabled:active:scale-100">
      <div className="flex items-center gap-3">
        <PersonAvatar avatar={p.avatar} name={p.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-base">
            <span className="font-display font-bold">{p.name}</span> <span className="text-mute">bet</span> {p.amountUsd > 0 && <span className="font-display font-bold text-up">{money(p.amountUsd)}</span>}
          </div>
          <div className="text-base text-mute">{ago(p.createdAt)}</div>
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-[#1c1c22] p-3">
        <div className="font-display text-base font-bold">{p.detail}</div>
        <div className="mt-1 line-clamp-2 text-base text-mute">{p.title}</div>
      </div>
    </button>
  );
}

/** Everything holders are saying, across all coins. Tap a post to open its coin. */
export function FeedList({ onOpen, onOpenPrediction }: { onOpen: (c: CoinRef) => void; onOpenPrediction: (eventId: string) => void }) {
  const { userId, getAccessToken } = useWallet();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [me, setMe] = useState<MiniProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Someone else's public page, opened by tapping a name.
  const [profileOf, setProfileOf] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const alive = useRef(true);
  const [notice, setNotice] = useState<string | null>(null);

  // Tail: the poster earns 0.10% of your buys of this coin for 24 hours, then the coin opens so you can buy.
  const tail = async (p: CommentPost) => {
    try {
      await tailPost(p.id, await getAccessToken());
      setNotice(`Tailing ${p.name}. Your buys of ${p.coin.symbol} in the next 24 hours earn them 0.10%. You pay nothing extra.`);
      haptic("success");
    } catch (e) {
      setNotice(humanError(e, "Could not tail this post."));
    }
    onOpen(coinFromPost(p));
  };

  const load = useCallback(async () => {
    try {
      const r = await fetchFeed();
      if (!alive.current) return;
      setPosts((cur) => {
        // Keep older pages the person already scrolled to, put fresh posts on top.
        if (!cur) return r.posts;
        const ids = new Set(r.posts.map((x) => x.id));
        return [...r.posts, ...cur.filter((x) => !ids.has(x.id))];
      });
      setNext((n) => n ?? r.next);
      setError(false);
    } catch {
      if (alive.current) setError(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => !document.hidden && void load(), 30_000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    getAccessToken().then(fetchProfile).then(setMe).catch(() => undefined);
  }, [userId, getAccessToken]);

  const more = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetchFeed(next);
      setPosts((cur) => [...(cur ?? []), ...r.posts]);
      setNext(r.next);
    } catch {
      /* the button stays, tap again */
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-base text-mute">Bets, buys and what holders say about the coins they own. Tap one to open it.</p>
        {me && (
          <button type="button" onClick={() => setProfileOpen(true)} aria-label="Your profile" className="shrink-0 rounded-full active:scale-95">
            <PersonAvatar avatar={me.avatar} name={me.name} size={44} />
          </button>
        )}
      </div>

      {notice && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl bg-[#1c1c22] p-3 text-base">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-mute underline">OK</button>
        </div>
      )}
      <div className="mt-3 space-y-3">
        {posts === null && !error && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        {error && posts === null && (
          <div className="card px-4 py-8 text-center text-base text-mute">
            The feed is not available right now.
            <button type="button" onClick={() => void load()} className="btn3d dark mx-auto mt-4 h-12 px-6 text-base">Try again</button>
          </div>
        )}
        {posts?.length === 0 && <div className="card px-4 py-10 text-center text-base text-mute">Nothing yet. Place a bet or open a coin you hold and share the first take on it.</div>}
        {posts?.map((p) => (p.type === "comment" ? <Post key={p.id} p={p} onOpen={onOpen} onTail={tail} onProfile={setProfileOf} onThread={setThreadId} mine={!!me && me.name === p.name} /> : p.type === "trade" ? <TradeRow key={p.id} p={p} onOpen={onOpen} /> : <PredictionRow key={p.id} p={p} onOpen={onOpenPrediction} />))}
        {next && (
          <button type="button" onClick={more} disabled={loadingMore} className="btn3d dark flex h-14 w-full items-center justify-center gap-2 text-base">
            {loadingMore && <Loader2 size={18} className="animate-spin" />} Load more
          </button>
        )}
      </div>
      {profileOpen && <ProfileSheet onClose={() => setProfileOpen(false)} onChanged={setMe} />}
      {threadId && <ThreadSheet postId={threadId} onClose={() => setThreadId(null)} onChanged={() => void load()} onProfile={(n) => { setThreadId(null); setProfileOf(n); }} />}
      {profileOf && <UserSheet handle={profileOf} onClose={() => setProfileOf(null)} />}
    </div>
  );
}
