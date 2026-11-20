"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { JetBrains_Mono, Manrope, Sora } from "next/font/google";
import { Mark } from "./Mark";
import { WithdrawPage } from "./WithdrawPage";
import { feeFor, LOGOS, onColor, SETUP, type Setup } from "./setup-shared";
import "./tutorial.css";

// The partner portal's own fonts: Manrope for text, JetBrains Mono for labels. Sora is the withdraw page heading font.
const sans = Manrope({ subsets: ["latin"], variable: "--font-tt-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-tt-mono", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-tt-sora", display: "swap" });

const PORTAL_HREF = "https://pay.loofta.com/partner/portal";
const STORE_HREF = "https://loofta-rally.fly.dev";

/* ---------- motion helpers ---------- */

/** Returns 0, then 1, 2... as each time (ms from mount) passes. Scenes remount per step, so they replay. */
function usePhase(times: number[]) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const ids = times.map((t, i) => window.setTimeout(() => setP(i + 1), t));
    return () => ids.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return p;
}

function useCount(to: number, delay = 0, dur = 1200, from = 0) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      setV(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, dur, from]);
  return v;
}

function useTyped(text: string, delay = 400, speed = 70) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    let iv = 0;
    const st = window.setTimeout(() => {
      iv = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) window.clearInterval(iv);
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(st);
      window.clearInterval(iv);
    };
  }, [text, delay, speed]);
  return text.slice(0, n);
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAYOUTS = [
  { who: "Mira Okafor", h: "MO", amt: 400, c: "#f97316" },
  { who: "Jon Reyes", h: "JR", amt: 250, c: "#3b82f6" },
  { who: "Sana Iyer", h: "SI", amt: 150, c: "#a855f7" },
  { who: "Leo Brandt", h: "LB", amt: 100, c: "#22c55e" },
  { who: "Ada Kimura", h: "AK", amt: 100, c: "#ec4899" },
];

