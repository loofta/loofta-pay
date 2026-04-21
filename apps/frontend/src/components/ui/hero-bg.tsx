'use client'

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

// ─── Particle network canvas ────────────────────────────────────────────────

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
}

export function ParticleNet({
  count = 55,
  linkDist = 130,
  className,
}: {
  count?: number;
  linkDist?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();

    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    const dots: Dot[] = Array.from({ length: count }, () => ({
      x: Math.random() * W(),
      y: Math.random() * H(),
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r: Math.random() * 1.6 + 0.8,
      alpha: Math.random() * 0.45 + 0.2,
    }));

    const frame = () => {
      ctx.clearRect(0, 0, W(), H());
      const w = W(), h = H();

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;

        // dot
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 100, 20, ${d.alpha})`;
        ctx.fill();

        // connections
        for (let j = i + 1; j < dots.length; j++) {
          const d2 = dots[j];
          const dx = d.x - d2.x, dy = d.y - d2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < linkDist) {
            const a = (1 - dist / linkDist) * 0.28;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d2.x, d2.y);
            ctx.strokeStyle = `rgba(255, 70, 10, ${a})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(frame);
    };

    frame();

    const onResize = () => { resize(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [count, linkDist]);

  return (
    <canvas
      ref={ref}
      className={`absolute inset-0 w-full h-full ${className ?? ""}`}
      style={{ opacity: 0.7 }}
    />
  );
}

// ─── Drifting gradient orbs ─────────────────────────────────────────────────

const ORB_VARIANTS = [
  {
    color: "radial-gradient(ellipse, rgba(255,19,1,0.22) 0%, transparent 70%)",
    size: 700,
    initial: { x: "-10%", y: "-20%" },
    animate: { x: ["−10%", "8%", "−5%", "−10%"], y: ["−20%", "5%", "18%", "−20%"] },
    duration: 22,
  },
  {
    color: "radial-gradient(ellipse, rgba(234,179,8,0.16) 0%, transparent 70%)",
    size: 560,
    initial: { x: "55%", y: "50%" },
    animate: { x: ["55%", "68%", "45%", "55%"], y: ["50%", "35%", "62%", "50%"] },
    duration: 28,
  },
  {
    color: "radial-gradient(ellipse, rgba(255,80,10,0.14) 0%, transparent 70%)",
    size: 420,
    initial: { x: "30%", y: "70%" },
    animate: { x: ["30%", "18%", "42%", "30%"], y: ["70%", "55%", "80%", "70%"] },
    duration: 18,
  },
];

export function DriftingOrbs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {ORB_VARIANTS.map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: orb.size,
            height: orb.size,
            background: orb.color,
            filter: "blur(60px)",
            top: 0,
            left: 0,
          }}
          initial={orb.initial as any}
          animate={orb.animate as any}
          transition={{
            duration: orb.duration,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// ─── Perspective scrolling grid ─────────────────────────────────────────────

export function PerspectiveGrid({ opacity = 0.18 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ perspective: "220px", opacity }}
    >
      <div
        className="absolute inset-0 animate-grid"
        style={{
          transform: "rotateX(62deg)",
          transformOrigin: "50% 0",
          backgroundImage:
            "linear-gradient(to right, rgba(255,80,10,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,80,10,0.35) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          width: "200%",
          height: "300%",
          marginLeft: "-50%",
          marginTop: "-10%",
        }}
      />
      {/* Fade out at top and bottom */}
      <div className="absolute inset-0" style={{
        background: "linear-gradient(to bottom, #0f0f12 0%, transparent 30%, transparent 65%, #0f0f12 100%)",
      }} />
    </div>
  );
}

// ─── Floating payment bubbles ───────────────────────────────────────────────
// Musical timing: bubbles arrive in pairs/triplets with breathing room between.
// Sizes vary — larger bubbles carry more visual weight.
// Eased vertical movement: slow start → cruise → slow fade at top.

type Bubble = {
  amount: string; to: string; confirmed?: boolean;
  left: string; top: string; travel: number; dur: number;
  drift: number; delay: number; lg?: boolean;
};

const BUBBLES: Bubble[] = [
  // Left edge cluster
  { amount: "$2,400", to: "@rina",   left: "1%",  top: "60%", travel: 780, dur: 16, drift:  6, delay: 0,   lg: true },
  { amount: "$50",    to: "@mika",   left: "3%",  top: "78%", travel: 940, dur: 13, drift:  4, delay: 1.4          },
  { amount: "$300",   to: "@jess",   left: "10%", top: "40%", travel: 560, dur: 15, drift:  5, delay: 5.0          },
  // Right edge cluster
  { amount: "$1,200", to: "@neo",    confirmed: true,
                                     left: "78%", top: "55%", travel: 700, dur: 14, drift: -5, delay: 3.5, lg: true },
  { amount: "$88",    to: "@arturo", left: "83%", top: "72%", travel: 860, dur: 11, drift: -4, delay: 4.8          },
  { amount: "$500",   to: "@lucas",  left: "88%", top: "32%", travel: 440, dur: 12, drift: -6, delay: 8.0, lg: true },
];

