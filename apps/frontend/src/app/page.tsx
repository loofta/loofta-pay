"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Sparkles, X, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const AT = String.fromCharCode(64);
const CONTACT_EMAIL = `hello${AT}loofta.xyz`;
const BRAND_GRADIENT_DIAG = "bg-gradient-to-br from-[#FF1301] via-[#FF6A00] to-[#EAB308]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

const easeBrand = [0.16, 1, 0.3, 1] as const;

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.9, ease: easeBrand },
};

/* =====================================================
   VIDEO MODAL
   ===================================================== */

function VideoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (open) {
      videoRef.current?.play();
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.25, ease: easeBrand }}
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              ref={videoRef}
              src="/videos/twitter-clip-v2.mp4"
              className="w-full"
              controls
              playsInline
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* =====================================================
   HEADER
   ===================================================== */

function Header({ onHowItWorks }: { onHowItWorks: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", on);
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 flex items-center justify-between transition-all duration-300 ${scrolled
        ? "border-b border-white/5 bg-[#0c0c0e]/70 px-8 py-3.5 backdrop-blur-xl"
        : "border-b border-transparent px-10 py-5"
        }`}
    >
      <div className="flex items-center gap-10">
        <Link href="/">
          <Image src="/loofta_white.svg" alt="Loofta" width={110} height={24} priority />
        </Link>
        <nav className="hidden gap-1 md:flex">
          {([
            { label: "Pay & Receive", href: "#pay-receive" },
            { label: "Features", href: "#features" },
            { label: "Privacy", href: "#privacy" },
            { label: "Earn", href: "#earn" },
            { label: "Business", href: "#business" },
            { label: "Stack", href: "#stack" },
          ] as const).map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="cursor-pointer px-3 py-2 font-grotesk text-sm text-slate-400 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href={APP_URL}
          className={`group inline-flex items-center gap-2.5 rounded-full px-5 py-3 font-display text-sm font-medium text-white shadow-[0_20px_50px_-15px_rgba(255,19,1,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-15px_rgba(255,19,1,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] ${BRAND_GRADIENT}`}
        >
          Launch app
          <ArrowRight className="h-[15px] w-[15px]" strokeWidth={2} />
        </Link>
      </div>
    </header>
  );
}

/* =====================================================
   HERO — draggable card stack
   ===================================================== */

type Mode = "receive" | "send";

type HeroCard = {
  amount: string;
  person: string;
  sub: string;
  meta: string;
  status: string;
  statusColor: string;
  time: string;
  avatarLetter: string;
  avatarBg: string;
};

type Pose = { x: number; y: number; rot: number; scale: number; opacity: number; blur: number };

function HeroReceiptCard({
  card,
  pose,
  z,
  dragHandlers,
  isDragged,
  isFront,
}: {
  card: HeroCard;
  pose: Pose;
  z: number;
  dragHandlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
  isDragged: boolean;
  isFront: boolean;
}) {
  return (
    <div
      onMouseDown={isFront ? dragHandlers.onMouseDown : undefined}
      onTouchStart={isFront ? dragHandlers.onTouchStart : undefined}
      className="absolute w-[320px] select-none rounded-[22px] border border-white/10 bg-gradient-to-b from-[#222228]/95 to-[#121216]/95 p-[22px] backdrop-blur-xl"
      style={{
        top: "50%",
        left: "50%",
        zIndex: z,
        transform: `translate(calc(-50% + ${pose.x}px), calc(-50% + ${pose.y}px)) rotate(${pose.rot}deg) scale(${pose.scale})`,
        opacity: pose.opacity,
        filter: pose.blur ? `blur(${pose.blur}px)` : "none",
        transformOrigin: "50% 50%",
        transition: isDragged
          ? "none"
          : "transform 1100ms cubic-bezier(.22,1,.36,1), opacity 700ms cubic-bezier(.22,1,.36,1), filter 700ms linear",
        boxShadow: isDragged
          ? "0 50px 120px -20px rgba(0,0,0,.9), 0 0 40px rgba(255,19,1,.3), inset 0 1px 0 rgba(255,255,255,.1)"
          : "0 40px 90px -20px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.08)",
        cursor: isFront ? (isDragged ? "grabbing" : "grab") : "default",
        touchAction: isFront ? "none" : "auto",
      }}
    >
      <div className="mb-[18px] flex items-center justify-between">
        <span
          className="inline-flex items-center gap-[7px] rounded-full py-1 pl-[9px] pr-[11px] font-grotesk text-[12px] font-semibold"
          style={{
            color: card.statusColor,
            background: `${card.statusColor}14`,
            border: `1px solid ${card.statusColor}35`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: card.statusColor, boxShadow: `0 0 10px ${card.statusColor}` }}
          />
          {card.status}
        </span>
        <span className="font-grotesk text-[11px] text-slate-500">{card.time}</span>
      </div>
      <div className="mb-1 font-display text-[48px] font-medium leading-none tracking-[-0.025em] tabular-nums text-white">
        {card.amount}
      </div>
      <div className="mb-[18px] font-grotesk text-[13px] italic text-slate-400">"{card.meta}"</div>
      <div className="flex items-center gap-2.5 border-t border-white/[0.06] pt-2.5">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full font-display text-[13px] font-medium text-white"
          style={{ background: card.avatarBg }}
        >
          {card.avatarLetter}
        </div>
        <div className="font-grotesk text-[13px] leading-tight">
          <div className="font-medium text-white">{card.person}</div>
          <div className="text-[11px] text-slate-500">{card.sub}</div>
        </div>
      </div>
    </div>
  );
}

function HeroStack({ mode }: { mode: Mode }) {
  const receiveCards: HeroCard[] = [
    { amount: "$2,500", person: "XYZ Foundation", sub: "Hackathon prize", meta: "Congrats on winning Radar 🏆", status: "RECEIVED", statusColor: "#34D399", time: "just now", avatarLetter: "◎", avatarBg: "linear-gradient(135deg, #14F195, #9945FF)" },
    { amount: "$890", person: "Straipe", sub: "Payout · bank 🏦", meta: "October subscription", status: "RECEIVED", statusColor: "#34D399", time: "18s ago", avatarLetter: "S", avatarBg: "linear-gradient(135deg, #635BFF, #00D4FF)" },
    { amount: "$75", person: "@jpegmafia", sub: "Tipped on X", meta: "loved your latest post 🔥", status: "RECEIVED", statusColor: "#34D399", time: "1m ago", avatarLetter: "𝕏", avatarBg: "linear-gradient(135deg, #0F172A, #475569)" },
    { amount: "€450", person: "Helena Bauer 🇩🇪", sub: "Paid from Revolut", meta: "Community manager — Week 42", status: "RECEIVED", statusColor: "#34D399", time: "3m ago", avatarLetter: "H", avatarBg: "linear-gradient(135deg, #3B82F6, #8B5CF6)" },
    { amount: "$1,200", person: "Mirror.xyz", sub: "Video collab on X", meta: "Sponsored post + edit", status: "RECEIVED", statusColor: "#34D399", time: "5m ago", avatarLetter: "M", avatarBg: "linear-gradient(135deg, #F59E0B, #EF4444)" },
  ];
  const sendCards: HeroCard[] = [
    { amount: "€180", person: "Léa Martin 🇫🇷", sub: "Sent to Revolut", meta: "Community mod bonus", status: "SENT", statusColor: "#60A5FA", time: "just now", avatarLetter: "L", avatarBg: "linear-gradient(135deg, #60A5FA, #3B82F6)" },
    { amount: "$420", person: "@motiondesigner", sub: "Sent via X handle", meta: "launch video — amazing work 🎬", status: "SENT", statusColor: "#60A5FA", time: "20s ago", avatarLetter: "𝕏", avatarBg: "linear-gradient(135deg, #A855F7, #EC4899)" },
    { amount: "£95", person: "Tom Ellis 🇬🇧", sub: "Sent to Wise", meta: "logo redesign · round 2", status: "SENT", statusColor: "#60A5FA", time: "1m ago", avatarLetter: "T", avatarBg: "linear-gradient(135deg, #14F195, #06B6D4)" },
    { amount: "$1,500", person: "winner@radar.so", sub: "Hackathon prize · unclaimed", meta: "🏆 Congrats! Claim within 7 days", status: "PENDING", statusColor: "#EAB308", time: "3m ago", avatarLetter: "@", avatarBg: "linear-gradient(135deg, #F59E0B, #EF4444)" },
    { amount: "$35", person: "@mia", sub: "Sent to Venmo", meta: "coffee on me ☕", status: "SENT", statusColor: "#60A5FA", time: "5m ago", avatarLetter: "V", avatarBg: "linear-gradient(135deg, #3B82F6, #1E40AF)" },
  ];
  const cards = mode === "send" ? sendCards : receiveCards;

  const [front, setFront] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [throwing, setThrowing] = useState<{ x: number; y: number; rot: number } | null>(null);

  useEffect(() => {
    if (drag || throwing) return;
    const id = setInterval(() => setFront((f) => (f + 1) % cards.length), 2400);
    return () => clearInterval(id);
  }, [cards.length, drag, throwing]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDrag({ x: 0, y: 0, startX: e.clientX, startY: e.clientY });
  };
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    setDrag({ x: 0, y: 0, startX: t.clientX, startY: t.clientY });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (clientX: number, clientY: number) => {
      setDrag((d) => (d ? { ...d, x: clientX - d.startX, y: clientY - d.startY } : null));
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    };
    const onEnd = () => {
      setDrag((cur) => {
        if (!cur) return null;
        const dist = Math.hypot(cur.x, cur.y);
        if (dist > 120) {
          const mag = 900 / Math.max(1, dist);
          const throwX = cur.x * mag * 0.9;
          const throwY = cur.y * mag * 0.9;
          const throwRot = cur.x * 0.08;
          setThrowing({ x: throwX, y: throwY, rot: throwRot });
          setTimeout(() => {
            setFront((f) => (f + 1) % cards.length);
            setThrowing(null);
          }, 500);
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchend", onEnd);
    };
  }, [drag, cards.length]);

  const getPose = (i: number): Pose => {
    const n = cards.length;
    let d = (i - front + n) % n;
    if (d > n / 2) d -= n;

    if (d === 0) {
      if (throwing) return { x: throwing.x, y: throwing.y, rot: throwing.rot, scale: 0.9, opacity: 0, blur: 3 };
      if (drag) {
        const rotation = drag.x * 0.08;
        return { x: drag.x, y: drag.y + 20, rot: -1 + rotation, scale: 1.02, opacity: 1, blur: 0 };
      }
      return { x: 0, y: 20, rot: -1, scale: 1, opacity: 1, blur: 0 };
    }
    if (d === 1) return { x: 95, y: -30, rot: 6, scale: 0.94, opacity: 0.85, blur: 0 };
    if (d === 2) return { x: 175, y: -85, rot: 12, scale: 0.86, opacity: 0.55, blur: 2 };
    if (d === -1) return { x: -140, y: -280, rot: -22, scale: 0.82, opacity: 0, blur: 5 };
    return { x: -180, y: -360, rot: -26, scale: 0.78, opacity: 0, blur: 7 };
  };

  const dragHandlers = { onMouseDown, onTouchStart };

  return (
    <div className="relative h-[540px] w-full">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[70px]"
        style={{ background: "radial-gradient(ellipse, rgba(255,19,1,.32), transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[260px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.06]"
        style={{ transform: "translate(-50%, -50%) rotate(-8deg)" }}
      />

      {cards.map((c, i) => {
        const pose = getPose(i);
        const n = cards.length;
        let d = (i - front + n) % n;
        if (d > n / 2) d -= n;
        const z = 10 - Math.abs(d);
        const isFront = d === 0;
        const isDragged = isFront && !!drag;
        return (
          <HeroReceiptCard
            key={`${mode}-${i}`}
            card={c}
            pose={pose}
            z={z}
            dragHandlers={dragHandlers}
            isDragged={isDragged}
            isFront={isFront}
          />
        );
      })}

      {!drag && !throwing && (
        <div className="pointer-events-none absolute left-1/2 top-4 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 font-grotesk text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
          drag to flick →
        </div>
      )}

      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
        {cards.map((_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === front ? 20 : 6,
              background: i === front ? "linear-gradient(90deg, #FF1301, #EAB308)" : "rgba(255,255,255,.18)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Hero({ onHowItWorks }: { onHowItWorks: () => void }) {
  const [mode, setMode] = useState<Mode>("receive");

  return (
    <section className="relative min-h-screen overflow-hidden px-10 pb-24 pt-36">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-200px] h-[700px] w-[1100px] -translate-x-1/2 rounded-full opacity-[0.22] blur-[140px]"
        style={{ background: "radial-gradient(ellipse, #FF1301 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-100px] top-[200px] h-[500px] w-[500px] rounded-full opacity-10 blur-[100px]"
        style={{ background: "radial-gradient(ellipse, #EAB308, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 70%)",
        }}
      />

      <div className="relative z-[2] mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          {/* POV toggle */}
          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.06 }} className="mb-7">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1 font-display text-sm font-medium">
              {([
                { k: "receive", label: "I want to get paid" },
                { k: "send", label: "I want to send" },
              ] as const).map((o) => (
                <button
                  key={o.k}
                  onClick={() => setMode(o.k)}
                  className={`rounded-full px-[18px] py-2.5 transition-all duration-200 ${mode === o.k
                    ? `text-white shadow-[0_10px_30px_-10px_rgba(255,19,1,0.5)] ${BRAND_GRADIENT}`
                    : "text-slate-400"
                    }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Headline — swap by mode */}
          <motion.div
            {...fadeUp}
            key={`h-${mode}`}
            transition={{ ...fadeUp.transition, delay: 0.12 }}
            className="mb-7"
          >
            {mode === "receive" ? (
              <h1 className="m-0 font-display text-[clamp(3.2rem,7vw,6.2rem)] font-medium leading-[1.05] tracking-[-0.035em] text-white">
                One link.
                <br />
                Get paid in{" "}
                <span
                  className={`inline-block italic align-baseline leading-[1.2] pb-[0.22em] -mb-[0.22em] isolate ${BRAND_GRADIENT} bg-clip-text text-transparent`}
                >
                  anything
                </span>
                .
              </h1>
            ) : (
              <h1 className="m-0 font-display text-[clamp(3.2rem,7vw,6.2rem)] font-medium leading-[1.05] tracking-[-0.035em] text-white">
                Send to{" "}
                <span
                  className={`inline-block italic align-baseline leading-[1.2] pb-[0.22em] -mb-[0.22em] pr-[0.12em] -mr-[0.12em] isolate ${BRAND_GRADIENT} bg-clip-text text-transparent`}
                >
                  anyone
                </span>
                ,
                <br />
                anywhere.
              </h1>
            )}
          </motion.div>

          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.18 }}
            className="mb-10 max-w-[540px] font-grotesk text-[clamp(1.1rem,1.35vw,1.2rem)] leading-[1.6] text-slate-400"
          >
            {mode === "receive"
              ? "Share your payment link. Anyone sends from anywhere, in any currency — you receive USDC on Solana and withdraw to whatever you actually want."
              : "No wallet address. No sign-up required for them. Send to an email, @handle, or username — they claim it when they sign in."}
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.28 }}
            className="flex flex-wrap gap-3"
          >
            <Link
              href={APP_URL}
              className={`inline-flex items-center gap-2.5 rounded-full font-display font-medium text-white shadow-[0_20px_50px_-15px_rgba(255,19,1,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-15px_rgba(255,19,1,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] px-8 py-[18px] text-[17px] ${BRAND_GRADIENT}`}
            >
              {mode === "receive" ? "Create your link" : "Send a payment"}{" "}
              <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} />
            </Link>
            {mode === "receive" ? (
              <button
                onClick={onHowItWorks}
                className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-[30px] py-[17px] text-[17px]"
              >
                <Play className="h-4 w-4" />
                See how it works
              </button>
            ) : (
              <Link
                href={APP_URL}
                className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-[30px] py-[17px] text-[17px]"
              >
                Pay by email
              </Link>
            )}
          </motion.div>
        </div>

        {/* hero stack */}
        <HeroStack mode={mode} />
      </div>
    </section>
  );
}

