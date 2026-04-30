"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Play, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { Turnstile } from "@marsidev/react-turnstile";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  display_name: string;
  email: string;
  telegram_handle: string;
  twitter_username: string;
  preferred_comms: string;
  age_range: string;
  occupation: string;
  payment_volume: string;
  payment_type: string;
  fiat_to_crypto: boolean | null;
  withdrawal_rails: string;
  earn_interest: boolean | null;
}

const EMPTY_FORM: FormData = {
  display_name: "",
  email: "",
  telegram_handle: "",
  twitter_username: "",
  preferred_comms: "",
  age_range: "",
  occupation: "",
  payment_volume: "",
  payment_type: "",
  fiat_to_crypto: null,
  withdrawal_rails: "",
  earn_interest: null,
};

// ─── Options ──────────────────────────────────────────────────────────────────

const COMMS_OPTIONS = [
  { value: "twitter_dm", label: "Twitter / X DM" },
  { value: "telegram", label: "Telegram" },
  { value: "email", label: "Email" },
];

const AGE_OPTIONS = [
  { value: "under_18", label: "Under 18" },
  { value: "18_24", label: "18 – 24" },
  { value: "25_34", label: "25 – 34" },
  { value: "35_44", label: "35 – 44" },
  { value: "45_54", label: "45 – 54" },
  { value: "55_plus", label: "55 +" },
];

const OCCUPATION_OPTIONS = [
  { value: "freelancer", label: "Freelancer" },
  { value: "creator", label: "Content Creator" },
  { value: "web3_business", label: "Web3 Business Owner" },
  { value: "remote_worker", label: "Remote Worker / Employee" },
  { value: "developer", label: "Developer" },
  { value: "student", label: "Student" },
  { value: "trader", label: "Crypto Trader / Investor" },
  { value: "other", label: "Other" },
];

const VOLUME_OPTIONS = [
  { value: "less_1k", label: "Less than $1,000 / mo" },
  { value: "1k_5k", label: "$1,000 – $5,000 / mo" },
  { value: "5k_25k", label: "$5,000 – $25,000 / mo" },
  { value: "25k_100k", label: "$25,000 – $100,000 / mo" },
  { value: "100k_plus", label: "$100,000 + / mo" },
];

const PAYMENT_TYPE_OPTIONS = [
  { value: "non_private", label: "Non-private (standard on-chain)" },
  { value: "private", label: "Private (shielded / confidential)" },
  { value: "both", label: "Both — I'll use whatever fits" },
];


// ─── Steps ────────────────────────────────────────────────────────────────────

type StepId =
  | "name" | "email" | "telegram" | "twitter" | "comms"
  | "age" | "occupation" | "volume" | "payment_type"
  | "fiat_to_crypto" | "withdrawal_rails" | "earn";

interface Step {
  id: StepId;
  question: string;
  hint?: string;
  type: "text" | "single" | "multi" | "yesno";
}

const STEPS: Step[] = [
  { id: "name", question: "What's your name, or how do you want to be called?", hint: "A nickname is totally fine.", type: "text" },
  { id: "email", question: "What's your email address?", hint: "We'll send your early access details here.", type: "text" },
  { id: "telegram", question: "What's your Telegram handle?", hint: "e.g. @yourhandle — leave blank to skip.", type: "text" },
  { id: "twitter", question: "What's your Twitter / X username?", hint: "e.g. @yourname — leave blank to skip.", type: "text" },
  { id: "comms", question: "How do you prefer we reach out?", type: "single" },
  { id: "age", question: "What's your age range?", type: "single" },
  { id: "occupation", question: "How would you describe yourself?", hint: "Pick the one that fits best.", type: "single" },
  { id: "volume", question: "How much in payments do you plan to receive monthly?", type: "single" },
  { id: "payment_type", question: "Which payment style interests you most?", hint: "Loofta supports both standard and fully private (shielded) payments.", type: "single" },
  { id: "fiat_to_crypto", question: "Interested in letting people pay you in fiat and receiving in crypto?", hint: "e.g. someone pays in USD via card, you receive USDC on-chain.", type: "yesno" },
  { id: "withdrawal_rails", question: "Which withdrawal rails will you use?", hint: "e.g. USDC, Revolut, Venmo, SEPA, BTC — be as specific as you like.", type: "text" },
  { id: "earn", question: "Are you interested in our Earn product?", hint: "Earn yield on your balance while it sits in Loofta.", type: "yesno" },
];