type Ctx = { s: Setup; accent: string; on: string };
const On = ({ show, children, delay = 0 }: { show: boolean; children: ReactNode; delay?: number }) => (
  <div className={`g ${show ? "on" : ""}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
);
const Browser = ({ url, dark, children }: { url: string; dark?: boolean; children: ReactNode }) => (
  <div className={`t-frame ${dark ? "dark" : ""}`}>
    <div className="t-chrome"><i /><i /><i /><span>{url}</span></div>
    {children}
  </div>
);

/* ---------- scenes ---------- */

/** The first page: a payout card sends money to eight people and each lands with a tick. */
const PEOPLE: Array<[string, string, number, string, number, number]> = [
  ["M", "mira@gmail.com", 400, "#FF7A3D", -330, -130],
  ["J", "jon.park@outlook.com", 250, "#4C8DFF", 330, -130],
  ["S", "sana@hey.com", 150, "#B36BFF", -470, -45],
  ["L", "leo.m@gmail.com", 100, "#34C77B", 470, -45],
  ["A", "ada@proton.me", 100, "#FF5FA2", -330, 40],
  ["N", "noor.k@icloud.com", 75, "#E8B422", 330, 40],
  ["T", "tess@gmail.com", 60, "#2EC4B6", -470, 125],
  ["R", "ravi.s@yahoo.com", 40, "#7C7CFF", 470, 125],
];

/** True on phone-sized screens, where the first page uses a narrower arrangement. */
function useCompact() {
  const [c, setC] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 700px)");
    const f = () => setC(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return c;
}

function IntroStage() {
  const compact = useCompact();
  const wrap = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const start = performance.now();
    const iv = window.setInterval(() => setT((performance.now() - start) % 9600), 50);
    const fit = () => {
      const el = wrap.current;
      const w = el ? el.clientWidth : 1240;
      const h = el ? el.clientHeight : 420;
      const vw = compact ? 360 : 1240;
      const vh = compact ? 540 : 420;
      setScale(Math.min(1, (w - 16) / vw, (h - 8) / vh));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrap.current) ro.observe(wrap.current);
    return () => {
      window.clearInterval(iv);
      ro.disconnect();
    };
  }, [compact]);

  const press = 1000;
  const fly = 900;
  const out = t > 8200;
  let total = 0;
  let sent = 0;
  const COMPACT_POS: Array<[number, number]> = [[-92, -218], [92, -148], [-92, -148], [92, -218], [-92, 148], [92, 218], [-92, 218], [92, 148]];
  const chips = PEOPLE.map(([initial, email, amt, color, x0, y0], i) => {
    const x = compact ? COMPACT_POS[i][0] : x0;
    const y = compact ? COMPACT_POS[i][1] : y0;
    const l = 1250 + i * 190;
    const launched = t > l;
    const landed = t > l + fly * 0.7;
    const f = Math.min(1, Math.max(0, (t - l - fly * 0.4) / 500));
    total += amt * f;
    if (landed) sent++;
    return { initial, email, color, amt, x, y, launched, landed };
  });
  if (out) {
    total = 1175;
    sent = 8;
  }
  const done = sent === 8;
  const pressing = t > press && t < press + 180;
  const sending = t > press && !done;
  return (
    <div ref={wrap} style={{ position: "relative", flex: "1 1 0", minHeight: 0, width: "100%", height: compact ? "clamp(380px, calc(100dvh - 400px), 560px)" : "min(42vh, 420px)", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: compact ? 360 : 1120, height: compact ? 540 : 420, transform: `translate(-50%,-50%) scale(${scale})`, transformOrigin: "center" }}>
        {chips.map((c) => (
          <div
            key={c.email}
            style={{
              position: "absolute", left: "50%", top: "50%", width: compact ? 168 : 240, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 11, padding: "10px 14px 10px 10px", borderRadius: 999,
              background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 14px 34px -14px rgba(40,25,15,0.22)",
              opacity: c.launched && !out ? 1 : 0,
              transform: c.launched ? `translate(calc(-50% + ${c.x}px), calc(-50% + ${c.y}px)) scale(${out ? 0.94 : 1})` : "translate(-50%,-50%) scale(0.6)",
              transition: "transform 1000ms cubic-bezier(.16,1,.3,1), opacity 500ms ease",
            }}
          >
            <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "50%", background: c.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600 }}>{c.initial}</div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "#86868B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{compact ? c.email.split("@")[0] : c.email}</div>
              <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: c.landed ? "#1F9D55" : "#AEAEB2", transition: "color 400ms ease" }}>+${c.amt}</div>
            </div>
            <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: "#1F9D55", display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${c.landed ? 1 : 0})`, opacity: c.landed ? 1 : 0, transition: "transform 420ms cubic-bezier(.3,1.7,.5,1), opacity 200ms ease" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2L5 8.5L9.5 3.5" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        ))}
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 300, transform: "translate(-50%,-50%)", padding: 22, boxSizing: "border-box", borderRadius: 28, background: "#fff", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 40px 80px -24px rgba(40,25,15,0.25), 0 0 0 6px rgba(255,255,255,0.6)", display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#86868B" }}>
            <span className="m">POST /payouts</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: done ? "#1F9D55" : sending ? "#FF9500" : "#C7C7CC", transition: "background 300ms" }} />
              {done ? "Complete" : sending ? "Sending" : "Ready"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums" }}>{usd(total)}</div>
            <div style={{ fontSize: 13, color: "#86868B" }}>{sent} of 8 people paid · USDC</div>
          </div>
          <div style={{ height: 46, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, background: done ? "rgba(31,157,85,0.1)" : "#1D1D1F", color: done ? "#1F9D55" : "#fff", transform: `scale(${pressing ? 0.95 : 1})`, transition: "transform 160ms ease, background 400ms ease, color 400ms ease" }}>
            {done ? "Paid 8 people" : sending ? "Sending…" : "Pay 8 people"}
          </div>
        </div>
      </div>
    </div>
  );
}

