// Snapshot of Megapot's published tiers (docs.megapot.io/learn/prize-structure, taken
// 2026-07-12 against a ~$1.1M pool). The `prize` dollar figures here are a stale, ~10%-discounted
// estimate and are NOT shown to users anymore — PrizeTiersModal in megapot/page.tsx fetches the
// real, live per-tier payout from GET /lottery/prize-tiers instead (the amount a ticket in that
// tier just actually paid out from the most recently settled round). This array now only supplies
// the tier SHAPE/ORDER (normal/bonusMatch combos) for the ball display and for ticketTierLabel's
// win/no-win existence check below — its `prize` field is otherwise unused and shouldn't be
// trusted as a real number.
export const PRIZE_TIERS = [
  { normal: 5, bonusMatch: true, prize: "$183,918.03" },
  { normal: 5, bonusMatch: false, prize: "$1,858.64" },
  { normal: 4, bonusMatch: true, prize: "$179.24" },
  { normal: 4, bonusMatch: false, prize: "$20.71" },
  { normal: 3, bonusMatch: true, prize: "$8.33" },
  { normal: 2, bonusMatch: true, prize: "$4.77" },
  { normal: 3, bonusMatch: false, prize: "$4.19" },
  { normal: 1, bonusMatch: true, prize: "$2.66" },
  { normal: 2, bonusMatch: false, prize: "Free ticket" },
  { normal: 0, bonusMatch: true, prize: "Free ticket" },
] as const;

export function ticketTierLabel(matchedNormals: number, bonusMatch: boolean): string | null {
  const tier = PRIZE_TIERS.find((t) => t.normal === matchedNormals && t.bonusMatch === bonusMatch);
  return tier?.prize ?? null;
}

/** Renders one ticket's main + bonus numbers, with an optional win/no-win badge when
 *  winningNumbers is supplied — omit it (e.g. a freshly-claimed gift ticket, before any draw has
 *  happened) to render just the numbers with no win-tier logic invoked at all. */
export function TicketNumberCard({ tn, winningNumbers }: {
  tn: { main: number[]; bonus: number };
  winningNumbers?: { main: number[]; bonus: number } | null;
}) {
  const winSet = winningNumbers ? new Set(winningNumbers.main) : null;
  const bonusHit = winningNumbers ? tn.bonus === winningNumbers.bonus : false;
  const matchedCount = winSet ? tn.main.filter((n) => winSet.has(n)).length : 0;
  const prize = winningNumbers ? ticketTierLabel(matchedCount, bonusHit) : null;
  // Megapot's own lowest tier is marketed as "a free ticket", but on-chain claimWinnings pays
  // out real USDC for it exactly like every other tier — there's no separate non-monetary
  // redemption path in either their contract or ours. Treat it as a normal win, not a distinct
  // "free ticket" case, so this badge can't contradict the card header (which already shows it
  // as a real, redeemable "Won!" amount).
  const isWin = prize !== null;

  return (
    <div className={`flex items-center rounded-xl border bg-white/[0.04] px-3 gap-3 relative overflow-hidden ${isWin ? "border-emerald-500/30" : "border-white/[0.08]"
      }`} style={{ minHeight: 58 }}>
      {/* Numbers */}
      <div className="flex flex-col gap-1 flex-1 min-w-0 py-3">
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-600 uppercase">Numbers</span>
        <div className="flex gap-2.5">
          {tn.main.map((n) => {
            const hit = winSet?.has(n);
            return (
              <span key={n} className={`text-sm font-bold tabular-nums ${hit ? "text-emerald-400" : "text-slate-400"}`}>
                {n}
              </span>
            );
          })}
        </div>
      </div>
      {/* Dashed separator */}
      <div className="self-stretch border-l border-dashed border-white/[0.12] mx-1" />
      {/* Bonus */}
      <div className="flex flex-col items-center gap-1 shrink-0 py-3">
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-600 uppercase">Bonus</span>
        <span className={`w-7 h-7 rounded-full border text-sm font-bold flex items-center justify-center tabular-nums ${bonusHit
          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
          : "border-amber-500/50 bg-amber-500/10 text-amber-400"
          }`}>
          {tn.bonus}
        </span>
      </div>
      {/* WIN / NO WIN label — only shown when we have winning numbers */}
      {winningNumbers && (
        <>
          <div className="self-stretch border-l border-dashed border-white/[0.12] mx-1" />
          <div className="shrink-0 py-3">
            {isWin ? (
              <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-bold whitespace-nowrap">
                WIN
              </span>
            ) : (
              <span className="text-slate-600 text-sm font-bold uppercase tracking-wide">No win</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
