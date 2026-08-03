'use client';
// PokerTable.tsx — who's actually in the room, shown as a shallow half-circle of avatar bubbles
// arcing over the pack (not a separate table graphic) so it reads as "these people are gathered
// around the pack" rather than a dry seat counter.
//
// Compact and label-free by default — usernames don't sit permanently under each bubble (that
// breaks down fast at 10 seats on a narrow phone); tap/click ANOTHER seat's bubble to reveal
// their username in a small floating tag for a couple seconds. Tap/click YOUR OWN bubble instead
// opens a small emoji picker right there, so choosing your avatar is discoverable without a
// permanently-visible picker row taking up space below the table.
//
// Each seat's avatar is either the emoji that participant actually picked (see onPickEmoji) or,
// until they pick one, a deterministic fallback hashed from their username/seat so it's never
// blank.

import { useEffect, useRef, useState } from 'react';

export interface TableSeat {
  seatNumber: number;
  username: string | null;
  isMe?: boolean;
  /** The emoji this participant actually picked, if any — falls back to a deterministic one. */
  emoji?: string | null;
}

export const AVATAR_EMOJIS = ['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦉', '🐺', '🐵', '🐰', '🐹', '🦝', '🐻', '🐧', '🦄'];
// 10 entries — matches the largest room config (10 seats) so assigning by seat number (below)
// can never repeat a color within one room, unlike hashing each person's seed independently.
const BG_COLORS = ['#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#3B82F6', '#EF4444', '#14B8A6', '#F97316', '#84CC16', '#0EA5E9'];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function fallbackEmoji(seed: string): string {
  return AVATAR_EMOJIS[hashSeed(seed) % AVATAR_EMOJIS.length];
}
/** Assigned by seat number, not hashed from username — guarantees every seat in the room gets a
 *  visually distinct color (a hash-per-person approach can and did collide once seats > ~4). */
function bgForSeat(seatNumber: number): string {
  return BG_COLORS[(seatNumber - 1) % BG_COLORS.length];
}

/** seats is only used to pick a size that still fits ~10 across a narrow phone without
 *  overlapping too much — the arc itself is spaced across however many participants there
 *  actually are, not the room's full seat count (an arc stretched to fit 2 people into a 10-seat
 *  span would just look sparse/broken). */
