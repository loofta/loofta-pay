"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, Layers, Loader2, X } from "lucide-react";
import { Sheet } from "@/trade/components/Sheet";
import { useWallet } from "@/trade/hooks/useWallet";
import { getTokenBalance } from "@/trade/lib/balances";
import { MIN_BET_USD, createCombo, executeCombo, toBase58, usd, type ComboLeg, type ComboOrder } from "@/trade/lib/predict";
import { reportPrediction } from "@/trade/lib/rewards";
import { USDC, b64ToBytes, bytesToB64, fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";

/** Floating bar that shows how many picks are in the combo. Rendered above everything, so it is also visible over a market. */
export function ComboBar({ count, onOpen, onClear }: { count: number; onOpen: () => void; onClear: () => void }) {
  if (count === 0 || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-x-0 z-[70] flex justify-center px-4" style={{ bottom: "calc(var(--safe-bottom) + 100px)" }}>
      <div className="flex w-full max-w-md items-center gap-2 rounded-[24px] border border-white/10 bg-[#1c1c22] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
        <button type="button" onClick={onClear} aria-label="Clear combo" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-raised text-mute">
          <X size={20} />
        </button>
        <button type="button" onClick={onOpen} className="btn3d flex h-12 min-w-0 flex-1 items-center justify-center gap-2 text-base">
          <Layers size={18} /> {count < 2 ? "Combo: add one more pick" : `Combo of ${count} picks`}
        </button>
      </div>
    </div>,
    document.body,
  );
}

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  if (/reject|cancel|denied/i.test(m) && !/Payment rejected/i.test(m)) return "Cancelled.";
  if (/Payment rejected/i.test(m)) return "Not enough cash for this combo, or the wallet cannot pay the network fee. Check your balance.";
  return m || "Something went wrong. Try again.";
};

/** Review the picks, see what the combo pays, and place it. Every pick has to be right for it to pay. */
export function ComboSheet({ legs, onRemove, onClose, onPlaced }: { legs: ComboLeg[]; onRemove: (marketId: string) => void; onClose: () => void; onPlaced: () => void }) {
  const { address, wallet, signTransaction, getAccessToken } = useWallet();
  const [amount, setAmount] = useState("5");
  const [cash, setCash] = useState<number | null>(null);
  const [quote, setQuote] = useState<ComboOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (address) getTokenBalance(address, USDC).then(setCash).catch(() => {});
  }, [address]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  // A new amount or a different set of picks means the old price no longer applies.
  const key = legs.map((l) => `${l.marketId}:${l.side}`).join(",");
  useEffect(() => setQuote(null), [amount, key]);

  const amt = Number(amount) || 0;
  const tooFew = legs.length < 2;
  const tooLow = amt < MIN_BET_USD;
  const noCash = cash != null && amt > cash + 1e-6;
  const expiresAt = quote?.quote?.quoteExpiresAt ? new Date(quote.quote.quoteExpiresAt).getTime() : null;
  const expired = expiresAt != null && now > expiresAt - 2_000;
  const payout = quote?.quote?.netReceiveE6 ? usd(quote.quote.netReceiveE6) : null;
  const chance = legs.reduce((p, l) => p * (l.cents / 100), 1);

  const run = async () => {
    if (!address || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      if (!quote || expired) {
        setQuote(await createCombo({ owner: address, legs, usd: amt, mint: USDC }));
        haptic("tap");
        return;
      }
      const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(quote.transaction), wallet, chain: "solana:mainnet", options: { uiOptions: { showWalletUIs: false } } });
      await executeCombo(bytesToB64(signedTransaction), quote.id);
      haptic("success");
      // The signature is the first one on the transaction. It counts toward the Predictor badge. Never blocks the bet.
      try {
        const sig = toBase58(signedTransaction.slice(1, 65));
        void getAccessToken().then((t) => reportPrediction(sig, legs.map((l) => ({ marketId: l.marketId, side: l.side })), t)).catch(() => undefined);
      } catch {
        /* the badge is a bonus */
      }
      setDone(true);
      onPlaced();
    } catch (e) {
      setError(errText(e));
      setQuote(null);
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={done ? "Done" : "Combo"} onClose={() => !busy && onClose()}>
      {done ? (
        <div className="mt-6 flex flex-col items-center gap-3 pb-2 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-up/15 text-up">
            <Check size={32} />
          </span>
          <div className="font-display text-xl font-bold">Combo placed.</div>
          <p className="text-base text-mute">It pays when every pick is right. Settled combos are paid out by Jupiter.</p>
          <button type="button" onClick={onClose} className="btn3d mt-2 h-14 w-full text-lg">
            Close
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            {legs.map((l) => (
              <div key={l.marketId} className="flex items-center gap-3 rounded-2xl bg-[#1c1c22] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-bold">{l.label}</div>
                  <div className="truncate text-base text-mute">{l.event}</div>
                </div>
                <span className="shrink-0 font-display text-base font-bold">{l.cents}¢</span>
                <button type="button" onClick={() => onRemove(l.marketId)} aria-label={`Remove ${l.label}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised text-mute">
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
          {tooFew && <div className="rounded-2xl bg-[#1c1c22] p-3 text-base text-mute">A combo needs at least 2 picks. Go back to the markets and tap one more outcome.</div>}

          <div>
            <div className="mb-2 text-base text-mute">How much to bet (minimum ${MIN_BET_USD})</div>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-16 w-full rounded-2xl bg-[#1c1c22] px-4 font-display text-3xl font-extrabold outline-none" />
            <div className="mt-2 flex gap-2">
              {[5, 10, 25, 50].map((v) => (
                <button key={v} type="button" onClick={() => setAmount(String(v))} className="h-11 flex-1 rounded-full bg-[#1c1c22] font-display text-base font-bold text-mute">
                  ${v}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 text-base">
            <div className="flex justify-between">
              <span className="text-mute">Chance all {legs.length} are right</span>
              <span className="font-display font-bold">about {Math.max(1, Math.round(chance * 100))}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-mute">If all are right, you get</span>
              <span className="font-display font-bold text-up">{payout != null && !expired ? `$${fmt(payout, 2)}` : "tap See payout"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-mute">If one is wrong</span>
              <span className="font-display font-bold text-down">you lose ${fmt(amt, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-mute">Your cash</span>
              <span className="font-display font-bold">{cash == null ? "..." : `$${fmt(cash, 2)}`}</span>
            </div>
            {quote && expired && <div className="text-mute">The price expired. Tap Refresh payout.</div>}
          </div>

          {error && <div className="text-base text-down">{error}</div>}
          <button type="button" onClick={run} disabled={busy || tooFew || tooLow || noCash || !address} className={clsx("btn3d flex h-16 w-full items-center justify-center gap-2 text-lg")}>
            {busy && <Loader2 size={20} className="animate-spin" />}
            {busy ? "Working" : tooFew ? "Pick at least 2" : tooLow ? `Minimum $${MIN_BET_USD}` : noCash ? "Not enough cash" : !quote ? "See payout" : expired ? "Refresh payout" : `Place combo, $${fmt(amt, 2)}`}
          </button>
          <p className="text-base text-mute">Prices come from Polymarket traders. You can lose everything you bet. One wrong pick loses the whole combo.</p>
        </div>
      )}
    </Sheet>
  );
}
