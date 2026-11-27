"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AmplePackInfoDialog } from "@/components/ample-pack/AmplePackInfoDialog";

const MONO = "var(--font-home-mono), 'JetBrains Mono', monospace";

type PackResp = { eligible: boolean; pack: Record<string, any> | null; reason?: string; progressUsd?: number; requiredUsd?: number };

/** Small green Ample pack. Grey and blurred while locked, sharp once the pack is earned. */
function MiniPack({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 100 140" width={84} height={118} aria-hidden style={{ flex: "none", transform: "rotate(-6deg)", filter: locked ? "grayscale(1) blur(2.5px) brightness(.8)" : "drop-shadow(0 10px 16px rgba(30,160,100,.5))", transition: "filter .4s" }}>
      <defs>
        <linearGradient id="amp-mini" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#35C487" /><stop offset=".6" stopColor="#1B9E64" /><stop offset="1" stopColor="#0E6E48" /></linearGradient>
        <linearGradient id="amp-orb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4FB88A" /><stop offset="1" stopColor="#14925E" /></linearGradient>
        <clipPath id="amp-clip"><rect x="4" y="4" width="92" height="132" rx="9" /></clipPath>
      </defs>
      <rect x="4" y="4" width="92" height="132" rx="9" fill="url(#amp-mini)" />
      <g clipPath="url(#amp-clip)">
        {[18, 28, 38, 48, 58, 68].map((r) => <circle key={r} cx="50" cy="78" r={r} fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth="3" />)}
        <rect x="4" y="4" width="92" height="12" fill="#fff" opacity=".16" />
        <rect x="4" y="124" width="92" height="12" fill="#fff" opacity=".16" />
        {Array.from({ length: 23 }).map((_, i) => (<g key={i}><rect x={6 + i * 4} y="4" width="2" height="12" fill="#fff" opacity=".35" /><rect x={6 + i * 4} y="124" width="2" height="12" fill="#fff" opacity=".35" /></g>))}
        <rect x="18" y="4" width="14" height="132" fill="#fff" opacity=".1" transform="skewX(-10)" />
      </g>
      <text x="50" y="42" textAnchor="middle" fontSize="16" fontWeight="900" fill="#fff" fontFamily="system-ui,sans-serif" letterSpacing="-0.5" fontStyle="italic">AMPLE</text>
      <circle cx="50" cy="78" r="23" fill="#fff" />
      <circle cx="58" cy="75" r="10" fill="url(#amp-orb)" /><circle cx="45" cy="81" r="6.5" fill="#5DBB93" /><circle cx="37" cy="84" r="3.6" fill="#6FC59E" />
      <text x="50" y="114" textAnchor="middle" fontSize="6.5" fontWeight="800" fill="#fff" fontFamily="system-ui,sans-serif" letterSpacing="2.2">FREE PACK</text>
    </svg>
  );
}