function Intro() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(10px,1.8vh,22px)", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#E8461A", letterSpacing: "0.01em" }}>Partner Payouts</div>
        <h1 style={{ margin: 0, fontSize: "clamp(40px,min(8vw,8.5vh),112px)", lineHeight: 0.95, letterSpacing: "-0.05em", fontWeight: 700 }}>
          Pay anyone.<br /><span style={{ color: "#A1A1A6" }}>By email.</span>
        </h1>
        <p style={{ margin: 0, maxWidth: "40em", fontSize: "clamp(16px,min(1.4vw,2.2vh),20px)", lineHeight: 1.5, color: "#6E6E73" }}>
          See how a platform pays hundreds of people in one click, with no accounts, no wallets and no forms for them to fill in. Two minutes, start to finish.
        </p>
      </div>
      <IntroStage />
    </>
  );
}

function Store({ c }: { c: Ctx }) {
  const p = usePhase([500, 1100, 1700, 2300]);
  return (
    <div className="t-stage">
      <Browser url="rally.com">
        <div className="t-pad" style={{ paddingTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 650, fontSize: 18 }}>
            <Mark id={c.s.logo} size={30} />{c.s.brand}
            <span className="mut" style={{ marginLeft: "auto", fontWeight: 500, fontSize: 14.5 }}>Discover &nbsp; Top creators</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "end", margin: "24px 0 8px", flexWrap: "wrap" }}>
            <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1.08 }}>Get paid for the<br /><span style={{ color: c.accent }}>content</span> you make</div>
            <On show={p >= 1}><div style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: "10px 18px" }}><div className="mut" style={{ fontSize: 13.5 }}>Creator fund</div><div style={{ fontSize: 28, fontWeight: 650, letterSpacing: "-0.03em" }}>$1,000</div></div></On>
          </div>
          <div style={{ marginTop: 14 }}>
            {PAYOUTS.slice(0, 4).map((r, i) => (
              <On key={r.h} show={p >= 2} delay={i * 130}>
                <div className="r">
                  <span className="mut" style={{ width: 16, fontWeight: 500 }}>{i + 1}</span>
                  <span className="av" style={{ background: r.c }}>{r.h}</span>
                  <span className="grow">{r.who}</span>
                  <span className="mut" style={{ fontVariantNumeric: "tabular-nums" }}>{(512 - i * 38).toLocaleString()}k views</span>
                </div>
              </On>
            ))}
          </div>
        </div>
      </Browser>
    </div>
  );
}

