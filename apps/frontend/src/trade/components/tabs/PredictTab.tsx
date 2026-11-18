"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Loader2, Search } from "lucide-react";
import { useWallet } from "@/trade/hooks/useWallet";
import { getConnection, getSolBalance, getTokenBalance, waitForConfirmation } from "@/trade/lib/balances";
import { ChatPanel } from "@/trade/components/CoinTabs";
import { MIN_BET_USD, cents, claimPosition, closePosition, createBuyOrder, eventImage, getEvent, getEventTrades, getPositionsPage, getSettledChunk, betState, getScore, groupMarkets, listEvents, optionLabel, orderStatus, searchEvents, usd, type OrderTx, type PredictCategory, type PredictEvent, type PredictMarket, type PredictPosition, type SettledBet, type PredictScore, type PredictTrade, type TotalsLine, type ComboLeg } from "@/trade/lib/predict";
import { FEE_WALLET, PREDICT_FEE_BPS, predictFeeUsd } from "@/trade/lib/fees";
import { buildTransfer } from "@/trade/lib/transfer";
import { USDC, b64ToBytes, bytesToB64, fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";
import { reportPrediction } from "@/trade/lib/rewards";
import { Sheet } from "@/trade/components/Sheet";
import { ComboBar, ComboSheet } from "@/trade/components/ComboSheet";
import { Segmented, Skeleton } from "@/trade/components/ui";

const CATEGORIES: { id: PredictCategory; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "crypto", label: "Crypto" },
  { id: "sports", label: "Sports" },
  { id: "politics", label: "Politics" },
  { id: "culture", label: "Culture" },
  { id: "economics", label: "Economy" },
  { id: "tech", label: "Tech" },
];

const closes = (iso?: string) => {
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
  return v >= 1_000_000 ? `$${fmt(v / 1_000_000, 1)}M volume` : v >= 1_000 ? `$${fmt(v / 1_000, 0)}K volume` : "";
};
const openMarkets = (e: PredictEvent) => (e.markets ?? []).filter((m) => m.status === "open" && m.pricing);
/** The market that leads the event: the one most likely to be Yes. */
const lead = (e: PredictEvent) => [...openMarkets(e)].sort((a, b) => (b.pricing?.buyYesPriceUsd ?? 0) - (a.pricing?.buyYesPriceUsd ?? 0))[0];

function Img({ src, size }: { src?: string | null; size: number }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className="shrink-0 rounded-2xl bg-[#1f1f26]" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="shrink-0 rounded-2xl object-cover" style={{ width: size, height: size }} />;
}

/** Signs a transaction from Jupiter with the user's own wallet and sends it. The user's wallet pays the network fee. */
function useSender() {
  const { wallet, signTransaction } = useWallet();
  return useCallback(
    async (tx: OrderTx) => {
      if (!wallet) throw new Error("Your wallet is still loading.");
      const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(tx.transaction), wallet, chain: "solana:mainnet", options: { uiOptions: { showWalletUIs: false } } });
      const sig = await getConnection().sendRawTransaction(signedTransaction, { skipPreflight: true, maxRetries: 3 });
      await waitForConfirmation(sig);
      return sig;
    },
    [wallet, signTransaction],
  );
}

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  return /reject|cancel|denied/i.test(m) ? "Cancelled." : m || "Something went wrong. Try again.";
};

