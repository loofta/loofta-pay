"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn } from "./ui";

export type ConfirmOptions = {
  title: string;
  /** What will happen, in plain words. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red button, for things that move money back or remove something. */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * The portal's own confirmation dialog, used instead of the browser's alert box.
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: "Take back $5.00?", body: "...", confirmLabel: "Take back", danger: true }))) return;
 *   ... render {dialog} once in the component.
 *
 * Escape or a click outside cancels, Enter confirms.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const close = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok);
      return null;
    });
  }, []);

  const dialog = pending ? <ConfirmDialog {...pending} onClose={close} /> : null;
  return { confirm, dialog };
}

function ConfirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onClose }: Pending & { onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      if (e.key === "Enter") onClose(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    confirmRef.current?.querySelector<HTMLButtonElement>("button[data-confirm]")?.focus();
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[#1D1D1F]/45 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div
        ref={confirmRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] rounded-[24px] bg-white p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
      >
        <h2 className="m-0 text-[22px] font-extrabold leading-[1.2] tracking-[-0.02em] text-[#1D1D1F]">{title}</h2>
        {body && <div className="mt-3 text-[15.5px] leading-[1.55] text-[#6E6E73]">{body}</div>}
        <div className="mt-7 flex flex-wrap items-center justify-end gap-2.5">
          <Btn kind="ghost" onClick={() => onClose(false)}>
            {cancelLabel}
          </Btn>
          <span data-confirm-wrap className="contents">
            <ConfirmButton danger={danger} onClick={() => onClose(true)}>
              {confirmLabel}
            </ConfirmButton>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A Btn that can be found and focused, so Enter confirms and the keyboard lands on the main action. */
function ConfirmButton({ danger, onClick, children }: { danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-confirm
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-[11px] text-[14px] font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
        danger
          ? "bg-[#D8481A] shadow-[0_6px_16px_-6px_rgba(216,72,26,0.55)] hover:bg-[#C23F14] focus-visible:ring-[#D8481A]"
          : "bg-[#FF4A1C] shadow-[0_6px_16px_-6px_rgba(255,74,28,0.55)] hover:bg-[#F03E10] focus-visible:ring-[#FF4A1C]"
      }`}
    >
      {children}
    </button>
  );
}
