"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import AmplePack3D from "./AmplePack3D";
import { PackFacts } from "./PackFacts";
import { DepositExplainer } from "./DepositExplainer";
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
  const r = p?.bonusTicketsRange, t = Number(p?.bonusTickets);
  if (!r || !Number.isFinite(t) || !(r.max > r.min)) return "rare";
  const k = (t - r.min) / (r.max - r.min);
  return k > 0.85 ? "legendary" : k > 0.6 ? "epic" : k > 0.2 ? "rare" : k > 0.05 ? "uncommon" : "common";
}

const pickOf = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** What the 3D card shows for a result. */
function cardFor(p: AnyObj | null): Record<string, unknown> | null {
  return p && p.bonusTickets != null ? { name: `$${p.bonusTickets} in bonus tickets`, tickets: p.bonusTickets } : null;
}

const DEMO_PACK: AnyObj = { id: "demo", status: "UNOPENED", network: "EVM", bonusTicketsRange: { min: 10, max: 150 }, minDepositUsd: 10, openBy: new Date(Date.now() + 2 * 86_400_000).toISOString() };

/** The whole window is the scene: the 3D pack fills it, everything else is laid over it. No app menu, no scrolling. */
function Screen({ children, anim, card, rarity, onRevealed, stageKey, note }: { children: ReactNode; anim: "idle" | "open"; card?: Record<string, unknown> | null; rarity?: string; onRevealed?: () => void; stageKey?: number; note?: ReactNode }) {
  const [soundOn, setSound] = useSoundOn();
  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden text-white" style={{ background: BG }}>
      <div key={stageKey} className="absolute inset-x-0" style={{ top: "-7vh", height: "100vh" }}>
        <AmplePack3D phase={anim} card={card} rarity={rarity} onRevealed={onRevealed} />
      </div>
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
  const { authenticated, ready, login, getAccessToken } = useAuth() as AnyObj;
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "ripping">("idle");
  const [result, setResult] = useState<AnyObj | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [anim, setAnim] = useState<"idle" | "open">("idle");
  usePackSounds();
  useEffect(() => { unlockAudioOnGesture(); }, []);

  // /app/pack?demo=1 (or the demo button) on localhost only: rip a fake pack with no sign-in, payment or Ample call.
  const [demo, setDemo] = useState(false);
  const [autoRip, setAutoRip] = useState(false);
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
    refetchInterval: (q) => { const x = q.state.data as PackResp | undefined; return x?.eligible && x.pack ? (String(x.pack.status) === "OPENED" ? 30_000 : false) : 6_000; },
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
      const res: AnyObj = { status: "OPENED", bonusTickets: pickOf([10, 25, 50, 150]), fundingDeadline: new Date(Date.now() + 3 * 86_400_000).toISOString(), depositedUsd: 0, withdrawnBeforeOpenUsd: 0, drawEndsAt: new Date(Date.now() + 6 * 86_400_000).toISOString() };
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

  const reset = () => { setResult(null); setAnim("idle"); setRevealed(false); setErr(null); setStageKey((k) => k + 1); };
  const demoNote = demo ? (
    <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-amber-300 px-4 py-2 text-base font-bold text-[#2a1a00]">
      <span>Demo</span>
      <button type="button" onClick={reset} className="underline">Reset</button>
    </div>
  ) : null;
  const info = <PackFacts className="text-base font-semibold text-white/90" />;

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
        <h1 className="text-3xl font-extrabold" style={shadow}>{pack.data?.reason === "AMPLE_PACK_NO_CAMPAIGN" ? "Your $10 is in, your pack is coming" : pack.data?.reason ? "No pack available right now" : "Pay $10 to unlock your free pack"}</h1>
        {pack.data?.reason === "AMPLE_PACK_NO_CAMPAIGN" && <p className="text-lg font-semibold" style={shadow}>We are getting your pack ready. Come back here soon and you can rip it.</p>}
        {(!pack.data?.reason || pack.data?.reason === "AMPLE_PACK_NO_CAMPAIGN") && (
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
      </Screen>
    );
  }

  if (!p) return <div className="fixed inset-0 z-[9999]" style={{ background: BG }} />;

  const showStage = !opened || anim === "open";
  return (
    <Screen anim={showStage ? anim : "idle"} card={cardFor(result)} rarity={rarityOf(p)} onRevealed={() => setRevealed(true)} stageKey={stageKey} note={demoNote}>
      {!opened && anim !== "open" && (
        <>
          <h1 className="text-3xl font-extrabold" style={shadow}>Your free pack is ready</h1>
          <button onClick={rip} disabled={phase !== "idle"} className={cta}>{phase === "ripping" ? "Ripping..." : "Rip the pack"}</button>
          {err && <p className="rounded-xl bg-red-900/80 px-4 py-2 text-lg font-bold text-white">{err}</p>}
          {info}
        </>
      )}
      {anim === "open" && !revealed && <p className="text-2xl font-extrabold" style={shadow}>Ripping...</p>}
      {opened && (anim !== "open" || revealed) && (
        <>
          <Result p={p} />
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/app/stake" className={cta}>Add to Earn</Link>
            {demo && <button type="button" onClick={() => { reset(); setAutoRip(true); }} className="rounded-full border-2 border-white px-8 py-3.5 text-lg font-bold text-white">Rip again</button>}
          </div>
          {info}
        </>
      )}
    </Screen>
  );
}

function Result({ p }: { p: AnyObj }) {
  const st = String(p.status);
  const deposited = Number(p.depositedUsd ?? 0);
  const need = Number(p.minDepositUsd ?? 0) + Number(p.withdrawnBeforeOpenUsd ?? 0);
  const pct = need > 0 ? Math.min(100, (deposited / need) * 100) : 0;
  const late = p.fundingDeadline && new Date(p.fundingDeadline).getTime() < Date.now();
  const headline = st === "UNLOCKED" ? "Unlocked" : st === "EXPIRED" ? "Expired" : late ? "Checking your deposit" : "Add to Earn to unlock";
  return (
    <div className={`${glass} w-full !p-4`}>
      <p className="text-base font-semibold opacity-80">You pulled</p>
      <p className="text-3xl font-extrabold leading-tight text-[#FFE28A]">{p.bonusTickets != null ? `$${p.bonusTickets} in bonus tickets` : "Bonus tickets"}</p>
      <p className="mt-1 text-lg font-bold">{headline}</p>
      {st === "OPENED" && (
        <>
          <p className="text-base">Deposit {usd(need)}{p.fundingDeadline ? ` by ${when(p.fundingDeadline)}` : ""}.</p>
          {Number(p.withdrawnBeforeOpenUsd) > 0 && <p className="text-sm opacity-80">{usd(p.minDepositUsd)} minimum, plus {usd(p.withdrawnBeforeOpenUsd)} you took out of Earn in the last 30 days.</p>}
          <div className="mx-auto mt-2 h-2.5 w-full overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-[#7BE0A8] to-[#D6FFE6]" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="text-base font-semibold">{usd(deposited)} of {usd(need)} counted</p>
            <DepositExplainer amount={Math.max(1, Math.round(Number(p.minDepositUsd) || need))} className="text-sm font-bold underline underline-offset-4" />
          </div>
        </>
      )}
      {st === "UNLOCKED" && <p className="mt-1 text-base">Your bonus counts in the draw ending {when(p.drawEndsAt)}. Keep your deposit in until then.</p>}
      {st === "EXPIRED" && <p className="mt-1 text-base">The deposit window passed, so this bonus will not count.</p>}
    </div>
  );
}

/** Full screen, no app menu. */
export function RipPackPage() {
  return <RipPackInner />;
}
