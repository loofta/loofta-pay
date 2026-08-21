"use client";

// Slide-to-pay control for the Mystery Pack gate: the pack itself stays draggable/orbitable
// underneath this, but cannot be opened until the user (1) slides the thumb all the way across
// and (2) taps the confirm button that appears — two deliberate steps before any charge, so a
// pack can never open on an accidental drag or tap. Once fully slid, the track morphs in place
// into the confirm button (same box, cross-fade + spring scale) rather than stacking a second
// element below it.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useReducedMotion } from "framer-motion";
import { ChevronsRight, Loader2, Check } from "lucide-react";

const TRACK_HEIGHT = 64; // matches the track's h-16
const TRACK_PADDING = 5;
// Derived from the track height (not a separate arbitrary number) so the thumb always fills the
// padded interior edge-to-edge — a fixed size independent of TRACK_HEIGHT previously left a
// visible gap above/below the thumb instead of it touching the top and bottom of the pill.
const THUMB_SIZE = TRACK_HEIGHT - TRACK_PADDING * 2;
const CONFIRM_DELAY_MS = 160; // lets the thumb visibly snap to the end before morphing
// Fraction of the track that must be crossed to count as "slid" — a little more forgiving than a
// near-full-width requirement so a real fat-finger swipe on a small screen isn't punished for
// stopping just short, while still requiring clear, deliberate intent (not a light tap/jiggle).
const SLIDE_COMPLETE_THRESHOLD = 0.72;

export default function SlideToPay({
  amountLabel,
  label = "Slide to pay",
  confirmLabel,
  onConfirm,
  busy = false,
  error = null,
}: {
  amountLabel: string;
  label?: string;
  /** Overrides the default `Confirm ${amountLabel} payment` text on the post-slide button —
   *  needed for non-payment confirmations (e.g. a free spin) where "payment" doesn't apply. */
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [slid, setSlid] = useState(false);
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => { if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current); }, []);

  const maxX = Math.max(0, trackWidth - THUMB_SIZE - TRACK_PADDING * 2);
  // Trailing fill grows behind the thumb as it's dragged — the "on slide" feedback.
  const fillWidth = useTransform(x, v => Math.min(trackWidth, v + THUMB_SIZE + TRACK_PADDING));
  const labelOpacity = useTransform(x, [0, Math.max(maxX * 0.6, 1)], [1, 0]);

  const reset = useCallback(() => {
    setSlid(false);
    animate(x, 0, { type: "spring", stiffness: 500, damping: 32 });
  }, [x]);

  // If a payment attempt errors, let the user try the slide again rather than getting stuck.
  useEffect(() => {
    if (error) reset();
  }, [error, reset]);

  const showCancel = slid && !busy;

  return (
    <div className="w-full">
      {/* Always rendered above the track (never conditionally mounted) so its height is
          permanently reserved there — toggling only opacity/interactivity means the track/confirm
          box's on-screen position never shifts whether Cancel is showing or not. Sits ABOVE, not
          below: this whole block is positioned via `bottom: ...` in the parent, so reserved space
          below the track would push the visible pay button up off the true bottom anchor by
          Cancel's height even while Cancel itself is invisible — putting the reserved space above
          instead means the track (last child) is what actually sits flush at that anchor. */}
      <button
        onClick={reset}
        aria-hidden={!showCancel}
        tabIndex={showCancel ? 0 : -1}
        className={`mb-3 w-full py-3 text-center text-base font-medium text-slate-400 hover:text-slate-200 transition-opacity ${showCancel ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        Cancel
      </button>
      <div className="relative h-16 w-full">
        <AnimatePresence mode="wait" initial={false}>
          {!slid ? (
            <motion.div
              key="track"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.06 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <div
                ref={trackRef}
                // touchAction: 'none' is the actual mobile fix here — without it, a touch that
                // starts on the track can get interpreted as a page/vertical scroll gesture by
                // the browser before framer-motion's own drag handling ever takes over, making
                // the slide feel sticky or unresponsive on phones specifically.
                className="relative h-16 w-full rounded-full bg-white/[0.07] border border-white/10 overflow-hidden select-none flex items-center"
                style={{ padding: TRACK_PADDING, touchAction: "none" }}
              >
                <motion.div
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#FF1301]/50 to-[#EAB308]/50"
                  style={{ width: fillWidth }}
                />
                <motion.div
                  className="absolute inset-0 flex items-center justify-center gap-2 text-base font-semibold tracking-wide text-slate-300 pointer-events-none"
                  style={{ opacity: labelOpacity }}
                >
                  {label} · {amountLabel}
                  <motion.span
                    aria-hidden
                    className="flex text-slate-400"
                    animate={reduceMotion || busy ? undefined : { x: [0, 6, 0] }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <ChevronsRight className="w-5 h-5" />
                  </motion.span>
                </motion.div>
                <motion.div
                  drag={busy ? false : "x"}
                  dragConstraints={{ left: 0, right: maxX }}
                  dragElastic={0.04}
                  dragMomentum={false}
                  dragTransition={{ bounceStiffness: 500, bounceDamping: 28 }}
                  whileTap={{ scale: 0.96 }}
                  whileDrag={{ scale: 1.08 }}
                  style={{ x, width: THUMB_SIZE, height: THUMB_SIZE, touchAction: "none", WebkitTapHighlightColor: "transparent" }}
                  className="relative rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing"
                  onDragEnd={() => {
                    if (x.get() >= maxX * SLIDE_COMPLETE_THRESHOLD) {
                      // "On fully slide": snap the thumb the rest of the way, then morph into
                      // the confirm button once that's visibly settled.
                      animate(x, maxX, { type: "spring", stiffness: 500, damping: 32 });
                      confirmTimeoutRef.current = setTimeout(() => setSlid(true), CONFIRM_DELAY_MS);
                    } else {
                      reset();
                    }
                  }}
                >
                  <ChevronsRight className="w-6 h-6 text-white" />
                </motion.div>
              </div>
            </motion.div>
          ) : (
            // Same moving lightning-glow border as the "Play again" CTA on the Redeem tab
            // (GlowPlayAgainButton in megapot/page.tsx) — reused here so a payment confirm gets
            // the same "this is the featured action" treatment instead of a flat, no-hover button.
            <motion.div
              key="confirm"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
              className="absolute inset-0"
            >
              <div className="relative h-16 w-full">
                <style>{`
                  @keyframes looftaGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                  @keyframes looftaGlowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
                `}</style>
                <div
                  aria-hidden
                  className="absolute -inset-[2.5px] rounded-full blur-[7px]"
                  style={{
                    background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)",
                    backgroundSize: "220% 100%",
                    animation: reduceMotion ? undefined : "looftaGlowShift 2.4s linear infinite, looftaGlowPulse 2.4s ease-in-out infinite",
                    opacity: reduceMotion ? 0.7 : undefined,
                  }}
                />
                <button
                  onClick={onConfirm}
                  disabled={busy}
                  className="relative h-16 w-full rounded-full text-base font-semibold text-white flex items-center justify-center gap-2 bg-gradient-to-r from-[#FF1301] to-[#EAB308] active:scale-[0.99] transition-transform disabled:opacity-70 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                  {busy ? "Confirming…" : confirmLabel ?? `Confirm ${amountLabel} payment`}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
