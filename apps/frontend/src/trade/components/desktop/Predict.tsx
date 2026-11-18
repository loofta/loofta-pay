"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { useWallet } from "@/trade/hooks/useWallet";
import { useSignIn } from "@/trade/hooks/useSignIn";
import { errText, usePlaceBet } from "@/trade/hooks/usePredictActions";
import { getTokenBalance } from "@/trade/lib/balances";
import { PREDICT_FEE_BPS, predictFeeUsd } from "@/trade/lib/fees";
import { MIN_BET_USD, cents, eventImage, getEvent, getEventTrades, groupMarkets, leadOpenMarket, listEvents, optionLabel, usd, type PredictCategory, type PredictEvent, type PredictMarket, type PredictTrade } from "@/trade/lib/predict";
import { USDC, fmt } from "@/trade/lib/solana";
import { ChatPanel } from "@/trade/components/CoinTabs";
import { NiceSelect } from "@/components/ui/NiceSelect";
import { Skeleton } from "@/trade/components/ui";

export type BetPick = { market: PredictMarket; isYes: boolean; title: string };

const CATS: Array<{ id: PredictCategory; label: string }> = [
  { id: "trending", label: "Trending" },
  { id: "crypto", label: "Crypto" },
  { id: "sports", label: "Sports" },
  { id: "politics", label: "Politics" },
  { id: "culture", label: "Culture" },
  { id: "economics", label: "Economics" },
  { id: "tech", label: "Tech" },
];
type Sort = "trending" | "volume" | "closing";

