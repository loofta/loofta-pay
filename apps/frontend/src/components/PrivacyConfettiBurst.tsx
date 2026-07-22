"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { PrivacyGlyph } from "@/components/PrivacyGlyph";

/** Confetti-style burst of our own mask SVG rising from the bottom of the screen — used instead
 *  of canvas-confetti's shapeFromText, which silently draws nothing (no error) if the browser's
 *  canvas context can't rasterize the emoji glyph, which turned out to be unreliable. Pure DOM/SVG
 *  via Framer Motion instead, so it always renders. Random per-glyph trajectory is computed once
 *  at mount (useMemo with no deps) so it doesn't reshuffle mid-animation on re-render.
 *
 *  The celebratory "entering incognito mode" moment — mount one with a fresh `key` (e.g.
 *  Date.now()) whenever a private-mode toggle flips on, and clear it via onDone. */
export function PrivacyConfettiBurst({ onDone }: { onDone: () => void }) {
  const glyphs = useMemo(
    () =>
      Array.from({ length: 16 }, () => ({
        left: 8 + Math.random() * 84,
        size: 16 + Math.random() * 20,
        delay: Math.random() * 0.25,
        duration: 1.3 + Math.random() * 0.7,
        drift: (Math.random() - 0.5) * 16,
        rotate: (Math.random() - 0.5) * 50,
      })),
    [],
  );

  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
      {glyphs.map((g, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, top: "100vh", left: `${g.left}vw`, rotate: 0, scale: 0.6 }}
          animate={{
            opacity: [0, 1, 1, 0],
            top: ["100vh", "-8vh"],
            left: [`${g.left}vw`, `${g.left + g.drift}vw`],
            rotate: [0, g.rotate],
            scale: [0.6, 1],
          }}
          transition={{ duration: g.duration, delay: g.delay, ease: "easeOut" }}
          className="absolute text-slate-300"
        >
          <PrivacyGlyph size={g.size} opacity={0.9} />
        </motion.div>
      ))}
    </div>
  );
}