// Easing: slow lift → cruise → fade — feels like floating, not falling
const RISE_EASE = [0.2, 0, 0.8, 1] as const;

function BubbleDark({ b }: { b: Bubble }) {
  return (
    <motion.div
      className={`absolute flex items-center gap-2 rounded-full border border-white/[0.13] bg-[#14141c]/75 backdrop-blur-md whitespace-nowrap ${b.lg ? "px-4 py-2.5" : "px-3 py-1.5"}`}
      style={{
        left: b.left, top: b.top,
        boxShadow: "0 4px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.07)",
      }}
      initial={{ y: 0, x: 0, opacity: 0, scale: 0.82 }}
      animate={{
        y:       [0, -b.travel * 0.12, -b.travel],
        x:       [0, b.drift * 0.4, b.drift, b.drift * 0.3, -b.drift * 0.2, 0],
        opacity: [0, 1, 1, 0.85, 0],
        scale:   [0.82, 1.04, 1, 1, 0.96],
      }}
      transition={{
        duration: b.dur, delay: b.delay, repeat: Infinity,
        ease: RISE_EASE,
        times: [0, 0.06, 1],
        x:       { duration: b.dur, delay: b.delay, ease: "easeInOut", repeat: Infinity, times: [0, 0.2, 0.5, 0.7, 0.9, 1] },
        opacity: { duration: b.dur, delay: b.delay, ease: "linear",    repeat: Infinity, times: [0, 0.07, 0.6, 0.9, 1] },
        scale:   { duration: b.dur, delay: b.delay, ease: "easeOut",   repeat: Infinity, times: [0, 0.09, 0.25, 0.7, 1] },
      }}
    >
      <span className="flex-shrink-0 w-2 h-2 rounded-full" style={{ background: "#22d3ee", boxShadow: "0 0 7px #22d3ee99" }} />
      <span className={`font-semibold text-white/85 ${b.lg ? "text-[13px]" : "text-[11px]"}`}>{b.amount}</span>
      <span className="text-white/20 text-[10px]">→</span>
      <span className={`text-slate-500 ${b.lg ? "text-[13px]" : "text-[11px]"}`}>{b.to}</span>
      {b.confirmed && (
        <span className="flex items-center justify-center w-4 h-4 rounded-full text-[9px]" style={{ background: "linear-gradient(135deg,#FF1301,#EAB308)" }}>✓</span>
      )}
    </motion.div>
  );
}

export function FloatingPayments() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {BUBBLES.map((b) => <BubbleDark key={b.to} b={b} />)}
    </div>
  );
}

// ─── Light-theme floating payment bubbles ───────────────────────────────────

function BubbleLight({ b }: { b: Bubble }) {
  return (
    <motion.div
      className={`absolute flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/90 backdrop-blur-md whitespace-nowrap ${b.lg ? "px-4 py-2.5" : "px-3 py-1.5"}`}
      style={{
        left: b.left, top: b.top,
        boxShadow: "0 2px 20px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)",
      }}
      initial={{ y: 0, x: 0, opacity: 0, scale: 0.82 }}
      animate={{
        y:       [0, -b.travel * 0.12, -b.travel],
        x:       [0, b.drift * 0.4, b.drift, b.drift * 0.3, -b.drift * 0.2, 0],
        opacity: [0, 1, 1, 0.85, 0],
        scale:   [0.82, 1.04, 1, 1, 0.96],
      }}
      transition={{
        duration: b.dur, delay: b.delay, repeat: Infinity,
        ease: RISE_EASE,
        times: [0, 0.06, 1],
        x:       { duration: b.dur, delay: b.delay, ease: "easeInOut", repeat: Infinity, times: [0, 0.2, 0.5, 0.7, 0.9, 1] },
        opacity: { duration: b.dur, delay: b.delay, ease: "linear",    repeat: Infinity, times: [0, 0.07, 0.6, 0.9, 1] },
        scale:   { duration: b.dur, delay: b.delay, ease: "easeOut",   repeat: Infinity, times: [0, 0.09, 0.25, 0.7, 1] },
      }}
    >
      <span className="flex-shrink-0 w-2 h-2 rounded-full" style={{ background: "#06b6d4", boxShadow: "0 0 7px #06b6d499" }} />
      <span className={`font-semibold text-slate-800 ${b.lg ? "text-[13px]" : "text-[11px]"}`}>{b.amount}</span>
      <span className="text-slate-300 text-[10px]">→</span>
      <span className={`text-slate-400 ${b.lg ? "text-[13px]" : "text-[11px]"}`}>{b.to}</span>
      {b.confirmed && (
        <span className="flex items-center justify-center w-4 h-4 rounded-full text-[9px] text-white" style={{ background: "linear-gradient(135deg,#FF1301,#EAB308)" }}>✓</span>
      )}
    </motion.div>
  );
}

export function FloatingPaymentsLight() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {BUBBLES.map((b) => <BubbleLight key={b.to} b={b} />)}
    </div>
  );
}

// ─── Dot grid (static, subtle) ──────────────────────────────────────────────

export function DotGrid({ opacity = 0.12 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,100,20,0.55) 1px, transparent 1px)",
        backgroundSize: "36px 36px",
        opacity,
      }}
    />
  );
}