function Setup({ c }: { c: Ctx }) {
  const p = usePhase([1900, 2700, 3500]);
  const name = useTyped(c.s.brand, 500, 110);
  const fee = useCount(c.s.fee, 2800, 900);
  const pct = useCount(c.s.pct, 2800, 900);
  const amount = 400;
  const f = feeFor({ fee: c.s.fee, pct: c.s.pct }, amount);
  return (
    <div className="t-stage">
      <Browser url="pay.loofta.com/partner/portal" dark>
        <div className="t-pad t-two">
          <div>
            <div className="lbl" style={{ marginTop: 0 }}>Name</div>
            <div className={`field ${name.length < c.s.brand.length ? "caret" : ""}`}>{name}</div>
            <div className="lbl">Logo</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[...LOGOS.filter((l) => l.id !== c.s.logo).slice(0, 3), LOGOS.find((l) => l.id === c.s.logo)!].map((l, i) => (
                <span key={l.id} style={{ padding: 3, borderRadius: 12, border: `2px solid ${p >= 1 && i === 3 ? "#ededef" : "transparent"}`, opacity: p >= 1 && i !== 3 ? 0.35 : 1, transition: "all .4s", display: "inline-flex" }}><Mark id={l.id} size={34} /></span>
              ))}
            </div>
            <div className="lbl">Your fee</div>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>${fee.toFixed(2)}</div>
              <div className="field" style={{ flex: 1 }}>{pct.toFixed(1)}%</div>
            </div>
          </div>
          <On show={p >= 1}>
            <div style={{ background: "#121214", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 18 }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center", fontWeight: 650 }}>
                <Mark id={c.s.logo} size={26} />{c.s.brand}
              </div>
              <div className="mut" style={{ fontSize: 13.5, marginTop: 14 }}>Your payout</div>
              <div style={{ fontSize: 34, fontWeight: 650, letterSpacing: "-0.03em" }}>{usd(amount)}</div>
              <div className={`g ${p >= 2 ? "on" : ""}`} style={{ marginTop: 10, fontSize: 15 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span className="mut">{c.s.brand} fee</span><span>-{usd(f)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.08)", fontWeight: 650 }}><span>You receive</span><span>{usd(amount - f)}</span></div>
              </div>
            </div>
          </On>
        </div>
      </Browser>
    </div>
  );
}

function Wallet() {
  const p = usePhase([700, 1500, 2300]);
  const bal = useCount(2500, 1500, 1400);
  return (
    <div className="t-stage">
      <Browser url="pay.loofta.com/partner/portal" dark>
        <div className="t-pad">
          <div className="lbl" style={{ marginTop: 0 }}>Company wallet</div>
          <div style={{ fontSize: 52, fontWeight: 650, letterSpacing: "-0.04em", lineHeight: 1 }}>{usd(bal)} <span className="mut" style={{ fontSize: 18, fontWeight: 500, letterSpacing: 0 }}>USDC</span></div>
          <On show={p >= 1}>
            <div className="m" style={{ marginTop: 20, background: "#0b0b0d", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, color: "#c9c9d0", wordBreak: "break-all" }}>7xKQ4tPz9mVd2cYhRb8LwNfA3sUeJgX6qTn1oZk9fKp</div>
          </On>
          <On show={p >= 2}>
            <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
              <span style={{ display: "inline-flex", marginRight: 4 }}>
                <span className="av" style={{ background: "#f97316" }}>Y</span>
                <span className="av" style={{ background: "#3b82f6", marginLeft: -8, boxShadow: "0 0 0 2px #0e0e10" }}>D</span>
              </span>
              <span className="mut" style={{ fontSize: 15 }}>2 signers · 1 approval needed</span>
            </div>
          </On>
        </div>
      </Browser>
      <div className={`g ${p >= 3 ? "on" : ""}`} style={{ position: "absolute", right: -6, top: -18, background: "#fff", borderRadius: 14, padding: "10px 16px", boxShadow: "0 18px 40px -10px rgba(0,0,0,.3)", fontWeight: 600, fontSize: 15.5, display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ color: "#1a9d5b" }}>●</span> +$2,500.00 USDC received
      </div>
    </div>
  );
}

function Api({ c }: { c: Ctx }) {
  const n = useCount(14, 300, 3200);
  const L: ReactNode[] = [
    <><span className="k">import</span> {"{ LooftaPayClient }"} <span className="k">from</span> <span className="s">&quot;@loofta/pay-sdk&quot;</span>;</>,
    <>&nbsp;</>,
    <><span className="k">await</span> loofta.partner.<span className="c">createBatch</span>({"{"}</>,
    <>&nbsp;&nbsp;label: <span className="s">&quot;{c.s.brand} creator fund&quot;</span>,</>,
    <>&nbsp;&nbsp;rows: [</>,
    <>&nbsp;&nbsp;&nbsp;&nbsp;{"{ email: "}<span className="s">&quot;mira@example.com&quot;</span>{", amount: 400 },"}</>,
    <>&nbsp;&nbsp;&nbsp;&nbsp;{"{ email: "}<span className="s">&quot;jon@example.com&quot;</span>{", amount: 250 },"}</>,
    <>&nbsp;&nbsp;&nbsp;&nbsp;<span className="mut">...</span></>,
    <>&nbsp;&nbsp;],</>,
    <>{"});"}</>,
  ];
  const shown = Math.floor(n);
  const p = usePhase([3700]);
  return (
    <div className="t-stage">
      <Browser url="your-server.js" dark>
        <div className="code">
          {L.map((l, i) => (
            <div key={i} className={`g ${shown > i ? "on" : ""}`} style={{ transform: shown > i ? "none" : "translateX(-8px)" }}>{l}</div>
          ))}
        </div>
      </Browser>
      <div className={`g ${p >= 1 ? "on" : ""}`} style={{ position: "absolute", right: -4, bottom: -22, background: "#fff", borderRadius: 16, padding: "14px 18px", boxShadow: "0 24px 50px -12px rgba(0,0,0,.35)", minWidth: 250 }}>
        <div style={{ fontWeight: 650, fontSize: 16 }}>Batch created</div>
        <div className="mut" style={{ fontSize: 14.5, margin: "2px 0 8px" }}>5 creators · $1,000.00</div>
        <span className="pillx amber">Waiting for approval</span>
      </div>
    </div>
  );
}

function Approve() {
  const p = usePhase([900, 1500, 2300]);
  const bal = useCount(1500, 2300, 1400, 2500);
  return (
    <div className="t-stage">
      <Browser url="pay.loofta.com/partner/portal" dark>
        <div className="t-pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div><div style={{ fontWeight: 650, fontSize: 18 }}>Summer Quest creator fund</div><div className="mut" style={{ fontSize: 14.5 }}>5 creators · $1,000.00 · created by API</div></div>
            <span className={`pillx ${p >= 3 ? "green" : "amber"}`}>{p >= 3 ? "Paid, emails sent" : "Needs approval"}</span>
          </div>
          <div style={{ margin: "16px 0 4px" }}>
            {PAYOUTS.map((r) => (
              <div key={r.h} className="r" style={{ padding: "9px 0" }}>
                <span className="av" style={{ background: r.c, width: 28, height: 28, fontSize: 12 }}>{r.h}</span>
                <span className="grow" style={{ fontWeight: 500 }}>{r.who}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{usd(r.amt)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12 }}>
            <div className="mut" style={{ fontSize: 15 }}>Wallet <b style={{ color: "#ededef", fontVariantNumeric: "tabular-nums" }}>{usd(bal)}</b></div>
            <div key={p >= 2 ? "x" : "y"} className={`btnx ${p === 2 ? "press" : ""}`} style={{ background: p >= 3 ? "#1f3b2d" : "#ff6a1f", transition: "background .5s", animation: p === 0 ? undefined : p === 2 ? undefined : undefined }}>{p >= 3 ? "Approved" : "Approve and pay"}</div>
          </div>
        </div>
      </Browser>
      {p >= 3 && [-120, -60, 0, 60, 120].map((x, i) => <span key={x} className="env" style={{ ["--x" as string]: `${x}px`, animationDelay: `${i * 0.12}s` }}>✉</span>)}
    </div>
  );
}

function Email({ c }: { c: Ctx }) {
  const p = usePhase([500, 1400]);
  return (
    <div className="t-stage">
      <div className="t-frame" style={{ maxWidth: 520 }}>
        <div className="t-pad">
          <div className="r" style={{ borderTop: 0, paddingTop: 0 }}>
            <Mark id={c.s.logo} size={42} />
            <div className="grow"><div>{c.s.brand} via Loofta</div><div className="mut" style={{ fontSize: 14, fontWeight: 400 }}>To mira@example.com</div></div>
            <span className="mut" style={{ fontSize: 13.5 }}>now</span>
          </div>
          <On show={p >= 1}>
            <div style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em", margin: "8px 0 8px" }}>Your $400 creator payout is ready</div>
            <div className="mut" style={{ fontSize: 16.5, lineHeight: 1.5 }}>Congratulations Mira, you finished #1 in the Summer Quest creator fund with 512,000 views.</div>
          </On>
          <On show={p >= 2} delay={100}>
            <div className="btnx" style={{ background: c.accent, color: c.on, marginTop: 18, animation: "t-pulse 1.8s ease-out 2" }}>Withdraw your payout</div>
          </On>
        </div>
      </div>
    </div>
  );
}

function Withdraw({ c }: { c: Ctx }) {
  const p = usePhase([1300, 2100, 4600, 5400, 6300]);
  const wallet = useTyped("7xKQ4tPz9mVd2cYhRb8LwNfA3sUeJgX6qTn1oZk9fKp", 2300, 38);
  const f = feeFor({ fee: c.s.fee, pct: c.s.pct }, 400);
  const view = p >= 5 ? "sent" : p >= 2 ? "usdc" : "list";
  return (
    <div className="t-stage">
      <Browser url="pay.loofta.com/withdraw" dark>
        <div style={{ zoom: 0.8, position: "relative" }}>
          <WithdrawPage brand={c.s.brand} logo={c.s.logo} fee={f} view={view} enabled={c.s.enabled} hot={p === 1 ? "usdc" : undefined} wallet={view === "usdc" ? wallet : ""} walletFocus />
          {p === 4 && <div className="press" style={{ position: "absolute", left: "50%", bottom: 118, width: 160, height: 44, marginLeft: -80, borderRadius: 16, background: "rgba(255,255,255,.14)" }} />}
        </div>
      </Browser>
    </div>
  );
}

function Earn({ c }: { c: Ctx }) {
  const total = PAYOUTS.reduce((a, r) => a + feeFor({ fee: c.s.fee, pct: c.s.pct }, r.amt), 0);
  const v = useCount(total, 500, 2600);
  const n = Math.min(5, Math.floor(v / (total / 5) + 0.02));
  return (
    <div className="t-stage">
      <div className="t-frame dark">
        <div className="t-pad">
          <div className="lbl" style={{ marginTop: 0 }}>Your fees</div>
          <div style={{ fontSize: 64, fontWeight: 650, letterSpacing: "-0.045em", lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "#5fd49c" }}>{usd(v)}</div>
          <div style={{ marginTop: 18 }}>
            {PAYOUTS.map((r, i) => (
              <On key={r.h} show={n > i}>
                <div className="r" style={{ padding: "8px 0" }}>
                  <span className="av" style={{ background: r.c, width: 28, height: 28, fontSize: 12 }}>{r.h}</span>
                  <span className="grow" style={{ fontWeight: 500 }}>{r.who} withdrew</span>
                  <span style={{ color: "#5fd49c", fontVariantNumeric: "tabular-nums" }}>+{usd(feeFor({ fee: c.s.fee, pct: c.s.pct }, r.amt))}</span>
                </div>
              </On>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- the tour ---------- */

type Step = { tag: string; h: ReactNode; p: string; glow: string; scene: (c: Ctx) => ReactNode; center?: boolean };

export function Tutorial() {
  const setup: Setup = SETUP;
  const c: Ctx = { s: setup, accent: `#${setup.color}`, on: onColor(setup.color) };
  const steps: Step[] = [
    { tag: "", h: null, p: "", glow: "rgba(255,106,31,.14)", scene: () => <Intro />, center: true },
    { tag: "The example", h: <>Meet {setup.brand}.</>, p: `${setup.brand} is a creator platform. Every month the top creators share a fund, and ${setup.brand} wants to pay them without building a payments system.`, glow: "rgba(59,130,246,.12)", scene: (x) => <Store c={x} /> },
    { tag: "1 · Set up", h: <>Make it yours.</>, p: "Add your name, your logo and your own fee. Loofta's withdraw page wears your brand, and you earn on every withdrawal.", glow: "rgba(168,85,247,.13)", scene: (x) => <Setup c={x} /> },
    { tag: "2 · Fund", h: <>Fund one wallet.</>, p: "Send USDC once. Your team controls the wallet and Loofta never holds the keys. Network fees are paid in USDC too.", glow: "rgba(34,197,94,.12)", scene: () => <Wallet /> },
    { tag: "3 · Pay", h: <>One call pays everyone.</>, p: "Your platform sends a batch with the SDK. The key can create payouts but can never move money.", glow: "rgba(15,23,42,.1)", scene: (x) => <Api c={x} /> },
    { tag: "4 · Approve", h: <>Your team approves.</>, p: "One tap releases the whole batch from the wallet. Every creator is emailed the moment it goes through.", glow: "rgba(255,106,31,.13)", scene: () => <Approve /> },
    { tag: "5 · Notify", h: <>They get an email.</>, p: "No signup, no wallet, no forms. It comes from your brand and they sign in with the address it was sent to.", glow: "rgba(236,72,153,.11)", scene: (x) => <Email c={x} /> },
    { tag: "6 · Withdraw", h: <>They cash out on your page.</>, p: "This is the real Loofta withdraw page, with your name and logo on it. Bank, card, USDC, Wise, PayPal and more. Every fee is shown before they confirm, and you build none of it.", glow: "rgba(59,130,246,.12)", scene: (x) => <Withdraw c={x} /> },
    { tag: "7 · Earn", h: <>You earn on every withdrawal.</>, p: "The fee you set goes to you each time a creator cashes out. Loofta's own fee is separate and shown to them up front.", glow: "rgba(34,197,94,.13)", scene: (x) => <Earn c={x} /> },
  ];
  const total = steps.length + 1;
  const [i, setI] = useState(0);
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(total - 1, n))), [total]);
  // ?s=3 opens a given step, so a step can be linked.
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("s"));
    if (Number.isFinite(n) && n > 0) setI(Math.min(total - 1, Math.floor(n)));
  }, [total]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(i + 1); }
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [i, go]);

  const end = i === total - 1;
  const s = steps[i];
  return (
    <div className={`tt ${sans.variable} ${mono.variable} ${sora.variable}`}>
      <div className="t-glow" style={{ background: `radial-gradient(900px 520px at 50% 105%, rgba(255,150,110,0.22), rgba(255,150,110,0) 70%), radial-gradient(700px 500px at 92% 0%, rgba(255,196,170,0.28), rgba(255,196,170,0) 70%), radial-gradient(60% 50% at 75% 30%, ${end ? "rgba(255,106,31,.10)" : s.glow}, transparent 70%)` }} />
      <div className="t-top">
        <a href="/partner" aria-label="Loofta partners" style={{ padding: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/loofta.svg" alt="Loofta" style={{ height: 26, width: "auto", display: "block" }} /></a>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <a href={STORE_HREF}>Example store</a>
          <a className="pill" href={PORTAL_HREF}>Try now</a>
        </span>
      </div>
      <div className="t-body">
        {end ? (
          <div key="end" className="t-step center">
            <div>
              <div className="t-eyebrow" style={{ color: c.accent }}>That is all of it</div>
              <h2 className="t-h">Now try it yourself.</h2>
              <p className="t-p" style={{ margin: "0 auto" }}>Create your partner account, set your name, logo and fee, and send your first batch. It takes a few minutes.</p>
              <div className="t-row">
                <a href={PORTAL_HREF} className="t-btn big accent">Try now</a>
                <a href={STORE_HREF} className="t-btn big light">See the example store</a>
              </div>
              <div className="t-row" style={{ marginTop: 14 }}>
                <button className="t-btn light" onClick={() => go(0)}>Watch again</button>
              </div>
            </div>
          </div>
        ) : (
          <div key={i} className={`t-step ${s.center ? "center" : ""}`}>
            {s.center ? (
              s.scene(c)
            ) : (
              <>
                <div>
                  <div className="t-eyebrow" style={{ color: c.accent }}>{s.tag}</div>
                  <h2 className="t-h">{s.h}</h2>
                  <p className="t-p">{s.p}</p>
                </div>
                {s.scene(c)}
              </>
            )}
          </div>
        )}
      </div>
      <div className="t-bar">
        <div className="t-count">{i + 1} / {total}</div>
        <div className="t-dots">
          {Array.from({ length: total }).map((_, n) => <button key={n} aria-label={`Step ${n + 1}`} className={n === i ? "on" : ""} onClick={() => go(n)} />)}
        </div>
        <div className="stats3" style={{ marginTop: 0, visibility: i === 0 ? "visible" : "hidden" }}>
          <div><b>1 call</b><span>pays everyone</span></div>
          <div><b>0</b><span>accounts to create</span></div>
          <div><b>Your fee</b><span>on every withdrawal</span></div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end" }}>
          <span className="t-key">Use the arrow keys</span>
          {i > 0 && <button className="t-btn light" onClick={() => go(i - 1)}>Back</button>}
          {!end && <button className="t-btn" onClick={() => go(i + 1)}>{i === 0 ? "Start the tutorial" : "Next"}</button>}
        </div>
      </div>
    </div>
  );
}
