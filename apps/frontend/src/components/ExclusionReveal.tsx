"use client";

// Full-screen cinematic takeover for the exclusion-draw reveal — a movie-style 16:9 frame with
// black letterbox bars sliding in, a sword-slash streak per excluded player, their mascot shown
// big in its "sad" mood (droop + tear + rain cloud — see Mascot.tsx), and a manga/cartoon-style
// "OUTTT!!" SFX-text burst. Deliberately NOT a bordered/boxed panel like the rest of this page's
// status cards (that reads as a form-validation alert, not a game moment) — this is a fixed,
// full-viewport overlay (same z-[9999]-over-everything convention as MainnetLaunchCelebration)
// that self-dismisses once its animation finishes, handing control back to the normal page
// underneath (which has usually already advanced past 'excluding' by then).

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Mascot from "@/components/Mascot";
import type { Mascot as MascotMeta } from "@/lib/mascots";

// Gap between the sad mascot landing and the "OUTTT!!" stamp punching in over it — deliberately
// generous (not the near-simultaneous 0.15s it used to be) so there's a real beat to actually see
// them sad before the callout lands, instead of both arriving as one blur.
const SAD_BEFORE_OUT_S = 1.1;

export default function ExclusionReveal({
  excludedSeatNumbers,
  getMascotForSeat,
  onDone,
}: {
  excludedSeatNumbers: number[];
  getMascotForSeat: (seatNumber: number) => MascotMeta | null;
  onDone: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Letterbox-in (~0.5s) + first slash start (~0.9s) + one slash per player (~0.9s stagger) +
    // the sad-before-OUT beat + a hold to read the last name + letterbox-out — generous enough to
    // never feel rushed at 2 excluded (the common case) without dragging at higher counts.
    const totalMs = 1400 + excludedSeatNumbers.length * 900 + SAD_BEFORE_OUT_S * 1000 + 2200;
    const t = setTimeout(() => setVisible(false), totalMs);
    return () => clearTimeout(t);
  }, [excludedSeatNumbers.length]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] bg-black flex items-center justify-center overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="absolute top-0 left-0 right-0 bg-black"
            initial={{ height: 0 }}
            animate={{ height: "14vh" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
          <motion.div
            className="absolute bottom-0 left-0 right-0 bg-black"
            initial={{ height: 0 }}
            animate={{ height: "14vh" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />

          <div className="relative w-full aspect-video max-h-full flex flex-col items-center justify-center gap-6 sm:gap-10 px-6">
            <motion.p
              className="font-display text-xl sm:text-3xl uppercase tracking-[0.35em] text-white/60"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              Excluded
            </motion.p>

            <div className="flex flex-wrap items-center justify-center gap-10 sm:gap-20">
              {excludedSeatNumbers.map((seatNumber, i) => {
                const mascot = getMascotForSeat(seatNumber);
                const delay = 0.9 + i * 0.9;
                return (
                  <div key={seatNumber} className="relative flex flex-col items-center gap-2 sm:gap-3">
                    <motion.div
                      className="absolute -inset-4 pointer-events-none"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ delay, duration: 0.35, times: [0, 0.45, 1] }}
                    >
                      <div className="absolute left-1/2 top-1/2 h-[3px] w-[260%] -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_24px_6px_rgba(255,255,255,0.85)]" />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: delay + 0.15, type: "spring", stiffness: 260, damping: 18 }}
                      className="relative"
                    >
                      {mascot && <Mascot name={mascot.key} mood="sad" size={128} />}

                      {/* manga/cartoon SFX-text burst — lands well after the sad mascot (see
                          SAD_BEFORE_OUT_S) so there's a real beat to see them sad first */}
                      <motion.span
                        initial={{ opacity: 0, scale: 2.2, rotate: -18 }}
                        animate={{ opacity: 1, scale: 1, rotate: -12 }}
                        transition={{ delay: delay + 0.15 + SAD_BEFORE_OUT_S, type: "spring", stiffness: 260, damping: 12 }}
                        className="absolute -inset-x-6 top-1/2 -translate-y-1/2 flex items-center justify-center font-display italic text-4xl sm:text-6xl font-medium text-transparent bg-clip-text bg-gradient-to-b from-white via-[#FFE9A8] to-[#EAB308] pointer-events-none"
                        style={{
                          WebkitTextStroke: "2px #7A0A00",
                          filter: "drop-shadow(0 0 3px rgba(0,0,0,0.9)) drop-shadow(0 6px 10px rgba(0,0,0,0.6))",
                        }}
                      >
                        OUTTT!!
                      </motion.span>
                    </motion.div>

                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: delay + 0.5 }}
                      className="font-display text-lg sm:text-2xl font-medium tracking-[-0.01em] text-white"
                    >
                      {mascot?.name ?? `Seat ${seatNumber}`}
                    </motion.span>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
