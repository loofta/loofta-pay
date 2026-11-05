"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QuestHistoryDialog, type QuestReward } from "@/components/QuestHistoryDialog";
import { useToast } from "@/components/ui/use-toast";

const MONO = "var(--font-home-mono), 'JetBrains Mono', monospace";
const WEEKLY_QUEST_TARGET_USD = 150;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const totems = (n: number) => `${n} ${n === 1 ? "totem" : "totems"}`;

type Quest = { volumeUsd: number; targetUsd: number; daysUntilNext: number; qualified: boolean; projectedTickets?: number; history?: QuestReward[]; unseenAward?: (QuestReward & { id: string }) | null };

/**
 * Weekly quest on the app home: move a set amount in a week (sends + withdrawals) and PoolRip totems are granted when
 * the week ends. The server is the source of truth (the same numbers the hourly award job uses).
 */
export function WeeklyQuestCard({ userId, getAccessToken }: { userId?: string; getAccessToken: () => Promise<string | null> }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);
  const quest = useQuery({
    queryKey: ["weekly-quest", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const r = await fetch("/api/weekly-quest", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!r.ok) throw new Error("weekly-quest");
      return r.json() as Promise<Quest>;
    },
  });
  const unseen = quest.data?.unseenAward ?? null;
  useEffect(() => {
    if (!unseen) return;
    toast({
      title: "Your weekly reward is in",
      description: `You received ${totems(unseen.tickets)} for last week's ${money(unseen.volumeUsd)} volume. Use them in a PoolRip Death room.`,
      duration: 12000,
    });
    void (async () => {
      const token = await getAccessToken().catch(() => null);
      await fetch("/api/weekly-quest", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ awardId: unseen.id }) }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ["weekly-quest"] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen?.id]);

  const target = quest.data?.targetUsd ?? WEEKLY_QUEST_TARGET_USD;
  const shown = quest.data?.volumeUsd ?? 0;
  const pct = Math.min(100, (shown / target) * 100);
  const done = shown >= target;
  const daysLeft = quest.data?.daysUntilNext ?? null;
  const projected = quest.data?.projectedTickets ?? 1;
  const history = quest.data?.history ?? [];
  const newQuest = daysLeft !== null ? ` New quest in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.` : "";

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 18, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 0" }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>{done ? "Quest complete" : "Weekly quest: free PoolRip totems"}</span>
            <span style={{ fontSize: 13, color: "#9A98A3" }}>A totem saves your seat from one vote-out.</span>
          </div>
          <span style={{ flex: "none", fontFamily: MONO, fontSize: 13, color: "#9A98A3", fontVariantNumeric: "tabular-nums" }}>{money(Math.min(shown, target))} / {money(target)}</span>
        </div>
        <div style={{ height: 14, borderRadius: 999, background: "rgba(0,0,0,0.4)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${Math.max(pct, shown > 0 ? 4 : 0)}%`, height: "100%", borderRadius: 999, background: done ? "linear-gradient(90deg,#3CC878,#9BE564)" : "linear-gradient(90deg,#FF4A26,#FF7A2A,#EAB308)", boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.22)", transition: "width .7s ease" }} />
        </div>
        <span style={{ fontSize: 14, color: "#9A98A3", lineHeight: 1.35 }}>
          {done
            ? `You are on track for ${totems(projected)}, granted automatically when the week ends.${newQuest}`
            : `${money(Math.max(0, target - shown))} more sent or withdrawn this week earns you free totems, granted when the week ends.${newQuest}`}
        </span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setHistoryOpen(true)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#FF8A4A", fontWeight: 700, fontSize: 14 }}>Past rewards{history.length > 0 ? ` (${history.length})` : ""}</button>
          <a href="https://play.loofta.com/?utm_source=loofta&utm_medium=app_home&utm_campaign=weekly_quest" target="_blank" rel="noopener noreferrer" style={{ color: "#F5B70C", fontWeight: 700, fontSize: 14 }}>Play PoolRip →</a>
        </div>
      </div>
      <QuestHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} rewards={history} />
    </>
  );
}
