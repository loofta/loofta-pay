"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import AmplePack3D from "./AmplePack3D";
import { AmplePackInfoDialog } from "./AmplePackInfoDialog";
import { DepositExplainer } from "./DepositExplainer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { unlockAudioOnGesture, usePackSounds, useSoundOn } from "@/lib/amplePackSfx";

type AnyObj = Record<string, any>;
type PackResp = { eligible: boolean; pack: AnyObj | null; reason?: string; progressUsd?: number; requiredUsd?: number };

const BG = "#0F6B45";
const usd = (n: unknown) => `$${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const glass = "rounded-3xl bg-[#04281A]/75 p-5 text-white backdrop-blur-md";
const shadow = { textShadow: "0 2px 12px rgba(0,0,0,.45)" } as const;

/** Where the roll sits in the campaign range, as the pack animation's rarity (bigger roll, bigger reveal). */
function rarityOf(p: AnyObj | null): string {
  if (p?.demoPrize === "stocks" || p?.demoPrize === "airpods") return "epic";
  if (p?.demoPrize === "gta") return "legendary";
  if (p?.demoPrize === "cash") return p.cashUsd >= 500 ? "legendary" : p.cashUsd >= 100 ? "epic" : p.cashUsd >= 25 ? "rare" : "uncommon";
  const r = p?.bonusTicketsRange, t = Number(p?.bonusTickets);
  if (!r || !Number.isFinite(t) || !(r.max > r.min)) return "rare";
  const k = (t - r.min) / (r.max - r.min);
  return k > 0.85 ? "legendary" : k > 0.6 ? "epic" : k > 0.3 ? "rare" : k > 0.1 ? "uncommon" : "common";
}

const DEMO_OPTIONS = [["random", "Random"], ["tickets", "Tickets"], ["cash", "Cash"], ["stocks", "Stocks"], ["airpods", "AirPods"], ["gta", "GTA VI"]] as const;
const PRIZE_IDS = ["tickets", "cash", "stocks", "airpods", "gta"];
const pickOf = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** What the 3D card shows for a result. */
function cardFor(p: AnyObj | null): Record<string, unknown> | null {
  if (!p) return null;
  switch (p.demoPrize) {
    case "cash": return { kind: "cash", title: `$${p.cashUsd}`, name: `$${p.cashUsd} cash` };
    case "stocks": return { kind: "stocks", title: "Up to $250", sub: "OF STOCKS", name: "Stocks" };
    case "airpods": return { kind: "device", title: "AirPods", sub: "PHYSICAL PRIZE", image: "/ample-pack/prizes/airpods.jpg", name: "AirPods" };
    case "gta": return { kind: "game", title: "GTA VI", sub: "GAME PRIZE", image: "/ample-pack/prizes/gta-vi.jpg", name: "GTA VI" };
  }
  return p.bonusTickets !== undefined ? { name: `${p.bonusTickets} bonus tickets`, tickets: p.bonusTickets } : null;
}

const PRODUCT_PRIZES = ["cash", "stocks", "airpods", "gta"];

const DEMO_PACK: AnyObj = { id: "demo", status: "UNOPENED", network: "EVM", bonusTicketsRange: { min: 10, max: 150 }, minDepositUsd: 10, openBy: new Date(Date.now() + 2 * 86_400_000).toISOString() };

/** The whole window is the scene: the 3D pack fills it, everything else is laid over it. No app menu, no scrolling. */
function Screen({ children, anim, card, rarity, hideCard, onRevealed, onFlip, stageKey, note, overlay }: { children: ReactNode; anim: "idle" | "open"; card?: Record<string, unknown> | null; rarity?: string; hideCard?: boolean; onRevealed?: () => void; onFlip?: () => void; stageKey?: number; note?: ReactNode; overlay?: ReactNode }) {
  const [soundOn, setSound] = useSoundOn();
  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden text-white" style={{ background: BG }}>
      <div key={stageKey} className="absolute inset-x-0" style={{ top: "-7vh", height: "100vh" }}>
        <AmplePack3D phase={anim} card={card} rarity={rarity} hideCard={hideCard} onRevealed={onRevealed} onFlip={onFlip} />
      </div>
      {overlay && <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[34vh] flex items-center justify-center"><div className="pointer-events-auto">{overlay}</div></div>}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <Link href="/app" className="pointer-events-auto rounded-full bg-black/45 px-5 py-2.5 text-base font-bold text-white backdrop-blur">Back</Link>
        {note}
        <button type="button" onClick={() => setSound(!soundOn)} className="pointer-events-auto rounded-full bg-black/45 px-5 py-2.5 text-base font-bold text-white backdrop-blur">{soundOn ? "Sound on" : "Sound off"}</button>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex max-h-[62vh] flex-col items-center gap-4 overflow-y-auto bg-gradient-to-t from-[#04281A]/90 via-[#04281A]/55 to-transparent px-4 pb-8 pt-16 text-center">
        <div className="flex w-full max-w-xl flex-col items-center gap-4">{children}</div>
      </div>
    </div>
  );
}

const cta = "rounded-full bg-gradient-to-r from-[#FF4A26] to-[#FFB020] px-8 py-3.5 text-xl font-extrabold text-[#1a0a05] shadow-lg disabled:opacity-60";

function RipPackInner() {
  const { authenticated, ready, login, getAccessToken, email: loginEmail } = useAuth() as AnyObj;
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "ripping">("idle");
  const [result, setResult] = useState<AnyObj | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [anim, setAnim] = useState<"idle" | "open">("idle");
  const [infoOpen, setInfoOpen] = useState(false);
  usePackSounds();
  useEffect(() => { unlockAudioOnGesture(); }, []);

  // /app/pack?demo=1 (or the demo button) on localhost only: rip a fake pack with no sign-in, payment or Ample call.
  const [demo, setDemo] = useState(false);
  const [autoRip, setAutoRip] = useState(false);
  const [demoPick, setDemoPick] = useState<string>("random");
  const [stageKey, setStageKey] = useState(0);
  const [canDemo, setCanDemo] = useState(false);
  useEffect(() => {
    try {
      const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      setCanDemo(local);
      if (local && new URLSearchParams(window.location.search).get("demo") === "1") setDemo(true);
    } catch { /* ignore */ }
  }, []);

  const pack = useQuery({
    queryKey: ["ample-pack"],
    enabled: !!authenticated && !demo,
    retry: 1,
    refetchInterval: (q) => (String((q.state.data as PackResp | undefined)?.pack?.status ?? "") === "OPENED" ? 30_000 : false),
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const r = await fetch("/api/ample-pack", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!r.ok) throw new Error("pack");
      return (await r.json()) as PackResp;
    },
  });

  const base = demo ? DEMO_PACK : pack.data?.pack ?? null;
  const p: AnyObj | null = base ? { ...base, ...(result ?? {}) } : result;
  const packId = String(base?.id ?? "");
  const status = String(p?.status ?? "");
  const opened = status !== "" && status !== "UNOPENED";

  async function rip() {
    if (!packId || phase !== "idle" || (!demo && (opened || result))) return; // one rip per pack
    setErr(null);
    setPhase("ripping");
    if (demo) {
      await new Promise((r) => setTimeout(r, 400));
      const prize = demoPick === "random" ? pickOf(PRIZE_IDS) : demoPick;
      const res: AnyObj = { status: "OPENED", demoPrize: prize, fundingDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(), depositedUsd: 0, withdrawnBeforeOpenUsd: 0, drawEndsAt: new Date(Date.now() + 6 * 86_400_000).toISOString() };
      if (prize === "tickets") res.bonusTickets = pickOf([10, 25, 50, 150]); // the bonus-ticket prizes shown in the drop
      if (prize === "cash") res.cashUsd = pickOf([1, 25, 100, 500]);
      setResult(res);
      setAnim("open");
      setPhase("idle");
      return;
    }
    try {
      const token = await getAccessToken().catch(() => null);
      const [res] = await Promise.all([
        fetch("/api/ample-pack", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ packId }) }),
        new Promise((r) => setTimeout(r, 800)),
      ]);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? body?.error?.message ?? "Could not open the pack");
      setResult(body);
      setAnim("open");
      void qc.invalidateQueries({ queryKey: ["ample-pack"] });
    } catch (e: any) {
      setErr(e?.message ?? "Could not open the pack, try again");
    } finally {
      setPhase("idle");
    }
  }

  // The demo button starts ripping right away.
  useEffect(() => {
    if (demo && autoRip && phase === "idle" && !result) { setAutoRip(false); void rip(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, autoRip]);

  const reset = () => { setResult(null); setAnim("idle"); setRevealed(false); setFlipped(false); setErr(null); setStageKey((k) => k + 1); };
  const demoNote = demo ? (
    <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-amber-300 px-4 py-2 text-base font-bold text-[#2a1a00]">
      <span>Demo</span>
      <button type="button" onClick={reset} className="underline">Reset</button>
    </div>
  ) : null;
  const demoChips = demo ? (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {DEMO_OPTIONS.map(([id, label]) => (
        <button key={id} type="button" onClick={() => setDemoPick(id)} className={`rounded-full px-4 py-2 text-base font-bold ${demoPick === id ? "bg-white text-[#0A3A26]" : "border border-white/70 text-white"}`}>{label}</button>
      ))}
    </div>
  ) : null;
  const info = <button type="button" onClick={() => setInfoOpen(true)} className="text-lg font-bold text-white underline underline-offset-4" style={shadow}>What is in the pack?</button>;
  const dialog = <AmplePackInfoDialog open={infoOpen} onOpenChange={setInfoOpen} />;

  if (!demo && (!ready || (authenticated && pack.isLoading))) return <div className="fixed inset-0 z-[9999]" style={{ background: BG }} />;

  if (!demo && !authenticated) return (
    <Screen anim="idle">
      <p className="text-2xl font-extrabold" style={shadow}>Sign in to open your free pack</p>
      <button onClick={() => login()} className={cta}>Sign in</button>
    </Screen>
  );

  if (!demo && pack.isError) return (
    <Screen anim="idle"><p className="text-xl font-bold" style={shadow}>Could not load your pack. Try again in a moment.</p></Screen>
  );

  // Locked: nothing earned yet (or no campaign running).
  if (!demo && (!pack.data?.eligible || !p)) {
    const done = pack.data?.progressUsd ?? 0, need = pack.data?.requiredUsd ?? 10;
    return (
      <Screen anim="idle">
        <h1 className="text-3xl font-extrabold" style={shadow}>{pack.data?.reason ? "No pack available right now" : "Pay $10 to unlock your free pack"}</h1>
        {!pack.data?.reason && (
          <div className="w-full">
            <div className="h-4 w-full overflow-hidden rounded-full bg-black/35"><div className="h-full rounded-full bg-gradient-to-r from-[#7BE0A8] to-[#D6FFE6]" style={{ width: `${Math.min(100, (done / need) * 100)}%` }} /></div>
            <p className="mt-1 text-lg font-bold" style={shadow}>{usd(done)} of {usd(need)} paid</p>
          </div>
        )}
        <div className="flex flex-nowrap items-center justify-center gap-3">
          {!pack.data?.reason && <Link href="/app/send" className={cta}>Send a payment</Link>}
          {canDemo && <button type="button" onClick={() => { setDemo(true); setAutoRip(true); }} className="rounded-full border-2 border-white px-7 py-3 text-xl font-bold text-white">Rip a demo pack</button>}
        </div>
        {info}
        {dialog}
      </Screen>
    );
  }

  if (!p) return <div className="fixed inset-0 z-[9999]" style={{ background: BG }} />;

  const showStage = !opened || anim === "open";
  const isProduct = PRODUCT_PRIZES.includes(String(result?.demoPrize));
  return (
    <Screen anim={showStage ? anim : "idle"} card={cardFor(result)} rarity={rarityOf(result ?? p)} hideCard={isProduct} onRevealed={() => setRevealed(true)} onFlip={() => setFlipped(true)} stageKey={stageKey} note={demoNote} overlay={isProduct && flipped ? <ProductShow p={result!} /> : null}>
      {!opened && anim !== "open" && (
        <>
          <h1 className="text-3xl font-extrabold" style={shadow}>Your free pack is ready</h1>
          <p className="text-lg font-semibold" style={shadow}>Rip it for bonus draw tickets{p.bonusTicketsRange ? ` (${p.bonusTicketsRange.min} to ${p.bonusTicketsRange.max})` : ""}.</p>
          {demoChips}
          <button onClick={rip} disabled={phase !== "idle"} className={cta}>{phase === "ripping" ? "Ripping..." : "Rip the pack"}</button>
          {err && <p className="rounded-xl bg-red-900/80 px-4 py-2 text-lg font-bold text-white">{err}</p>}
          {info}
        </>
      )}
      {anim === "open" && !revealed && <p className="text-2xl font-extrabold" style={shadow}>Ripping...</p>}
      {opened && (anim !== "open" || revealed) && (
        <>
          <Result p={p} loginEmail={loginEmail} demo={demo} />
          {demoChips}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/app/stake" className={cta}>Add to Earn</Link>
            {demo && <button type="button" onClick={() => { reset(); setAutoRip(true); }} className="rounded-full border-2 border-white px-8 py-3.5 text-lg font-bold text-white">Rip again</button>}
          </div>
          {info}
        </>
      )}
      {dialog}
    </Screen>
  );
}

const PRIZE_TEXT: Record<string, { title: (p: AnyObj) => string; need: string }> = {
  cash: { title: (p) => `$${p.cashUsd} cash`, need: "Deposit $150 and keep it in for a full weekly cycle. Paid in USDC on Base after verification." },
  stocks: { title: () => "Up to $250 of stocks", need: "Deposit $150 to activate it." },
  airpods: { title: () => "AirPods", need: "Deposit $150 to activate it. We pass your details to Ample using your login email." },
  gta: { title: () => "GTA VI", need: "Deposit $150 to activate it. We pass your details to Ample using your login email." },
};

function Result({ p, loginEmail, demo }: { p: AnyObj; loginEmail?: string; demo: boolean }) {
  const st = String(p.status);
  const other = PRIZE_TEXT[String(p.demoPrize)];
  const deposited = Number(p.depositedUsd ?? 0);
  const need = Number(p.minDepositUsd ?? 0) + Number(p.withdrawnBeforeOpenUsd ?? 0);
  const pct = need > 0 ? Math.min(100, (deposited / need) * 100) : 0;
  const late = p.fundingDeadline && new Date(p.fundingDeadline).getTime() < Date.now();
  const headline = st === "UNLOCKED" ? "Unlocked" : st === "EXPIRED" ? "Expired" : late ? "Checking your deposit" : "Add to Earn to unlock";
  return (
    <div className={`${glass} w-full`}>
      <p className="text-lg font-semibold">You pulled</p>
      <p className="mt-1 text-5xl font-extrabold text-[#FFE28A]">{other ? other.title(p) : `${p.bonusTickets ?? "?"} bonus tickets`}</p>
      <p className="mt-2 text-xl font-bold">{headline}</p>
      {other && <p className="mt-1 text-lg">{other.need}</p>}
      {other && <DepositExplainer amount={150} cash={p.demoPrize === "cash"} />}
      {demo && (p.demoPrize === "airpods" || p.demoPrize === "gta") && <ClaimEmail loginEmail={loginEmail} />}
      {!other && st === "OPENED" && (
        <>
          <p className="mt-1 text-lg">Deposit {usd(need)} of new money{p.fundingDeadline ? ` by ${when(p.fundingDeadline)}` : ""}.</p>
          {Number(p.withdrawnBeforeOpenUsd) > 0 && <p className="text-base">That includes {usd(p.withdrawnBeforeOpenUsd)} you took out in the last 30 days, which is put back first.</p>}
          <div className="mx-auto mt-3 h-4 w-full overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-[#7BE0A8] to-[#D6FFE6]" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-lg font-semibold">{usd(deposited)} of {usd(need)} counted</p>
          <DepositExplainer amount={Math.max(1, Math.round(need))} />
        </>
      )}
      {st === "UNLOCKED" && <p className="mt-1 text-lg">Your bonus counts in the draw ending {when(p.drawEndsAt)}. Keep your deposit in until then.</p>}
      {st === "EXPIRED" && <p className="mt-1 text-lg">The deposit window passed, so this bonus will not count.</p>}
    </div>
  );
}


/** The real product, bursting out of the pack (instead of a card). */
function ProductShow({ p }: { p: AnyObj }) {
  const k = String(p.demoPrize);
  return (
    <div className="flex flex-col items-center gap-3" style={{ animation: "amp-pop .75s cubic-bezier(.2,1.3,.3,1) both" }}>
      <style>{`@keyframes amp-pop{0%{transform:scale(.15) rotate(-10deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}@keyframes amp-float{0%,100%{transform:translateY(0) rotate(var(--r,0deg))}50%{transform:translateY(-12px) rotate(var(--r,0deg))}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}`}</style>
      {k === "airpods" && (
        <div className="overflow-hidden rounded-full" style={{ width: "min(74vw,320px)", height: "min(74vw,320px)", background: "#F4F5F7", boxShadow: "0 30px 60px rgba(0,0,0,.45), 0 0 0 4px rgba(255,255,255,.9), 0 0 80px rgba(255,255,255,.35)", animation: "amp-float 3.6s ease-in-out infinite" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ample-pack/prizes/airpods.jpg" alt="AirPods" className="h-full w-full object-cover" />
        </div>
      )}
      {k === "gta" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/ample-pack/prizes/gta-vi.jpg" alt="Grand Theft Auto VI" className="rounded-lg" style={{ height: "min(44vh,400px)", ["--r" as string]: "3deg", boxShadow: "0 30px 60px rgba(0,0,0,.5), 0 0 0 3px rgba(255,255,255,.85)", animation: "amp-float 3.6s ease-in-out infinite" }} />
      )}
      {k === "stocks" && (
        <svg viewBox="0 0 140 90" style={{ width: "min(82vw,380px)", filter: "drop-shadow(0 10px 30px rgba(255,211,106,.45))", animation: "amp-float 3.6s ease-in-out infinite" }} aria-label="Stocks">
          {[[22, 38, "g"], [40, 32, "g"], [50, 36, "r"], [62, 44, "g"], [74, 30, "g"], [86, 24, "r"], [98, 18, "g"]].map(([x, y, c], i) => <rect key={i} x={Number(x) - 3.5} y={Number(y) + 20} width="7" height="18" rx="2" fill={c === "g" ? "#7BE0A8" : "#FF8A98"} />)}
          <path d="M8 80 L24 66 L36 62 L48 52 L60 54 L72 40 L84 30 L96 22 L110 14" fill="none" stroke="#FFE28A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="110" cy="14" r="5.5" fill="#FFE28A" />
        </svg>
      )}
      {k === "cash" && (
        <div className="relative" style={{ width: "min(56vw,230px)", height: "min(56vw,230px)", animation: "amp-float 3.6s ease-in-out infinite" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/usdc.svg" alt="USDC" className="absolute left-[-18%] top-[18%] w-[70%]" style={{ filter: "drop-shadow(0 12px 22px rgba(0,0,0,.4))", transform: "rotate(-14deg)" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/usdc.svg" alt="" className="absolute right-[-14%] top-[8%] w-[70%]" style={{ filter: "drop-shadow(0 12px 22px rgba(0,0,0,.4))", transform: "rotate(12deg)" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/usdc.svg" alt="USDC" className="absolute inset-0 m-auto w-[92%]" style={{ filter: "drop-shadow(0 16px 28px rgba(0,0,0,.45))" }} />
        </div>
      )}
    </div>
  );
}

/** Prize claim contact: a button that opens a small form. Uses the login email; with none, they type it twice. */
function ClaimEmail({ loginEmail }: { loginEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [again, setAgain] = useState("");
  const [sent, setSent] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ok = loginEmail ? true : valid && email.trim().toLowerCase() === again.trim().toLowerCase();
  const field = "w-full rounded-xl border border-white/10 bg-[#121217] px-4 py-3 text-lg text-[#F2EFE8] placeholder:text-[#8A8893]";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mx-auto mt-5 block rounded-full bg-white px-8 py-3 text-lg font-extrabold text-[#0A3A26]">{sent ? "Claim sent" : "Claim your prize"}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wrapperZIndexClassName="z-[10001]" overlayZIndexClassName="z-[10000]" className="w-[calc(100vw-24px)] max-w-md rounded-3xl border border-white/10 bg-[#141418] text-[#F2EFE8] shadow-2xl p-6">
          <DialogTitle className="text-2xl font-extrabold">Claim your prize</DialogTitle>
          <DialogDescription className="text-base text-[#C9C6CF]">We pass your details to Ample so they can reach you.</DialogDescription>
          {sent ? (
            <p className="text-xl font-bold">Done. We will pass {loginEmail ?? email.trim()} to Ample.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {loginEmail ? (
                <p className="text-lg">We will use <b>{loginEmail}</b>.</p>
              ) : (
                <>
                  <p className="text-lg">Add the email Ample should reach you on, and confirm it.</p>
                  <input className={field} type="email" inputMode="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <input className={field} type="email" inputMode="email" autoComplete="email" placeholder="Confirm email" value={again} onChange={(e) => setAgain(e.target.value)} />
                  {again && email.trim().toLowerCase() !== again.trim().toLowerCase() && <p className="text-base font-bold text-[#FFB4A8]">The two emails do not match.</p>}
                </>
              )}
              <button type="button" disabled={!ok} onClick={() => setSent(true)} className="rounded-full bg-gradient-to-r from-[#FF4A26] to-[#FFB020] px-6 py-3 text-lg font-extrabold text-[#1a0a05] disabled:opacity-50">{loginEmail ? "Confirm" : "Confirm email"}</button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Full screen, no app menu. */
export function RipPackPage() {
  return <RipPackInner />;
}
