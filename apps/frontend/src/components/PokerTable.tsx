'use client';
// PokerTable.tsx — who's actually in the room, shown as a fixed 2-row grid of avatar seats
// arcing over the pack (not a separate table graphic) so it reads as "these people are gathered
// around the pack" rather than a dry seat counter.
//
// The grid is FIXED per room size (5 vs 10 seats), not recomputed from how many people have
// actually joined — every slot's position is derived purely from `seats`, so the layout never
// reflows or jumps as people trickle in. Empty slots render as dim placeholder "fake seats" so
// the room always looks like its final shape, just filling in. YOU always occupy the exact
// center slot of the front row — never recentered, never displaced by who else has joined —
// and everyone else fills outward from that center slot, nearest-to-you first.
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
import { getMascot, mascotImageSrc } from '@/lib/mascots';

export interface TableSeat {
  seatNumber: number;
  username: string | null;
  isMe?: boolean;
  /** The emoji this participant actually picked, if any — falls back to a deterministic one.
   *  Superseded by mascotKey wherever both are present (see below); still supported for the demo
   *  page and any seat that hasn't locked in a mascot yet. */
  emoji?: string | null;
  /** The mascot this participant locked in (gacha_room_participants.mascot_key), if any — takes
   *  priority over emoji when present. */
  mascotKey?: string | null;
}

export const AVATAR_EMOJIS = ['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦉', '🐺', '🐵', '🐰', '🐹', '🦝', '🐻', '🐧', '🦄'];
// 10 entries — matches the largest room config (10 seats) so assigning by seat number (below)
// can never repeat a color within one room, unlike hashing each person's seed independently.
const BG_COLORS = ['#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#3B82F6', '#EF4444', '#14B8A6', '#F97316', '#84CC16', '#0EA5E9'];

// 'hero' is a bigger version of the exact same layout, used for the waiting-room/exclusion-draw
// moments this component is meant to dominate the page for; 'compact' (the original sizing) is
// used everywhere else so it doesn't crowd out the pack itself.
const SIZE_PRESETS = {
  compact: { container: 'h-24 sm:h-28', back: { size: 24, fontSize: 12 }, front: { size: 32, fontSize: 16 } },
  hero: { container: 'h-40 sm:h-52', back: { size: 36, fontSize: 18 }, front: { size: 52, fontSize: 26 } },
} as const;

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

/** Slot indices ordered by distance from `center` — nearest first, alternating sides on ties —
 *  so "fill outward from the middle" and "empty seats furthest from me stay empty longest" both
 *  fall out of the same simple sort. */
function byDistanceFromCenter(count: number, center: number): number[] {
  return [...Array(count).keys()].sort((a, b) => {
    const da = Math.abs(a - center), db = Math.abs(b - center);
    if (da !== db) return da - db;
    return a - b; // tie-break: prefer the left side consistently over re-sorting every render
  });
}

type Slot = TableSeat | null;

