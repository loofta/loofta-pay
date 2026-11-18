"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Bottom sheet with a title and a close button. Locks the page behind it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  // Portaled to the body: the tab wrapper is animated with a transform, which would otherwise trap a fixed overlay inside it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="anim-fade fixed inset-0 z-[60] flex items-end bg-black/60 md:items-center md:justify-center md:p-6" onClick={onClose}>
      <div className="anim-sheet text-white max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] border-t border-white/10 md:max-w-lg md:rounded-[24px] md:border bg-[#141418] px-4 pt-4" style={{ paddingBottom: "calc(var(--safe-bottom) + 20px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-extrabold text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-2xl bg-raised">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