const closeMs = (e: PredictEvent) => {
  const t = e.metadata.closeTime ? new Date(e.metadata.closeTime).getTime() : NaN;
  return Number.isNaN(t) ? Infinity : t;
};
export const closes = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Closed";
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return days < 60 ? `Closes in ${days} days` : `Closes ${d.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
};
const volume = (micro?: string) => {
  const v = usd(micro);
  return v >= 1_000_000 ? `$${fmt(v / 1_000_000, 1)}M vol` : v >= 1_000 ? `$${fmt(v / 1_000, 0)}K vol` : "";
};
const openMarkets = (e: PredictEvent) => (e.markets ?? []).filter((m) => m.status === "open" && m.pricing);

function Img({ src, size }: { src?: string | null; size: number }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className="shrink-0 rounded-xl bg-white/[0.06]" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />;
}

/** Label for the left side of a card row: the team, the option, or the market title. */
const GENERIC = /^(yes|no)$/i;
export const rowLabel = (m: PredictMarket) => {
  if (m.team?.name) return m.team.name;
  const opt = optionLabel(m);
  // Date and threshold markets carry "Yes" as their only option, so the title (the date) is the real name.
  return GENERIC.test(opt.trim()) ? m.title || opt : opt;
};

/** The Yes / No pair for one market, as the two filled buttons the mockup uses. */
function YesNo({ m, onPick, active, size = "md" }: { m: PredictMarket; onPick: (yes: boolean) => void; active?: boolean | null; size?: "sm" | "md" }) {
  const y = cents(m.pricing?.buyYesPriceUsd);
  const n = cents(m.pricing?.buyNoPriceUsd);
  const cls = size === "sm" ? "h-10 px-4" : "h-11 px-5";
  return (
    <div className="flex shrink-0 gap-2">
      <button type="button" onClick={(e) => { e.stopPropagation(); onPick(true); }} className={clsx("rounded-xl text-base font-semibold transition-colors", cls, active === true ? "bg-[#3cb371] text-black" : "bg-[#3cb371]/15 text-[#3cb371] hover:bg-[#3cb371]/25")}>
        Yes {y}¢
      </button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onPick(false); }} className={clsx("rounded-xl text-base font-semibold transition-colors", cls, active === false ? "bg-[#ff5a4a] text-black" : "bg-[#ff5a4a]/15 text-[#ff5a4a] hover:bg-[#ff5a4a]/25")}>
        No {n}¢
      </button>
    </div>
  );
}

/** Card grid of live events, with category pills, a sort and a "your bets" shortcut. */
export function PredictGrid({ activeEventIds, onOpen, onBets, openId }: { activeEventIds: Set<string>; onOpen: (e: PredictEvent, pick?: { market: PredictMarket; isYes: boolean }) => void; onBets: () => void; openId?: string | null }) {
  const [cat, setCat] = useState<PredictCategory>("trending");
  const [sort, setSort] = useState<Sort>("trending");
  const [all, setAll] = useState<Partial<Record<PredictCategory, PredictEvent[]>>>({});
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const load = () => {
      CATS.forEach((c) =>
        listEvents(c.id, ctrl.signal)
          .then((r) => alive && setAll((p) => ({ ...p, [c.id]: r })))
          .catch(() => alive && c.id === "trending" && setErr(true)),
      );
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
      ctrl.abort();
    };
  }, []);

  const list = useMemo(() => {
    const base = (all[cat] ?? []).filter((e) => openMarkets(e).length > 0);
    const vol = (e: PredictEvent) => Number(e.volumeUsd ?? 0);
    if (sort === "volume") return [...base].sort((a, b) => vol(b) - vol(a));
    if (sort === "closing") return [...base].sort((a, b) => closeMs(a) - closeMs(b));
    return [...base].sort((a, b) => Number(b.volume24hr ?? b.volumeUsd ?? 0) - Number(a.volume24hr ?? a.volumeUsd ?? 0));
  }, [all, cat, sort]);
  const loading = all[cat] === undefined && !err;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="hscroll flex flex-1 gap-2 overflow-x-auto">
          {CATS.map((c) => {
            const n = all[c.id]?.filter((e) => openMarkets(e).length > 0).length;
            return (
              <button key={c.id} type="button" onClick={() => setCat(c.id)} className={clsx("h-11 shrink-0 rounded-full px-5 text-base font-medium transition-all", cat === c.id ? "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white" : "border border-white/10 text-slate-300 hover:bg-white/[0.06]")}>
                {c.label}
                {n ? <span className={clsx("ml-2", cat === c.id ? "text-white/80" : "text-slate-500")}>{n}</span> : null}
              </button>
            );
          })}
        </div>
        <NiceSelect className="w-44" align="right" buttonClassName="h-11 bg-[#15151a] py-0" value={sort} onChange={(v) => setSort(v as Sort)} options={[{ value: "trending", label: "Trending" }, { value: "volume", label: "Volume" }, { value: "closing", label: "Closing soon" }]} />
        <button type="button" onClick={onBets} className="h-11 rounded-xl border border-white/10 px-5 text-base font-medium text-slate-300 hover:bg-white/[0.06]">
          Your bets
        </button>
      </div>

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      )}
      {err && all.trending === undefined && <div className="rounded-2xl border border-white/10 bg-[#101014] px-4 py-12 text-center text-base text-slate-400">Predictions did not load. Try again in a moment.</div>}
      {!loading && list.length === 0 && !err && <div className="rounded-2xl border border-white/10 bg-[#101014] px-4 py-12 text-center text-base text-slate-400">No open markets here right now.</div>}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((e) => {
          const ms = [...openMarkets(e)].sort((a, b) => (b.pricing?.buyYesPriceUsd ?? 0) - (a.pricing?.buyYesPriceUsd ?? 0));
          const top = ms.slice(0, 2);
          const lead = leadOpenMarket(e);
          const mine = activeEventIds.has(e.eventId);
          return (
            <div key={e.eventId} role="button" tabIndex={0} onClick={() => onOpen(e)} onKeyDown={(k) => k.key === "Enter" && onOpen(e)} className={clsx("flex cursor-pointer flex-col gap-4 rounded-2xl border bg-[#121216] p-5 transition-colors hover:bg-[#17171c]", openId === e.eventId ? "border-[#EAB308]/60" : "border-white/10")}>
              <div className="flex items-start gap-3">
                <Img src={eventImage(e)} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-lg font-semibold leading-snug text-white">{e.metadata.title}</div>
                  <div className="mt-1 truncate text-base text-slate-400">{[closes(e.metadata.closeTime), volume(e.volumeUsd)].filter(Boolean).join(" · ")}</div>
                </div>
                {mine && <span className="shrink-0 rounded-full bg-[#EAB308]/15 px-3 py-0.5 text-base text-[#EAB308]">In your bets</span>}
              </div>
              <div className="flex flex-col gap-2">
                {top.map((m) => (
                  <div key={m.marketId} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-base text-slate-200">{ms.length === 1 ? e.metadata.title : rowLabel(m)}</div>
                    <YesNo m={m} size="sm" onPick={(yes) => onOpen(e, { market: m, isYes: yes })} />
                  </div>
                ))}
                {!top.length && lead && null}
              </div>
              {ms.length > 2 && <div className="text-base text-slate-400">+{ms.length - 2} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DTab = "comments" | "activity" | "rules";

/** One event: every market with its Yes / No price, then comments, recent bets and the rules. */
export function PredictDetail({ event, onBack, onPick, picked }: { event: PredictEvent; onBack: () => void; onPick: (p: BetPick) => void; picked: Set<string> }) {
  const [full, setFull] = useState<PredictEvent>(event);
  const [tab, setTab] = useState<DTab>("comments");
  const [trades, setTrades] = useState<PredictTrade[] | null>(null);
  useEffect(() => {
    let alive = true;
    setFull(event);
    getEvent(event.eventId)
      .then((e) => alive && setFull(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [event]);

  const markets = useMemo(() => openMarkets(full), [full]);
  const groups = useMemo(() => groupMarkets(markets), [markets]);
  useEffect(() => {
    let alive = true;
    getEventTrades(markets.map((m) => m.conditionId ?? "")).then((t) => alive && setTrades(t)).catch(() => alive && setTrades([]));
    return () => {
      alive = false;
    };
  }, [markets]);

  const title = full.metadata.title;
  const choose = (m: PredictMarket, isYes: boolean) => onPick({ market: m, isYes, title: `${title}${markets.length > 1 ? ` · ${rowLabel(m)}` : ""}` });
  const rows: Array<{ m: PredictMarket; label: string }> = [
    ...groups.winner.map((m) => ({ m, label: rowLabel(m) })),
    ...groups.totals.flatMap((t) => [t.over, t.under].filter(Boolean).map((m) => ({ m: m as PredictMarket, label: rowLabel(m as PredictMarket) }))),
    ...groups.other.map((m) => ({ m, label: rowLabel(m) })),
  ];
  const stats: Array<[string, string]> = [
    ["Volume", volume(full.volumeUsd).replace(" vol", "") || "-"],
    ["Last 24h", volume(full.volume24hr).replace(" vol", "") || "-"],
    ["Closes", closes(full.metadata.closeTime).replace("Closes ", "").replace("in ", "") || "-"],
    ["Markets", String(markets.length)],
  ];
  const rules = markets.find((m) => m.rulesPrimary)?.rulesPrimary;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-base text-slate-400">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-1.5 text-white hover:bg-white/[0.06]">
          <ArrowLeft size={16} /> Predict
        </button>
        <span>/</span>
        <span className="truncate text-white">{title}</span>
      </div>

      <div className="flex items-start gap-4">
        <Img src={eventImage(full)} size={64} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-snug text-white md:text-3xl">{title}</h1>
          {full.metadata.subtitle && <div className="mt-1 text-base text-slate-400">{full.metadata.subtitle}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-[#121216] px-4 py-3">
            <div className="text-base text-slate-500">{k}</div>
            <div className="text-lg font-semibold text-white">{v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101014]">
        <div className="border-b border-white/10 px-4 py-3 text-base text-slate-500">Outcomes</div>
        {rows.length === 0 && <div className="px-4 py-8 text-center text-base text-slate-400">This market is closed.</div>}
        {rows.map(({ m, label }) => {
          const chance = cents(m.pricing?.buyYesPriceUsd);
          const mine = picked.has(`${m.marketId}:yes`) ? true : picked.has(`${m.marketId}:no`) ? false : null;
          return (
            <div key={m.marketId} className="flex flex-wrap items-center gap-3 border-t border-white/5 px-4 py-3 first:border-t-0">
              {m.team?.imageUrl ? <Img src={m.team.imageUrl} size={36} /> : null}
              <div className="min-w-[140px] flex-1">
                <div className="truncate text-base font-semibold text-white">{label}</div>
                <div className="text-base text-slate-400">{chance}% chance</div>
              </div>
              <YesNo m={m} active={mine} onPick={(yes) => choose(m, yes)} />
            </div>
          );
        })}
      </div>

      <div>
        <div className="flex gap-6 border-b border-white/10">
          {(["comments", "activity", "rules"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={clsx("-mb-px border-b-2 pb-3 pt-1 text-base font-semibold capitalize", tab === id ? "border-[#EAB308] text-white" : "border-transparent text-slate-400 hover:text-white")}>
              {id}
            </button>
          ))}
        </div>
        <div className="pt-2">
          {tab === "comments" && <ChatPanel mint={full.eventId} eventId={full.eventId} name={title} price={null} myHoldingUsd={null} />}
          {tab === "activity" && (
            <div className="mt-3 flex flex-col">
              {trades === null && <Skeleton className="h-16" />}
              {trades?.length === 0 && <div className="py-8 text-center text-base text-slate-400">No recent bets to show.</div>}
              {trades?.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 border-b border-white/5 py-3 text-base">
                  <span className="min-w-0 truncate text-slate-300">
                    {t.who} {t.side === "BUY" ? "bought" : "sold"} <span className="font-semibold text-white">{t.outcome}</span>
                  </span>
                  <span className="shrink-0 text-white">${fmt(t.usd, 2)} at {Math.round(t.price * 100)}¢</span>
                </div>
              ))}
            </div>
          )}
          {tab === "rules" && <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-relaxed text-slate-300">{rules ?? "No rules published for this market."}</p>}
        </div>
      </div>
    </div>
  );
}

/** The bet box for the market you picked: Yes or No, an amount, what it pays if you are right. */
export function PredictPanel({ pick, onClose, onFlip, onDone }: { pick: BetPick; onClose?: () => void; onFlip: (yes: boolean) => void; onDone: () => void }) {
  const { address } = useWallet();
  const place = usePlaceBet();
  const { authed, signIn } = useSignIn();
  const [amount, setAmount] = useState("10");
  const [cash, setCash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    getTokenBalance(address, USDC).then(setCash).catch(() => undefined);
  }, [address, done]);

  const { market, isYes } = pick;
  const price = (isYes ? market.pricing?.buyYesPriceUsd : market.pricing?.buyNoPriceUsd) ?? 0;
  const p = price / 1_000_000;
  const amt = Number(amount) || 0;
  const fee = predictFeeUsd(amt);
  const contracts = p > 0 ? amt / p : 0;
  const tooLow = amt < MIN_BET_USD;
  const noCash = cash != null && amt + fee > cash + 1e-6;
  const cta = busy ? "Placing bet" : tooLow ? `Minimum is $${MIN_BET_USD}` : noCash ? "Not enough USDC" : `Bet ${isYes ? "Yes" : "No"}`;

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await place(market, isYes, amt);
      setDone(r.filled ? "Bet placed." : "Order sent. It will fill shortly, check My assets.");
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-[#121216] p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 text-lg font-semibold leading-snug text-white">{pick.title}</div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-white/[0.08] hover:text-white">
            <X size={20} />
          </button>
        )}
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[#3cb371]/20 text-[#3cb371]">
            <Check size={30} strokeWidth={3} />
          </div>
          <div className="text-xl font-semibold text-white">{done}</div>
          <button type="button" onClick={() => setDone(null)} className="btn3d mt-2 h-12 w-full text-base">
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#0b0b0e] p-1">
            {([true, false] as const).map((y) => (
              <button key={String(y)} type="button" onClick={() => onFlip(y)} className={clsx("rounded-lg py-2.5 text-base font-semibold transition-colors", isYes === y ? (y ? "bg-[#3cb371]/20 text-[#3cb371]" : "bg-[#ff5a4a]/20 text-[#ff5a4a]") : "text-slate-400 hover:text-white")}>
                {y ? "Yes" : "No"} {cents(y ? market.pricing?.buyYesPriceUsd : market.pricing?.buyNoPriceUsd)}¢
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-base text-slate-400">
              <span>Amount</span>
              <button type="button" onClick={() => cash != null && setAmount(String(Math.max(0, Math.floor((cash / (1 + PREDICT_FEE_BPS / 10_000)) * 100) / 100)))} className="hover:text-white">
                Balance ${(cash ?? 0).toFixed(2)}
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0b0b0e] px-4">
              <span className="text-2xl font-semibold text-slate-400">$</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="h-14 min-w-0 flex-1 bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-slate-600" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {["5", "10", "25", "50"].map((v) => (
                <button key={v} type="button" onClick={() => setAmount(v)} className="rounded-xl border border-white/10 py-2 text-base font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white">
                  ${v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 text-base">
            <div className="flex justify-between"><span className="text-slate-400">Contracts</span><span className="font-semibold text-white">{contracts > 0 ? fmt(contracts, 2) : "-"}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Pays if you are right</span><span className="font-semibold text-[#3cb371]">{contracts > 0 ? `$${fmt(contracts, 2)}` : "-"}</span></div>
            {fee > 0 && <div className="flex justify-between"><span className="text-slate-400">Loofta fee ({fmt(PREDICT_FEE_BPS / 100, 2)}%)</span><span className="font-semibold text-white">${fmt(fee, 2)}</span></div>}
          </div>
          {err && <div className="text-base text-[#ff5a4a]">{err}</div>}

          {!authed ? (
            <button type="button" onClick={signIn} className="btn3d flex h-14 items-center justify-center text-base">
              Sign in to bet
            </button>
          ) : (
          <button type="button" onClick={go} disabled={busy || tooLow || noCash || !address || p <= 0} className={clsx("btn3d flex h-14 items-center justify-center gap-2 text-base", !isYes && "down")}>
            {busy && <Loader2 size={20} className="animate-spin" />}
            {cta}
          </button>
          )}
          <div className="text-base text-slate-500">A right call pays $1 per contract. Minimum bet ${MIN_BET_USD}.</div>
        </>
      )}
    </div>
  );
}
