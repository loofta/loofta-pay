"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { sora, manrope } from "@/components/home-v4/fonts";
import "@/components/app-home/loofta-app.css";

const SORA = "var(--font-home-sora), Sora, sans-serif";

/** Wallet sheet used by Send, Receive and Swap: back circle, centered title, scrolling body. Same size on every step. */
export function WalletModal({
  open,
  onClose,
  title,
  onBack,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Back action for sub-steps. Falls back to closing the modal on the first screen. */
  onBack?: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {open ? (
        <DialogContent
          wrapperZIndexClassName="z-[120]"
          className={cn(
            sora.variable,
            manrope.variable,
            "loofta-app flex h-[min(86vh,700px)] w-[calc(100%-24px)] max-w-[460px] flex-col gap-0 overflow-hidden rounded-[32px] border border-white/10 bg-[#121216] p-6 text-[#F2EFE8] shadow-[0_40px_120px_rgba(0,0,0,0.6)] sm:rounded-[32px] [&>button.absolute]:hidden",
          )}
          style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}
        >
          <DialogDescription className="sr-only">{title}</DialogDescription>
          <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 44px", alignItems: "center", marginBottom: 16, flex: "none" }}>
            <button type="button" onClick={onBack ?? onClose} aria-label={onBack ? "Back" : "Close"} style={{ cursor: "pointer", width: 44, height: 44, borderRadius: 999, border: 0, background: "#1C1C22", color: "#C9C6CF", display: "grid", placeItems: "center", fontSize: 22, lineHeight: 1 }}>
              ‹
            </button>
            <DialogTitle style={{ margin: 0, textAlign: "center", fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>{title}</DialogTitle>
            <span />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>{children}</div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
