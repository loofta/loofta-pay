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
}: {
  seats: number;
  participants: TableSeat[];
  /** Present -> tapping your own bubble opens an emoji picker instead of doing nothing. */
  onPickEmoji?: (emoji: string) => void;
}) {
  // Everyone else stays sorted by seat number, but "me" is pulled out and reinserted at the
  // middle index — that's the arc's highest/most-central point (see the bulge math below) — so
  // you're always front and center regardless of which seat you actually landed in.
  const sorted = [...participants].sort((a, b) => a.seatNumber - b.seatNumber);
  const meIndex = sorted.findIndex((p) => p.isMe);
  let ordered = sorted;
  if (meIndex !== -1) {
    const me = sorted[meIndex];
    const others = sorted.filter((_, i) => i !== meIndex);
    const mid = Math.floor(others.length / 2);
    ordered = [...others.slice(0, mid), me, ...others.slice(mid)];
  }
  const n = ordered.length;
  const [revealedSeat, setRevealedSeat] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  if (n === 0) return null;

  const compact = seats > 6;
  const size = compact ? 30 : 38; // px

  const reveal = (seatNumber: number) => {
    setRevealedSeat(seatNumber);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealedSeat(null), 2000);
  };

  return (
    <div className="relative w-full h-16 sm:h-20 mb-1 select-none">
      {ordered.map((seat, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1); // 0..1 across the arc
        const leftPct = 10 + t * 80; // keep a margin so end avatars never clip the container edge
        const bulge = Math.sin(t * Math.PI); // 0 at the ends, 1 in the middle
        const topPct = (1 - bulge) * 55 + 4; // dome shape: middle sits highest, ends sit lowest
        const seed = seat.username ?? `seat-${seat.seatNumber}`;
        const emoji = seat.emoji ?? fallbackEmoji(seed);
        const bg = bgForSeat(seat.seatNumber);
        return (
          <div
            key={seat.seatNumber}
            className="absolute"
            style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: 'translate(-50%,-50%)', zIndex: seat.isMe ? 50 : 10 + i }}
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
              className={`rounded-full flex items-center justify-center ring-2 shadow-md cursor-pointer ${seat.isMe ? 'ring-amber-400' : 'ring-white/20'}`}
              style={{ width: size, height: size, background: bg, fontSize: compact ? 15 : 18 }}
            >
              {emoji}
            </button>
          </div>
        );
      })}
    </div>
  );
}
