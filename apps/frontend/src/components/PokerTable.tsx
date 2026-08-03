'use client';
// PokerTable.tsx — who's actually in the room, shown as a shallow half-circle of avatar bubbles
// arcing over the pack (not a separate table graphic) so it reads as "these people are gathered
// around the pack" rather than a dry seat counter.
//
// Compact and label-free by default — usernames don't sit permanently under each bubble (that
// breaks down fast at 10 seats on a narrow phone); tap/click a bubble to reveal that person's
// username in a small floating tag for a couple seconds instead.
//
// Each seat's avatar is either the emoji that participant actually picked (see the emoji picker
// wired into the room/demo pages — `emoji` prop below) or, until they pick one, a deterministic
// fallback hashed from their username/seat so it's never blank.

import { useEffect, useRef, useState } from 'react';

export interface TableSeat {
  seatNumber: number;
  username: string | null;
  isMe?: boolean;
  /** The emoji this participant actually picked, if any — falls back to a deterministic one. */
  emoji?: string | null;
}

export const AVATAR_EMOJIS = ['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦉', '🐺', '🐵', '🐰', '🐹', '🦝', '🐻', '🐧', '🦄'];
const BG_COLORS = ['#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#3B82F6', '#EF4444', '#14B8A6', '#F97316'];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function fallbackAvatar(seed: string) {
  const h = hashSeed(seed);
  return { emoji: AVATAR_EMOJIS[h % AVATAR_EMOJIS.length], bg: BG_COLORS[Math.floor(h / AVATAR_EMOJIS.length) % BG_COLORS.length] };
}
function bgFor(seed: string) {
  return BG_COLORS[Math.floor(hashSeed(seed) / 7) % BG_COLORS.length];
}

/** seats is only used to pick a size that still fits ~10 across a narrow phone without
 *  overlapping too much — the arc itself is spaced across however many participants there
 *  actually are, not the room's full seat count (an arc stretched to fit 2 people into a 10-seat
 *  span would just look sparse/broken). */
export default function PokerTable({ seats, participants }: { seats: number; participants: TableSeat[] }) {
  const ordered = [...participants].sort((a, b) => a.seatNumber - b.seatNumber);
  const n = ordered.length;
  const [revealedSeat, setRevealedSeat] = useState<number | null>(null);
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
        const emoji = seat.emoji ?? fallbackAvatar(seed).emoji;
        const bg = bgFor(seed);
        return (
          <div
            key={seat.seatNumber}
            className="absolute"
            style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: 'translate(-50%,-50%)', zIndex: seat.isMe ? 50 : 10 + i }}
          >
            {revealedSeat === seat.seatNumber && (
              <div className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/85 border border-white/10 px-2.5 py-1 text-sm text-slate-100">
                {seat.isMe ? 'You' : seat.username ?? `Seat ${seat.seatNumber}`}
              </div>
            )}
            <button
              type="button"
              onClick={() => reveal(seat.seatNumber)}
              aria-label={seat.isMe ? 'You' : seat.username ?? `Seat ${seat.seatNumber}`}
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
