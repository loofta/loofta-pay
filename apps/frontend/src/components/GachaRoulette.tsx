"use client";

// The exclusion draw's reveal — ported 1:1 from pack-party/preview/pack-party-screens.jsx's
// ScreenEat (screen 4): a chip grid that spins a gold "spot" highlight around while the real
// MagicBlock VRF draw resolves server-side, then freezes on each real victim one at a time ("hit"
// — sad + OUT tag). Once every victim is frozen, the full-screen ExclusionReveal cinematic
// (sword-slash + sad mascot + "OUTTT!!") plays on top and hands straight off into voting once it
// finishes — no separate static casualties recap after it (the reference's ScreenOut screen 5):
// that read as a redundant second "they're excluded" beat once the cinematic already showed it.
// The spin itself is pure suspense (identical shape to the reference's `startEat` — spins per
// victim, decaying interval) but the DESTINATION is never random: once `finalVictims` arrives
// from the real draw, every landing is on an actual result, never a guess.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { Shell, Chip, GRAD_STYLE, money, type ChipPlayer } from "@/components/PackParty";
import ExclusionReveal from "@/components/ExclusionReveal";
import { getMascot } from "@/lib/mascots";

export default function GachaRoulette({
  players,
  cardName,
  cardImage,
  rarity,
  potUsdc,
  exclusionCount,
  finalVictims,
  onContinue,
}: {
  players: ChipPlayer[];
  cardName?: string | null;
  cardImage?: string | null;
  rarity?: string | null;
  potUsdc: number;
  exclusionCount: number;
  /** null until the real VRF draw resolves server-side. */
  finalVictims: number[] | null;
  onContinue: () => void;
}) {
  const [spotSeat, setSpotSeat] = useState<number | null>(null);
  const [revealedVictims, setRevealedVictims] = useState<number[]>([]);
  const [cinematicActive, setCinematicActive] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const revealStartedRef = useRef(false);
  const advancedToCinematicRef = useRef(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); timers.current.push(t); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Suspense-only cycling while the real draw is still in flight — no bearing on the outcome.
  // Floor raised from 70ms to 130ms — on a small 5-seat grid, sub-100ms random jumps read as a
  // flicker rather than a spin, especially since the CSS highlight transition (see .pp-roul.spot
  // below) is itself 90ms; anything faster than that never finishes fading in before the next
  // step reassigns it, which is exactly what "glitchy" was describing.
  useEffect(() => {
    if (finalVictims || !players.length) return;
    let cancelled = false;
    let delay = 260;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      setSpotSeat(players[Math.floor(Math.random() * players.length)].seatNumber);
      delay = Math.max(130, delay * 0.95);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [finalVictims, players]);

  // The real result arrived — stop guessing and reveal each real victim in turn, same staggered
  // spin-then-land shape as the reference, just landing on a known seat instead of a random one.
  // Step gap raised from a 55ms floor (55 + i*i*0.9) to a 110ms floor (110 + i*i*1.4) for the same
  // reason as the suspense spin above — the old floor was faster than the highlight's own CSS
  // transition, so consecutive steps visually overlapped instead of reading as discrete landings.
  useEffect(() => {
    if (!finalVictims || revealStartedRef.current) return;
    revealStartedRef.current = true;
    let t = 400;
    finalVictims.forEach((victimSeat, round) => {
      const stillSpinning = players.filter((p) => !finalVictims.slice(0, round).includes(p.seatNumber));
      const spins = 10 + round * 4;
      for (let i = 0; i < spins; i++) {
        const delay = (t += 110 + i * i * 1.4);
        after(delay, () => setSpotSeat(i === spins - 1 ? victimSeat : stillSpinning[Math.floor(Math.random() * stillSpinning.length)].seatNumber));
      }
      t += 450;
      after(t, () => setRevealedVictims((v) => [...v, victimSeat]));
      t += 550;
    });
    after(t + 300, () => setSpotSeat(null));
  }, [finalVictims, players]);

  const allRevealed = !!finalVictims && revealedVictims.length >= finalVictims.length;

  // The hand-off (reveal -> cinematic -> voting) happens on its own, on a fixed beat, instead of
  // waiting on a click — nobody should have to tap through a moment that already resolved. The
  // cinematic itself calls its own onDone once its animation finishes playing (see below), which
  // is what actually advances to voting — no separate recap screen after it (see file header).
  useEffect(() => {
    if (!allRevealed || advancedToCinematicRef.current) return;
    advancedToCinematicRef.current = true;
    after(600, () => setCinematicActive(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRevealed]);

  const cinematic = cinematicActive && finalVictims && (
    <ExclusionReveal
      excludedSeatNumbers={finalVictims}
      getMascotForSeat={(seatNumber) => getMascot(players.find((p) => p.seatNumber === seatNumber)?.mascotKey)}
      onDone={() => { setCinematicActive(false); onContinue(); }}
    />
  );

  return (
    <>
      {cinematic}
      <Shell
      kicker="4 / 6 · ROULETTE"
      title="WHO GETS TO"
      titleGrad="EAT?"
      sub={allRevealed ? "the wheel has spoken." : "pure luck. no crying. (ok some crying)"}
      footer={allRevealed && <span className="pp-small waitpulse" style={{ marginTop: 0 }}>they're out…</span>}
    >
      <p className="font-display text-lg sm:text-xl font-semibold tracking-[0.04em] uppercase mb-4" style={{ marginTop: 0 }}>
        Buyback <span style={GRAD_STYLE}>{money(potUsdc)}</span>
      </p>
      {cardName && (
        <div className="pp-pull">
          {cardImage && (
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              aria-label="Zoom in on this card"
              style={{ position: "relative", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- pp-pull's fixed small size doesn't need next/image's responsive machinery */}
              <img src={cardImage} alt={cardName} />
              <span style={{ position: "absolute", bottom: 2, right: 2, width: 20, height: 20, borderRadius: 999, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Maximize2 style={{ width: 11, height: 11, color: "#fff" }} />
              </span>
            </button>
          )}
          <div>
            <b>{cardName.toUpperCase()}</b>
            <span>{(rarity ?? "common").toUpperCase()}</span>
          </div>
        </div>
      )}
      {zoomOpen && cardImage && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-6" onClick={() => setZoomOpen(false)}>
          <button
            type="button"
            onClick={() => setZoomOpen(false)}
            aria-label="Close"
            className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 border border-white/20 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- full-res zoom needs the raw source, not a canvas render */}
          <img src={cardImage} alt={cardName ?? "Card"} className="max-w-[92vw] max-h-[92vh] object-contain rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>,
        document.body,
      )}
      <div className="pp-lobbygrid">
        {players.map((p) => {
          const isSpot = spotSeat === p.seatNumber;
          const hit = revealedVictims.includes(p.seatNumber);
          return (
            <div key={p.seatNumber} className={"pp-roul" + (isSpot ? " spot" : "") + (hit ? " hit" : "")}>
              <Chip p={p} mood={hit ? "sad" : isSpot ? "happy" : "idle"} ring={isSpot ? "#E8B23A" : hit ? "#FF1301" : null} tag={hit ? "OUT" : undefined} />
            </div>
          );
        })}
      </div>
      <p className="pp-small">
        {exclusionCount} of {players.length} {exclusionCount === 1 ? "player gets" : "players get"} excluded — survivors split the buyback.
      </p>
      </Shell>
    </>
  );
}
