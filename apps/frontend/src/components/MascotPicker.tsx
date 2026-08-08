"use client";

// Mascot lock-in — pick one of the 20 branded mascots, preview it locally, then explicitly commit
// with "Lock In". Deliberately a separate two-step (pick -> confirm) flow rather than reusing
// PokerTable's own-seat emoji popover (which commits on first click): once locked, the choice is
// permanent for the room (see gacha.service.ts lockMascot), so a stray tap shouldn't be able to
// lock the wrong one in.

import { useCallback, useEffect, useRef, useState } from "react";
import { MASCOTS, mascotImageSrc } from "@/lib/mascots";

const PICK_SECONDS = 30;

export default function MascotPicker({
  lockedMascotKey,
  onLock,
}: {
  /** Already-locked mascot key for this seat, if any — renders the read-only "locked in" state. */
  lockedMascotKey: string | null;
  onLock: (mascotKey: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PICK_SECONDS);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  // Guards against firing twice: lockedMascotKey only updates once the parent's refresh() round
  // trip completes after a successful lock, so without this the auto-lock effect below would see
  // secondsLeft still 0 and locking already back to false in that gap and fire again.
  const autoLockedRef = useRef(false);

  const lockKey = useCallback(async (mascotKey: string) => {
    setLocking(true);
    setError(null);
    const res = await onLock(mascotKey);
    if (!res.ok) setError(res.error ?? "Couldn't lock that in — please try again.");
    setLocking(false);
  }, [onLock]);

  // 30s to pick — if you haven't locked one in by then, you get a random one so a distracted
  // player can never stall the whole room from advancing to the exclusion draw.
  useEffect(() => {
    if (lockedMascotKey) return;
    const interval = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
  }, [lockedMascotKey]);

  useEffect(() => {
    if (lockedMascotKey || secondsLeft > 0 || locking || autoLockedRef.current) return;
    autoLockedRef.current = true;
    const fallback = selectedRef.current ?? MASCOTS[Math.floor(Math.random() * MASCOTS.length)].key;
    void lockKey(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lockKey/locking would re-run this every render
  }, [secondsLeft, lockedMascotKey]);

  if (lockedMascotKey) {
    const mascot = MASCOTS.find((m) => m.key === lockedMascotKey);
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 flex items-center gap-4">
        {mascot && (
          // eslint-disable-next-line @next/next/no-img-element -- small local SVG sticker
          <img src={mascotImageSrc(mascot.key)} alt={mascot.name} width={56} height={56} className="rounded-full bg-white/10 shrink-0" />
        )}
        <div>
          <p className="font-display text-xl font-medium tracking-[-0.02em] text-white">Locked in: {mascot?.name ?? lockedMascotKey}</p>
          <p className="text-slate-400 text-base">Waiting on everyone else to lock in too…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308]" />
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="font-display text-3xl font-medium tracking-[-0.02em] text-white">Pick your mascot</p>
        <span className={`font-display text-2xl tabular-nums ${secondsLeft <= 10 ? "text-red-300" : "text-slate-400"}`}>0:{secondsLeft.toString().padStart(2, "0")}</span>
      </div>
      <p className="text-slate-400 text-base -mt-2">Lock it in for the whole game — no pick by the timer and you get a random one.</p>

      {error && <p className="text-red-300 text-base">{error}</p>}

      <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
        {MASCOTS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setSelected(m.key)}
            aria-label={m.name}
            className={`flex flex-col items-center gap-1 rounded-xl p-2 transition-all ${selected === m.key ? "bg-gradient-to-br from-[#FF1301]/20 via-[#FF6A00]/20 to-[#EAB308]/20 ring-2 ring-[#FF6A00] scale-105" : "bg-white/5 hover:bg-white/10 active:bg-white/15 ring-1 ring-white/10"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- small local SVG sticker */}
            <img src={mascotImageSrc(m.key)} alt={m.name} width={48} height={48} className="rounded-full bg-white/10" draggable={false} />
            <span className="text-xs font-semibold text-slate-300 truncate w-full text-center">{m.name}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => selected && lockKey(selected)}
        disabled={!selected || locking}
        className="w-full h-12 rounded-full bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308] text-white font-display font-semibold text-lg hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {locking ? "Locking in…" : selected ? `Lock in ${MASCOTS.find((m) => m.key === selected)?.name}` : "Pick a mascot"}
      </button>
    </div>
  );
}