export default function PokerTable({
  seats,
  participants,
  onPickEmoji,
  readySeats,
  size = 'compact',
  excludedSeats,
  spinning,
}: {
  /** Room capacity — 5 or 10 today. Drives the FIXED grid shape; never how many have joined. */
  seats: number;
  participants: TableSeat[];
  /** Present -> tapping your own bubble opens an emoji picker instead of doing nothing. */
  onPickEmoji?: (emoji: string) => void;
  /** Seat numbers that have marked themselves ready — draws a green ring + check badge directly
   *  on that seat's avatar instead of only surfacing readiness as a bare "3/10 ready" count. */
  readySeats?: number[];
  /** 'hero' (bigger) for the lobby/exclusion-draw moments this table should dominate the page
   *  for; 'compact' (default, original sizing) everywhere else. */
  size?: 'compact' | 'hero';
  /** Seat numbers the exclusion draw has knocked out — rendered dim/greyscale with an "OUT" badge
   *  instead of the ready checkmark, regardless of that seat's ready state. */
  excludedSeats?: number[];
  /** True while the exclusion draw's VRF result is pending — every seat's avatar spins in place,
   *  slot-machine style, for suspense. Ignored on seats already in excludedSeats. */
  spinning?: boolean;
}) {
  const me = participants.find((p) => p.isMe) ?? null;
  const others = participants.filter((p) => !p.isMe).sort((a, b) => a.seatNumber - b.seatNumber);

  // Always 2 rows, always `seats` total slots — front row gets the extra one when seats is odd.
  const backCount = Math.max(1, Math.floor(seats / 2));
  const frontCount = Math.max(1, seats - backCount);
  const meFrontIdx = Math.floor((frontCount - 1) / 2); // dead-center slot, reserved for me

  const frontSlots: Slot[] = new Array(frontCount).fill(null);
  const backSlots: Slot[] = new Array(backCount).fill(null);
  frontSlots[meFrontIdx] = me;

  // Fill the remaining slots outward from center — front row's other seats first (closest to
  // me), then the back row (also outward from ITS OWN center, for the same symmetric reason) —
  // so the two or three people who've actually joined so far always land nearest to me, and the
  // empty "fake seats" are always the ones furthest away, never a random-looking gap.
  const frontFillOrder = byDistanceFromCenter(frontCount, meFrontIdx).filter((i) => i !== meFrontIdx);
  const backFillOrder = byDistanceFromCenter(backCount, (backCount - 1) / 2);
  let oi = 0;
  for (const idx of frontFillOrder) { if (oi >= others.length) break; frontSlots[idx] = others[oi++]; }
  for (const idx of backFillOrder) { if (oi >= others.length) break; backSlots[idx] = others[oi++]; }

  const readySet = new Set(readySeats ?? []);
  const excludedSet = new Set(excludedSeats ?? []);
  const preset = SIZE_PRESETS[size];

  const [revealedSeat, setRevealedSeat] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const reveal = (seatNumber: number) => {
    setRevealedSeat(seatNumber);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealedSeat(null), 2000);
  };

  function renderRow(row: Slot[], opts: { size: number; fontSize: number; topBase: number; topSpread: number; zBase: number }) {
    const rn = row.length;
    return row.map((seat, i) => {
      const t = rn === 1 ? 0.5 : i / (rn - 1); // 0..1 across the row — fixed by slot index, not fill count
      const leftPct = 10 + t * 80; // margin so end avatars never clip the container edge
      const bulge = Math.sin(t * Math.PI); // 0 at the ends, 1 in the middle
      const topPct = opts.topBase + (1 - bulge) * opts.topSpread; // dome: middle highest, ends lowest
      const wrapStyle = { left: `${leftPct}%`, top: `${topPct}%`, transform: 'translate(-50%,-50%)', zIndex: seat?.isMe ? 100 : opts.zBase + i };

      if (!seat) {
        return (
          <div key={`empty-${i}`} className="absolute" style={wrapStyle}>
            <div
              className="rounded-full border-2 border-dashed border-white/10"
              style={{ width: opts.size, height: opts.size, opacity: 0.5 }}
            />
          </div>
        );
      }

      const seed = seat.username ?? `seat-${seat.seatNumber}`;
      const emoji = seat.emoji ?? fallbackEmoji(seed);
      const mascot = getMascot(seat.mascotKey);
      // The rainbow per-seat color only made sense for flat emoji glyphs (no bg of their own).
      // Mascot art is already a full-color illustration — a colored disc behind it just clashes —
      // so every mascot seat gets the same neutral bubble instead of a seat-hashed color.
      const bg = mascot ? 'rgba(255,255,255,0.08)' : bgForSeat(seat.seatNumber);
      const isReady = readySet.has(seat.seatNumber);
      const isExcluded = excludedSet.has(seat.seatNumber);
      const isSpinning = !!spinning && !isExcluded;
      const size = seat.isMe ? Math.round(opts.size * 1.22) : opts.size;
      const fontSize = seat.isMe ? Math.round(opts.fontSize * 1.15) : opts.fontSize;
      return (
        <div key={seat.seatNumber} className="absolute" style={wrapStyle}>
          {revealedSeat === seat.seatNumber && !seat.isMe && (
            <div className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/85 border border-white/10 px-2.5 py-1 text-sm text-slate-100">
              {mascot ? `${mascot.name} · ` : ''}{seat.username ?? `Seat ${seat.seatNumber}`}
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
            onMouseEnter={() => !seat.isMe && reveal(seat.seatNumber)}
            onMouseLeave={() => !seat.isMe && setRevealedSeat((cur) => (cur === seat.seatNumber ? null : cur))}
            aria-label={seat.isMe ? 'Pick your emoji' : seat.username ?? `Seat ${seat.seatNumber}`}
            className={`relative rounded-full flex items-center justify-center ring-2 shadow-md cursor-pointer transition-all ${isExcluded ? 'ring-white/10 grayscale' : isReady ? 'ring-emerald-400' : seat.isMe ? 'ring-amber-400' : 'ring-white/20'}`}
            style={{ width: size, height: size, background: bg, fontSize, opacity: isExcluded ? 0.35 : opts.zBase === 10 ? 0.85 : 1 }}
          >
            {mascot ? (
              // eslint-disable-next-line @next/next/no-img-element -- small local SVG sticker, not a next/image candidate
              <img
                src={mascotImageSrc(mascot.key)}
                alt={mascot.name}
                width={size}
                height={size}
                className={`rounded-full ${isSpinning ? 'animate-spin' : ''}`}
                style={isSpinning ? { animationDuration: '0.6s' } : undefined}
                draggable={false}
              />
            ) : (
              emoji
            )}
            {isExcluded ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 rounded-full bg-red-500/90 border border-black/40 flex items-center justify-center text-white leading-none font-bold uppercase"
                style={{ width: Math.max(20, size * 0.55), height: Math.max(12, size * 0.32), fontSize: Math.max(7, size * 0.2) }}
              >
                Out
              </span>
            ) : isReady && (
              <span
                className="absolute -bottom-0.5 -right-0.5 rounded-full bg-emerald-500 border border-black/40 flex items-center justify-center text-white leading-none"
                style={{ width: Math.max(12, size * 0.4), height: Math.max(12, size * 0.4), fontSize: Math.max(8, size * 0.26) }}
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
    <div className={`relative w-full mb-1 select-none transition-[height] duration-300 ${preset.container}`}>
      {renderRow(backSlots, { ...preset.back, topBase: 2, topSpread: 30, zBase: 10 })}
      {renderRow(frontSlots, { ...preset.front, topBase: 32, topSpread: 45, zBase: 50 })}
    </div>
  );
}