// ─── Video Modal ──────────────────────────────────────────────────────────────

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
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
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

// ─── Waitlist card stack (same pattern as home hero) ─────────────────────────

type WCard = {
  amount: string; person: string; sub: string; meta: string;
  status: string; statusColor: string; time: string;
  avatarLetter: string; avatarBg: string;
};
type WPose = { x: number; y: number; rot: number; scale: number; opacity: number; blur: number };

const WCARDS: WCard[] = [
  { amount: "$2,500", person: "XYZ Foundation", sub: "Hackathon prize", meta: "Congrats on winning Radar 🏆", status: "RECEIVED", statusColor: "#34D399", time: "just now", avatarLetter: "◎", avatarBg: "linear-gradient(135deg,#14F195,#9945FF)" },
  { amount: "$890",   person: "Straipe",         sub: "Payout · bank 🏦",  meta: "October subscription",        status: "RECEIVED", statusColor: "#34D399", time: "18s ago",  avatarLetter: "S", avatarBg: "linear-gradient(135deg,#635BFF,#00D4FF)" },
  { amount: "$75",    person: "@jpegmafia",       sub: "Tipped on X",       meta: "loved your latest post 🔥",   status: "RECEIVED", statusColor: "#34D399", time: "1m ago",   avatarLetter: "𝕏", avatarBg: "linear-gradient(135deg,#0F172A,#475569)" },
  { amount: "€450",   person: "Helena Bauer 🇩🇪", sub: "Paid from Revolut", meta: "Community manager — Week 42", status: "RECEIVED", statusColor: "#34D399", time: "3m ago",   avatarLetter: "H", avatarBg: "linear-gradient(135deg,#3B82F6,#8B5CF6)" },
  { amount: "$1,200", person: "Mirror.xyz",       sub: "Video collab",       meta: "Sponsored post + edit",       status: "RECEIVED", statusColor: "#34D399", time: "5m ago",   avatarLetter: "M", avatarBg: "linear-gradient(135deg,#F59E0B,#EF4444)" },
];

