'use client'

/** Shown wherever a Loofta-balance payment can't cover its cost. Opens top-up with the shortfall prefilled. */
export function InsufficientBalanceCard({
  balanceUSD,
  neededUSD,
  showFeesLabel = true,
  onBeforeTopUp,
  className,
}: {
  balanceUSD: number;
  neededUSD: number;
  showFeesLabel?: boolean;
  onBeforeTopUp?: () => void;
  className?: string;
}) {
  const shortfall = Math.max(0, neededUSD - balanceUSD);
  return (
    <div className={["space-y-3", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0E0E12] px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-sm text-[#B5B2BC]">Loofta balance</div>
          <div className="mt-0.5 text-base font-semibold text-white">${balanceUSD.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-[#8A8893]">Add to pay{showFeesLabel ? ", fees included" : ""}</div>
          <div className="mt-0.5 text-base font-semibold text-white">${shortfall.toFixed(2)}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          onBeforeTopUp?.();
          window.dispatchEvent(new CustomEvent("openBalanceModal", {
            detail: { tab: "topup", amountUsd: Number(shortfall.toFixed(2)) },
          }));
        }}
        className="w-full h-12 rounded-xl font-semibold text-base border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
      >
        Add funds & pay
      </button>
    </div>
  );
}