/** Home card: the free Ample pack offer. Locked with a progress bar until $10 of payments, then rip it, then unlock it with a deposit. */
export function AmplePackCard({ userId, getAccessToken, demoPack }: { userId?: string; getAccessToken: () => Promise<string | null>; demoPack?: PackResp }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const q = useQuery({
    queryKey: ["ample-pack", userId],
    enabled: !!userId && !demoPack,
    retry: 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      const r = await fetch("/api/ample-pack", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!r.ok) throw new Error("pack");
      return (await r.json()) as PackResp;
    },
  });

  const d = demoPack ?? q.data;
  const p = d?.pack;
  const st = String(p?.status ?? "");
  // Shown while loading or if the lookup fails, so the offer is never invisible. Only an explicit "no campaign" or a finished pack hides it.
  if (d && d.reason) return null;
  const drawOver = p?.drawEndsAt && new Date(String(p.drawEndsAt)).getTime() < Date.now();
  // Stays on the home screen from the rip until the campaign ends (the bonus draw has finished).
  if (d?.eligible && (!p || !["UNOPENED", "OPENED", "UNLOCKED", "EXPIRED"].includes(st) || (st !== "OPENED" && drawOver))) return null;

  const locked = !d?.eligible;
  const unlocked = st === "UNLOCKED";
  const expired = st === "EXPIRED";
  const deposited = Number(p?.depositedUsd ?? 0);
  const depNeed = Number(p?.minDepositUsd ?? 0) + Number(p?.withdrawnBeforeOpenUsd ?? 0);
  const depPct = unlocked ? 100 : depNeed > 0 ? Math.min(100, Math.round((deposited / depNeed) * 100)) : 0;
  const fd = (v: unknown) => { try { return new Date(String(v)).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };
  const need = d?.requiredUsd ?? 10;
  const done = Math.min(d?.progressUsd ?? 0, need);
  const pct = Math.round((done / need) * 100);

  const title = unlocked ? "Your gift is on the way" : expired ? "Ample pack expired" : st === "OPENED" ? "Unlock your Ample pack" : "FREE Ample pack";
  const sub = locked ? `Pay $${need} in total to rip it.`
    : unlocked ? `Your ${p?.bonusTickets ?? ""} bonus tickets count in the draw ending ${fd(p?.drawEndsAt)}. Keep your deposit in until then.`
    : expired ? "The deposit window passed, so this bonus will not count."
    : st === "OPENED" ? `Deposit $${depNeed.toFixed(2)} into Earn${p?.fundingDeadline ? ` by ${fd(p.fundingDeadline)}` : ""} to unlock your ${p?.bonusTickets ?? ""} bonus tickets.`
    : "Rip it open for bonus draw tickets.";
  const cta = locked ? "Send to unlock" : st === "OPENED" ? "Add to Earn" : unlocked || expired ? "See your pack" : "Rip your pack";
  const href = locked ? "/app/send" : st === "OPENED" ? "/app/stake" : "/app/pack";
  const showDeposit = st === "OPENED" || unlocked;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", borderRadius: 24, background: "linear-gradient(135deg,rgba(47,122,82,.22),rgba(22,26,24,.9))", border: "1px solid rgba(92,196,140,.28)" }}>
      <div style={{ position: "relative", flex: "none" }}>
        <MiniPack locked={locked} />
        {locked && <span style={{ position: "absolute", left: 6, bottom: 2, fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: "#0E1411", border: "1px solid rgba(92,196,140,.4)", color: "#E8F5EE" }}>{pct}%</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em" }}>{title}</span>
            <button type="button" onClick={() => setInfoOpen(true)} aria-label="What is in the pack" style={{ cursor: "pointer", flex: "none", width: 22, height: 22, borderRadius: "50%", border: "1px solid rgba(255,255,255,.35)", background: "transparent", color: "#C9D6CE", fontSize: 13, fontWeight: 800, lineHeight: 1 }}>i</button>
          </span>
          <span style={{ fontSize: 15, color: "#B7C4BC" }}>{sub}</span>
        </div>
        {locked && (
          <>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(pct, done > 0 ? 4 : 0)}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#3FA874,#7BE0A8)", transition: "width .7s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 13, color: "#9AA8A0" }}>
              <span>${done.toFixed(2)}</span>
              <span>${need.toFixed(2)}</span>
            </div>
          </>
        )}
        {showDeposit && (
          <>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(depPct, deposited > 0 ? 4 : 0)}%`, height: "100%", borderRadius: 999, background: unlocked ? "linear-gradient(90deg,#7BE0A8,#D6FFE6)" : "linear-gradient(90deg,#3FA874,#7BE0A8)", transition: "width .7s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 13, color: "#9AA8A0" }}>
              <span>{unlocked ? "Deposit counted" : `$${deposited.toFixed(2)} counted`}</span>
              <span>{unlocked ? "On the way" : `$${depNeed.toFixed(2)}`}</span>
            </div>
          </>
        )}
        <style>{`
          .amp-cta{position:relative;overflow:hidden;display:block;text-align:center;padding:13px 12px;border-radius:14px;background:linear-gradient(90deg,#FF4A26,#F5B70C);color:#1a0a05;font-weight:800;font-size:16px;box-shadow:0 6px 18px rgba(255,90,30,.25);transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}
          .amp-cta::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);transition:left .55s ease}
          .amp-cta:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 12px 30px rgba(255,120,30,.5);filter:brightness(1.08)}
          .amp-cta:hover::after{left:130%}
          .amp-cta:active{transform:translateY(0) scale(.98)}
          @media (prefers-reduced-motion:reduce){.amp-cta,.amp-cta::after{transition:none}}
        `}</style>
        <Link href={href} className="amp-cta">{cta}</Link>
      </div>
    <AmplePackInfoDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  );
}
