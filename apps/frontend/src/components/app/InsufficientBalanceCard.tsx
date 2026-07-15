'use client'

/** Shown wherever a Loofta-balance payment can't cover its cost — same look everywhere so the "top up" ask is instantly recognizable. */
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
  return (
    <div className={["space-y-3", className].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5">
        <svg viewBox="0 0 56 57" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 shrink-0" aria-hidden>
          <path d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z" fill="#FF4A26" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-base">Loofta wallet</div>
          <div className="text-base md:text-sm text-amber-400 mt-0.5">
            ${balanceUSD.toFixed(2)} available — ${neededUSD.toFixed(2)} needed{showFeesLabel ? " (incl. fees)" : ""}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          onBeforeTopUp?.();
          window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "topup" } }));
        }}
        className="w-full h-12 rounded-xl font-semibold text-base border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
      >
        Add funds to your balance
      </button>
    </div>
  );
}