/* =====================================================
   SHARED UI
   ===================================================== */

function Pill({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1.5 pl-2.5 pr-3.5 font-grotesk text-[13px] font-medium text-slate-200 backdrop-blur-md">
      {icon && (
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-white ${BRAND_GRADIENT}`}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/* =====================================================
   CHAINS MARQUEE
   ===================================================== */

function Chains() {
  const payRow = [
    { name: "Ethereum", src: "/static/icons/network/ethereum.svg" },
    { name: "Solana", src: "/static/icons/network/solana.svg" },
    { name: "Base", src: "/static/icons/network/base.svg" },
    { name: "Arbitrum", src: "/static/icons/network/arbitrum.svg" },
    { name: "BNB Chain", src: "/static/icons/network/bsc.svg" },
    { name: "Avalanche", src: "/static/icons/network/avalanche.svg" },
    { name: "Bitcoin", src: "/static/icons/network/btc.svg" },
    { name: "Cardano", src: "/static/icons/network/cardano.svg" },
    { name: "Dogecoin", src: "/static/icons/network/dogecoin.svg" },
  ];
  type ReceiveItem = { name: string; emoji?: string; src?: string };
  const receiveRow: ReceiveItem[] = [
    { name: "USD", emoji: "🇺🇸" },
    { name: "EUR", emoji: "🇪🇺" },
    { name: "GBP", emoji: "🇬🇧" },
    { name: "JPY", emoji: "🇯🇵" },
    { name: "CAD", emoji: "🇨🇦" },
    { name: "AUD", emoji: "🇦🇺" },
    { name: "Revolut", src: "/static/icons/apps/revolut.svg" },
    { name: "Venmo", src: "/static/icons/apps/venmo.svg" },
    { name: "Cash App", src: "/static/icons/apps/cashapp.svg" },
    { name: "Wise", src: "/static/icons/apps/wise.svg" },
    { name: "Any bank", emoji: "🏦" },
    { name: "USDC", src: "/images/usdm.png" },
    { name: "USDT", src: "/images/usdt.svg" },
    { name: "SOL", src: "/static/icons/network/solana.svg" },
    { name: "BTC", src: "/static/icons/network/btc.svg" },
  ];
  const pay = [...payRow, ...payRow, ...payRow];
  const rec = [...receiveRow, ...receiveRow, ...receiveRow];

  const maskStyle = {
    maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
    WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
  };

  return (
    <section id="pay-receive" className="overflow-hidden border-y border-white/[0.06] py-20">
      <motion.p
        {...fadeUp}
        className="mb-10 text-center font-grotesk text-[13px] font-medium uppercase tracking-[0.14em] text-slate-500"
      >
        Pay from any chain · Receive what you want
      </motion.p>

      {/* Row 1 — scrolls left */}
      <div className="relative mb-5 overflow-hidden" style={maskStyle}>
        <div className="flex w-max gap-12 animate-[scrollL_40s_linear_infinite]">
          {pay.map((c, i) => (
            <div
              key={`pay-${i}`}
              className="flex flex-shrink-0 items-center gap-3.5 rounded-full border border-white/10 bg-white/[0.03] px-7 py-3"
            >
              <Image src={c.src} alt={c.name} width={26} height={26} unoptimized />
              <span className="font-display text-[18px] font-medium text-white">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Row 2 — scrolls right */}
      <div className="relative overflow-hidden" style={maskStyle}>
        <div className="flex w-max gap-12 animate-[scrollR_45s_linear_infinite]">
          {rec.map((c, i) => (
            <div
              key={`rec-${i}`}
              className="flex flex-shrink-0 items-center gap-3.5 rounded-full border border-white/10 bg-white/[0.03] px-7 py-3"
            >
              {c.emoji ? (
                <span className="inline-flex h-[26px] w-[26px] items-center justify-center text-[22px] leading-none">
                  {c.emoji}
                </span>
              ) : (
                <Image src={c.src!} alt={c.name} width={26} height={26} className="rounded-md" unoptimized />
              )}
              <span className="font-display text-[18px] font-medium text-white">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes scrollL {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.333%); }
        }
        @keyframes scrollR {
          from { transform: translateX(-33.333%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </section>
  );
}

/* =====================================================
   FEATURE SPLIT
   ===================================================== */

function FeatureSplit() {
  const items = [
    {
      eyebrow: "01 · Accept",
      title: "One link. Any token.",
      body: "Your username becomes your payment link. Senders pay from any of 20+ chains — you receive exactly the token you want.",
    },
    {
      eyebrow: "02 · Shield",
      title: "Activity off the public record.",
      body: "MagicBlock's Private Ephemeral Rollup routes your payments so amounts and counterparts stay yours alone. No setup.",
    },
    {
      eyebrow: "03 · Earn",
      title: "Idle balances don't sit idle.",
      body: "Every dollar between payments compounds yield through Morpho vaults. Withdraw anywhere, anytime, as any token.",
    },
  ];

  return (
    <section id="features" className="relative px-10 py-36">
      <div className="mx-auto max-w-[1320px]">
        <motion.div {...fadeUp} className="mb-24 max-w-[760px]">
          <Pill>Three pillars</Pill>
          <h2 className="mt-6 font-display text-[clamp(3rem,6vw,5.2rem)] font-medium leading-[0.95] tracking-[-0.03em] text-white">
            Built so payments
            <br />
            <span className="italic text-slate-400">just work for you.</span>
          </h2>
        </motion.div>

        <div className="flex flex-col gap-px overflow-hidden rounded-[28px] border border-white/[0.08]">
          {items.map((it, i) => (
            <motion.div
              key={it.eyebrow}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.1 }}
              className="grid grid-cols-1 items-center gap-10 bg-white/[0.02] p-14 transition-colors duration-300 hover:bg-white/[0.045] md:grid-cols-[220px_1fr_1fr] md:gap-14"
            >
              <span className="font-grotesk text-[13px] font-medium uppercase tracking-[0.12em] text-slate-500">
                {it.eyebrow}
              </span>
              <h3 className="m-0 font-display text-[clamp(1.8rem,3vw,2.8rem)] font-medium leading-[1.02] tracking-[-0.02em] text-white">
                {it.title}
              </h3>
              <p className="m-0 font-grotesk text-[17px] leading-[1.55] text-slate-400">{it.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   PRIVACY
   ===================================================== */

function Privacy() {
  const rows: Array<[string, string, boolean?, string?]> = [
    ["Amount", "••• USDC", true],
    ["To", "@you", false],
    ["From", "•••••", true],
    ["Chain", "Solana", false],
    ["Visibility", "Shielded", false, "text-emerald-400"],
    ["Gas", "Sponsored", false, "text-emerald-400"],
  ];

  return (
    <section id="privacy" className="px-10 py-36">
      <div className="mx-auto max-w-[1320px]">
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-b from-[#1e0f0a]/40 to-[#0f0f12]/40 px-6 py-12 sm:px-12 sm:py-16 lg:px-[72px] lg:py-20"
        >
          <div
            aria-hidden
            className="absolute left-[-10%] top-[-30%] h-[600px] w-[600px] rounded-full opacity-[0.18] blur-[100px]"
            style={{ background: "radial-gradient(ellipse, #FF1301, transparent 70%)" }}
          />
          <div
            aria-hidden
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />

          <div className="relative grid grid-cols-1 items-center gap-16 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
            <div>
              <Pill icon={<Sparkles className="h-3 w-3" />}>MagicBlock PER</Pill>
              <h2 className="mb-7 mt-6 font-display text-[clamp(2.6rem,5vw,4.4rem)] font-medium leading-[0.95] tracking-[-0.03em] text-white">
                The only ledger
                <br />
                that <span className="italic text-[#FF6A00]">matters</span> is yours.
              </h2>
              <p className="mb-10 max-w-[500px] font-grotesk text-[18px] leading-[1.6] text-slate-400">
                Private Ephemeral Rollups shield amounts, counterparts, and patterns from public observers. No setup, no new wallet — just a toggle.
              </p>
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {[
                  "Payment details shielded on-chain",
                  "Counterparts can't be linked together",
                  "One toggle. Works with your existing flow.",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-3.5 font-grotesk text-base text-slate-200">
                    <span className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-white ${BRAND_GRADIENT}`}>
                      <Check className="h-[13px] w-[13px]" strokeWidth={2.5} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative flex justify-end">
              <div className="w-[360px] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#282830]/70 to-[#141418]/90 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-5">
                  <span className="font-display text-base font-medium text-slate-200">Receipt</span>
                  <span className={`rounded-full px-3 py-1 font-grotesk text-[11px] font-medium uppercase tracking-[0.06em] text-white ${BRAND_GRADIENT}`}>
                    Private
                  </span>
                </div>
                <div className="flex flex-col gap-3.5 p-6">
                  {rows.map(([k, v, blur, color]) => (
                    <div key={k} className="flex justify-between font-grotesk text-[15px]">
                      <span className="text-slate-500">{k}</span>
                      <span
                        className={`${color ?? "text-white"} ${k === "Amount" || k === "From" ? "font-mono" : ""
                          } transition-all duration-300`}
                        style={{ filter: blur ? "blur(3px)" : "none" }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t border-white/[0.06] bg-white/[0.02] px-6 py-3.5 font-grotesk text-xs text-slate-500">
                  <Image src="/images/icons/shield-icon.png" alt="" width={18} height={18} />
                  Ephemeral rollup · Verified
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* =====================================================
   EARN
   ===================================================== */

function Earn() {
  return (
    <section id="earn" className="px-10 py-36">
      <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-20 lg:grid-cols-2">
        <motion.div {...fadeUp}>
          <Pill icon={<Sparkles className="h-3 w-3" />}>Morpho Vaults</Pill>
          <h2 className="mb-7 mt-6 font-display text-[clamp(2.6rem,5vw,4.4rem)] font-medium leading-[0.95] tracking-[-0.03em] text-white">
            Your balance
            <br />
            <span className="italic text-slate-400">always on.</span>
          </h2>
          <p className="mb-9 max-w-[440px] font-grotesk text-[18px] leading-[1.6] text-slate-400">
            Every minute between payments, your idle USDC earns yield through audited Morpho vaults. Withdraw instantly — we unwind in the background.
          </p>
          <div className="flex gap-10">
            <div>
              <div className="font-display text-[56px] font-medium leading-none tracking-[-0.02em] text-white">
                5.4<span className="text-[28px] text-slate-500">%</span>
              </div>
              <div className="mt-2 font-grotesk text-[13px] text-slate-500">Current APY*</div>
            </div>
            <div>
              <div className={`font-display text-[56px] font-medium leading-none tracking-[-0.02em] ${BRAND_GRADIENT} bg-clip-text text-transparent`}>
                ∞
              </div>
              <div className="mt-2 font-grotesk text-[13px] text-slate-500">Loofta Points</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.15 }}
          className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-[#1e1e23]/80 to-[#0f0f12]/80 p-8 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)]"
        >
          <div className="mb-7 flex items-center justify-between">
            <div>
              <div className="mb-1.5 font-grotesk text-[13px] text-slate-500">Available balance</div>
              <div className="font-display text-[40px] font-medium leading-none tracking-[-0.02em] text-white">
                $2,847.15
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-2 font-grotesk text-[13px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Earning
            </div>
          </div>

          <svg width="100%" height="120" viewBox="0 0 400 120" className="mb-5">
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#FF1301" stopOpacity="0.4" />
                <stop offset="1" stopColor="#FF1301" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="chart-stroke" x1="0" x2="1">
                <stop offset="0" stopColor="#FF1301" />
                <stop offset="1" stopColor="#EAB308" />
              </linearGradient>
            </defs>
            <path
              d="M0,95 C40,85 80,75 120,70 S200,55 240,45 320,30 400,15 L400,120 L0,120 Z"
              fill="url(#chart-fill)"
            />
            <path
              d="M0,95 C40,85 80,75 120,70 S200,55 240,45 320,30 400,15"
              fill="none"
              stroke="url(#chart-stroke)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="400" cy="15" r="5" fill="#EAB308" />
            <circle cx="400" cy="15" r="10" fill="#EAB308" opacity="0.25" />
          </svg>

          <div className="flex items-center justify-between">
            <div className="flex gap-2.5">
              {["1D", "1W", "1M", "ALL"].map((t) => (
                <button
                  key={t}
                  className={`rounded-full px-3.5 py-1.5 font-grotesk text-[13px] transition-colors ${t === "1W" ? "bg-white/[0.08] text-white" : "text-slate-500 hover:text-white"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="font-grotesk text-[13px] text-emerald-400">+$12.40 earned</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* =====================================================
   FOR BUSINESS
   ===================================================== */

function Business() {
  const schedule = [
    { day: "TUE", date: "14", label: "Payroll · November", amt: "$42,800", status: "in 3 days", active: true },
    { day: "FRI", date: "17", label: "Contractor batch", amt: "$8,900", status: "queued" },
    { day: "MON", date: "20", label: "Mod bonuses", amt: "€2,400", status: "queued" },
  ];

  const recurringBars = [1, 1, 1, 1, 1, 0.7, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4];

  const kycRows: Array<{
    icon: React.ReactNode;
    iconBg: string;
    border: string;
    bg: string;
    name: string;
    meta: string;
    opacity?: number;
  }> = [
      {
        icon: <Check className="h-[14px] w-[14px]" strokeWidth={2.5} />,
        iconBg: "bg-emerald-400/15 text-emerald-400",
        border: "border-emerald-400/25",
        bg: "bg-emerald-400/[0.06]",
        name: "Verified · Helena B.",
        meta: "Passport 🇩🇪 · $2,500 released",
      },
      {
        icon: <span className="text-sm">🪪</span>,
        iconBg: "bg-yellow-500/15",
        border: "border-yellow-500/25",
        bg: "bg-yellow-500/[0.05]",
        name: "Pending KYC · winner@...",
        meta: "Funds held · claim in 7d",
      },
      {
        icon: <span className="text-[13px]">⏳</span>,
        iconBg: "bg-white/[0.06]",
        border: "border-white/[0.06]",
        bg: "bg-white/[0.02]",
        name: "Awaiting review · Tom E.",
        meta: "Submitted 2h ago",
        opacity: 0.55,
      },
    ];

  const invoiceRows = [
    { label: "Design retainer", amt: "$4,800" },
    { label: "Additional scope", amt: "$1,200" },
    { label: "Tax", amt: "$540", muted: true },
  ];

  const bulkRows = [
    { flag: "🇩🇪", name: "Helena B.", method: "Revolut", amt: "€450" },
    { flag: "🇫🇷", name: "Léa M.", method: "USDC", amt: "$380" },
    { flag: "🇬🇧", name: "Tom E.", method: "Wise", amt: "£420" },
    { flag: "🇺🇸", name: "Jordan K.", method: "Venmo", amt: "$520" },
    { flag: "🇯🇵", name: "Aiko T.", method: "🏦 bank", amt: "¥62,000" },
    { flag: "🇨🇦", name: "Marcus L.", method: "USDC", amt: "$410" },
  ];

  const features = [
    {
      icon: "📅",
      title: "Schedule payments",
      body: "Queue a payment for next Tuesday. Or the 1st of every month. It leaves on time whether you're online or not.",
      preview: (
        <div className="flex flex-col gap-2">
          {schedule.map((r, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 ${r.active
                ? "border border-[rgba(255,19,1,0.25)] bg-[rgba(255,19,1,0.08)]"
                : "border border-white/[0.05] bg-white/[0.03]"
                }`}
            >
              <div
                className={`flex h-9 w-9 flex-col items-center justify-center rounded-lg ${r.active ? BRAND_GRADIENT : "bg-white/[0.06]"
                  }`}
              >
                <div
                  className={`font-grotesk text-[8px] font-semibold tracking-[0.08em] ${r.active ? "text-white/80" : "text-slate-500"
                    }`}
                >
                  {r.day}
                </div>
                <div className="font-display text-[14px] font-medium leading-none text-white">{r.date}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-grotesk text-[12px] text-white">{r.label}</div>
                <div className="font-grotesk text-[10px] text-slate-500">{r.status}</div>
              </div>
              <div className="font-display text-[13px] font-medium tabular-nums text-white">{r.amt}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: "🔁",
      title: "Recurring payments",
      body: "Set it once. Payroll every 1st, retainers every 15th, subscriptions weekly. Pause or edit any time.",
      preview: (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-[18px]">
          <div className="mb-3.5 flex items-baseline justify-between">
            <span className="font-grotesk text-[11px] uppercase tracking-[0.12em] text-slate-500">Every month · 1st</span>
            <span className="inline-flex items-center gap-1.5 font-grotesk text-[10px] text-emerald-400">
              <span className="h-[5px] w-[5px] rounded-full bg-emerald-400 shadow-[0_0_6px_#34D399]" />
              Active
            </span>
          </div>
          <div className="mb-1 font-display text-[32px] font-medium leading-none tabular-nums text-white">$12,500</div>
          <div className="mb-3.5 font-grotesk text-[12px] text-slate-400">→ 8 team members</div>
          <div className="flex h-7 items-end gap-[3px]">
            {recurringBars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${h * 100}%`,
                  background:
                    h === 1
                      ? "linear-gradient(90deg, #FF1301, #EAB308)"
                      : h > 0.5
                        ? "rgba(255,255,255,.25)"
                        : "rgba(255,255,255,.08)",
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-grotesk text-[9px] text-slate-500">
            <span>Jun</span>
            <span>Now</span>
            <span>Next yr</span>
          </div>
        </div>
      ),
    },
    {
      icon: "🪪",
      title: "KYC-gated claims",
      body: "Require identity verification before a recipient can claim. Perfect for hackathon prizes, grants, or compliance-bound transfers.",
      preview: (
        <div className="flex flex-col gap-2.5">
          {kycRows.map((r, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-xl border ${r.border} ${r.bg} p-3`}
              style={{ opacity: r.opacity ?? 1 }}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${r.iconBg}`}>{r.icon}</div>
              <div className="flex-1">
                <div className="font-grotesk text-[12px] text-white">{r.name}</div>
                <div className="font-grotesk text-[10px] text-slate-500">{r.meta}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: "🧾",
      title: "Invoices",
      body: "Send a clean invoice link. Client pays any way they want. You get paid in whatever you want. Reconciliation handled.",
      preview: (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-[18px]">
          <div className="mb-3.5 flex items-center justify-between border-b border-white/[0.05] pb-3">
            <div>
              <div className="font-grotesk text-[10px] uppercase tracking-[0.1em] text-slate-500">INV-2047</div>
              <div className="mt-0.5 font-display text-[14px] font-medium text-white">Acme Corp</div>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/[0.12] px-2 py-[3px] font-grotesk text-[10px] font-semibold text-emerald-400">
              PAID
            </span>
          </div>
          {invoiceRows.map((r, i) => (
            <div key={i} className="flex justify-between py-1.5 font-grotesk text-[12px]">
              <span className={r.muted ? "text-slate-500" : "text-slate-300"}>{r.label}</span>
              <span className={`tabular-nums ${r.muted ? "text-slate-500" : "text-white"}`}>{r.amt}</span>
            </div>
          ))}
          <div className="mt-2.5 flex items-baseline justify-between border-t border-white/[0.05] pt-2.5">
            <span className="font-grotesk text-[11px] text-slate-500">Total received</span>
            <span className="font-display text-[22px] font-medium tabular-nums text-white">$6,540</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section id="business" className="relative overflow-hidden px-10 py-36">
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-10%] top-[10%] h-[500px] w-[500px] rounded-full opacity-[0.06] blur-[120px]"
        style={{ background: "radial-gradient(ellipse, #EAB308, transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-[1320px]">
        {/* header */}
        <motion.div
          {...fadeUp}
          className="mb-20 flex flex-wrap items-end justify-between gap-10"
        >
          <div className="max-w-[680px]">
            <Pill>For business</Pill>
            <h2 className="mb-5 mt-6 font-display text-[clamp(2.8rem,5.5vw,4.8rem)] font-medium leading-[1.02] tracking-[-0.03em] text-white">
              Payroll, payouts,
              <br />
              <span className="italic text-slate-400">all in one place.</span>
            </h2>
            <p className="max-w-[520px] font-grotesk text-[1.15rem] leading-[1.6] text-slate-400">
              From paying your contractors in five countries to releasing hackathon prizes with KYC — Loofta handles the messy stuff.
            </p>
          </div>
          <a
            href="https://calendly.com/lisa-bechina"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-5 py-3 text-sm whitespace-nowrap"
          >
            Book a business demo <ArrowRight className="h-[15px] w-[15px]" strokeWidth={2} />
          </a>
        </motion.div>

        {/* hero feature: bulk payments */}
        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.1 }}
          className="relative mb-6 grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-[#221612]/55 to-[#0f0f12]/70 p-6 sm:p-10 lg:p-16 lg:grid-cols-[1fr_1.1fr] lg:gap-14"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-[-5%] top-[-20%] h-[500px] w-[500px] rounded-full opacity-[0.12] blur-[100px]"
            style={{ background: "radial-gradient(ellipse, #FF1301, transparent 70%)" }}
          />

          <div className="relative">
            <span className="font-grotesk text-[13px] font-medium uppercase tracking-[0.12em] text-slate-500">
              Bulk payments
            </span>
            <h3 className="mb-5 mt-4 font-display text-[clamp(2rem,3.4vw,3rem)] font-medium leading-[1.05] tracking-[-0.025em] text-white">
              Pay 200 people in one signature.
            </h3>
            <p className="mb-6 max-w-[440px] font-grotesk text-[1.05rem] leading-[1.6] text-slate-400">
              Upload a CSV or paste a list. Pay your freelancers, creators, hackathon winners, or an entire payroll — in any mix of currencies they each want to receive.
            </p>
            <div className="inline-flex items-center gap-2.5 rounded-full border border-[rgba(255,19,1,0.3)] bg-[rgba(255,19,1,0.1)] px-3.5 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#FF1301] shadow-[0_0_8px_#FF1301]" />
              <span className="font-grotesk text-xs font-medium text-white">200+ recipients · one tx</span>
            </div>
          </div>

          {/* bulk table */}
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0c]/70 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-[18px] py-3.5">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-7 w-7 items-center justify-center rounded-md text-[13px] ${BRAND_GRADIENT}`}>
                  📄
                </div>
                <div>
                  <div className="font-grotesk text-[12px] font-medium text-white">contractors-nov.csv</div>
                  <div className="font-grotesk text-[10px] text-slate-500">24 recipients · 5 currencies</div>
                </div>
              </div>
              <span className="font-display text-[18px] font-medium tabular-nums text-white">$12,400</span>
            </div>
            {bulkRows.map((r, i) => (
              <div
                key={i}
                className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-3.5 px-[18px] py-[11px] font-grotesk text-xs ${i < bulkRows.length - 1 ? "border-b border-white/[0.04]" : ""
                  }`}
              >
                <span className="w-5 text-center text-base">{r.flag}</span>
                <span className="text-white">{r.name}</span>
                <span className="text-[11px] text-slate-500">{r.method}</span>
                <span className="min-w-[68px] text-right tabular-nums text-white">{r.amt}</span>
              </div>
            ))}
            <div className="bg-white/[0.02] px-[18px] py-2.5 text-center font-grotesk text-[11px] text-slate-500">
              + 18 more · <span className="text-slate-300">1 signature to send all</span>
            </div>
          </div>
        </motion.div>

        {/* 4-feature grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.12 + i * 0.08 }}
              className="flex h-full flex-col gap-6 rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#18181c]/60 to-[#0f0f12]/60 p-6 sm:p-9 transition-all duration-300 hover:-translate-y-[3px] hover:border-white/[0.16]"
            >
              <div>
                <div className="mb-4 text-[28px] leading-none">{f.icon}</div>
                <h3 className="mb-2.5 font-display text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-white">
                  {f.title}
                </h3>
                <p className="font-grotesk text-sm leading-[1.55] text-slate-400">{f.body}</p>
              </div>
              <div className="mt-auto">{f.preview}</div>
            </motion.div>
          ))}
        </div>

        {/* business contact CTA */}
        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.5 }}
          className="relative mt-10 flex flex-wrap items-center justify-between gap-10 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-[#22140e]/70 to-[#140f0a]/60 px-14 py-11"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute right-[-5%] top-[-50%] h-[420px] w-[420px] rounded-full opacity-[0.18] blur-[90px]"
            style={{ background: "radial-gradient(ellipse, #FF1301, transparent 70%)" }}
          />
          <div className="relative min-w-[280px] flex-1 basis-[420px]">
            <div className="mb-2.5 font-grotesk text-xs font-medium uppercase tracking-[0.14em] text-[#FF6A00]">
              Talk to us
            </div>
            <h3 className="mb-2.5 font-display text-[clamp(1.8rem,2.8vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.025em] text-white">
              Running payroll, a DAO, or a grants program?
            </h3>
            <p className="max-w-[560px] font-grotesk text-[15px] leading-[1.55] text-slate-400">
              Custom volume pricing, dedicated support, and onboarding help for teams paying 50+ recipients.
            </p>
          </div>
          <div className="relative flex flex-wrap gap-3">
            <Link
              href={APP_URL}
              className={`inline-flex items-center gap-2.5 rounded-full font-display font-medium text-white shadow-[0_20px_50px_-15px_rgba(255,19,1,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-15px_rgba(255,19,1,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] px-8 py-[18px] text-[17px] ${BRAND_GRADIENT}`}
            >
              Contact sales <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} />
            </Link>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-[30px] py-[17px] text-[17px]"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* =====================================================
   BUILT ON SOLANA × MAGICBLOCK
   ===================================================== */

function BuiltOn() {
  const specs = [
    { label: "Settlement", value: "Solana L1", sub: "~400ms finality" },
    { label: "Privacy layer", value: "MagicBlock PER", sub: "Private Ephemeral Rollup" },
    { label: "Stable asset", value: "USDC", sub: "Circle-native on Solana" },
    { label: "Custody", value: "Non-custodial", sub: "Keys never leave your device" },
  ];

  return (
    <section id="stack" className="relative overflow-hidden px-10 py-36">
      <div
        aria-hidden
        className="pointer-events-none absolute left-[15%] top-[20%] h-[420px] w-[420px] rounded-full opacity-[0.08] blur-[110px]"
        style={{ background: "radial-gradient(ellipse, #14F195 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[10%] right-[15%] h-[420px] w-[420px] rounded-full opacity-[0.10] blur-[110px]"
        style={{ background: "radial-gradient(ellipse, #9945FF 0%, transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-[1320px]">
        <div className="grid grid-cols-1 items-center gap-20 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <motion.div {...fadeUp}>
              <Pill>The stack</Pill>
            </motion.div>
            <motion.h2
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.08 }}
              className="mb-7 mt-6 font-display text-[clamp(2.8rem,5.2vw,4.6rem)] font-medium leading-[1.02] tracking-[-0.03em] text-white"
            >
              Built on{" "}
              <span
                className="italic"
                style={{
                  background: "linear-gradient(90deg, #14F195, #9945FF)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Solana
              </span>
              .
              <br />
              Private with <span className="italic text-white">MagicBlock</span>.
            </motion.h2>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.14 }}
              className="mb-9 max-w-[520px] font-grotesk text-[1.15rem] leading-[1.65] text-slate-400"
            >
              Every payment settles on Solana in under half a second. MagicBlock's Private Ephemeral Rollup keeps amounts and counterparts off the public ledger — by default, for every user, every time.
            </motion.p>
            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.2 }}
              className="flex flex-wrap gap-3"
            >
              <a href="#" className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-5 py-3 text-sm">
                Read the architecture
              </a>
              <a href="#" className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-5 py-3 text-sm">
                How PER works
              </a>
            </motion.div>
          </div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.12 }}
            className="flex flex-col gap-4"
          >
            {/* Solana card */}
            <div className="relative overflow-hidden rounded-[22px] border border-[rgba(20,241,149,0.22)] bg-[linear-gradient(135deg,rgba(20,241,149,0.08)_0%,rgba(153,69,255,0.08)_100%)] px-9 py-8">
              <div
                aria-hidden
                className="absolute -right-10 -top-10 h-[200px] w-[200px] rounded-full blur-[40px]"
                style={{ background: "radial-gradient(ellipse, rgba(20,241,149,.25), transparent 70%)" }}
              />
              <div className="relative flex items-center gap-5">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-[14px] shadow-[0_16px_40px_-12px_rgba(20,241,149,0.5)]"
                  style={{ background: "linear-gradient(135deg, #14F195, #9945FF)" }}
                >
                  <Image
                    src="/images/logo/solana-mark.svg"
                    alt="Solana"
                    width={28}
                    height={28}
                    className="brightness-0 invert"
                  />
                </div>
                <div className="flex-1">
                  <div className="mb-1 font-grotesk text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                    Settlement layer
                  </div>
                  <div className="font-display text-[28px] font-medium leading-none tracking-[-0.02em] text-white">
                    Solana
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-[22px] font-medium tabular-nums text-[#14F195]">
                    400
                    <span className="ml-0.5 text-sm text-slate-500">ms</span>
                  </div>
                  <div className="font-grotesk text-[11px] text-slate-500">finality</div>
                </div>
              </div>
            </div>

            {/* connector */}
            <div className="flex items-center gap-3 py-0.5">
              <div
                className="h-px flex-1"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.12), transparent)" }}
              />
              <span className="font-display text-base italic text-slate-500">powered with</span>
              <div
                className="h-px flex-1"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.12), transparent)" }}
              />
            </div>

            {/* MagicBlock card */}
            <div className="relative overflow-hidden rounded-[22px] border border-[rgba(255,19,1,0.22)] bg-[linear-gradient(135deg,rgba(255,19,1,0.08)_0%,rgba(234,179,8,0.08)_100%)] px-9 py-8">
              <div
                aria-hidden
                className="absolute -left-10 -top-10 h-[200px] w-[200px] rounded-full blur-[40px]"
                style={{ background: "radial-gradient(ellipse, rgba(255,19,1,.25), transparent 70%)" }}
              />
              <div className="relative flex items-center gap-5">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-[14px] shadow-[0_16px_40px_-12px_rgba(255,19,1,0.5)] ${BRAND_GRADIENT}`}
                >
                  <Image
                    src="/images/logo/magicblock-mark.svg"
                    alt="MagicBlock"
                    width={32}
                    height={32}
                    className="brightness-0 invert"
                  />
                </div>
                <div className="flex-1">
                  <div className="mb-1 font-grotesk text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                    Privacy layer
                  </div>
                  <div className="font-display text-[28px] font-medium leading-none tracking-[-0.02em] text-white">
                    MagicBlock PER
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-[22px] font-medium text-[#EAB308]">private</div>
                  <div className="font-grotesk text-[11px] text-slate-500">by default</div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* spec strip */}
        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.26 }}
          className="mt-20 grid grid-cols-2 gap-10 border-t border-white/[0.06] pt-10 md:grid-cols-4"
        >
          {specs.map((s) => (
            <div key={s.label}>
              <div className="mb-2.5 font-grotesk text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                {s.label}
              </div>
              <div className="mb-1 font-display text-[22px] font-medium tracking-[-0.015em] text-white">
                {s.value}
              </div>
              <div className="font-grotesk text-[13px] text-slate-400">{s.sub}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* =====================================================
   CTA
   ===================================================== */

function CTA() {
  return (
    <section className="relative overflow-hidden px-10 py-40">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18] blur-[120px]"
        style={{ background: "radial-gradient(ellipse, #FF1301 0%, transparent 60%)" }}
      />
      <motion.div {...fadeUp} className="relative mx-auto max-w-[900px] text-center">
        <h2 className="mb-6 font-display text-[clamp(3.5rem,9vw,7.5rem)] font-medium leading-[1.02] tracking-[-0.035em] text-white pb-[0.14em]">
          Ready to{" "}
          <span className={`inline-block italic ${BRAND_GRADIENT} bg-clip-text text-transparent pb-[0.05em] pr-[0.12em] -mr-[0.12em]`}>get paid?</span>
        </h2>
        <p className="mb-12 font-grotesk text-[clamp(1.15rem,1.6vw,1.4rem)] text-slate-400">
          Free account. No seed phrase. No wallet install. Ready in 30 seconds.
        </p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <Link
            href={APP_URL}
            className={`inline-flex items-center gap-2.5 rounded-full font-display font-medium text-white shadow-[0_20px_50px_-15px_rgba(255,19,1,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-15px_rgba(255,19,1,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] px-8 py-[18px] text-[17px] ${BRAND_GRADIENT}`}
          >
            Create your payment link <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} />
          </Link>
          <Link
            href={APP_URL}
            className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] font-display font-medium text-white transition-colors duration-200 hover:border-white/25 hover:bg-white/10 px-[30px] py-[17px] text-[17px]"
          >
            Send a payment
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-white/[0.06] px-10 py-10">
      <div className="flex items-center gap-6">
        <Image src="/loofta_white.svg" alt="Loofta" width={95} height={22} />
        <span className="font-grotesk text-[13px] text-slate-600">Non-custodial · Private · Devnet</span>
      </div>
      <div className="flex gap-6">
        {[
          { label: "Twitter", href: "https://x.com/looftaxyz" },
          { label: "Telegram", href: "https://t.me/looftapay" },
          { label: "Medium", href: "https://medium.com/@looftaxyz" },
          { label: "Privacy", href: "#" },
        ].map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="font-grotesk text-[13px] text-slate-400 hover:text-white">
            {l.label}
          </a>
        ))}
        <Link href="/brand" className="font-grotesk text-[13px] text-slate-400 hover:text-white">
          Brand
        </Link>
      </div>
    </footer>
  );
}

/* =====================================================
   PAGE
   ===================================================== */

export default function HomePage() {
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0a0c] text-white antialiased">
      <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} />
      <Header onHowItWorks={() => setVideoOpen(true)} />
      <Hero onHowItWorks={() => setVideoOpen(true)} />
      <Chains />
      <FeatureSplit />
      <Privacy />
      <Earn />
      <Business />
      <BuiltOn />
      <CTA />
      <Footer />
    </main>
  );
}
