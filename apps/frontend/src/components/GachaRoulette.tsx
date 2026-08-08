"use client";

// The exclusion draw's reveal — ported 1:1 from pack-party/preview/pack-party-screens.jsx's
// ScreenEat + ScreenOut (screens 4 and 5): a chip grid that spins a gold "spot" highlight around
// while the real MagicBlock VRF draw resolves server-side, then freezes on each real victim one
// at a time ("hit" — sad + OUT tag), then hands off to a static OUUUT casualties screen before
// letting the caller continue into voting. The spin itself is pure suspense (identical shape to
// the reference's `startEat` — spins per victim, decaying interval) but the DESTINATION is never
// random: once `finalVictims` arrives from the real draw, every landing is on an actual result,
// never a guess.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { Shell, Chip, GRAD_STYLE, money, type ChipPlayer } from "@/components/PackParty";

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
  const [phase, setPhase] = useState<"spin" | "out">("spin");
  const [zoomOpen, setZoomOpen] = useState(false);
  const revealStartedRef = useRef(false);
  const advancedToOutRef = useRef(false);
  const advancedToVoteRef = useRef(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); timers.current.push(t); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Suspense-only cycling while the real draw is still in flight — no bearing on the outcome.
  useEffect(() => {
    if (finalVictims || !players.length) return;
    let cancelled = false;
    let delay = 220;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      setSpotSeat(players[Math.floor(Math.random() * players.length)].seatNumber);
      delay = Math.max(70, delay * 0.93);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [finalVictims, players]);

  // The real result arrived — stop guessing and reveal each real victim in turn, same staggered
  // spin-then-land shape as the reference, just landing on a known seat instead of a random one.
  useEffect(() => {
    if (!finalVictims || revealStartedRef.current) return;
    revealStartedRef.current = true;
    let t = 400;
    finalVictims.forEach((victimSeat, round) => {
      const stillSpinning = players.filter((p) => !finalVictims.slice(0, round).includes(p.seatNumber));
      const spins = 10 + round * 4;
      for (let i = 0; i < spins; i++) {
        const delay = (t += 55 + i * i * 0.9);
        after(delay, () => setSpotSeat(i === spins - 1 ? victimSeat : stillSpinning[Math.floor(Math.random() * stillSpinning.length)].seatNumber));
      }
      t += 450;
      after(t, () => setRevealedVictims((v) => [...v, victimSeat]));
      t += 550;
    });
    after(t + 300, () => setSpotSeat(null));
  }, [finalVictims, players]);

  const allRevealed = !!finalVictims && revealedVictims.length >= finalVictims.length;

  // Both hand-offs (reveal -> OUUUT -> voting) now happen on their own, on a fixed beat, instead
  // of waiting on a click — nobody should have to tap through a moment that already resolved.
  useEffect(() => {
    if (!allRevealed || advancedToOutRef.current) return;
    advancedToOutRef.current = true;
    after(2200, () => setPhase("out"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRevealed]);

  useEffect(() => {
    if (phase !== "out" || advancedToVoteRef.current) return;
    advancedToVoteRef.current = true;
    after(3000, onContinue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const outs = players.filter((p) => finalVictims?.includes(p.seatNumber));
  const survivorCount = players.length - (finalVictims?.length ?? 0);

  if (phase === "out") {
    const viewerExcluded = outs.some((p) => p.isMe);
    return (
      <Shell
        kicker="5 / 7 · CASUALTIES"
        title={viewerExcluded ? "YOU'RE" : "THEY'RE"}
        titleGrad="OUUUT"
        sub="thoughts and prayers. mostly prayers."
        footer={<span className="pp-small waitpulse" style={{ marginTop: 0 }}>survivors vote next…</span>}
      >
        <div className="pp-outrow">
          {outs.map((p) => (
            <Chip key={p.seatNumber} p={p} mood="sad" size={110} tag="no soup" />
          ))}
        </div>
        <p className="pp-small">{survivorCount} still standing</p>
      </Shell>
    );
  }

  return (
    <Shell
      kicker="4 / 7 · ROULETTE"
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
  );
}