function WReceiptCard({ card, pose, z, dragHandlers, isDragged, isFront }: {
  card: WCard; pose: WPose; z: number;
  dragHandlers: { onMouseDown: (e: React.MouseEvent) => void; onTouchStart: (e: React.TouchEvent) => void };
  isDragged: boolean; isFront: boolean;
}) {
  return (
    <div
      onMouseDown={isFront ? dragHandlers.onMouseDown : undefined}
      onTouchStart={isFront ? dragHandlers.onTouchStart : undefined}
      className="absolute w-[300px] select-none rounded-[22px] border border-white/10 bg-gradient-to-b from-[#222228]/95 to-[#121216]/95 p-[22px] backdrop-blur-xl"
      style={{
        top: "50%", left: "50%", zIndex: z,
        transform: `translate(calc(-50% + ${pose.x}px), calc(-50% + ${pose.y}px)) rotate(${pose.rot}deg) scale(${pose.scale})`,
        opacity: pose.opacity,
        filter: pose.blur ? `blur(${pose.blur}px)` : "none",
        transition: isDragged ? "none" : "transform 1100ms cubic-bezier(.22,1,.36,1), opacity 700ms cubic-bezier(.22,1,.36,1), filter 700ms linear",
        boxShadow: isDragged
          ? "0 50px 120px -20px rgba(0,0,0,.9), 0 0 40px rgba(255,19,1,.3), inset 0 1px 0 rgba(255,255,255,.1)"
          : "0 40px 90px -20px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.08)",
        cursor: isFront ? (isDragged ? "grabbing" : "grab") : "default",
        touchAction: isFront ? "none" : "auto",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-[7px] rounded-full py-1 pl-[9px] pr-[11px] text-[12px] font-semibold"
          style={{ color: card.statusColor, background: `${card.statusColor}14`, border: `1px solid ${card.statusColor}35` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: card.statusColor, boxShadow: `0 0 10px ${card.statusColor}` }} />
          {card.status}
        </span>
        <span className="text-[11px] text-slate-500">{card.time}</span>
      </div>
      <div className="mb-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-white">{card.amount}</div>
      <div className="mb-4 text-[13px] italic text-slate-400">&ldquo;{card.meta}&rdquo;</div>
      <div className="flex items-center gap-2.5 border-t border-white/[0.06] pt-2.5">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px] font-medium text-white" style={{ background: card.avatarBg }}>
          {card.avatarLetter}
        </div>
        <div className="text-[13px] leading-tight">
          <div className="font-medium text-white">{card.person}</div>
          <div className="text-[11px] text-slate-500">{card.sub}</div>
        </div>
      </div>
    </div>
  );
}

function WCardStack() {
  const [front, setFront] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [throwing, setThrowing] = useState<{ x: number; y: number; rot: number } | null>(null);
  const n = WCARDS.length;

  useEffect(() => {
    if (drag || throwing) return;
    const id = setInterval(() => setFront((f) => (f + 1) % n), 2400);
    return () => clearInterval(id);
  }, [n, drag, throwing]);

  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); setDrag({ x: 0, y: 0, startX: e.clientX, startY: e.clientY }); };
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; setDrag({ x: 0, y: 0, startX: t.clientX, startY: t.clientY }); };

  useEffect(() => {
    if (!drag) return;
    const onMove = (cx: number, cy: number) => setDrag((d) => d ? { ...d, x: cx - d.startX, y: cy - d.startY } : null);
    const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const tm = (e: TouchEvent) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); };
    const onEnd = () => {
      setDrag((cur) => {
        if (!cur) return null;
        const dist = Math.hypot(cur.x, cur.y);
        if (dist > 120) {
          const mag = 900 / Math.max(1, dist);
          setThrowing({ x: cur.x * mag * 0.9, y: cur.y * mag * 0.9, rot: cur.x * 0.08 });
          setTimeout(() => { setFront((f) => (f + 1) % n); setThrowing(null); }, 500);
        }
        return null;
      });
    };
    window.addEventListener("mousemove", mm); window.addEventListener("touchmove", tm);
    window.addEventListener("mouseup", onEnd); window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("touchmove", tm); window.removeEventListener("mouseup", onEnd); window.removeEventListener("touchend", onEnd); };
  }, [drag, n]);

  const getPose = (i: number): WPose => {
    let d = (i - front + n) % n;
    if (d > n / 2) d -= n;
    if (d === 0) {
      if (throwing) return { x: throwing.x, y: throwing.y, rot: throwing.rot, scale: 0.9, opacity: 0, blur: 3 };
      if (drag) return { x: drag.x, y: drag.y + 20, rot: -1 + drag.x * 0.08, scale: 1.02, opacity: 1, blur: 0 };
      return { x: 0, y: 20, rot: -1, scale: 1, opacity: 1, blur: 0 };
    }
    if (d === 1)  return { x: 85,   y: -30,  rot: 6,   scale: 0.94, opacity: 0.85, blur: 0 };
    if (d === 2)  return { x: 155,  y: -80,  rot: 12,  scale: 0.86, opacity: 0.55, blur: 2 };
    if (d === -1) return { x: -130, y: -270, rot: -22, scale: 0.82, opacity: 0,    blur: 5 };
    return             { x: -170, y: -350, rot: -26, scale: 0.78, opacity: 0,    blur: 7 };
  };

  const dragHandlers = { onMouseDown, onTouchStart };

  return (
    <div className="relative h-full w-full">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px]" style={{ background: "radial-gradient(ellipse,rgba(255,19,1,.28),transparent 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[240px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.06]" style={{ transform: "translate(-50%,-50%) rotate(-8deg)" }} />
      {WCARDS.map((c, i) => {
        let d = (i - front + n) % n;
        if (d > n / 2) d -= n;
        return (
          <WReceiptCard key={i} card={c} pose={getPose(i)} z={10 - Math.abs(d)} dragHandlers={dragHandlers} isDragged={d === 0 && !!drag} isFront={d === 0} />
        );
      })}
      {!drag && !throwing && (
        <div className="pointer-events-none absolute left-1/2 top-6 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
          drag to flick →
        </div>
      )}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-1.5">
        {WCARDS.map((_, i) => (
          <span key={i} className="h-1.5 rounded-full transition-all duration-300" style={{ width: i === front ? 20 : 6, background: i === front ? "linear-gradient(90deg,#FF1301,#EAB308)" : "rgba(255,255,255,.18)" }} />
        ))}
      </div>
    </div>
  );
}

