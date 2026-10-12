"use client";

import { useEffect, useRef, useState } from "react";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import { useAuth } from "@/hooks/useAuth";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

const POINTS = ["Minimum KYC", "$30 one-time fee", "Private spending", "Unlimited daily spend"];

function MastercardMark() {
  return (
    <svg width="54" height="34" viewBox="0 0 54 30" style={{ flex: "none" }} aria-hidden>
      <circle cx="19" cy="15" r="15" fill="#EB001B" />
      <circle cx="35" cy="15" r="15" fill="#F79E1B" />
      <path d="M27 2.31A15 15 0 0 1 27 27.69A15 15 0 0 1 27 2.31Z" fill="#FF5F00" />
    </svg>
  );
}

export function LooftaCardDetail() {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const motion = useRef({ rx: 0, ry: 0, base: 0, flipped: false });
  const [flipped, setFlipped] = useState(false);
  const { email: accountEmail } = useAuth();
  const [email, setEmail] = useState("");
  const seededEmail = useRef(false);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (seededEmail.current || !accountEmail) return;
    seededEmail.current = true;
    setEmail(accountEmail);
  }, [accountEmail]);

  useEffect(() => {
    motion.current.flipped = flipped;
  }, [flipped]);

  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const m = motion.current;
      const px = pointer.current.x;
      const py = pointer.current.y;
      const targetY = px != null ? px * 34 : Math.sin(t * 0.7) * 14;
      const targetX = py != null ? -py * 24 : 6 + Math.cos(t * 0.55) * 5;
      m.rx += (targetX - m.rx) * 0.08;
      m.ry += (targetY - m.ry) * 0.08;
      m.base += ((m.flipped ? 180 : 0) - m.base) * 0.09;
      const fy = Math.sin(t * 1.1) * 8;
      const card = cardRef.current;
      if (card) {
        card.style.transform = `translateY(${fy}px) rotateX(${m.rx}deg) rotateY(${m.base + m.ry}deg)`;
        const face = ((m.base + m.ry) % 360 + 360) % 360;
        const gx = 50 + (face > 90 && face < 270 ? -1 : 1) * m.ry * 2.2;
        const gy = 40 - m.rx * 3;
        card.style.setProperty("--gx", `${gx}%`);
        card.style.setProperty("--gy", `${gy}%`);
      }
      const shadow = shadowRef.current;
      if (shadow) {
        shadow.style.transform = `scaleX(${1 - fy / 60})`;
        shadow.style.opacity = String(0.55 + fy / 40);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    const res = await fetch("/api/card/early-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      setStatus("error");
      setError(typeof data?.error === "string" ? data.error : "Could not save your application. Try again.");
      return;
    }
    setStatus("done");
  }

  return (
    <div className={`loofta-app ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif", color: "#F2EFE8", minHeight: "100vh", background: "radial-gradient(900px 560px at 30% 40%,rgba(255,74,18,0.16),rgba(255,74,18,0) 70%),#0B0B0E" }}>
      <div style={{ width: "100%", maxWidth: 1160, margin: "0 auto", padding: "clamp(32px,6vw,72px) clamp(16px,4vw,40px) 140px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: "clamp(32px,5vw,64px)", alignItems: "center" }}>
        <div
          ref={stageRef}
          onPointerMove={(e) => {
            const r = stageRef.current?.getBoundingClientRect();
            if (!r) return;
            pointer.current = { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 };
          }}
          onPointerLeave={() => { pointer.current = { x: null, y: null }; }}
          onClick={() => setFlipped((v) => !v)}
          style={{ cursor: "pointer", position: "relative", display: "grid", placeItems: "center", minHeight: "clamp(340px,48vw,520px)", perspective: 1300, touchAction: "none" }}
        >
          <div ref={shadowRef} style={{ position: "absolute", left: "50%", bottom: "6%", width: "min(360px,70vw)", height: 40, marginLeft: "calc(min(360px,70vw) / -2)", borderRadius: "50%", background: "radial-gradient(closest-side,rgba(0,0,0,0.7),rgba(0,0,0,0))", filter: "blur(6px)" }} />
          <div ref={cardRef} style={{ position: "relative", width: "min(420px,82vw)", aspectRatio: "1.586", transformStyle: "preserve-3d", willChange: "transform" }}>
            {[ -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4 ].map((z) => (
              <div key={z} style={{ position: "absolute", inset: 0, borderRadius: 22, background: "#9C2802", transform: `translateZ(${z}px)` }} />
            ))}
            <div style={{ position: "absolute", inset: 0, borderRadius: 22, overflow: "hidden", transform: "translateZ(3px)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", color: "#fff" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 120% at 15% 0%,#FFB27A 0%,#FF5A1A 38%,#D23806 72%,#7A1E04 100%)" }} />
              <div style={{ position: "absolute", right: "-30%", top: "-60%", width: "90%", height: "160%", borderRadius: "50%", background: "radial-gradient(closest-side,rgba(245,183,12,0.55),rgba(245,183,12,0))" }} />
              <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(255,255,255,0) 0px,rgba(255,255,255,0) 14px,rgba(255,255,255,0.035) 15px,rgba(255,255,255,0) 16px)" }} />
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at var(--gx,30%) var(--gy,20%),rgba(255,255,255,0.42),rgba(255,255,255,0) 42%)", mixBlendMode: "overlay" }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: 22, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45),inset 0 -2px 6px rgba(0,0,0,0.25)" }} />
              <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "7% 7.5%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <img src="/loofta-white.svg" alt="loofta" style={{ height: "clamp(22px,5vw,30px)" }} />
                  <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: "clamp(9px,2vw,11px)", letterSpacing: "0.22em", opacity: 0.85 }}>VIRTUAL</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ position: "relative", width: "15%", aspectRatio: "1.3", borderRadius: 7, background: "linear-gradient(135deg,#FFF0B8 0%,#E8B64A 35%,#B8801E 65%,#F1D27A 100%)", boxShadow: "inset 0 0 0 1px rgba(90,50,0,0.35),0 1px 2px rgba(0,0,0,0.3)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "33%", height: 1, background: "rgba(90,50,0,0.45)" }} />
                    <div style={{ position: "absolute", left: 0, right: 0, top: "66%", height: 1, background: "rgba(90,50,0,0.45)" }} />
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: "38%", width: 1, background: "rgba(90,50,0,0.45)" }} />
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: "62%", width: 1, background: "rgba(90,50,0,0.45)" }} />
                  </div>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.85 }} aria-hidden>
                    <path d="M8.5 7.5a6.5 6.5 0 0 1 0 9" />
                    <path d="M12 5a10 10 0 0 1 0 14" />
                    <path d="M15.5 2.5a13.5 13.5 0 0 1 0 19" />
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: "clamp(14px,3.6vw,21px)", letterSpacing: "0.12em", textShadow: "0 1px 1px rgba(0,0,0,0.25)" }}>•••• •••• •••• 4821</span>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
                    <div style={{ display: "flex", gap: "clamp(16px,4vw,28px)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", opacity: 0.7 }}>CARDHOLDER</span>
                        <span style={{ fontFamily: SORA, fontWeight: 600, fontSize: "clamp(11px,2.6vw,14px)", letterSpacing: "0.06em" }}>YOUR NAME</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", opacity: 0.7 }}>EXPIRES</span>
                        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: "clamp(11px,2.6vw,14px)" }}>••/••</span>
                      </div>
                    </div>
                    <MastercardMark />
                  </div>
                </div>
              </div>
            </div>
            <div style={{ position: "absolute", inset: 0, borderRadius: 22, overflow: "hidden", transform: "rotateY(180deg) translateZ(3px)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", color: "#fff" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 120% at 85% 0%,#FF8A4A 0%,#E2440C 45%,#8E2205 100%)" }} />
              <div style={{ position: "absolute", left: 0, right: 0, top: "12%", height: "19%", background: "linear-gradient(180deg,#141414,#050505)" }} />
              <div style={{ position: "relative", height: "100%", boxSizing: "border-box", padding: "39% 7.5% 7%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: "clamp(28px,7vw,38px)", borderRadius: 5, background: "repeating-linear-gradient(-45deg,#F4F1EA 0 6px,#E6E1D6 6px 12px)" }} />
                  <div style={{ flex: "none", padding: "6px 12px", borderRadius: 6, background: "#fff", color: "#0B0B0E", fontFamily: MONO, fontWeight: 700, fontSize: "clamp(13px,3vw,16px)", letterSpacing: "0.1em" }}>•••</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
                  <span style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.8, maxWidth: "62%" }}>Virtual card for online and in-app payments. Spends from your Loofta balance.</span>
                  <MastercardMark />
                </div>
              </div>
            </div>
          </div>
          <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", fontSize: 14, fontWeight: 600, color: "#6E6C78" }}>Move to tilt · tap to flip</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.2em", color: "#FF8A4A" }}>LOOFTA CARD</span>
              <span style={{ padding: "5px 10px", borderRadius: 999, background: "rgba(255,122,42,0.14)", color: "#FF8A4A", fontWeight: 800, fontSize: 13, letterSpacing: "0.08em" }}>COMING SOON</span>
            </div>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: "clamp(36px,5.4vw,58px)", letterSpacing: "-0.05em", lineHeight: 1, textWrap: "balance" }}>
              Get your Loofta card <span style={{ color: "#6E6C78" }}>and spend privately.</span>
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            {POINTS.map((point) => (
              <div key={point} style={{ padding: "18px 16px", borderRadius: 20, background: "#141419", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 16, letterSpacing: "-0.03em" }}>{point}</span>
              </div>
            ))}
          </div>

          <form onSubmit={apply} style={{ padding: 22, borderRadius: 26, background: "#141419", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.03em" }}>Apply for early access</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: "#9A98A3" }}>Leave your email. We’ll write when the card opens.</span>
            </div>
            {status === "done" ? (
              <span style={{ padding: "14px 16px", borderRadius: 16, background: "rgba(60,200,120,0.14)", color: "#5FD38E", fontWeight: 700, fontSize: 15 }}>You’re on the list.</span>
            ) : (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#8A8893" }}>Email</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required maxLength={200} style={{ width: "100%", boxSizing: "border-box", padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "#0E0E12", color: "#F2EFE8", font: "inherit", fontSize: 16 }} />
                </label>
                {status === "error" && <span style={{ fontSize: 14, fontWeight: 700, color: "#FF8A4A" }}>{error}</span>}
                <button type="submit" disabled={status === "saving"} style={{ cursor: status === "saving" ? "wait" : "pointer", border: 0, padding: "14px 16px", borderRadius: 16, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontWeight: 800, fontSize: 15 }}>
                  {status === "saving" ? "Sending…" : "Apply for early access"}
                </button>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
