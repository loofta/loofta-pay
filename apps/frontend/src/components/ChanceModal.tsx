"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { ChanceIcon } from "@/components/ChanceIcon";
import { useWallets } from "@privy-io/react-auth/solana";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CHANCE_PRICE_USDC, MAX_CHANCES_PER_BUY, useChanceTicket } from "@/hooks/useChanceTicket";
import { BONUS_MAX, MAIN_COUNT, MAIN_MAX } from "@/components/megapot/ChooseNumbers";

// Jackpot odds per entry: pick MAIN_COUNT of MAIN_MAX plus one bonus ball.
function combinations(n: number, k: number) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}
const JACKPOT_ODDS = combinations(MAIN_MAX, MAIN_COUNT) * BONUS_MAX;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Chance details: your entries, the draw, the prize pool and odds, and a way to add more. */
export function ChanceModal({
  open,
  onOpenChange,
  balanceUsd,
  solanaAddress,
  getAccessToken,
  onBought,
  entries = 0,
  drawTime,
  prizePool,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  balanceUsd: number;
  solanaAddress?: string | null;
  getAccessToken: () => Promise<string | null>;
  onBought?: () => void;
  entries?: number;
  drawTime?: string | null;
  prizePool?: string | null;
}) {
  const { wallets } = useWallets();
  const wallet = useMemo(() => {
    const list = wallets ?? [];
    return (solanaAddress ? list.find((w) => w.address === solanaAddress) : undefined)
      ?? list.find((w) => (w as { walletClientType?: string }).walletClientType === "privy")
      ?? list[0];
  }, [wallets, solanaAddress]);
  const buy = useChanceTicket(getAccessToken, "home_chance_modal");
  const [state, setState] = useState<"idle" | "buying" | "done" | "failed">("idle");
  const [count, setCount] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !drawTime) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, drawTime]);

  const maxAffordable = Math.max(0, Math.min(MAX_CHANCES_PER_BUY, Math.floor(balanceUsd / CHANCE_PRICE_USDC)));
  const n = Math.min(count, Math.max(1, maxAffordable));
  const total = n * CHANCE_PRICE_USDC;
  const canAfford = maxAffordable >= 1;
  const msLeft = drawTime ? new Date(drawTime).getTime() - nowMs : null;
  const pool = prizePool ? Math.round(parseFloat(prizePool)) : null;

  const go = async () => {
    setState("buying");
    const ok = await buy(wallet, n);
    setState(ok ? "done" : "failed");
    if (ok) onBought?.();
  };

  const stat = (label: string, value: string) => (
    <div className="flex flex-col rounded-2xl bg-white/[0.05] px-3 py-2.5">
      <span className="text-sm text-[#8A8893]">{label}</span>
      <span className="text-base font-bold text-white tabular-nums">{value}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setState("idle"); setCount(1); } onOpenChange(o); }}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-sm max-h-[90svh] overflow-y-auto rounded-3xl border border-white/10 bg-[#121217] p-5 text-white sm:p-6">
        <DialogTitle className="sr-only">Chance to win $200K</DialogTitle>
        <DialogDescription className="sr-only">Your entries in today&apos;s draw, the prize pool and odds, and how to add more.</DialogDescription>

        <div className="flex flex-col items-center gap-2 text-center">
          <ChanceIcon size={72} />
          <p className="text-2xl font-extrabold">{state === "done" ? "You're in" : "Win up to $200K today"}</p>
          <p className="text-base text-[#9A98A3]">
            {state === "done"
              ? "Your new entries are locked in for today's draw. Winnings land straight in your balance."
              : "One draw every day. Each entry is one more chance, and prizes are paid straight to your balance."}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {stat("Your entries", String(entries))}
          {stat("Draw in", msLeft !== null && msLeft > 0 ? `${pad2(Math.floor(msLeft / 3_600_000))}:${pad2(Math.floor((msLeft % 3_600_000) / 60_000))}:${pad2(Math.floor((msLeft % 60_000) / 1000))}` : "Soon")}
          {stat("Prize pool", pool ? `$${pool.toLocaleString("en-US")}` : "Live daily")}
          {stat("Jackpot odds", `1 in ${JACKPOT_ODDS.toLocaleString("en-US")}`)}
        </div>
        <p className="mt-2 text-sm text-[#8A8893]">Odds are per entry for the jackpot. Partial matches win smaller prizes.</p>

        {state === "done" ? (
          <button type="button" onClick={() => onOpenChange(false)} className="mt-4 w-full rounded-2xl bg-white/10 py-3.5 text-base font-semibold text-white">Done</button>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.05] px-3 py-2">
              <span className="text-base font-semibold">Add more chances</span>
              <span className="flex items-center gap-3">
                <button type="button" aria-label="Fewer" disabled={n <= 1 || state === "buying"} onClick={() => setCount(Math.max(1, n - 1))} className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="w-6 text-center text-xl font-extrabold tabular-nums">{n}</span>
                <button type="button" aria-label="More" disabled={n >= maxAffordable || state === "buying"} onClick={() => setCount(Math.min(maxAffordable, n + 1))} className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              </span>
            </div>
            {!canAfford && <p className="mt-2 text-base text-red-400">You need at least ${CHANCE_PRICE_USDC} in your balance.</p>}
            {state === "failed" && <p className="mt-2 text-base text-red-400">Couldn&apos;t add them. Nothing was charged, try again.</p>}
            <div className="relative mt-3 rounded-2xl">
              <style>{`
                @keyframes looftaGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                @keyframes looftaGlowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
                @media (prefers-reduced-motion: reduce) { .chance-glow { animation: none !important; opacity: .7 !important; } }
              `}</style>
              <div
                aria-hidden
                className="chance-glow absolute -inset-[2.5px] rounded-2xl blur-[7px]"
                style={{
                  background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)",
                  backgroundSize: "220% 100%",
                  animation: canAfford ? "looftaGlowShift 2.4s linear infinite, looftaGlowPulse 2.4s ease-in-out infinite" : undefined,
                  opacity: canAfford ? undefined : 0.2,
                }}
              />
              <button
                type="button"
                disabled={!canAfford || state === "buying" || !wallet}
                onClick={() => { void go(); }}
                className="relative w-full rounded-2xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-3.5 text-base font-semibold text-white disabled:opacity-60"
              >
                {state === "buying" ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Adding…</span> : `Add ${n} ${n === 1 ? "chance" : "chances"} for $${total}`}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
