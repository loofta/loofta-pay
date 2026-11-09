"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { PlayGame, type ActiveFx, type RunEvent, type RunResult, type Unlock } from "./PlayGame";
import { FALLBACK_RATES, PLAY_CURRENCIES, PLAY_WORLDS, formatMoney, type PlayWorld } from "./playWorlds";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";
const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const RUN_LENGTH = 7;
const SHARE_URL = "https://loofta.xyz/play";
const BEST_KEY = "loofta.play.best.v1";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111114]";

const EVENT_EMOJI: Record<RunEvent, string> = { coin: "🪙", hit: "🟥", dodge: "⬜", bonus: "⚡" };

function pickRun(): PlayWorld[] {
  const pool = [...PLAY_WORLDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, RUN_LENGTH);
}

function shareText(worlds: PlayWorld[], r: RunResult): string {
  const lines = worlds.map((w, i) => `${w.flag} ${(r.trail[i] ?? []).slice(0, 8).map((e) => EVENT_EMOJI[e]).join("") || "▫️"}`);
  return [
    "LOOFTA WORLD 🏃💨",
    ...lines,
    `🪙 ${r.coins} USDC  🟥 ${r.hits} fees  ⚡ ${r.bonuses} bonuses  🌍 ${worlds.length} countries`,
    "Cash out USDC in 19 countries.",
    SHARE_URL,
  ].join("\n");
}

