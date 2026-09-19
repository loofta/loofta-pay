"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UnclaimedPayment } from "@/hooks/useUnclaimedPaymentToast";
import { useBulkClaim } from "@/hooks/useBulkClaim";

export function UnclaimedPaymentToast({
  payments,
  onDismiss,
}: {
  payments: UnclaimedPayment[];
  onDismiss: () => void;
}) {
  const t = useTranslations("UnclaimedPaymentToast");
  const { start, statuses, isRunning } = useBulkClaim();

  if (!payments || payments.length === 0) return null;

  const count = payments.length;
  const single = count === 1 ? payments[0] : null;
  const totalAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

  // Once a bulk run has produced results, only the ones that didn't succeed still need action —
  // successful ones drop out on their own next time the unclaimed-nudge query refetches.
  const failed = payments.filter((p) => statuses.get(p.id) === "failed");
  const settledCount = payments.filter((p) => {
    const s = statuses.get(p.id);
    return s === "success" || s === "failed";
  }).length;
  const hasRunOnce = statuses.size > 0 && !isRunning;
  const showFailedState = hasRunOnce && failed.length > 0;
  const failedSingle = showFailedState && failed.length === 1 ? failed[0] : null;
  // While running, `statuses` only tracks the batch actually passed to start() (either
  // everyone the first time, or just the failed subset on a retry) — size that batch off
  // the map itself so the "N of M" progress matches whichever batch is in flight.
  const activeBatchSize = isRunning ? statuses.size : count;
  const currentStep = Math.min(settledCount + 1, activeBatchSize);

  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="relative rounded-2xl border border-white/10 bg-[#0f0f12]/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-4">
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3 pr-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7A2A] to-[#EAB308] shadow-lg shadow-orange-500/40 text-2xl">
            💌
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold font-sans text-base">
              {count === 1 ? t("titleOne") : t("titleMany", { count })}
            </p>
            <p className="text-slate-400 text-base mt-0.5">
              {t("amountWaiting", { amount: totalAmount.toFixed(2) })}
            </p>
            {single ? (
              <Link
                href={`/c/${single.short_id ?? single.id}`}
                onClick={onDismiss}
                className="inline-flex items-center gap-1 mt-3 rounded-xl px-3 py-1.5 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity"
              >
                {t("claimOne")}
              </Link>
            ) : failedSingle ? (
              <Link
                href={`/c/${failedSingle.short_id ?? failedSingle.id}`}
                onClick={onDismiss}
                className="inline-flex items-center gap-1 mt-3 rounded-xl px-3 py-1.5 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity"
              >
                {t("claimOne")}
              </Link>
            ) : (
              <button
                type="button"
                disabled={isRunning}
                onClick={() => void start(showFailedState ? failed : payments)}
                className="inline-flex items-center gap-1 mt-3 rounded-xl px-3 py-1.5 text-base font-medium bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {isRunning
                  ? t("claimingProgress", { current: currentStep, total: activeBatchSize })
                  : showFailedState
                    ? t("retryFailed", { count: failed.length })
                    : t("claimMany")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
