"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Award, Check, Copy, Share2, Trophy } from "lucide-react";
import { Sheet } from "@/trade/components/Sheet";
import { Segmented, Skeleton } from "@/trade/components/ui";
import { useWallet } from "@/trade/hooks/useWallet";
import { fetchCallouts, fetchLeaderboard, fetchRewards, usd0, type CalloutSummary, type Leaderboard, type RewardsSummary } from "@/trade/lib/rewards";
import { haptic, openExternal } from "@/trade/lib/telegram";

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

/** Rewards: invite a friend for lower fees, things to do with badges, and this week's leaderboard. */
export function RewardsSheet({ onClose }: { onClose: () => void }) {
  const { getAccessToken, userId } = useWallet();
  const [sum, setSum] = useState<RewardsSummary | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"rewards" | "board" | "callouts">("rewards");
  const [callouts, setCallouts] = useState<CalloutSummary | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const [s, b, c] = await Promise.all([fetchRewards(token), fetchLeaderboard(token).catch(() => null), fetchCallouts(token).catch(() => null)]);
        if (!alive) return;
        setSum(s);
        setBoard(b);
        setCallouts(c);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, getAccessToken]);

  const copy = async () => {
    if (!sum) return;
    try {
      await navigator.clipboard.writeText(sum.inviteLink);
      setCopied(true);
      haptic("success");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* copying is a convenience, the share button still works */
    }
  };
  const share = () => {
    if (!sum) return;
    haptic("tap");
    const text = `Trade stocks, pre-IPO companies and coins on Loofta. Join with my link and we both pay ${sum.discount.percent}% lower fees.`;
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(sum.inviteLink)}&text=${encodeURIComponent(text)}`);
  };

  const earned = sum?.badges.filter((b) => b.earned).length ?? 0;

  return (
    <Sheet title="Rewards" onClose={onClose}>
      {failed && <div className="card mt-4 px-4 py-8 text-center text-base text-mute">Rewards are not available right now. Try again in a moment.</div>}
      {!failed && !sum && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      )}

      {sum && (
        <>
          <div className="mt-4">
            <Segmented
              value={tab}
              onChange={(t) => {
                haptic("tap");
                setTab(t);
              }}
              options={[
                { id: "rewards", label: "Rewards" },
                { id: "board", label: "Leaderboard" },
                { id: "callouts", label: "Callouts" },
              ]}
            />
          </div>

          {tab === "rewards" && (
            <>
          {/* invite */}
          <div className="mt-4 rounded-[28px] p-5" style={{ background: "linear-gradient(135deg,#2a150c,#16110d 62%)", border: "1px solid rgba(255,90,26,0.28)" }}>
            <div className="font-display text-xl font-extrabold">Invite a friend, both pay {sum.discount.percent}% lower fees</div>
            <p className="mt-1 text-base leading-snug text-mute">
              Your friend gets it as soon as they join. You get it once they make their first trade. Fees go from {(sum.discount.baseFeeBps / 100).toFixed(2)}% to {((sum.discount.baseFeeBps * (100 - sum.discount.percent)) / 10_000).toFixed(2)}% or lower.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={share} className="btn3d flex h-14 min-w-0 flex-1 items-center justify-center gap-2 text-base">
                <Share2 size={18} /> Share link
              </button>
              <button type="button" onClick={copy} aria-label="Copy invite link" className="btn3d dark grid h-14 w-14 shrink-0 place-items-center !rounded-2xl">
                {copied ? <Check size={20} className="text-up" /> : <Copy size={20} />}
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between text-base">
              <span className="text-mute">Friends joined / traded</span>
              <span className="font-display font-bold">
                {sum.invites.total} / {sum.invites.traded}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-base">
              <span className="text-mute">Your fee</span>
              <span className={clsx("font-display font-bold", sum.discount.active && "text-up")}>
                {(sum.discount.feeBps / 100).toFixed(2)}% {sum.discount.active ? "(discount on)" : ""}
              </span>
            </div>
          </div>

          {/* things to do */}
          <div className="mb-2 mt-6 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">
              <Award size={20} /> Badges
            </h3>
            <span className="text-base text-mute">
              {earned} of {sum.badges.length}
            </span>
          </div>
          <div className="space-y-2">
            {sum.badges.map((b) => (
              <div key={b.id} className="card flex items-center gap-3 px-4 py-3">
                <div className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", b.earned ? "bg-up/20 text-up" : "bg-raised text-mute")}>{b.earned ? <Check size={22} strokeWidth={3} /> : <Award size={22} />}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-base font-bold">{b.title}</div>
                  <div className="text-base leading-snug text-mute">{b.hint}</div>
                </div>
                {!b.earned && b.total > 1 && (
                  <span className="shrink-0 text-base text-mute">
                    {b.done.toLocaleString("en-US")}/{b.total.toLocaleString("en-US")}
                  </span>
                )}
              </div>
            ))}
          </div>

            </>
          )}

          {tab === "callouts" && (
            <div className="mt-4 space-y-3">
              <div className="rounded-[28px] p-5" style={{ background: "linear-gradient(135deg,#2a150c,#16110d 62%)", border: "1px solid rgba(255,90,26,0.28)" }}>
                <div className="font-display text-xl font-extrabold">Earn when people tail you</div>
                <p className="mt-1 text-base leading-snug text-mute">Write about a coin you hold. When someone taps Tail on your post and then buys that coin, you earn {callouts?.sharePercent ?? 0.1}% of what they buy for the next 24 hours. They pay nothing extra, it comes out of Loofta&apos;s fee. You have to still hold the coin.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { k: "Waiting for payout", v: `$${(callouts?.pendingUsd ?? 0).toFixed(2)}` },
                  { k: "Paid out", v: `$${(callouts?.paidUsd ?? 0).toFixed(2)}` },
                  { k: "People who tailed you", v: String(callouts?.tailers ?? 0) },
                  { k: "Volume you drove", v: usd0(callouts?.tailedVolumeUsd ?? 0) },
                ].map((x) => (
                  <div key={x.k} className="rounded-2xl bg-[#1c1c22] px-3 py-4 text-center">
                    <div className="font-display text-xl font-extrabold">{x.v}</div>
                    <div className="text-base text-mute">{x.k}</div>
                  </div>
                ))}
              </div>
              <p className="text-base text-mute">Earnings are paid out by Loofta in batches. Up to $50 a day counts.</p>
              {callouts && callouts.recent.length > 0 && (
                <div className="card divide-y divide-white/10 px-4">
                  {callouts.recent.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-3 text-base">
                      <span className="font-semibold">{r.symbol}</span>
                      <span className="font-display font-bold text-up">+${r.amountUsd.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              {callouts && callouts.recent.length === 0 && <div className="card px-4 py-8 text-center text-base text-mute">No tails yet. Share a take on a coin you hold, and it shows in the Feed with a Tail button.</div>}
            </div>
          )}

          {/* leaderboard */}
          {tab === "board" && (
            <>
          <div className="mb-2 mt-5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">
              <Trophy size={20} /> This week
            </h3>
            <span className="text-base text-mute">{daysLeft(sum.week.endsAt)} days left</span>
          </div>
          <p className="mb-2 text-base text-mute">Ranked by trading volume. Only completed trades count.</p>
          <div className="card divide-y divide-white/10 px-4">
            {board && board.rows.length === 0 && <div className="py-6 text-center text-base text-mute">No trades yet this week. Be the first.</div>}
            {board?.rows.map((r) => (
              <div key={r.rank} className={clsx("flex items-center gap-3 py-3 text-base", r.you && "text-up")}>
                <span className="w-7 shrink-0 font-display font-bold">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {r.name}
                  {r.you ? " (you)" : ""}
                </span>
                <span className="font-display font-bold">{usd0(r.volumeUsd)}</span>
              </div>
            ))}
            {!board && <div className="py-6 text-center text-base text-mute">The leaderboard is loading.</div>}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl bg-raised px-4 py-3 text-base">
            <span className="text-mute">You</span>
            <span className="font-display font-bold">{sum.week.rank ? `#${sum.week.rank} · ${usd0(sum.week.volumeUsd)}` : "Not ranked yet"}</span>
          </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
