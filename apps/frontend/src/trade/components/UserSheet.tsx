"use client";

import { useEffect, useState } from "react";
import { PersonAvatar } from "@/trade/components/PersonAvatar";
import { Sheet } from "@/trade/components/Sheet";
import { Avatar, Skeleton } from "@/trade/components/ui";
import { humanError } from "@/trade/lib/errors";
import { fmt } from "@/trade/lib/solana";
import { fetchUser, type PublicProfile } from "@/trade/lib/takes";

const money = (v: number) => (Math.abs(v) >= 1000 ? `$${fmt(v, 0)}` : `$${fmt(v, 2)}`);
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Someone else's public page: what they traded through Loofta and what they said. Only what they chose to share. */
export function UserSheet({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [p, setP] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchUser(handle)
      .then((r) => alive && setP(r))
      .catch((e) => alive && setError(humanError(e, "Could not load this profile.")));
    return () => {
      alive = false;
    };
  }, [handle]);

  const stats = p?.stats
    ? [
        { label: "Volume", value: money(p.stats.volumeUsd) },
        { label: "Trades", value: String(p.stats.trades) },
        { label: "Coins", value: String(p.stats.coins) },
        { label: "Biggest", value: money(p.stats.biggestUsd) },
        { label: "Bets", value: String(p.stats.predictions) },
        { label: "Bet total", value: money(p.stats.predictedUsd) },
      ]
    : [];

  return (
    <Sheet title="Profile" onClose={onClose}>
      {error && <div className="mt-4 rounded-2xl bg-[#1c1c22] p-4 text-center text-base text-mute">{error}</div>}
      {!error && !p && <Skeleton className="mt-4 h-40" />}
      {p && (
        <div className="mt-4 space-y-5">
          <div className="flex items-center gap-3">
            <PersonAvatar avatar={p.avatar} name={p.handle} size={64} />
            <div className="min-w-0">
              <div className="truncate font-display text-xl font-extrabold">{p.handle}</div>
              {p.joinedAt && <div className="text-base text-mute">Joined {new Date(p.joinedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</div>}
            </div>
          </div>

          {p.stats ? (
            <div className="grid grid-cols-3 gap-2">
              {stats.map((s) => (
                <div key={s.label} className="rounded-2xl bg-[#1c1c22] px-2 py-3 text-center">
                  <div className="font-display text-base font-bold">{s.value}</div>
                  <div className="text-base text-mute">{s.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#1c1c22] p-4 text-center text-base text-mute">This person keeps their trading private.</div>
          )}

          {p.topCoins.length > 0 && (
            <div>
              <div className="mb-2 text-base font-bold uppercase tracking-[0.04em] text-mute">Most traded</div>
              <div className="space-y-2">
                {p.topCoins.map((c) => (
                  <div key={c.mint} className="flex items-center gap-3 rounded-2xl bg-[#1c1c22] p-3">
                    <Avatar mint={c.mint} symbol={c.symbol} src={c.icon} size={36} />
                    <div className="min-w-0 flex-1 truncate font-display text-base font-bold">{c.symbol}</div>
                    <div className="font-display text-base font-bold">{money(c.volumeUsd)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-base font-bold uppercase tracking-[0.04em] text-mute">Takes</div>
            {p.takes.length === 0 && <div className="rounded-2xl bg-[#1c1c22] p-4 text-center text-base text-mute">No takes yet.</div>}
            <div className="space-y-2">
              {p.takes.map((t) => (
                <div key={t.id} className="rounded-2xl bg-[#1c1c22] p-3">
                  <div className="flex items-center gap-2 text-base text-mute">
                    <Avatar mint={t.mint} symbol={t.symbol} src={t.icon} size={22} />
                    <span className="font-semibold text-ink">{t.symbol}</span>
                    <span>{ago(t.createdAt)}</span>
                  </div>
                  <p className="mt-1 break-words text-base leading-snug">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