/** Pick an amount and buy Yes or No on one market. */
function BetSheet({ market, isYes, title, label, onClose, onDone }: { market: PredictMarket; isYes: boolean; title: string; label?: string; onClose: () => void; onDone: () => void }) {
  const { address, getAccessToken } = useWallet();
  const send = useSender();
  const [amount, setAmount] = useState("5");
  const [cash, setCash] = useState<number | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = (isYes ? market.pricing?.buyYesPriceUsd : market.pricing?.buyNoPriceUsd) ?? 0;
  const p = price / 1_000_000;
  const amt = Number(amount) || 0;
  const win = p > 0 ? amt / p : 0;
  const fee = predictFeeUsd(amt);
  // A head-to-head side (a fighter, a team) has no "No" to buy, so name the side instead of saying Yes.
  const single = (market.pricing?.buyNoPriceUsd ?? 0) === 0;
  const side = label ?? (single ? market.title : isYes ? "Yes" : "No");

  useEffect(() => {
    if (!address) return;
    getTokenBalance(address, USDC).then(setCash).catch(() => {});
    getSolBalance(address).then(setSol).catch(() => {});
  }, [address]);

  const tooLow = amt < MIN_BET_USD;
  const noCash = cash != null && amt + fee > cash + 1e-6;
  const noGas = sol != null && sol < 0.003;

  const buy = async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const order = await createBuyOrder({ owner: address, marketId: market.marketId, isYes, usd: amt, mint: USDC });
      const orderSig = await send(order);
      // The order fills a moment after it lands. Wait for the answer so we can say what happened.
      const key = order.order?.orderPubkey;
      let state = "";
      for (let i = 0; key && i < 15 && state !== "filled" && state !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await orderStatus(key).catch(() => null);
        state = String(s?.status ?? s?.data?.status ?? "").toLowerCase();
      }
      if (state === "failed") throw new Error("The order did not fill and nothing was taken. Try again.");
      // Our fee is taken only once the bet is in. If this step fails the bet still stands and nothing is retried.
      if (fee > 0) {
        try {
          const raw = await buildTransfer({ from: address, to: FEE_WALLET, token: "USDC", amount: fee });
          await send({ transaction: bytesToB64(raw) });
        } catch {
          /* the bet is placed, the fee is not worth failing it over */
        }
      }
      haptic("success");
      // Counts toward the Predictor badge. Never blocks or fails the bet.
      void getAccessToken().then((t) => reportPrediction(orderSig, [{ marketId: market.marketId, side: isYes ? "yes" : "no" }], t)).catch(() => undefined);
      setDone(state === "filled" || !key ? "Bet placed." : "Order sent. It will fill shortly, check My bets.");
      onDone();
    } catch (e) {
      setError(errText(e));
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={done ? "Done" : `Bet on ${side}`} onClose={() => !busy && onClose()}>
      {done ? (
        <div className="mt-6 flex flex-col items-center gap-3 pb-2 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-up/15 text-up"><Check size={32} /></span>
          <div className="font-display text-xl font-bold">{done}</div>
          <button type="button" onClick={onClose} className="btn3d mt-2 h-14 w-full text-lg">Close</button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="text-base text-mute">{title}</div>
          <div className="font-display text-lg font-bold">{label ?? market.title}</div>
          <div className="flex items-center justify-between rounded-2xl bg-[#1c1c22] px-4 py-3 text-base">
            <span className="text-mute">Price for {single ? "this side" : side}</span>
            <span className="font-display font-bold">{cents(price)}¢ ({cents(price)}% chance)</span>
          </div>
          <div>
            <div className="mb-2 text-base text-mute">How much to bet (minimum ${MIN_BET_USD})</div>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-16 w-full rounded-2xl bg-[#1c1c22] px-4 font-display text-3xl font-extrabold outline-none" />
            <div className="mt-2 flex gap-2">
              {[5, 10, 25, 50].map((v) => (
                <button key={v} type="button" onClick={() => setAmount(String(v))} className="h-11 flex-1 rounded-full bg-[#1c1c22] font-display text-base font-bold text-mute">${v}</button>
              ))}
            </div>
          </div>
          <div className="space-y-2 text-base">
            <div className="flex justify-between"><span className="text-mute">If you are right, you get about</span><span className="font-display font-bold text-up">${fmt(win, 2)}</span></div>
            <div className="flex justify-between"><span className="text-mute">If you are wrong</span><span className="font-display font-bold text-down">you lose ${fmt(amt, 2)}</span></div>
            {fee > 0 && <div className="flex justify-between"><span className="text-mute">Loofta fee ({fmt(PREDICT_FEE_BPS / 100, 2)}%)</span><span className="font-display font-bold">${fmt(fee, 2)}</span></div>}
            <div className="flex justify-between"><span className="text-mute">Your cash</span><span className="font-display font-bold">{cash == null ? "..." : `$${fmt(cash, 2)}`}</span></div>
          </div>
          {noGas && <div className="rounded-2xl bg-[#1c1c22] p-3 text-base text-mute">This needs a tiny amount of SOL for the network fee (about $0.01). Add a little SOL in Wallet.</div>}
          {error && <div className="text-base text-down">{error}</div>}
          <button type="button" onClick={buy} disabled={busy || tooLow || noCash || noGas || !address} className="btn3d flex h-16 w-full items-center justify-center gap-2 text-lg">
            {busy && <Loader2 size={20} className="animate-spin" />}
            {busy ? "Placing bet" : tooLow ? `Minimum $${MIN_BET_USD}` : noCash ? "Not enough cash" : `Bet $${fmt(amt + fee, 2)} on ${side}`}
          </button>
          <p className="text-base text-mute">Prices come from Polymarket traders. You can lose everything you bet. Winning bets pay $1 per contract.</p>
        </div>
      )}
    </Sheet>
  );
}

