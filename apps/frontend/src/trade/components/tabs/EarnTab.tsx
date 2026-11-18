"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CircleHelp, Loader2 } from "lucide-react";
import { useWallet } from "@/trade/hooks/useWallet";
import { getTokenBalance } from "@/trade/lib/balances";
import * as ample from "@/trade/lib/ample";
import { USDC, b64ToBytes, bytesToB64, fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";
import { Sheet } from "@/trade/components/Sheet";
import { VaultIcon } from "@/trade/components/icons";
import { Segmented, Skeleton, Tile } from "@/trade/components/ui";

const MIN_DEPOSIT_USD = 1;
/** Same as the main app: every dollar in Earn is 100 tickets. */
const TICKETS_PER_DOLLAR = 100;
const ADD_PRESETS = ["10", "50", "100"];
const SELL_PRESETS = [25, 50, 100];
const PRIZE_NAMES = ["Grand prize", "Big prizes", "Mid prizes", "Small prizes"];
/** Used only when Ample has not sent this week's real groups: the share of the pool each group gets. */
const FALLBACK_TIERS = [
  { name: "Grand prize", share: 25, note: "1 winner" },
  { name: "Big prizes", share: 15, note: "A few winners" },
  { name: "Mid prizes", share: 30, note: "More winners" },
  { name: "Small prizes", share: 30, note: "Many small prizes" },
];
const HOW_STEPS = [
  { title: "Put idle dollars to work", body: "Everyone's deposits earn yield in the pool, and that yield is paid out as prizes every week." },
  { title: "Deposit your money", body: "Your deposit stays yours and is always available. Take it out any time.", note: "Audited by Pashov Audit Group" },
  { title: "Get tickets", body: "Tickets are your entries into the weekly draw. Every dollar in Earn is 100 tickets, and more tickets mean a better chance." },
  { title: "Weekly draws", body: "Every week the pool's yield is shared between winners, from one grand prize down to many small ones." },
  { title: "Win upside", body: "A win lands on top of your savings. You do not win every week, and a week without a win costs you nothing." },
];

const usdText = (v: number) => (v >= 10 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`);
const oddsText = (v: number) => (!Number.isFinite(v) || v <= 0 ? "-" : v * 100 < 0.01 ? "<0.01%" : `${(v * 100).toFixed(2)}%`);

/** Days, hours and minutes left, or null when there is no draw time. */
function countdown(iso: string | null | undefined, now: number): { d: number; h: number; m: number } | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

/** Decimal string to base units, or null if it is not a plain number with at most `decimals` places. */
function toBase(input: string, decimals: number): string | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const out = (w + f.padEnd(decimals, "0")).replace(/^0+/, "");
  return out === "" ? null : out;
}

function TimeBox({ n, label }: { n: number; label: string }) {
  return (
    <div className="grid h-[68px] w-[68px] place-items-center rounded-2xl bg-black/35 text-center">
      <div>
        <div className="font-display text-2xl font-extrabold leading-none">{String(n).padStart(2, "0")}</div>
        <div className="mt-1 text-base text-mute">{label}</div>
      </div>
    </div>
  );
}

/**
 * The vault. Deposit dollars, the yield on everyone's deposits is paid out as weekly prizes, and the
 * money stays the person's own. Wording rule: prizes from pooled yield, never "interest". The
 * average figure is what savers have won, not a promised rate.
 */
export function EarnTab({ onAddMoney, active = true }: { onAddMoney?: () => void; active?: boolean }) {
  const { address, wallet, userId, getAccessToken, signTransaction } = useWallet();
  const [stats, setStats] = useState<ample.AmpleStats | null>(null);
  const [status, setStatus] = useState<ample.AmpleStatus | null>(null);
  const [overview, setOverview] = useState<ample.AmpleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [usdcBal, setUsdcBal] = useState<number | null>(null);
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [amount, setAmount] = useState("50");
  const [customOpen, setCustomOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [review, setReview] = useState<{ id: string; arriving: number; fee: number; total: number } | null>(null);
  const [how, setHow] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => ample.getStats().then((s) => alive && setStats(s)).catch(() => {});
    void load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const token = await getAccessToken();
      const s = await ample.getStatus(token);
      setStatus(s);
      setOverview(s.enabled && s.linked ? await ample.getOverview(token).catch(() => null) : null);
    } catch {
      /* the page keeps working with what it has */
    } finally {
      setLoading(false);
    }
    if (address) getTokenBalance(address, USDC).then(setUsdcBal).catch(() => {});
  }, [userId, getAccessToken, address]);

  // Refreshes quietly each time the tab is opened again. What was loaded stays on screen meanwhile.
  useEffect(() => {
    if (active) void refresh();
  }, [refresh, active]);

  const vault = status?.vault ?? null;
  const held = overview?.balances.find((b) => vault && b.vaultId === vault.id) ?? overview?.balances.find((b) => b.token?.symbol === "USDC");
  const savedUsd = ample.usd(held?.depositsToken);
  const claimable = overview?.claimable ?? [];
  const claimableUsd = claimable.reduce((a, c) => a + ample.usd(c.usdMicro ?? c.payoutAmount), 0);
  const tickets = overview?.tickets?.totalTickets != null ? Math.floor(Number(overview.tickets.totalTickets)) : 0;
  const amt = Math.max(0, Number(amount) || 0);
  const maxAmount = mode === "add" ? Math.max(0, Math.floor((usdcBal ?? 0) * 100) / 100) : Math.floor(savedUsd * 100) / 100;
  const weeklyPool = stats?.estimatedPayoutPoolUsd ?? null;
  const left = countdown(stats?.nextDrawAt, now);
  const tiers = stats?.tiers ?? [];
  const winners = tiers.reduce((a, t) => a + t.winners, 0);
  const oneIn = winners > 0 && stats?.depositors && stats.depositors >= winners ? Math.max(1, Math.round(stats.depositors / winners)) : null;
  const poolUsd = stats?.tvlUsd ?? 0;

  /** Runs one action with shared busy and error handling. */
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNote(null);
    haptic("tap");
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/reject|cancel|denied/i.test(m)) setError("Cancelled.");
      else setError(m || "Something went wrong. Try again.");
      haptic("error");
    } finally {
      setBusy(null);
    }
  };

  const waitForOrder = async (id: string, what: string) => {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await ample.orderStatus(id, await getAccessToken()).catch(() => null);
      if (st?.status === "FAILED") throw new Error(st.detail || `${what} did not finish. Your money is safe and we are looking into it.`);
      if (st?.status === "SUCCESS") return;
    }
    throw new Error(`${what} is taking longer than usual. Your money is safe, check back in a few minutes.`);
  };

  // Step 1: ask for the exact price, show it, change nothing yet.
  const prepareDeposit = () =>
    run("review", async () => {
      if (!address) throw new Error("Wallet not ready yet");
      if (!vault) throw new Error("Earn is not available right now. Try again in a moment.");
      if (amt < MIN_DEPOSIT_USD) throw new Error("The minimum is $1.");
      if ((usdcBal ?? 0) < MIN_DEPOSIT_USD + 0.05) throw new Error("You need USDC in your wallet first. Add money, then come back.");
      const toUnits = (n: number) => String(Math.round(n * 1e6));
      const prep = await ample.fundPrepare({ solanaAddress: address, outputUnits: toUnits(amt), maxTotalUnits: toUnits(usdcBal ?? 0) }, await getAccessToken());
      const arriving = Math.floor((Number(prep.outUnits) / 1e6) * 100) / 100;
      if (arriving < MIN_DEPOSIT_USD) throw new Error("That is too small after fees. Try a bit more.");
      setReview({ id: prep.id, arriving, fee: Number(prep.feeUnits) / 1e6, total: Number(prep.totalUnits) / 1e6 });
    });

  // Step 2: the person confirms, signs on Solana, and the backend does the rest.
  const confirmDeposit = () =>
    run("deposit", async () => {
      if (!review || !wallet) return;
      const token = await getAccessToken();
      const built = await ample.fundTx(review.id, token);
      const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(built.transaction), wallet, chain: "solana:mainnet", options: { uiOptions: { showWalletUIs: false } } });
      await ample.fundBroadcast(review.id, bytesToB64(signedTransaction), token);
      setNote("Adding to Earn. This takes a minute or two.");
      await waitForOrder(review.id, "Your deposit");
      haptic("success");
      setNote(`$${fmt(review.arriving, 2)} added. You are in this week's draw.`);
      setReview(null);
      await refresh();
    });

  const withdrawNow = () =>
    run("withdraw", async () => {
      if (!address || !held) return;
      const everything = amt >= savedUsd - 0.0001;
      const base = everything ? String(held.depositsToken) : toBase(amount, 6);
      if (!base) throw new Error("Enter an amount");
      const { id } = await ample.withdraw({ amount: base, solanaAddress: address }, await getAccessToken());
      setNote("Withdrawing to your wallet...");
      await waitForOrder(id, "Your withdrawal");
      haptic("success");
      setNote("Withdrawn to your wallet.");
      await refresh();
    });

  const claimPrizes = () =>
    run("claim", async () => {
      if (claimable.length === 0) return;
      await ample.claim(claimable.map((c) => c.payoutId), await getAccessToken());
      haptic("success");
      setNote(`${claimable.length} prize${claimable.length === 1 ? "" : "s"} added to Earn.`);
      await refresh();
    });

  const over = amt > maxAmount + 1e-9;
  const unavailable = !loading && status != null && !status.enabled;
  const needsMoney = mode === "add" && (usdcBal ?? 0) < MIN_DEPOSIT_USD + 0.05 && !!onAddMoney;
  const tiersToShow = tiers.length > 0
    ? tiers.map((t, i) => ({ key: String(t.tier), name: PRIZE_NAMES[i] ?? `Prize group ${t.tier}`, big: `~${usdText(t.perWinnerUsd)}`, sub: t.winners === 1 ? "1 winner" : `${t.winners.toLocaleString("en-US")} winners, ~${usdText(t.perWinnerUsd)} each` }))
    : FALLBACK_TIERS.map((t) => ({ key: t.name, name: t.name, big: weeklyPool ? `~${usdText((weeklyPool * t.share) / 100)}` : `${t.share}%`, sub: t.note }));

  return (
    <div className="px-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Earn</h1>
        <button type="button" aria-label="How Earn works" onClick={() => setHow(true)} className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-mute">
          <CircleHelp size={22} />
        </button>
      </div>

      {/* this week's prize */}
      <div className="relative mt-4 overflow-hidden rounded-[32px] p-5" style={{ background: "linear-gradient(135deg,#2a150c,#16110d 60%)", border: "1px solid rgba(255,90,26,0.28)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base text-[#d9b9a0]">This week&apos;s prize</div>
            <div className="mt-1 font-display text-6xl font-extrabold leading-none tracking-tight">{weeklyPool ? usdText(weeklyPool) : "-"}</div>
          </div>
          <div className="anim-bob shrink-0">
            <Tile tone="brand" size={72}>
              <span className="text-white">
                <VaultIcon size={38} />
              </span>
            </Tile>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          {left ? (
            <div className="flex gap-2">
              <TimeBox n={left.d} label="days" />
              <TimeBox n={left.h} label="hrs" />
              <TimeBox n={left.m} label="min" />
            </div>
          ) : (
            <div />
          )}
          {stats?.avgApr ? (
            <div className="text-right">
              <div className="font-display text-lg font-bold text-[#ff8a3d]">~{stats.avgApr.toFixed(0)}% / yr</div>
              <div className="text-base text-mute">avg. won</div>
            </div>
          ) : null}
        </div>
        <p className="mt-4 text-base leading-snug text-mute">Everyone&apos;s deposits earn yield. Every week the yield is paid out as prizes to savers, and your deposit stays yours.</p>
      </div>

      {unavailable && <div className="card mt-4 px-4 py-6 text-center text-base text-mute">Earn is not available right now. Check back soon.</div>}

      {!unavailable && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="card p-4">
              <div className="text-base text-mute">In Earn</div>
              {loading ? <Skeleton className="mt-1 h-8 w-24" /> : <div className="font-display text-2xl font-extrabold">${fmt(savedUsd, 2)}</div>}
            </div>
            <div className="card p-4">
              <div className="text-base text-mute">Your tickets</div>
              <div className="font-display text-2xl font-extrabold">{tickets.toLocaleString("en-US")}</div>
            </div>
          </div>
          {stats?.depositors ? (
            <div className="mt-3 flex items-center gap-3 text-base text-mute">
              <div className="flex -space-x-2">
                {["#e8b9a5", "#9fb4ee", "#c8e6a0"].map((c) => (
                  <span key={c} className="h-7 w-7 rounded-full border-2 border-bg" style={{ background: c }} />
                ))}
              </div>
              {stats.depositors.toLocaleString("en-US")} savers in this draw · withdraw anytime
            </div>
          ) : null}

          {claimableUsd > 0 && (
            <button type="button" onClick={claimPrizes} disabled={busy != null} className="btn3d mt-4 flex h-14 w-full items-center justify-center gap-2 text-base">
              {busy === "claim" && <Loader2 size={18} className="animate-spin" />}
              You won ${fmt(claimableUsd, 2)}. Tap to collect
            </button>
          )}

          {/* add or withdraw */}
          <div className="card mt-4 p-4">
            <Segmented<"add" | "withdraw">
              value={mode}
              onChange={(m) => {
                haptic("tap");
                setMode(m);
                setAmount(m === "add" ? "50" : "");
                setCustomOpen(false);
                setError(null);
                setNote(null);
              }}
              options={[
                { id: "add", label: "Add" },
                { id: "withdraw", label: "Withdraw" },
              ]}
            />

            <div className="mt-3 grid grid-cols-4 gap-2">
              {mode === "add"
                ? ADD_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setAmount(p);
                        setCustomOpen(false);
                      }}
                      className={clsx("btn3d dark h-12 !rounded-2xl font-display text-base font-bold", amount === p && !customOpen && "!border-[#ff7a2a] !text-[#ff9a5a]")}
                    >
                      ${p}
                    </button>
                  ))
                : SELL_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        const v = Math.floor(((savedUsd * p) / 100) * 100) / 100;
                        setAmount(v > 0 ? String(v) : "");
                        setCustomOpen(false);
                      }}
                      className="btn3d dark h-12 !rounded-2xl font-display text-base font-bold"
                    >
                      {p}%
                    </button>
                  ))}
              <button type="button" onClick={() => setCustomOpen((v) => !v)} className={clsx("btn3d dark h-12 !rounded-2xl font-display text-base font-bold", customOpen && "!border-[#ff7a2a] !text-[#ff9a5a]")}>
                Custom
              </button>
            </div>

            {customOpen && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex h-14 min-w-0 flex-1 items-center rounded-2xl bg-surface px-4">
                  <span className="pr-1 font-display text-xl font-bold text-mute">$</span>
                  <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50" />
                </div>
                <button type="button" onClick={() => setAmount(maxAmount > 0 ? String(maxAmount) : "")} className="btn3d dark h-14 shrink-0 px-5 !rounded-2xl text-base">
                  Max
                </button>
              </div>
            )}
            <div className="mt-2 text-base text-mute">{mode === "add" ? `Available $${fmt(maxAmount, 2)}` : `In Earn $${fmt(maxAmount, 2)}`}</div>

            {error && <div className="mt-2 text-base text-down">{error}</div>}
            {note && <div className="mt-2 text-base text-up">{note}</div>}
            {over && !needsMoney && <div className="mt-2 text-base text-down">Not enough balance</div>}

            {needsMoney ? (
              <button type="button" onClick={onAddMoney} className="btn3d mt-3 h-16 w-full text-lg">
                Add money first
              </button>
            ) : (
              <button
                type="button"
                disabled={busy != null || amt <= 0 || over || !address || (mode === "add" && !vault) || (mode === "withdraw" && savedUsd <= 0)}
                onClick={mode === "add" ? prepareDeposit : withdrawNow}
                className="btn3d mt-3 flex h-16 w-full items-center justify-center gap-2 text-lg"
              >
                {(busy === "review" || busy === "withdraw") && <Loader2 size={20} className="animate-spin" />}
                {mode === "add" ? (busy === "review" ? "Checking the price" : `Add${amt > 0 ? ` $${fmt(amt, 2)}` : ""}`) : busy === "withdraw" ? "Withdrawing" : `Withdraw${amt > 0 ? ` $${fmt(amt, 2)}` : ""}`}
              </button>
            )}
            <p className="mt-2 text-center text-base text-mute">{mode === "add" ? `${amt > 0 ? `About ${Math.round(amt * TICKETS_PER_DOLLAR).toLocaleString("en-US")} tickets · ` : ""}$1 = ${TICKETS_PER_DOLLAR} tickets` : "Take your money out any time"}</p>
          </div>

          {/* what you could win */}
          <h2 className="mt-8 font-display text-2xl font-extrabold">What you could win</h2>
          <p className="mt-2 text-base leading-snug text-mute">
            {winners > 0 && stats?.depositors
              ? `This week's estimate: ${weeklyPool ? `about ${usdText(weeklyPool)} shared between ` : ""}${winners.toLocaleString("en-US")} winners, out of ${stats.depositors.toLocaleString("en-US")} savers${oneIn ? `, so about 1 in ${oneIn} savers wins` : ""}. More tickets means better chances.`
              : "Each week the prize pool is split into groups of prizes, and your tickets decide your chance."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {tiersToShow.map((r) => (
              <div key={r.key} className="card p-4">
                <div className="text-base font-semibold text-mute">{r.name}</div>
                <div className="mt-1 font-display text-2xl font-extrabold text-[#ee6a2c]">{r.big}</div>
                <div className="mt-1 text-base leading-snug text-mute">{r.sub}</div>
              </div>
            ))}
          </div>
          {stats?.lastDraw && stats.lastDraw.payoutPoolUsd > 0 && (
            <div className="card mt-3 p-4">
              <div className="font-display text-base font-bold">Last draw, what was really paid</div>
              <div className="mt-2 space-y-1 text-base">
                <div className="flex justify-between"><span className="text-mute">Prizes paid</span><span className="font-semibold">{usdText(stats.lastDraw.payoutPoolUsd)}</span></div>
                <div className="flex justify-between"><span className="text-mute">Winners</span><span className="font-semibold">{stats.lastDraw.winners.toLocaleString("en-US")} of {stats.lastDraw.participants.toLocaleString("en-US")} savers</span></div>
                {stats.lastDraw.grandPrizeUsd ? <div className="flex justify-between"><span className="text-mute">Top prize</span><span className="font-semibold">{usdText(stats.lastDraw.grandPrizeUsd)}</span></div> : null}
              </div>
            </div>
          )}

          {poolUsd > 0 && (
            <div className="card mt-3 p-4">
              <div className="font-display text-base font-bold">What a small deposit looks like</div>
              <div className="mt-2 divide-y divide-white/10">
                {[10, 50, 100, 1000].map((v) => (
                  <div key={v} className="flex items-center justify-between gap-3 py-3 text-base">
                    <span className="font-display font-bold">${v.toLocaleString("en-US")}</span>
                    <span className="text-right text-mute">{(v * TICKETS_PER_DOLLAR).toLocaleString("en-US")} tickets · {oddsText(v / (poolUsd + v))} of all tickets</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-base leading-snug text-mute">In any one week a small deposit is less likely to win than a large one. You keep your whole deposit either way, and prizes are not guaranteed.</p>
            </div>
          )}

          {/* how it works, in three lines */}
          <h2 className="mt-8 font-display text-2xl font-extrabold">How it works</h2>
          <div className="mt-3 space-y-3">
            {[
              { n: "1", t: "Add dollars", s: "Start with $1. It stays yours and you can take it out any time." },
              { n: "2", t: "Get tickets", s: "The more you add, the more tickets you hold." },
              { n: "3", t: "Win every week", s: "Prizes are paid from the yield on everyone's deposits, never from fees." },
            ].map((x) => (
              <div key={x.n} className="card flex items-start gap-4 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink font-display text-base font-extrabold text-bg">{x.n}</span>
                <div>
                  <div className="font-display text-base font-bold">{x.t}</div>
                  <div className="text-base leading-snug text-mute">{x.s}</div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setHow(true)} className="btn3d dark mt-3 h-14 w-full text-base">
            Learn more
          </button>
          <p className="mt-3 text-base text-mute">You will not win every week. Your deposit is not lost if you do not win.</p>
        </>
      )}

      {how && (
        <Sheet title="How Earn works" onClose={() => setHow(false)}>
          <div className="relative mt-5 space-y-5">
            <div className="absolute bottom-6 left-[19px] top-6 w-0.5 bg-raised" />
            {HOW_STEPS.map((s, i) => (
              <div key={s.title} className="relative flex gap-4">
                <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink font-display text-base font-extrabold text-bg">{i + 1}</span>
                <div>
                  <div className="font-display text-base font-bold">{s.title}</div>
                  <p className="text-base leading-snug text-mute">{s.body}</p>
                  {s.note && <p className="mt-1 text-base font-semibold text-ink">{s.note}</p>}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setHow(false)} className="btn3d mt-6 h-16 w-full text-lg">
            Got it
          </button>
        </Sheet>
      )}

      {review && (
        <Sheet title="Confirm deposit" onClose={() => busy !== "deposit" && setReview(null)}>
          <div className="mt-4 space-y-3">
            <div className="flex justify-between text-base">
              <span className="text-mute">Goes into Earn</span>
              <span className="font-display font-bold">${fmt(review.arriving, 2)}</span>
            </div>
            <div className="flex justify-between text-base">
              <span className="text-mute">Fee</span>
              <span className="font-display font-bold">${fmt(review.fee, 2)}</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-3 text-base">
              <span className="text-mute">Leaves your wallet</span>
              <span className="font-display font-bold">${fmt(review.total, 2)}</span>
            </div>
            <p className="text-base text-mute">You sign once. The rest happens on its own and takes a minute or two. You are in the next draw as soon as it lands.</p>
            {error && <div className="text-base text-down">{error}</div>}
            {note && <div className="text-base text-up">{note}</div>}
            <button type="button" onClick={confirmDeposit} disabled={busy != null} className="btn3d flex h-16 w-full items-center justify-center gap-2 text-lg">
              {busy === "deposit" && <Loader2 size={20} className="animate-spin" />}
              {busy === "deposit" ? "Adding" : "Confirm and sign"}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
