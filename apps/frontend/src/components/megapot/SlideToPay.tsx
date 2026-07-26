"use client";

// Slide-to-pay control for the Mystery Pack gate: the pack itself stays draggable/orbitable
// underneath this, but cannot be opened until the user (1) slides the thumb all the way across
// and (2) taps the confirm button that appears — two deliberate steps before any charge, so a
// pack can never open on an accidental drag or tap.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, animate } from "framer-motion";
import { ChevronsRight, Loader2 } from "lucide-react";

const THUMB_SIZE = 48;
const TRACK_PADDING = 4;

export default function SlideToPay({
  amountLabel,
  label = "Slide to pay",
  onConfirm,
  busy = false,
  error = null,
}: {
  amountLabel: string;
  label?: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [slid, setSlid] = useState(false);
  const x = useMotionValue(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxX = Math.max(0, trackWidth - THUMB_SIZE - TRACK_PADDING * 2);

  const reset = useCallback(() => {
    setSlid(false);
    animate(x, 0, { type: "spring", stiffness: 500, damping: 32 });
  }, [x]);

  // If a payment attempt errors, let the user try the slide again rather than getting stuck.
  useEffect(() => {
    if (error) reset();
  }, [error, reset]);

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        className="relative h-14 w-full rounded-full bg-white/[0.07] border border-white/10 overflow-hidden select-none"
        style={{ padding: TRACK_PADDING }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center gap-1.5 text-sm font-semibold tracking-wide text-slate-300 pointer-events-none transition-opacity duration-150"
          style={{ opacity: slid ? 0 : 1 }}
        >
          {label} · {amountLabel}
          <ChevronsRight className="w-4 h-4 text-slate-400" />
        </div>
        <motion.div
          drag={slid || busy ? false : "x"}
          dragConstraints={{ left: 0, right: maxX }}
          dragElastic={0}
          dragMomentum={false}
          style={{ x, width: THUMB_SIZE, height: THUMB_SIZE }}
          className="rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing"
          onDragEnd={() => {
            if (x.get() >= maxX * 0.82) {
              animate(x, maxX, { type: "spring", stiffness: 500, damping: 32 });
              setSlid(true);
            } else {
              reset();
            }
          }}
        >
          <ChevronsRight className="w-5 h-5 text-white" />
        </motion.div>
      </div>

      {slid && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? "Confirming…" : `Confirm ${amountLabel} payment`}
          </button>
          {!busy && (
            <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
