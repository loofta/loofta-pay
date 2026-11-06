"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { MELD_SESSION_KEY } from "@/lib/meldOfframp";
import { cn } from "@/lib/utils";

const SORA = "var(--font-home-sora), Sora, sans-serif";

type Option = { id: string; label: string; receive: number; currency: string; fee: number; rate: number | null };
type QuoteResult = { supported?: boolean; options?: Option[]; currency?: string; error?: string };

const MIN_SELL_USDC = 3;

function fiat(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * One screen for both directions. Type an amount, see every way to complete it with what you get, pick one, go.
 * buy: pay dollars by card or Apple Pay, receive USDC. sell: send USDC, receive your local currency in a bank account.
 */
export function MeldFlow({
  side,
  solanaAddress,
  balanceNum = 0,
  getAccessToken,
  onBack,
}: {
  side: "buy" | "sell";
  solanaAddress: string;
  balanceNum?: number;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(side === "buy" ? "50" : "");
  const [options, setOptions] = useState<Option[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const amountNum = Number(amount);
  const sell = side === "sell";
  const spendable = Math.floor(balanceNum * 100) / 100;
  const overBalance = sell && amountNum > spendable;
  const choice = options?.find((o) => o.id === selected) ?? options?.[0] ?? null;

  // Live options: refetch shortly after the amount stops changing, keeping the old list on screen meanwhile
  useEffect(() => {
    if (!(amountNum > 0) || overBalance) { setOptions(null); setNotice(null); return; }
    const mine = ++request.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const access = await getAccessToken();
        const res = await fetch("/api/meld/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
          body: JSON.stringify({ side, amount: amountNum }),
        });
        const data = await res.json().catch(() => ({})) as QuoteResult;
        if (mine !== request.current) return;
        if (data.supported === false) { setUnsupported(true); setOptions([]); return; }
        setUnsupported(false);
        setOptions(data.options ?? []);
        setNotice(data.options?.length ? null : data.error ?? (sell ? `Nothing available for this amount. Try ${MIN_SELL_USDC} USDC or more.` : "Nothing available for this amount."));
        setSelected((cur) => (data.options?.some((o) => o.id === cur) ? cur : data.options?.[0]?.id ?? null));
      } catch {
        if (mine === request.current) setNotice("Couldn't load options. Check your connection.");
      } finally {
        if (mine === request.current) setLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [amountNum, overBalance, side, sell, getAccessToken]);

  const go = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      const access = await getAccessToken();
      const res = await fetch(sell ? "/api/meld/offramp-session" : "/api/meld/onramp-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({
          walletAddress: solanaAddress,
          amount: amountNum,
          serviceProvider: choice.id,
          ...(sell ? { currency: choice.currency } : {}),
          redirectUrl: sell ? `${window.location.origin}/cash-out/meld` : `${window.location.origin}/`,
        }),
      });
      const body = await res.json().catch(() => ({})) as { widgetUrl?: string; sessionId?: string; error?: string };
      if (!res.ok || !body.widgetUrl) throw new Error(body.error || "Couldn't continue.");
      if (sell) {
        if (!body.sessionId) throw new Error("Couldn't continue.");
        try { window.localStorage.setItem(MELD_SESSION_KEY, body.sessionId); } catch { /* storage blocked, the return page then needs the sessionId param */ }
      }
      window.location.assign(body.widgetUrl);
    } catch (err) {
      toast({ variant: "destructive", title: sell ? "Couldn't open cash-out" : "Couldn't start the deposit", description: err instanceof Error ? err.message : "Try again." });
      setBusy(false);
    }
  };

  const chips = sell
    ? [
        { label: "25%", value: spendable * 0.25 },
        { label: "50%", value: spendable * 0.5 },
        { label: "Max", value: spendable },
      ].map((c) => ({ label: c.label, value: String(Math.floor(c.value * 100) / 100) }))
    : [20, 50, 100, 250].map((v) => ({ label: `$${v}`, value: String(v) }));

  if (unsupported) {
    return (
      <div className="mt-4 flex flex-col gap-4">
        <button type="button" onClick={onBack} className="self-start text-sm font-semibold text-[#C8C6D0] hover:text-white">Back</button>
        <div className="rounded-2xl border border-white/10 bg-[#1A1A20] p-4">
          <p className="text-base font-bold text-white" style={{ fontFamily: SORA }}>Bank cash-out isn&apos;t available in your country yet</p>
          <p className="mt-1.5 text-sm text-[#C8C6D0]">Use PAJ Cash or Private P2P instead. Both are on the previous screen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <button type="button" onClick={onBack} className="self-start text-sm font-semibold text-[#C8C6D0] hover:text-white">
        {sell ? "Cash out to a bank" : "Deposit with card"}
      </button>

      <div>
        <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#1A1A20] px-4 py-3 focus-within:border-[#FF7A2A]/60">
          <span className="text-sm font-semibold text-[#8A8893]">{sell ? "You cash out (USDC)" : "You pay (USD)"}</span>
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={sell ? "0" : "50"}
            className="w-32 bg-transparent text-right text-3xl font-bold text-white outline-none"
            style={{ fontFamily: SORA }}
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={sell && spendable <= 0}
              onClick={() => setAmount(c.value)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-sm font-semibold text-[#C8C6D0] hover:bg-white/[0.06] disabled:opacity-40"
            >
              {c.label}
            </button>
          ))}
          {sell && <span className="ml-auto text-sm text-[#8A8893]">Balance ${spendable.toFixed(2)}</span>}
        </div>
        {overBalance && <p className="mt-2 text-sm text-red-400">That is more than your ${spendable.toFixed(2)} balance.</p>}
      </div>

      {amountNum > 0 && !overBalance && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-[#C8C6D0]">{loading && !options ? "Finding your options" : options?.length ? "Choose how" : ""}</p>

          {loading && !options && (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-white/[0.07] bg-[#1A1A20]" />)}
            </div>
          )}

          {options?.map((o, i) => {
            const on = o.id === choice?.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelected(o.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border bg-[#1A1A20] px-3.5 py-3 text-left transition-opacity",
                  on ? "border-[#FF7A2A]" : "border-white/[0.07] hover:border-white/20",
                  loading && "opacity-60",
                )}
              >
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", on ? "border-[#FF7A2A] bg-[#FF7A2A]" : "border-white/20")}>
                  {on && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-base font-bold text-white" style={{ fontFamily: SORA }}>{o.label}</span>
                    {i === 0 && options.length > 1 && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-sm font-semibold text-emerald-300">Best rate</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-[#8A8893]">
                    {sell
                      ? `1 USDC = ${fiat(o.rate ?? 0, o.currency)} · fee ${fiat(o.fee, o.currency)}`
                      : `Fee ${fiat(o.fee, o.currency)} included`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm text-[#8A8893]">You get</span>
                  <span className="block text-lg font-bold text-white" style={{ fontFamily: SORA }}>
                    {sell ? fiat(o.receive, o.currency) : `${o.receive.toFixed(2)} USDC`}
                  </span>
                </span>
              </button>
            );
          })}

          {notice && !loading && <p className="rounded-2xl border border-white/10 bg-[#1A1A20] px-4 py-3 text-sm text-[#C8C6D0]">{notice}</p>}
        </div>
      )}

      <button
        type="button"
        disabled={busy || loading || !choice || overBalance || !(amountNum > 0)}
        onClick={() => { void go(); }}
        className="w-full rounded-2xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-4 text-base font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy
          ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Opening…</span>
          : choice
            ? sell ? `Cash out ${amountNum} USDC` : `Pay $${amountNum}`
            : "Continue"}
      </button>
      <p className="text-center text-sm text-[#8A8893]">
        {sell ? "You add your bank details next. Loofta covers the network fee." : "You confirm your card or Apple Pay next. USDC lands in your Loofta balance."}
      </p>
    </div>
  );
}
