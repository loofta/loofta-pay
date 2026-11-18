"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { Sheet } from "@/trade/components/Sheet";
import { Skeleton } from "@/trade/components/ui";
import { useWallet } from "@/trade/hooks/useWallet";
import { claimPayments, getPayHistory, type PayHistoryItem } from "@/trade/lib/pay";
import { fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const CHIPS: { id: "all" | PayHistoryItem["kind"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "received", label: "Received" },
  { id: "deposit", label: "Added" },
];

/** Everything that moved in or out: sent, received and money you added, with filters. */
export function ActivitySheet({ onClose }: { onClose: () => void }) {
  const { userId, getAccessToken } = useWallet();
  const [items, setItems] = useState<PayHistoryItem[] | null>(null);
  const [filter, setFilter] = useState<"all" | PayHistoryItem["kind"]>("all");
  const load = useCallback(() => {
    if (!userId) return;
    getAccessToken().then((t) => getPayHistory(t)).then(setItems).catch(() => setItems((p) => p ?? []));
  }, [userId, getAccessToken]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const [claiming, setClaiming] = useState(false);
  const [claimNote, setClaimNote] = useState<string | null>(null);
  const waiting = (items ?? []).filter((it) => it.kind === "received" && it.claimable);
  const waitingUsd = waiting.reduce((t, it) => t + it.amount, 0);
  const claim = async (id?: string) => {
    if (claiming) return;
    haptic("tap");
    setClaiming(true);
    setClaimNote(null);
    try {
      const r = await claimPayments(await getAccessToken(), id);
      setClaimNote(r.failed ? `Claimed $${fmt(r.claimedUsd, 2)}. ${r.failed} could not be claimed yet, try again in a minute.` : `Claimed $${fmt(r.claimedUsd, 2)}. It is in your balance now.`);
      load();
    } catch (e) {
      setClaimNote((e as Error).message || "Could not claim. Try again.");
    } finally {
      setClaiming(false);
    }
  };

  const shown = items ? (filter === "all" ? items : items.filter((it) => it.kind === filter)) : [];
  return (
    <Sheet title="Activity" onClose={onClose}>
      <div className="mt-4 flex gap-2 overflow-x-auto">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" onClick={() => { haptic("tap"); setFilter(c.id); }} className={clsx("h-11 shrink-0 rounded-full px-5 font-display text-base font-bold", filter === c.id ? "bg-[#FF7A2A] text-white" : "bg-[#1c1c22] text-mute")}>
            {c.label}
          </button>
        ))}
      </div>
      {waiting.length > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-[30px] bg-[#141419] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-bold">${fmt(waitingUsd, 2)} waiting for you</div>
            <div className="text-base text-mute">Claim it to move it into your balance.</div>
          </div>
          <button type="button" disabled={claiming} onClick={() => claim()} className="h-11 shrink-0 rounded-full bg-[#FF7A2A] px-5 font-display text-base font-bold text-white disabled:opacity-60">
            {claiming ? "Claiming…" : "Claim"}
          </button>
        </div>
      )}
      {claimNote && <div className="mt-3 rounded-[20px] bg-[#141419] px-4 py-3 text-base text-mute">{claimNote}</div>}
      {items === null &&<div className="mt-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>}
      {items && shown.length === 0 && <div className="mt-4 rounded-[30px] bg-[#141419] px-4 py-10 text-center text-base text-mute">Nothing here yet.</div>}
      {items && shown.length > 0 && (
        <div className="mt-4 rounded-[30px] bg-[#141419] px-5 py-2">
          {shown.map((it) => (
            <div key={`${it.kind}-${it.id}`} className="flex items-center gap-3 border-b border-white/5 py-3 last:border-b-0">
              <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-full", it.kind === "sent" ? "bg-down/15 text-down" : "bg-up/15 text-up")}>
                {it.kind === "sent" ? <ArrowUpRight size={20} /> : it.kind === "received" ? <ArrowDownLeft size={20} /> : <Plus size={20} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-base font-bold">{it.kind === "sent" ? `Sent to ${it.who}` : it.kind === "received" ? `Received from ${it.who}` : it.who === "Card" ? "Added with card" : "Added money"}</div>
                <div className="text-base text-mute">{ago(it.at)}{it.kind === "received" && it.claimable ? " · waiting for you to claim" : it.status !== "SUCCESS" && it.status !== "COMPLETED" && it.status !== "complete" ? ` · ${it.status.toLowerCase().replace(/_/g, " ")}` : ""}</div>
              </div>
              {it.kind === "received" && it.claimable ? (
                <button type="button" disabled={claiming} onClick={() => claim(it.id)} className="h-10 shrink-0 rounded-full bg-[#FF7A2A] px-4 font-display text-base font-bold text-white disabled:opacity-60">Claim ${fmt(it.amount, 2)}</button>
              ) : (
                <div className={clsx("font-display text-base font-bold", it.kind === "sent" ? "" : "text-up")}>{it.kind === "sent" ? "-" : "+"}${fmt(it.amount, 2)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