type BetFn = (m: PredictMarket, isYes: boolean, title: string, label?: string) => void;

const timeAgo = (unix: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Who wins: one button per side, in the team's own colour. */
function WinnerCard({ markets, onBet, picked }: { markets: PredictMarket[]; onBet: (m: PredictMarket) => void; picked: Set<string> }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#1a1a20] p-3">
      <div className="mb-3 font-display text-base font-bold">Winner</div>
      <div className={clsx("grid gap-2", markets.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {markets.map((m) => {
          const color = m.team?.color || "#2f9e60";
          return (
            <button key={m.marketId} type="button" onClick={() => onBet(m)} className={clsx("flex h-16 items-center gap-2 rounded-2xl px-3 text-left active:scale-95", picked.has(`${m.marketId}:yes`) && "ring-2 ring-white")} style={{ background: `${color}33`, border: `1px solid ${color}66` }}>
              {m.team?.imageUrl && <Img src={m.team.imageUrl} size={36} />}
              <span className="min-w-0 flex-1 truncate font-display text-base font-bold">{m.team?.name ?? m.title}</span>
              <span className="font-display text-lg font-extrabold">{cents(m.pricing?.buyYesPriceUsd)}¢</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Over and under, with a strip to pick the line. */
function TotalsCard({ lines, onBet, picked }: { lines: TotalsLine[]; onBet: (m: PredictMarket) => void; picked: Set<string> }) {
  const [i, setI] = useState(Math.max(0, Math.floor((lines.length - 1) / 2)));
  const cur = lines[Math.min(i, lines.length - 1)];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#1a1a20] p-3">
      <div className="mb-3 font-display text-base font-bold">Totals</div>
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1">
        {lines.map((l, idx) => (
          <button key={l.line} type="button" onClick={() => setI(idx)} className={clsx("h-11 shrink-0 rounded-full px-4 font-display text-base font-bold", idx === i ? "bg-raised text-ink" : "text-mute")}>
            {l.line}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cur.over ? (
          <button type="button" onClick={() => onBet(cur.over!)} className={clsx("h-14 rounded-2xl bg-up/15 font-display text-base font-bold text-up active:scale-95", picked.has(`${cur.over.marketId}:yes`) && "ring-2 ring-up")}>
            Over {cur.line}, {cents(cur.over.pricing?.buyYesPriceUsd)}¢
          </button>
        ) : <div />}
        {cur.under ? (
          <button type="button" onClick={() => onBet(cur.under!)} className={clsx("h-14 rounded-2xl bg-[#1f6f9a]/25 font-display text-base font-bold text-[#6cc4f0] active:scale-95", picked.has(`${cur.under.marketId}:yes`) && "ring-2 ring-[#6cc4f0]")}>
            Under {cur.line}, {cents(cur.under.pricing?.buyYesPriceUsd)}¢
          </button>
        ) : <div />}
      </div>
    </div>
  );
}

/** One yes or no question, or one side that can only be backed. */
function QuestionCard({ m, onBet, rulesOpen, toggleRules, picked }: { m: PredictMarket; onBet: BetFn; rulesOpen: boolean; toggleRules: () => void; picked: Set<string> }) {
  const yes = cents(m.pricing?.buyYesPriceUsd);
  const canNo = (m.pricing?.buyNoPriceUsd ?? 0) > 0;
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#1a1a20] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 font-display text-base font-bold">{m.title}</div>
        <div className="shrink-0 font-display text-lg font-extrabold">{yes}%</div>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-[#2a2a32]"><div className="h-full rounded-full bg-up" style={{ width: `${Math.min(100, Math.max(2, yes))}%` }} /></div>
      {canNo ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onBet(m, true, m.title)} className={clsx("h-14 rounded-2xl bg-up/15 font-display text-base font-bold text-up active:scale-95", picked.has(`${m.marketId}:yes`) && "ring-2 ring-up")}>Yes, {yes}¢</button>
          <button type="button" onClick={() => onBet(m, false, m.title)} className={clsx("h-14 rounded-2xl bg-down/15 font-display text-base font-bold text-down active:scale-95", picked.has(`${m.marketId}:no`) && "ring-2 ring-down")}>No, {cents(m.pricing?.buyNoPriceUsd)}¢</button>
        </div>
      ) : (
        // Head-to-head sides (a fight, a match, one candidate among many) can only be backed, not bet against.
        <button type="button" onClick={() => onBet(m, true, m.title)} className={clsx("h-14 w-full rounded-2xl bg-up/15 font-display text-base font-bold text-up active:scale-95", picked.has(`${m.marketId}:yes`) && "ring-2 ring-up")}>Bet on {m.title}, {yes}¢</button>
      )}
      {m.rulesPrimary && (
        <button type="button" onClick={toggleRules} className="mt-2 text-base text-mute underline">{rulesOpen ? "Hide rules" : "How this is decided"}</button>
      )}
      {rulesOpen && <p className="mt-2 whitespace-pre-line text-base text-mute">{m.rulesPrimary}</p>}
    </div>
  );
}

/** Recent trades on the event, newest first. */
function TradesCard({ trades }: { trades: PredictTrade[] | null }) {
  if (trades === null) return <Skeleton className="mt-4 h-40" />;
  if (trades.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 font-display text-lg font-bold">Recent trades</div>
      <div className="card divide-y divide-white/10 px-4">
        {trades.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 py-3 text-base">
            <div className="min-w-0">
              <div className="truncate">
                <span className="font-semibold">{t.who}</span>
                <span className="text-mute"> {t.side === "BUY" ? "bought" : "sold"} </span>
                <span className={clsx("font-semibold", t.side === "BUY" ? "text-up" : "text-down")}>{t.outcome}</span>
              </div>
              <div className="text-mute">{timeAgo(t.at)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display font-bold">${fmt(t.usd, t.usd < 10 ? 2 : 0)}</div>
              <div className="text-mute">{Math.round(t.price * 100)}¢</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One event with all of its markets laid out like a sports page: winner, totals, then the yes or no questions. No combos. */
function EventSheet({ event, onClose, onBet, picked, comboMode, setComboMode }: { event: PredictEvent; onClose: () => void; onBet: BetFn; picked: Set<string>; comboMode: boolean; setComboMode: (v: boolean) => void }) {
  const [full, setFull] = useState<PredictEvent>(event);
  useEffect(() => {
    getEvent(event.eventId).then((e) => e?.markets && setFull((prev) => ({ ...prev, ...e }))).catch(() => {});
  }, [event.eventId]);
  const [score, setScore] = useState<PredictScore | null>(null);
  const [rulesOpen, setRulesOpen] = useState<string | null>(null);
  const [trades, setTrades] = useState<PredictTrade[] | null>(null);
  useEffect(() => {
    if (full.category === "sports") getScore(event.eventId).then(setScore);
  }, [event.eventId, full.category]);

  const open = openMarkets(full);
  const groups = groupMarkets(open);
  // Plain events (crypto, politics) have no sports types: everything lands in "other", biggest first.
  const questions = (groups.other.length ? groups.other : []).slice(0, 30);
  const conditionIds = [groups.winner[0]?.conditionId, groups.totals[0]?.over?.conditionId, ...questions.map((m) => m.conditionId)].filter(Boolean) as string[];
  const tradeKey = conditionIds.slice(0, 4).join(",");
  useEffect(() => {
    if (!tradeKey) return;
    let alive = true;
    getEventTrades(tradeKey.split(",")).then((t) => alive && setTrades(t));
    return () => {
      alive = false;
    };
  }, [tradeKey]);

  const image = eventImage(full);
  const begins = full.beginAt ? new Date(Number(full.beginAt) * 1000) : null;
  const stats = [
    { label: "Volume", value: volume(full.volumeUsd).replace(" volume", "") || "-" },
    { label: "Last 24h", value: volume(full.volume24hr).replace(" volume", "") || "-" },
    { label: "Closes", value: closes(full.metadata.closeTime).replace("Closes ", "").replace("in ", "") || "-" },
  ];
  const betMarket = (m: PredictMarket) => onBet(m, true, full.metadata.title, optionLabel(m));
  return (
    <Sheet title="Market" onClose={onClose}>
      <div className="mt-4 flex items-start gap-3">
        <Img src={image} size={64} />
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-snug">{full.metadata.title}</div>
          {begins && begins.getTime() > Date.now() && <div className="mt-1 text-base text-mute">Starts {begins.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
        </div>
      </div>
      <div className="mt-4">
        <Segmented value={comboMode ? "combo" : "single"} onChange={(v) => { haptic("tap"); setComboMode(v === "combo"); }} options={[{ id: "single", label: "Single bet" }, { id: "combo", label: "Combo" }]} />
        {comboMode && <p className="mt-2 text-base text-mute">Tap outcomes to add them to your combo. Every pick has to be right for it to pay, and it pays more.</p>}
      </div>
      {score && (
        <div className="mt-4 rounded-2xl bg-[#1c1c22] px-4 py-3 text-center">
          <div className="font-display text-2xl font-extrabold">{score.score}</div>
          <div className="text-base text-mute">{[score.homeTeam && score.awayTeam ? `${score.homeTeam} vs ${score.awayTeam}` : "", score.live ? `Live${score.period ? ` · ${score.period}` : ""}${score.elapsed ? ` ${score.elapsed}` : ""}` : score.ended ? "Final" : ""].filter(Boolean).join(" · ")}</div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-[#1c1c22] px-2 py-3 text-center">
            <div className="font-display text-base font-bold">{s.value}</div>
            <div className="text-base text-mute">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {open.length === 0 && <div className="rounded-2xl bg-[#1c1c22] p-4 text-center text-base text-mute">No open bets on this one right now.</div>}
        {groups.winner.length > 0 && <WinnerCard markets={groups.winner} onBet={betMarket} picked={picked} />}
        {groups.totals.length > 0 && <TotalsCard lines={groups.totals} onBet={betMarket} picked={picked} />}
        {questions.map((m) => (
          <QuestionCard key={m.marketId} m={m} onBet={onBet} picked={picked} rulesOpen={rulesOpen === m.marketId} toggleRules={() => setRulesOpen(rulesOpen === m.marketId ? null : m.marketId)} />
        ))}
      </div>
      <ChatPanel mint="" name={full.metadata.title} price={null} myHoldingUsd={null} eventId={full.eventId} />
      <TradesCard trades={trades} />
    </Sheet>
  );
}

function Markets({ onPick }: { onPick: (e: PredictEvent) => void }) {
  const [cat, setCat] = useState<PredictCategory>("trending");
  const [events, setEvents] = useState<PredictEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setEvents(null);
    setError(null);
    const t = setTimeout(
      () => {
        (q.trim().length >= 2 ? searchEvents(q.trim()) : listEvents(cat))
          .then((r) => id === seq.current && setEvents(r))
          .catch((e) => id === seq.current && setError(e instanceof Error ? e.message : "Could not load markets."));
      },
      q ? 350 : 0,
    );
    return () => clearTimeout(t);
  }, [cat, q, retry]);

  return (
    <div className="mt-4">
      <div className="flex h-14 items-center gap-2 rounded-2xl bg-[#1c1c22] px-4">
        <Search size={20} className="text-mute" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bets" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
      </div>
      {!q && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" onClick={() => { haptic("tap"); setCat(c.id); }} className={clsx("h-11 shrink-0 rounded-full px-5 font-display text-base font-bold", cat === c.id ? "bg-[#FF7A2A] text-white" : "bg-[#1c1c22] text-mute")}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 space-y-3">
        {events === null && !error && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        {error && (
          <div className="card px-4 py-8 text-center text-base text-mute">
            {error}
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="btn3d dark mx-auto mt-4 h-12 px-6 text-base">Try again</button>
          </div>
        )}
        {events?.length === 0 && <div className="card px-4 py-10 text-center text-base text-mute">Nothing found.</div>}
        {events?.map((e) => {
          const top = lead(e);
          const n = openMarkets(e).length;
          return (
            <button key={e.eventId} type="button" onClick={() => { haptic("tap"); onPick(e); }} className="flex w-full items-center gap-3 rounded-[24px] border border-white/[0.07] bg-[#141419] p-3 text-left active:scale-[0.99]">
              <Img src={eventImage(e)} size={56} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-display text-base font-bold leading-snug">{e.metadata.title}</div>
                <div className="mt-1 truncate text-base text-mute">{[closes(e.metadata.closeTime), volume(e.volumeUsd)].filter(Boolean).join(" · ")}</div>
              </div>
              {top ? (
                <div className="max-w-[40%] shrink-0 text-right">
                  <div className="font-display text-xl font-extrabold text-up">{cents(top.pricing?.buyYesPriceUsd)}%</div>
                  <div className="truncate text-base text-mute">{n > 1 ? `${top?.title ?? ""} · ${n} options` : "Yes"}</div>
                </div>
              ) : (
                <ChevronRight size={20} className="text-mute" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PAGE_SHOWN = 10;

function MyBets({ refreshKey }: { refreshKey: number }) {
  const { address } = useWallet();
  const send = useSender();
  const [items, setItems] = useState<PredictPosition[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<"active" | "history">("active");
  // Settled bets live in Jupiter's history feed, not in the positions list. Read in chunks, oldest unread last.
  const [settled, setSettled] = useState<SettledBet[] | null>(null);
  const [settledNext, setSettledNext] = useState<number | null>(0);
  const [settledBusy, setSettledBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Everything is kept, settled bets included: that is the history. Newest first, 20 at a time.
  const load = useCallback(() => {
    if (!address) return;
    getPositionsPage(address, 0)
      .then((r) => {
        setItems(r.items);
        setHasNext(r.hasNext);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load your bets.");
        setItems((p) => p ?? []);
      });
  }, [address]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // A few chunks at a time until something worth showing turns up, since most history rows are orders being created or filled.
  const loadSettled = useCallback(
    async (reset: boolean) => {
      if (!address) return;
      setSettledBusy(true);
      try {
        let from = reset ? 0 : settledNext;
        let got: SettledBet[] = [];
        for (let i = 0; i < 6 && from != null && got.length < PAGE_SHOWN; i++) {
          const r = await getSettledChunk(address, from);
          got = [...got, ...r.items];
          from = r.next;
        }
        setSettled((prev) => {
          const base = reset ? [] : prev ?? [];
          const seen = new Set(base.map((b) => b.id));
          return [...base, ...got.filter((b) => !seen.has(b.id))];
        });
        setSettledNext(from);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your history.");
        setSettled((p) => p ?? []);
      } finally {
        setSettledBusy(false);
      }
    },
    [address, settledNext],
  );
  useEffect(() => {
    if (view === "history" && settled === null && !settledBusy) void loadSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, address]);
  // A bet that just settled shows up after the next refresh.
  useEffect(() => {
    if (refreshKey > 0) setSettled(null);
  }, [refreshKey]);

  const more = async () => {
    if (!address || !items || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await getPositionsPage(address, items.length);
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((p) => p.pubkey));
        return [...(prev ?? []), ...r.items.filter((p) => !seen.has(p.pubkey))];
      });
      setHasNext(r.hasNext);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (p: PredictPosition, kind: "sell" | "claim") => {
    if (!address) return;
    setBusyId(p.pubkey);
    setError(null);
    try {
      const tx = kind === "claim" ? await claimPosition(p.pubkey, address) : await closePosition(p.pubkey, address);
      await send(tx);
      haptic("success");
      setTimeout(load, 2500);
    } catch (e) {
      setError(errText(e));
      haptic("error");
    } finally {
      setBusyId(null);
    }
  };

  if (items === null) return <div className="mt-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  const sorted = [...items].sort((a, b) => (b.openedAt ?? b.updatedAt ?? 0) - (a.openedAt ?? a.updatedAt ?? 0));
  const states = new Map(sorted.map((p) => [p.pubkey, betState(p)]));
  // A win that is not claimed yet stays under Active, where its Claim button is.
  const isActive = (p: PredictPosition) => states.get(p.pubkey) === "active" || (p.claimable && !p.claimed);
  const shown = sorted.filter(isActive);
  const activeCount = sorted.filter(isActive).length;
  return (
    <div className="mt-4 space-y-3">
      <Segmented value={view} onChange={(v) => setView(v as "active" | "history")} options={[{ id: "active", label: `Active${activeCount ? ` (${activeCount})` : ""}` }, { id: "history", label: "History" }]} />
      {error && <div className="text-base text-down">{error}</div>}
      {view === "history" && (
        <>
          {settled === null && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          {settled?.length === 0 && <div className="card px-4 py-10 text-center text-base text-mute">No settled bets yet. Wins and losses show up here once a market ends.</div>}
          {settled?.map((b) => (
            <div key={b.id} className="rounded-[24px] border border-white/[0.07] bg-[#141419] p-4">
              <div className="line-clamp-2 font-display text-base font-bold">{b.title}</div>
              {b.sub && <div className="mt-0.5 line-clamp-1 text-base text-mute">{b.sub}</div>}
              <div className="mt-2 flex items-center justify-between text-base">
                <span className={clsx("rounded-full px-3 py-1 font-display font-bold", b.isYes ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{b.isYes ? "Yes" : "No"}</span>
                <span className="text-mute">{new Date(b.at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              </div>
              <div className={clsx("mt-3 flex items-center justify-between rounded-2xl bg-[#1c1c22] px-4 py-3 text-base font-semibold", b.kind === "won" ? "text-up" : b.kind === "lost" ? "text-down" : "text-mute")}>
                <span>{b.kind === "won" ? "Won" : b.kind === "lost" ? "Lost" : "Sold"}</span>
                {b.resultUsd != null && <span>{b.resultUsd >= 0 ? "+" : "-"}${fmt(Math.abs(b.resultUsd), 2)}</span>}
              </div>
            </div>
          ))}
          {settledNext != null && settled !== null && (
            <button type="button" onClick={() => void loadSettled(false)} disabled={settledBusy} className="btn3d dark flex h-14 w-full items-center justify-center gap-2 text-base">
              {settledBusy && <Loader2 size={18} className="animate-spin" />} Load more
            </button>
          )}
        </>
      )}
      {view === "active" && shown.length === 0 && <div className="card px-4 py-10 text-center text-base text-mute">No open bets. Pick a market and place one.</div>}
      {view === "active" && shown.map((p) => {
        const state = states.get(p.pubkey)!;
        const cost = usd(p.totalCostUsd);
        const pnl = p.pnlUsd != null ? usd(p.pnlUsd) : null;
        const title = p.marketMetadata?.title ?? p.eventMetadata?.title ?? "Bet";
        // Settled: a win pays the full contract value, a loss is the whole stake.
        const result = state === "won" ? usd(p.claimedUsd) || usd(p.payoutUsd) : state === "lost" ? -cost : null;
        return (
          <div key={p.pubkey} className="rounded-[24px] border border-white/[0.07] bg-[#141419] p-4">
            <div className="line-clamp-2 font-display text-base font-bold">{title}</div>
            {p.eventMetadata?.title && p.eventMetadata.title !== title && <div className="mt-0.5 line-clamp-1 text-base text-mute">{p.eventMetadata.title}</div>}
            <div className="mt-2 flex items-center justify-between text-base">
              <span className={clsx("rounded-full px-3 py-1 font-display font-bold", p.isYes ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{p.isYes ? "Yes" : "No"}</span>
              <span className="text-mute">Bet ${fmt(cost, 2)}{state === "active" && pnl != null ? ` · ${pnl >= 0 ? "+" : "-"}$${fmt(Math.abs(pnl), 2)}` : ""}</span>
            </div>
            {p.claimable && !p.claimed ? (
              <button type="button" disabled={busyId === p.pubkey} onClick={() => act(p, "claim")} className="btn3d mt-3 flex h-12 w-full items-center justify-center gap-2 text-base">
                {busyId === p.pubkey && <Loader2 size={18} className="animate-spin" />}Won. Claim ${fmt(usd(p.payoutUsd), 2)}
              </button>
            ) : state === "active" ? (
              <button type="button" disabled={busyId === p.pubkey} onClick={() => act(p, "sell")} className="btn3d dark mt-3 flex h-12 w-full items-center justify-center gap-2 text-base">
                {busyId === p.pubkey && <Loader2 size={18} className="animate-spin" />}Sell
              </button>
            ) : (
              <div className={clsx("mt-3 flex items-center justify-between rounded-2xl bg-[#1c1c22] px-4 py-3 text-base font-semibold", state === "won" ? "text-up" : state === "lost" ? "text-down" : "text-mute")}>
                <span>{state === "won" ? "Won" : state === "lost" ? "Lost" : "Sold"}</span>
                {result != null && <span>{result >= 0 ? "+" : "-"}${fmt(Math.abs(result), 2)}</span>}
              </div>
            )}
          </div>
        );
      })}
      {view === "active" && hasNext && (
        <button type="button" onClick={more} disabled={loadingMore} className="btn3d dark flex h-14 w-full items-center justify-center gap-2 text-base">
          {loadingMore && <Loader2 size={18} className="animate-spin" />} Load more
        </button>
      )}
    </div>
  );
}

/** Predict: bet Yes or No on real events, through Jupiter's prediction markets. */
export function PredictTab({ openEvent, embedded = false }: { openEvent?: { id: string; n: number } | null; embedded?: boolean }) {
  const [section, setSection] = useState<"markets" | "mine">("markets");
  const [event, setEvent] = useState<PredictEvent | null>(null);
  const [bet, setBet] = useState<{ market: PredictMarket; isYes: boolean; title: string; label?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Opened from the Feed: load that event and show it.
  useEffect(() => {
    if (!openEvent) return;
    let alive = true;
    setSection("markets");
    getEvent(openEvent.id).then((e) => alive && setEvent(e)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [openEvent]);
  const [comboMode, setComboMode] = useState(false);
  const [legs, setLegs] = useState<ComboLeg[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const picked = new Set(legs.map((l) => `${l.marketId}:${l.side}`));
  const pick = (market: PredictMarket, isYes: boolean, title: string, label?: string) => {
    const side = isYes ? "yes" : "no";
    const single = (market.pricing?.buyNoPriceUsd ?? 0) === 0;
    const leg: ComboLeg = { marketId: market.marketId, side, label: label ?? (single ? market.title : `${isYes ? "Yes" : "No"}: ${market.title}`), event: title, cents: cents(isYes ? market.pricing?.buyYesPriceUsd : market.pricing?.buyNoPriceUsd) };
    haptic("tap");
    setLegs((cur) => (cur.some((l) => l.marketId === leg.marketId && l.side === side) ? cur.filter((l) => l.marketId !== leg.marketId) : [...cur.filter((l) => l.marketId !== leg.marketId), leg]));
  };

  return (
    <div className={embedded ? "" : "px-4 pt-2"}>
      {!embedded && <h1 className="font-display text-3xl font-extrabold">Predict</h1>}
      <p className={clsx("text-base text-mute", embedded ? "mt-3" : "mt-1")}>Bet Yes or No on real events. A right call pays $1 per contract.</p>
      <div className="mt-4">
        <Segmented value={section} onChange={setSection} options={[{ id: "markets", label: "Markets" }, { id: "mine", label: "My bets" }]} />
      </div>
      {section === "markets" ? <Markets onPick={setEvent} /> : <MyBets refreshKey={refreshKey} />}
      {event && !bet && <EventSheet event={event} onClose={() => setEvent(null)} onBet={(market, isYes, title, label) => (comboMode ? pick(market, isYes, title, label) : setBet({ market, isYes, title, label }))} picked={picked} comboMode={comboMode} setComboMode={setComboMode} />}
      {bet && (
        <BetSheet
          market={bet.market}
          isYes={bet.isYes}
          title={bet.title}
          label={bet.label}
          onClose={() => setBet(null)}
          onDone={() => {
            setRefreshKey((n) => n + 1);
          }}
        />
      )}
      {!comboOpen && !bet && <ComboBar count={legs.length} onOpen={() => setComboOpen(true)} onClear={() => { setLegs([]); setComboMode(false); }} />}
      {comboOpen && (
        <ComboSheet
          legs={legs}
          onRemove={(id) => setLegs((cur) => cur.filter((l) => l.marketId !== id))}
          onClose={() => setComboOpen(false)}
          onPlaced={() => {
            setLegs([]);
            setComboMode(false);
            setRefreshKey((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