// ─── Landing screen ───────────────────────────────────────────────────────────

const STATS = [
  { value: "500+", label: "On the waitlist" },
  { value: "$100", label: "Cashback for early users" },
  { value: "0%", label: "Fees during early access" },
  { value: "24h", label: "Avg. review time" },
];

const CARDS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FF4A26]">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
    ),
    title: "Up to $100 cashback",
    desc: "Not a voucher — real money deposited after your first payments on mainnet.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FF4A26]">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Direct founder access",
    desc: "Skip the queue. Message the team building this and shape what ships next.",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#FF4A26]">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    title: "Shape what gets built",
    desc: "Your workflow becomes the product roadmap. Early users decide priorities.",
  },
];

function LandingScreen({ onStart, onVideo, turnstileReady }: { onStart: () => void; onVideo: () => void; turnstileReady: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      className="bg-[#0f0f12] text-white"
    >
      {/* ── Split hero ── */}
      <div className="flex min-h-screen">
        {/* Left: card stack */}
        <div className="hidden lg:flex lg:w-1/2 items-center justify-center relative overflow-hidden bg-[#0a0a0d]">
          <WCardStack />
        </div>

        {/* Right: content */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center px-8 sm:px-12 lg:px-16 py-20">
          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-8">
            <span className="h-px w-6 bg-[#FF4A26]" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[#FF4A26]">
              Mainnet Early Access
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-semibold leading-[1.12] mb-6 max-w-lg">
            Most people will wait.<br />
            <span className="bg-gradient-to-r from-[#FF4A26] to-[#EAB308] bg-clip-text text-transparent italic">
              You don&apos;t have to.
            </span>
          </h1>

          {/* Body */}
          <p className="text-base text-slate-400 leading-relaxed mb-10 max-w-sm">
            A hand-picked group gets access before anyone else — real cashback,
            direct founder support, and features shaped around how you work.
            Spots are assigned manually.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-sm">
            <button
              type="button"
              onClick={onStart}
              disabled={!turnstileReady}
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#FF4A26] to-[#EAB308] hover:opacity-90 active:scale-[0.98] transition-all shadow-[0_8px_24px_rgba(255,74,38,0.25)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {turnstileReady ? "Request access →" : "Verifying…"}
            </button>
            <button
              type="button"
              onClick={onVideo}
              className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-semibold text-sm text-slate-300 border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all"
            >
              <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <Play className="w-3 h-3 text-white fill-white ml-0.5" />
              </span>
              Watch demo
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="border-y border-white/8 grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/8">
        {STATS.map((s) => (
          <div key={s.label} className="px-8 py-10">
            <p className="text-3xl sm:text-4xl font-semibold text-white mb-1.5 tabular-nums">{s.value}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Feature cards ── */}
      <div className="px-6 sm:px-10 py-20">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 text-center mb-12">
          Why apply early
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/8 rounded-2xl overflow-hidden max-w-5xl mx-auto">
          {CARDS.map((c) => (
            <div key={c.title} className="bg-[#0f0f12] p-8">
              <div className="mb-6">{c.icon}</div>
              <p className="text-lg font-semibold text-white mb-3">{c.title}</p>
              <p className="text-base text-slate-500 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Form sub-components ──────────────────────────────────────────────────────

function OptionButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left px-5 py-4 rounded-2xl border text-base font-medium transition-all duration-150",
        selected
          ? "bg-gradient-to-r from-[#FF4A26]/20 to-[#EAB308]/15 border-[#FF7A2A]/60 text-white shadow-[0_0_0_2px_rgba(255,122,42,0.2)]"
          : "bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20 hover:text-white",
      ].join(" ")}
    >
      <span className="flex items-center justify-between gap-3">
        <span>{children}</span>
        {selected && (
          <span className="shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-[#FF4A26] to-[#EAB308] flex items-center justify-center">
            <Check className="w-3 h-3 text-white" strokeWidth={3} />
          </span>
        )}
      </span>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ y: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { y: 0, opacity: 1, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
  exit: (dir: number) => ({ y: dir > 0 ? -60 : 60, opacity: 0, transition: { duration: 0.28, ease: [0.32, 0.72, 0, 1] } }),
};

export default function MainnetPage() {
  const { userId } = useAuth();
  const { user: privyUser } = usePrivy();

  const [started, setStarted] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentStep = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  useEffect(() => {
    if (!privyUser) return;
    const linked = privyUser.linkedAccounts ?? [];
    const emailAcc = linked.find((a: any) => a.type === "email" && a.address);
    if (emailAcc && !form.email) setForm((f) => ({ ...f, email: (emailAcc as any).address ?? "" }));
    const twitterAcc = linked.find((a: any) => a.type === "twitter_oauth" && a.username);
    if (twitterAcc && !form.twitter_username) setForm((f) => ({ ...f, twitter_username: `@${(twitterAcc as any).username ?? ""}` }));
  }, [privyUser]);

  useEffect(() => {
    if (started && currentStep?.type === "text") {
      const t = setTimeout(() => inputRef.current?.focus(), 400);
      return () => clearTimeout(t);
    }
  }, [step, started, currentStep?.type]);

  const getValue = (id: StepId): string => {
    const map: Record<StepId, string> = {
      name: form.display_name, email: form.email,
      telegram: form.telegram_handle, twitter: form.twitter_username,
      comms: form.preferred_comms, age: form.age_range,
      occupation: form.occupation, volume: form.payment_volume,
      payment_type: form.payment_type,
      fiat_to_crypto: form.fiat_to_crypto === null ? "" : form.fiat_to_crypto ? "yes" : "no",
      withdrawal_rails: form.withdrawal_rails,
      earn: form.earn_interest === null ? "" : form.earn_interest ? "yes" : "no",
    };
    return map[id];
  };

  const canAdvance = useCallback((): boolean => {
    const id = currentStep.id;
    if (id === "name") return form.display_name.trim().length > 0;
    if (id === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    if (id === "telegram" || id === "twitter") return true;
    if (id === "comms") return form.preferred_comms !== "";
    if (id === "age") return form.age_range !== "";
    if (id === "occupation") return form.occupation !== "";
    if (id === "volume") return form.payment_volume !== "";
    if (id === "payment_type") return form.payment_type !== "";
    if (id === "fiat_to_crypto") return form.fiat_to_crypto !== null;
    if (id === "withdrawal_rails") return form.withdrawal_rails.trim().length > 0;
    if (id === "earn") return form.earn_interest !== null;
    return false;
  }, [currentStep, form]);

  const advance = useCallback(async () => {
    if (!canAdvance()) return;
    if (step < STEPS.length - 1) {
      setDir(1);
      setStep((s) => s + 1);
    } else {
      await handleSubmit();
    }
  }, [canAdvance, step, form]);

  const back = () => {
    if (step === 0) { setStarted(false); return; }
    setDir(-1);
    setStep((s) => s - 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && currentStep.type === "text") { e.preventDefault(); advance(); }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/mainnet-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name || null,
          email: form.email || null,
          telegram_handle: form.telegram_handle || null,
          twitter_username: form.twitter_username || null,
          preferred_comms: form.preferred_comms || null,
          age_range: form.age_range || null,
          occupation: form.occupation || null,
          payment_volume: form.payment_volume || null,
          payment_type: form.payment_type || null,
          fiat_to_crypto: form.fiat_to_crypto,
          withdrawal_rails: form.withdrawal_rails,
          earn_interest: form.earn_interest,
          privy_user_id: userId || null,
          turnstile_token: turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const renderInput = () => {
    const id = currentStep.id;

    if (currentStep.type === "text") {
      const textMap: Record<string, { field: keyof FormData; placeholder: string; inputType?: string }> = {
        name: { field: "display_name", placeholder: "Your name or nickname" },
        email: { field: "email", placeholder: "you@example.com", inputType: "email" },
        telegram: { field: "telegram_handle", placeholder: "@yourhandle" },
        twitter: { field: "twitter_username", placeholder: "@yourname" },
        withdrawal_rails: { field: "withdrawal_rails", placeholder: "e.g. USDC, Revolut, BTC…" },
      };
      const cfg = textMap[id];
      return (
        <input
          ref={inputRef}
          type={cfg.inputType || "text"}
          placeholder={cfg.placeholder}
          value={(form[cfg.field] as string) || ""}
          onChange={(e) => setForm((f) => ({ ...f, [cfg.field]: e.target.value }))}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent border-b-2 border-white/20 focus:border-[#FF7A2A] outline-none text-white text-3xl py-3 placeholder-slate-600 transition-colors"
          autoComplete={cfg.inputType === "email" ? "email" : "off"}
        />
      );
    }

    if (currentStep.type === "yesno") {
      const currentVal = getValue(id);
      return (
        <div className="space-y-3">
          {[{ value: "yes", label: "Yes, definitely" }, { value: "no", label: "Not right now" }].map((opt) => (
            <OptionButton
              key={opt.value}
              selected={currentVal === opt.value}
              onClick={() => {
                const boolVal = opt.value === "yes";
                if (id === "fiat_to_crypto") setForm((f) => ({ ...f, fiat_to_crypto: boolVal }));
                if (id === "earn") setForm((f) => ({ ...f, earn_interest: boolVal }));
              }}
            >
              {opt.label}
            </OptionButton>
          ))}
        </div>
      );
    }

    if (currentStep.type === "single") {
      const optionsMap: Record<string, { value: string; label: string }[]> = {
        comms: COMMS_OPTIONS, age: AGE_OPTIONS, occupation: OCCUPATION_OPTIONS,
        volume: VOLUME_OPTIONS, payment_type: PAYMENT_TYPE_OPTIONS,
      };
      const fieldMap: Record<string, keyof FormData> = {
        comms: "preferred_comms", age: "age_range", occupation: "occupation",
        volume: "payment_volume", payment_type: "payment_type",
      };
      return (
        <div className="space-y-3">
          {(optionsMap[id] ?? []).map((opt) => (
            <OptionButton
              key={opt.value}
              selected={getValue(id) === opt.value}
              onClick={() => setForm((f) => ({ ...f, [fieldMap[id]]: opt.value }))}
            >
              {opt.label}
            </OptionButton>
          ))}
        </div>
      );
    }

    return null;
  };

  // ── Submitted ──────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <>
        <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} />
        <div className="min-h-screen bg-[#0f0f12] text-white flex items-center justify-center px-4 pb-24">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            className="max-w-md w-full text-center"
          >
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF4A26] to-[#EAB308] flex items-center justify-center mx-auto mb-6 shadow-[0_16px_40px_rgba(255,74,38,0.4)]">
              <Check className="w-10 h-10 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-3xl font-medium text-white mb-3">Request received{form.display_name ? `, ${form.display_name}` : ""}.</h1>
            <p className="text-slate-400 text-lg leading-relaxed mb-2">
              You'll be notified as soon as you get access — spots are assigned manually
              and we'll reach out directly when yours is ready.
            </p>
            <p className="text-slate-500 text-base leading-relaxed">
              Early members get up to{" "}
              <span className="text-amber-400 font-semibold">$100 cashback</span> when they start using Loofta on mainnet.
            </p>
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-left space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">What's included</p>
              {[
                "Direct notification when your access is granted",
                "Up to $100 cashback once you're active",
                "Private beta features before public launch",
                "Direct line to the founding team",
              ].map((perk) => (
                <div key={perk} className="flex items-center gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <Check className="w-3 h-3 text-amber-400" strokeWidth={3} />
                  </span>
                  <span className="text-sm text-slate-300">{perk}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </>
    );
  }

  // ── Landing ────────────────────────────────────────────────────────────────
  if (!started) {
    return (
      <>
        <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} />
        <Turnstile
          siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
          onSuccess={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          options={{ appearance: "interaction-only" }}
          className="fixed bottom-4 right-4 z-50"
        />
        <LandingScreen
          onStart={() => setStarted(true)}
          onVideo={() => setVideoOpen(true)}
          turnstileReady={!!turnstileToken}
        />
      </>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const isLast = step === STEPS.length - 1;
  const isOptional = ["telegram", "twitter"].includes(currentStep.id);
  const isChoiceStep = currentStep.type === "single" || currentStep.type === "yesno";

  return (
    <>
      <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} />

      <div className="min-h-screen bg-[#0f0f12] text-white flex flex-col pb-28">

        {/* Top bar: back + progress */}
        <div className="px-5 pt-6 pb-4 max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-4 mb-4">
            <button
              type="button"
              onClick={back}
              className="p-2 -ml-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1 h-1 rounded-full bg-white/8 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-[#FF4A26] to-[#EAB308]"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
              <span className="text-xs text-slate-500 tabular-nums shrink-0">{step + 1} / {STEPS.length}</span>
            </div>
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 flex flex-col justify-center px-5 max-w-2xl mx-auto w-full">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={currentStep.id}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="w-full"
            >
              {/* Question */}
              <h2 className="text-3xl sm:text-4xl font-medium text-white leading-snug mb-3">
                {currentStep.question}
              </h2>
              {currentStep.hint && (
                <p className="text-base text-slate-400 mb-8 leading-relaxed">{currentStep.hint}</p>
              )}
              {!currentStep.hint && <div className="mb-8" />}

              {renderInput()}

              {isOptional && (
                <p className="mt-4 text-sm text-slate-600">Optional — press Enter or Continue to skip.</p>
              )}

              {error && (
                <p className="mt-5 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}

              {/* CTAs */}
              {(!isChoiceStep || canAdvance()) && (
                <div className="mt-8 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={back}
                    className="px-6 py-3.5 rounded-2xl font-semibold text-base text-slate-400 border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all"
                  >
                    ← Back
                  </button>
                  <div className="flex items-center gap-3">
                    {currentStep.type === "text" && (
                      <span className="text-sm text-slate-600">or press Enter ↵</span>
                    )}
                    <button
                      type="button"
                      onClick={advance}
                      disabled={!canAdvance() || submitting}
                      className="px-8 py-3.5 rounded-2xl font-semibold text-base text-white bg-gradient-to-r from-[#FF4A26] to-[#EAB308] hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_24px_rgba(255,74,38,0.25)]"
                    >
                      {submitting ? "Submitting…" : isLast ? "Submit →" : "Continue →"}
                    </button>
                  </div>
                </div>
              )}
              {isChoiceStep && !canAdvance() && (
                <div className="mt-8 flex items-center justify-start">
                  <button
                    type="button"
                    onClick={back}
                    className="px-6 py-3.5 rounded-2xl font-semibold text-base text-slate-400 border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all"
                  >
                    ← Back
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </>
  );
}
