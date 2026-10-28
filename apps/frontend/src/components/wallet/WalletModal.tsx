"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
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
            "loofta-app flex h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#121216] p-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] text-[#F2EFE8] sm:h-[min(86vh,700px)] sm:w-[calc(100%-24px)] sm:max-w-[460px] sm:rounded-[32px] sm:border sm:border-white/10 sm:p-6 sm:shadow-[0_40px_120px_rgba(0,0,0,0.6)] [&>button.absolute]:hidden",
          )}
          style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}
        >
          <DialogDescription className="sr-only">{title}</DialogDescription>
          <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 44px", alignItems: "center", marginBottom: 16, flex: "none" }}>
            {onBack ? (
              <button type="button" onClick={onBack} aria-label="Back" style={{ cursor: "pointer", width: 44, height: 44, borderRadius: 999, border: 0, background: "#1C1C22", color: "#C9C6CF", display: "grid", placeItems: "center", fontSize: 22, lineHeight: 1 }}>
                ‹
              </button>
            ) : (
              <span />
            )}
            <DialogTitle style={{ margin: 0, textAlign: "center", fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>{title}</DialogTitle>
            <button type="button" onClick={onClose} aria-label="Close" style={{ cursor: "pointer", width: 44, height: 44, borderRadius: 999, border: 0, background: "#1C1C22", color: "#C9C6CF", display: "grid", placeItems: "center" }}>
              <X size={20} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>{children}</div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