export default function PlayContent() {
  const [run, setRun] = useState<PlayWorld[]>(PLAY_WORLDS.slice(0, RUN_LENGTH));
  const [phase, setPhase] = useState<"ready" | "running" | "done">("ready");
  const [worldIdx, setWorldIdx] = useState(0);
  const [coins, setCoins] = useState(0);
  const [fees, setFees] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [muted, setMuted] = useState(false);
  const [best, setBest] = useState(0);
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const [live, setLive] = useState(false);
  const [amount, setAmount] = useState("100");
  const [copied, setCopied] = useState(false);
  const [fxList, setFxList] = useState<ActiveFx[]>([]);
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [fsActive, setFsActive] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const full = fsActive || pseudoFs;

  useEffect(() => {
    const onChange = () => setFsActive(document.fullscreenElement === stageRef.current && !!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!pseudoFs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPseudoFs(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [pseudoFs]);

  const enterFull = useCallback(async () => {
    const el = stageRef.current;
    try {
      if (el && document.fullscreenEnabled && el.requestFullscreen) {
        await el.requestFullscreen();
        try {
          await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape");
        } catch {
          /* orientation lock not available */
        }
        return;
      }
    } catch {
      /* fall through to the in-page version */
    }
    setPseudoFs(true);
  }, []);

  const exitFull = useCallback(async () => {
    setPseudoFs(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* already out */
    }
  }, []);

  const onUnlock = useCallback((u: Unlock) => {
    setUnlock(u);
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => setUnlock(null), 2400);
  }, []);

  useEffect(() => {
    setRun(pickRun());
    try {
      setBest(Number(localStorage.getItem(BEST_KEY)) || 0);
    } catch {
      /* storage unavailable */
    }
    fetch("/api/play/rates")
      .then((r) => r.json())
      .then((j: { rates?: Record<string, number>; live?: boolean }) => {
        if (j.rates) setRates({ ...FALLBACK_RATES, ...j.rates });
        setLive(!!j.live);
      })
      .catch(() => {});
  }, []);

  const start = useCallback(() => {
    void enterFull();
    setRun(pickRun());
    setWorldIdx(0);
    setCoins(0);
    setFees(0);
    setResult(null);
    setPhase("running");
  }, [enterFull]);

  const finish = useCallback((r: RunResult) => {
    setResult(r);
    setPhase("done");
    setBest((b) => {
      const next = Math.max(b, r.coins);
      try {
        localStorage.setItem(BEST_KEY, String(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const world = run[Math.min(worldIdx, run.length - 1)];
  const usd = Math.max(0, Number(amount) || 0);
  const nowAmount = (w: PlayWorld) => formatMoney(100 * (rates[w.currency] ?? 1), w.currency, w.symbol);

  const text = useMemo(() => (result ? shareText(run, result) : ""), [result, run]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-slate-100">
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-10">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Run the world. Cash out anywhere.</h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-300">
          Jump the fees, grab the USDC, hit the app logos for bonuses, run into a new country. Every country has its own music.
        </p>

        <div ref={stageRef} className={full ? "fixed inset-0 z-[100] flex items-center justify-center bg-black" : "mt-8"}>
          <div className={full ? "relative w-[min(100vw,177.78vh)]" : "relative w-full"}>
            <PlayGame
              worlds={run}
              running={phase === "running"}
              muted={muted}
              fullscreen={full}
              onWorld={setWorldIdx}
              onCoins={(c, f) => {
                setCoins(c);
                setFees(f);
              }}
              onFx={setFxList}
              onUnlock={onUnlock}
              onFinish={finish}
            />

            {phase !== "ready" && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
                <div className="rounded-xl bg-black/55 px-3 py-2 text-lg font-bold text-white">
                  🪙 {coins}   🟥 {fees}
                </div>
                <div className="rounded-xl bg-black/55 px-3 py-2 text-lg font-bold text-white">
                  {Math.min(worldIdx + 1, run.length)} / {run.length}
                </div>
              </div>
            )}

            {phase === "running" && fxList.length > 0 && (
              <div className="pointer-events-none absolute left-3 top-16 flex flex-col gap-2 sm:left-4">
                {fxList.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 rounded-xl bg-black/65 px-3 py-2 text-white" style={{ boxShadow: `0 0 0 2px ${f.color}` }}>
                    {f.logo && <img src={f.logo} alt="" className="h-8 w-8 rounded-lg bg-white object-contain" />}
                    <div className="min-w-[8rem]">
                      <div className="text-base font-bold">{f.name}</div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/20">
                        <div className="h-full rounded-full" style={{ width: `${Math.round(f.left * 100)}%`, background: f.color }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {phase === "running" && unlock && (
              <div key={unlock.n} className="pointer-events-none absolute inset-x-0 top-[22%] flex justify-center px-3">
                <div className="flex items-center gap-4 rounded-2xl border-4 bg-black/80 px-5 py-4 text-white shadow-2xl" style={{ borderColor: unlock.color }}>
                  {unlock.logo && <img src={unlock.logo} alt="" className="h-14 w-14 rounded-xl bg-white object-contain" />}
                  <div>
                    <div className="text-sm font-bold uppercase tracking-widest" style={{ color: unlock.color }}>Bonus unlocked</div>
                    <div className="text-2xl font-extrabold">{unlock.name}</div>
                    <div className="text-base text-slate-200">{unlock.desc}</div>
                  </div>
                </div>
              </div>
            )}

            {phase === "running" && world && (
              <div key={world.id} className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3 sm:bottom-5">
                <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-white/15 bg-black/70 px-4 py-3 text-white shadow-lg">
                  <span className="text-2xl">{world.flag}</span>
                  <span className="text-lg font-bold">{world.name}</span>
                  <span className="text-lg text-slate-200">$100 = {nowAmount(world)}</span>
                  {world.apps.map((a) => (
                    <img key={a.name} src={a.logo} alt={a.name} title={a.name} className="h-8 w-8 rounded-lg bg-white object-contain" />
                  ))}
                </div>
              </div>
            )}

            {phase === "ready" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-2xl bg-black/60 p-4 text-center">
                <p className="text-2xl font-bold sm:text-3xl">Tap or press space to jump</p>
                <p className="max-w-xl text-lg text-slate-200">Jump the red FEE blocks. Catch the USDC. Jump up into the floating app logos for a bonus.</p>
                <button type="button" onClick={start} className={`${BRAND_GRADIENT} rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-[0_8px_32px_rgba(255,74,38,0.28)] hover:opacity-90 ${FOCUS_RING}`}>
                  Start in full screen
                </button>
                {best > 0 && <p className="text-lg text-slate-300">Your best: {best} USDC</p>}
              </div>
            )}

            {phase === "done" && result && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-auto bg-[#0f0f12]/92 p-4 text-center">
                <p className="text-3xl font-bold sm:text-4xl">World cleared</p>
                <p className="text-2xl">{run.map((w) => w.flag).join(" ")}</p>
                <p className="text-lg text-slate-200">
                  🪙 {result.coins} USDC kept   🟥 {result.hits} fees hit   ⚡ {result.bonuses} {result.bonuses === 1 ? "bonus" : "bonuses"}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <a
                    href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${BRAND_GRADIENT} rounded-2xl px-6 py-3 text-lg font-bold text-white hover:opacity-90 ${FOCUS_RING}`}
                  >
                    Post on X
                  </a>
                  <button type="button" onClick={copy} className={`rounded-2xl border border-white/20 px-6 py-3 text-lg font-bold text-white hover:bg-white/10 ${FOCUS_RING}`}>
                    {copied ? "Copied" : "Copy result"}
                  </button>
                  <button type="button" onClick={start} className={`rounded-2xl border border-white/20 px-6 py-3 text-lg font-bold text-white hover:bg-white/10 ${FOCUS_RING}`}>
                    Run again
                  </button>
                  {full && (
                    <button type="button" onClick={exitFull} className={`rounded-2xl border border-white/20 px-6 py-3 text-lg font-bold text-white hover:bg-white/10 ${FOCUS_RING}`}>
                      Exit full screen
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="absolute right-3 top-14 flex flex-col gap-2 sm:right-4">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Turn sound on" : "Turn sound off"}
                className={`rounded-xl bg-black/55 p-2 text-white hover:bg-black/75 ${FOCUS_RING}`}
              >
                {muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
              </button>
              <button
                type="button"
                onClick={full ? exitFull : enterFull}
                aria-label={full ? "Exit full screen" : "Full screen"}
                className={`rounded-xl bg-black/55 p-2 text-white hover:bg-black/75 ${FOCUS_RING}`}
              >
                {full ? <Minimize2 className="h-6 w-6" /> : <Maximize2 className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        <section className="mt-16">
          <h2 className="text-3xl font-bold">What your USDC becomes</h2>
          <p className="mt-2 text-base text-slate-300">
            {PLAY_CURRENCIES.length} currencies, one USDC balance. {live ? "Live market rates." : "Approximate market rates."} They are for reference. The app you pick sets the payout currency.
          </p>
          <label className="mt-6 flex max-w-xs items-center gap-3 rounded-2xl border border-white/10 bg-[#16161a] px-4 py-3">
            <span className="text-xl font-bold text-slate-400">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              aria-label="USDC amount"
              className="w-full bg-transparent text-xl font-bold text-white outline-none"
            />
            <span className="text-base text-slate-400">USDC</span>
          </label>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {PLAY_WORLDS.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#16161a] px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-2xl">{w.flag}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-bold">{w.name}</span>
                    <span className="block text-base text-slate-400">{w.currency}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {w.apps.slice(0, 3).map((a) => (
                    <img key={a.name} src={a.logo} alt={a.name} title={a.name} className="h-7 w-7 rounded-md bg-white object-contain" />
                  ))}
                  <span className="text-lg font-bold text-white">{formatMoney(usd * (rates[w.currency] ?? 1), w.currency, w.symbol)}</span>
                </span>
              </li>
            ))}
          </ul>
          <a href={APP_URL} className={`${BRAND_GRADIENT} mt-8 inline-block rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-[0_8px_32px_rgba(255,74,38,0.28)] hover:opacity-90 ${FOCUS_RING}`}>
            Cash out for real
          </a>
        </section>
      </main>
      <Footer />
    </div>
  );
}
