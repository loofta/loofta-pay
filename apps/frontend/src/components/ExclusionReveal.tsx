"use client";

// Full-screen cinematic takeover for the exclusion-draw reveal — a movie-style 16:9 frame with
// black letterbox bars sliding in, a sword-slash streak per excluded player, and a big "OUT"
// stamp over their portrait. Deliberately NOT a bordered/boxed panel like the rest of this page's
// status cards (that reads as a form-validation alert, not a game moment) — this is a fixed,
// full-viewport overlay (same z-[9999]-over-everything convention as MainnetLaunchCelebration)
// that self-dismisses once its animation finishes, handing control back to the normal page
// underneath (which has usually already advanced past 'excluding' by then).

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { mascotImageSrc, type Mascot } from "@/lib/mascots";

export default function ExclusionReveal({
  excludedSeatNumbers,
  getMascotForSeat,
  onDone,
}: {
  excludedSeatNumbers: number[];
  getMascotForSeat: (seatNumber: number) => Mascot | null;
  onDone: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Letterbox-in (~0.5s) + first slash start (~0.9s) + one slash per player (~0.9s stagger) +
    // a beat to read the last name + letterbox-out — generous enough to never feel rushed at 2
    // excluded (the common case) without dragging at higher counts.
    const totalMs = 1400 + excludedSeatNumbers.length * 900 + 2200;
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

          <div className="relative w-full aspect-video max-h-full flex flex-col items-center justify-center gap-8 sm:gap-12 px-6">
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
                  <div key={seatNumber} className="relative flex flex-col items-center gap-3 sm:gap-4">
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
                      {mascot && (
                        // eslint-disable-next-line @next/next/no-img-element -- small local SVG sticker
                        <img src={mascotImageSrc(mascot.key)} alt={mascot.name} width={128} height={128} className="rounded-full grayscale opacity-80 w-24 h-24 sm:w-36 sm:h-36" />
                      )}
                      <motion.span
                        initial={{ opacity: 0, scale: 1.7, rotate: -16 }}
                        animate={{ opacity: 1, scale: 1, rotate: -16 }}
                        transition={{ delay: delay + 0.3, type: "spring", stiffness: 320, damping: 14 }}
                        className="absolute inset-0 flex items-center justify-center font-display text-2xl sm:text-4xl font-bold text-red-500 [text-shadow:0_0_4px_rgba(255,0,0,0.7)]"
                        style={{ WebkitTextStroke: "1.5px black" }}
                      >
                        OUT
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
