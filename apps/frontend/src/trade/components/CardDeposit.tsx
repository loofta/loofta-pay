"use client";

import { useEffect, useMemo, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import clsx from "clsx";
import { Check, CreditCard, Loader2, Smartphone } from "lucide-react";
import { useWallet } from "@/trade/hooks/useWallet";
import { cardQuote, cardSession, type BuyOption } from "@/trade/lib/meld";
import { fmt } from "@/trade/lib/solana";
import { haptic, openExternal } from "@/trade/lib/telegram";

const PRESETS = ["20", "50", "100"];

/** Apple Pay only shows on iPhone and Google Pay only on Android, because that is where they work. */
function usable(o: BuyOption): boolean {
  if (typeof navigator === "undefined") return o.method === "CREDIT_DEBIT_CARD";
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const android = /Android/i.test(navigator.userAgent);
  if (o.method === "APPLE_PAY") return ios;
  if (o.method === "GOOGLE_PAY") return android;
  return true;
}

/**
 * Pay with Apple Pay, Google Pay or a card and receive USDC in your wallet. Meld (through the Loofta backend) picks the
 * providers. The checkout opens in the phone's browser, because Apple Pay does not work inside a Telegram web view,
 * and the money arrives here in a few minutes.
 */
export function CardDeposit() {
  const { userId, getAccessToken } = useWallet();
  const [amount, setAmount] = useState("50");
  const [options, setOptions] = useState<BuyOption[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const amt = Number(amount);

  // Fetch the ways to pay once the amount stops changing.
  useEffect(() => {
    setOptions(null);
    setNote(null);
    setError(null);
    if (!(amt >= 1) || !userId) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const q = await cardQuote(amt, await getAccessToken());
        if (!alive) return;
        const list = q.options.filter(usable);
        setOptions(list);
        setChosen(list[0] ? `${list[0].id}|${list[0].method}` : null);
        if (list.length === 0) setNote(q.error ?? "Card deposits are not available for this amount or country yet.");
      } catch (e) {
        if (alive) {
          setOptions([]);
          setError(humanError(e, "Couldn't load options."));
        }
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [amt, userId, getAccessToken]);

  const pick = useMemo(() => (options ?? []).find((o) => `${o.id}|${o.method}` === chosen) ?? null, [options, chosen]);

  const pay = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      const redirectUrl = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined;
      const { widgetUrl } = await cardSession({ amount: amt, serviceProvider: pick.id, paymentMethodType: pick.method, redirectUrl }, await getAccessToken());
      openExternal(widgetUrl);
      setOpened(true);
    } catch (e) {
      setError(humanError(e, "Couldn't start the payment."));
    } finally {
      setBusy(false);
    }
  };

  if (opened) {
    return (
      <div className="mt-4 text-center">
        <div className="anim-pop tile3d green mx-auto grid h-16 w-16 place-items-center rounded-[22px] text-white">
          <Check size={34} strokeWidth={3} />
        </div>
        <div className="mt-3 font-display text-xl font-extrabold">Finish paying in your browser</div>
        <p className="mt-2 text-base leading-snug text-mute">We opened the payment page. When you are done, your dollars arrive here in a few minutes. You can close this and keep using the app.</p>
        <button type="button" onClick={() => setOpened(false)} className="btn3d dark mt-4 h-14 w-full text-base">
          Open it again
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="mt-4 text-base leading-snug text-mute">Pay with Apple Pay, Google Pay or a card. You receive dollars in your wallet, usually within minutes.</p>

      <div className="mt-3 flex h-14 items-center rounded-2xl bg-surface px-4">
        <span className="pr-1 font-display text-xl font-bold text-mute">$</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setAmount(p)} className={clsx("btn3d dark h-12 !rounded-2xl font-display text-base font-bold", amount === p && "!border-up !text-up")}>
            ${p}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {options === null && amt >= 1 && <div className="skeleton h-16 rounded-2xl" />}
        {options?.map((o) => {
          const key = `${o.id}|${o.method}`;
          const on = key === chosen;
          return (
            <button key={key} type="button" onClick={() => setChosen(key)} className={clsx("flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left", on ? "border-[#ff7a2a] bg-[#2a150c]" : "border-white/10 bg-surface")}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised">{o.method === "CREDIT_DEBIT_CARD" ? <CreditCard size={20} /> : <Smartphone size={20} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-bold">{o.label}</span>
                <span className="block text-base text-mute">{o.eta}</span>
              </span>
              <span className="text-right">
                <span className="block font-display text-base font-bold">${fmt(o.receive, 2)}</span>
                <span className="block text-base text-mute">fee ${fmt(o.fee, 2)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {note && <p className="mt-3 text-base text-mute">{note}</p>}
      {error && <p className="mt-3 text-base text-down">{error}</p>}

      <button type="button" disabled={!pick || busy} onClick={pay} className="btn3d mt-4 flex h-16 w-full items-center justify-center gap-2 text-lg">
        {busy && <Loader2 size={20} className="animate-spin" />}
        {busy ? "Opening" : pick ? `Pay $${fmt(amt, 2)}${pick.method === "APPLE_PAY" || pick.method === "GOOGLE_PAY" ? ` with ${pick.label}` : ""}` : "Pay"}
      </button>
      <p className="mt-2 text-center text-base text-mute">Powered by Meld. Their fee and rate are shown above.</p>
    </div>
  );
}