export default function PokerTable({
  seats,
  participants,
  onPickEmoji,
  readySeats,
}: {
  seats: number;
  participants: TableSeat[];
  /** Present -> tapping your own bubble opens an emoji picker instead of doing nothing. */
  onPickEmoji?: (emoji: string) => void;
  /** Seat numbers that have marked themselves ready — draws a green ring + check badge directly
   *  on that seat's avatar instead of only surfacing readiness as a bare "3/10 ready" count. */
  readySeats?: number[];
}) {
  // Everyone else stays sorted by seat number, but "me" is pulled out and reinserted at the
  // middle of the FRONT row (see below) — the arc's highest/most-central point — so you're
  // always front and center regardless of which seat you actually landed in.
  const sorted = [...participants].sort((a, b) => a.seatNumber - b.seatNumber);
  const meIndex = sorted.findIndex((p) => p.isMe);
  const me = meIndex !== -1 ? sorted[meIndex] : null;
  const others = me ? sorted.filter((_, i) => i !== meIndex) : sorted;
  const n = sorted.length;

  // Above ~6 SEATS (room capacity, not how many have joined yet — a room going from one row to
  // two mid-fill, right as the 7th person lands, would be a jarring layout jump), spreading
  // everyone across one arc packs avatars closer together than their own diameter on a
  // phone-width screen — confirmed overlapping in practice at 10. Splitting into two depth rows
  // (front: closer/bigger, back: farther/smaller, poker-table style) roughly doubles the
  // effective per-avatar spacing for the same footprint instead of shrinking avatars below a
  // usable size. "Me" always lands in the front row.
  const twoRows = seats > 6;
  let frontRow: TableSeat[];
  let backRow: TableSeat[];
  if (!twoRows) {
    const mid = Math.floor(others.length / 2);
    frontRow = me ? [...others.slice(0, mid), me, ...others.slice(mid)] : others;
    backRow = [];
  } else {
    const frontOthersCount = Math.ceil(n / 2) - (me ? 1 : 0);
    const frontOthers = others.slice(0, frontOthersCount);
    backRow = others.slice(frontOthersCount);
    const mid = Math.floor(frontOthers.length / 2);
    frontRow = me ? [...frontOthers.slice(0, mid), me, ...frontOthers.slice(mid)] : frontOthers;
  }

  const readySet = new Set(readySeats ?? []);

  const [revealedSeat, setRevealedSeat] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  if (n === 0) return null;

  const reveal = (seatNumber: number) => {
    setRevealedSeat(seatNumber);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealedSeat(null), 2000);
  };

  function renderRow(row: TableSeat[], opts: { size: number; fontSize: number; topBase: number; topSpread: number; zBase: number }) {
    const rn = row.length;
    return row.map((seat, i) => {
      const t = rn === 1 ? 0.5 : i / (rn - 1); // 0..1 across the row
      const leftPct = 10 + t * 80; // margin so end avatars never clip the container edge
      const bulge = Math.sin(t * Math.PI); // 0 at the ends, 1 in the middle
      const topPct = opts.topBase + (1 - bulge) * opts.topSpread; // dome: middle highest, ends lowest
      const seed = seat.username ?? `seat-${seat.seatNumber}`;
      const emoji = seat.emoji ?? fallbackEmoji(seed);
      const bg = bgForSeat(seat.seatNumber);
      const isReady = readySet.has(seat.seatNumber);
      return (
        <div
          key={seat.seatNumber}
          className="absolute"
          style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: 'translate(-50%,-50%)', zIndex: seat.isMe ? 100 : opts.zBase + i }}
        >
          {revealedSeat === seat.seatNumber && !seat.isMe && (
            <div className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/85 border border-white/10 px-2.5 py-1 text-sm text-slate-100">
              {seat.username ?? `Seat ${seat.seatNumber}`}
            </div>
          )}
          {seat.isMe && pickerOpen && onPickEmoji && (
            <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 w-[248px] flex flex-wrap justify-center gap-2 rounded-2xl bg-black/90 border border-white/10 p-3">
              {AVATAR_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { onPickEmoji(e); setPickerOpen(false); }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-colors ${emoji === e ? "bg-amber-500/30 ring-2 ring-amber-400" : "bg-white/10 hover:bg-white/15 active:bg-white/20"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => (seat.isMe && onPickEmoji ? setPickerOpen((o) => !o) : reveal(seat.seatNumber))}
            aria-label={seat.isMe ? 'Pick your emoji' : seat.username ?? `Seat ${seat.seatNumber}`}
            className={`relative rounded-full flex items-center justify-center ring-2 shadow-md cursor-pointer transition-shadow ${isReady ? 'ring-emerald-400' : seat.isMe ? 'ring-amber-400' : 'ring-white/20'}`}
            style={{ width: opts.size, height: opts.size, background: bg, fontSize: opts.fontSize, opacity: opts.zBase === 10 ? 0.85 : 1 }}
          >
            {emoji}
            {isReady && (
              <span
                className="absolute -bottom-0.5 -right-0.5 rounded-full bg-emerald-500 border border-black/40 flex items-center justify-center text-white leading-none"
                style={{ width: Math.max(12, opts.size * 0.4), height: Math.max(12, opts.size * 0.4), fontSize: Math.max(8, opts.size * 0.26) }}
              >
                ✓
              </span>
            )}
          </button>
        </div>
      );
    });
  }

  return (
    <div className={`relative w-full mb-1 select-none ${twoRows ? 'h-24 sm:h-28' : 'h-16 sm:h-20'}`}>
      {twoRows && renderRow(backRow, { size: 24, fontSize: 12, topBase: 2, topSpread: 30, zBase: 10 })}
      {renderRow(frontRow, twoRows ? { size: 32, fontSize: 16, topBase: 32, topSpread: 45, zBase: 50 } : { size: 38, fontSize: 18, topBase: 4, topSpread: 55, zBase: 10 })}
    </div>
  );
}
