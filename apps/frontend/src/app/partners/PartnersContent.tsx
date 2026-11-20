'use client'

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Gift, Landmark, Moon, Share2, Sparkles, Sun, Trophy, Users, Video, Wallet } from "lucide-react";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { PARTNERS_FAQ as FAQ } from "./data";

/* =====================================================
   THEME — businesses usually prefer a light page, so the page opens light and
   switches to the dark brand look on demand. The choice is remembered per browser.
   Class strings are written out in full so Tailwind can see them.
   ===================================================== */

type Theme = "light" | "dark" | "portal";
const THEME_KEY = "loofta-business-theme";
const DEFAULT_THEME: Theme = "light";

const THEMES = {
  light: {
    page: "bg-[#F7F6F2] text-[#14141A]",
    ink: "text-[#14141A]",
    ink2: "text-[#4B5563]",
    ink3: "text-[#6B7280]",
    card: "bg-white border-[#E5E7EB] shadow-[0_1px_2px_rgba(20,20,26,0.04)]",
    cardSoft: "bg-[#EFEDE6] border-[#E5E7EB]",
    line: "border-[#E5E7EB]",
    ghostBtn: "border-[#14141A]/20 text-[#14141A] hover:border-[#14141A]/50",
    code: "bg-[#14141A] text-slate-100 border-[#14141A]",
    ctaInner: "bg-white",
    toggle: "bg-white border-[#E5E7EB] text-[#14141A]",
    toggleOn: "bg-[#14141A] text-white",
    glow: "rgba(255,106,0,0.10)",
  },
  dark: {
    page: "bg-[#0f0f12] text-slate-100",
    ink: "text-slate-100",
    ink2: "text-[#B9C0CC]",
    ink3: "text-[#8B93A1]",
    card: "bg-[#17171E] border-white/10",
    cardSoft: "bg-[#1a1a1f] border-white/10",
    line: "border-white/10",
    ghostBtn: "border-white/20 text-slate-100 hover:border-white/40",
    code: "bg-[#0b0b0e] text-slate-200 border-white/10",
    ctaInner: "bg-[#0f0f12]",
    toggle: "bg-[#17171E] border-white/10 text-slate-100",
    toggleOn: "bg-white text-[#14141A]",
    glow: "rgba(255,106,0,0.16)",
  },
  // The partner landing: the light, quiet look of the tutorial. White cards on a soft page, one orange accent.
  portal: {
    page: "text-[#1D1D1F]",
    ink: "text-[#1D1D1F]",
    ink2: "text-[#6E6E73]",
    ink3: "text-[#86868B]",
    card: "bg-white border-black/[0.05] shadow-[0_1px_2px_rgba(20,20,26,0.04)]",
    cardSoft: "bg-white border-black/[0.05]",
    line: "border-black/[0.07]",
    ghostBtn: "border-black/10 text-[#1D1D1F] hover:border-black/25",
    code: "bg-[#14141A] text-slate-100 border-[#14141A]",
    ctaInner: "bg-white",
    toggle: "",
    toggleOn: "",
    glow: "rgba(255,255,255,0)",
  },
} as const;

// Clash Grotesk and Clash Display are hard to read in long copy. This text-heavy page uses Inter,
// which the root layout already loads, for everything except the shared header and footer.
const READABLE_FONT = "font-[family-name:var(--font-inter)]";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_14px_34px_-12px_rgba(255,19,1,0.6)]";

const CONTACT_EMAIL = "hello@loofta.xyz";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Loofta payouts walkthrough")}`;
const TELEGRAM_HANDLE = "t.me/looftaxyz";
const TELEGRAM_HREF = "https://t.me/looftaxyz";
const DOCS_HREF = "/docs";

/* =====================================================
   CONTENT
   ===================================================== */

const STATS = [
  { value: "1,000+", label: "payouts sent" },
  { value: "85%", label: "of senders pay again" },
  { value: "0", label: "wallet addresses for you to collect" },
];

const USE_CASES = [
  {
    title: "Clippers and UGC creators",
    body: "Pay clippers per view or per campaign, in bulk, to a handle or an email. They pick how to be paid.",
  },
  {
    title: "Referral and affiliate payouts",
    body: "Pay out commissions and referral rewards on a schedule, without chasing bank details or wallets.",
  },
  {
    title: "Creator and partner payouts",
    body: "Pay creators, partners and agencies across countries, each in the way they actually want.",
  },
  {
    title: "Bounties and hackathons",
    body: "Pay winners and contributors right after judging. They claim in seconds.",
  },
  {
    title: "Giveaways and rewards",
    body: "Fund a prize pool, draw winners with a verifiable on-chain draw, and pay them automatically.",
  },
  {
    title: "Teams and contractors",
    body: "Recurring and bulk payouts with approvals, across countries and payout methods.",
  },
];

const STEPS = [
  {
    title: "You pay",
    body: "Send to a social handle, email or username, one person or a list of up to 100. Any token, any chain.",
  },
  {
    title: "They claim",
    body: "The recipient opens a page with your name and logo and picks Venmo, Cash App, Revolut, Zelle, a bank, or crypto. No wallet, no seed phrase, no gas.",
  },
  {
    title: "You earn",
    body: "When they cash out, a share of the fee comes back to you. We handle the support.",
  },
];

const REBATE_ROWS = [
  { rebate: "20%", back: "$200", net: "$0, payouts are free" },
  { rebate: "30%", back: "$300", net: "+$100" },
  { rebate: "40%", back: "$400", net: "+$200" },
];

const SUPPORT_POINTS = [
  "A recipient cannot find the claim page or does not know how to cash out",
  "A cash-out is slow or fails",
  "Someone asks where their money is",
];

const QUESTIONS = [
  { q: "Do your recipients need an account to get paid?", a: "No. They claim by handle or email." },
  { q: "Do you earn when they cash out?", a: "Yes. A share of the fee comes back to you." },
  { q: "Who answers when a payout goes wrong?", a: "We do. Recipients contact us, not you." },
  { q: "Can they take cash or crypto, public or private?", a: "Yes, their choice, on the same payout." },
];

const PRICING = [
  { what: "Send, public", who: "You", fee: "0.20%" },
  { what: "Recipient is new to Loofta", who: "You", fee: "$0.10 each" },
  { what: "Private send", who: "You", fee: "$0.20 + 0.20%" },
  { what: "Claim to a USDC wallet", who: "Recipient", fee: "Free" },
  { what: "Cash out to Venmo, Cash App, Revolut, Zelle", who: "Recipient", fee: "No Loofta fee" },
  { what: "Cash out to Naira", who: "Recipient", fee: "0.05 to 0.10%" },
];

const API_SNIPPET = `const loofta = new LooftaPayClient({
  apiKey: "lft_live_..."
});
await loofta.payHuman({
  to: { type: "email", value: "a@acme.com" },
  amount: 100 });`;

/* =====================================================
   PIECES
   ===================================================== */

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const t = THEMES[theme];
  const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
  ];
  return (
    <div role="group" aria-label="Page theme" className={`inline-flex rounded-full border p-1 ${t.toggle}`}>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => onChange(value)}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-base font-medium transition-colors ${
            theme === value ? t.toggleOn : t.ink3
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function ContactButtons({ theme, primaryLabel = "Book a 15 minute walkthrough", portal, inverse }: { theme: Theme; primaryLabel?: string; portal?: PortalActions; inverse?: boolean }) {
  const t = THEMES[theme];
  if (portal) {
    // On the partner landing: Sign in or open the portal, and the tutorial. Quiet pills, no gradients.
    const primary = `inline-flex items-center gap-2 rounded-full px-7 py-4 text-[17px] font-medium transition-all hover:scale-[1.03] ${inverse ? "bg-white text-[#1D1D1F] hover:bg-white/90" : "bg-[#1D1D1F] text-white hover:bg-black"}`;
    return (
      <div className="flex flex-wrap gap-3">
        {portal.signedIn ? (
          <a href="/partner/portal" className={primary}>Open the portal</a>
        ) : (
          <button type="button" onClick={portal.onSignIn} className={primary}>Sign in to the portal</button>
        )}
        <a
          href="/partner-tutorial"
          className={`inline-flex items-center gap-2 rounded-full px-7 py-4 text-[17px] font-medium transition-all hover:scale-[1.03] ${inverse ? "border border-white/50 bg-transparent text-white hover:bg-white/10" : "border border-black/[0.08] bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#F2F2F4]"}`}
        >
          Watch the tutorial
          <ArrowRight className={`h-5 w-5 ${inverse ? "text-white" : "text-[#E8461A]"}`} />
        </a>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3.5">
      <a
        href={TELEGRAM_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2.5 rounded-full px-7 py-4 text-lg font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
      >
        {primaryLabel}
        <ArrowRight className="h-5 w-5 text-white/80" />
      </a>
      <a
        href={DOCS_HREF}
        className={`inline-flex items-center gap-2.5 rounded-full border-[1.5px] px-7 py-4 text-lg font-semibold transition-colors ${t.ghostBtn}`}
      >
        Get an API key
      </a>
    </div>
  );
}

function SectionTitle({ theme, eyebrow, title, lead }: { theme: Theme; eyebrow?: string; title: string; lead?: string }) {
  const t = THEMES[theme];
  return (
    <div className="mb-8">
      {eyebrow && (
        <p className={`mb-3 text-base font-semibold uppercase tracking-[0.16em] ${t.ink3}`}>{eyebrow}</p>
      )}
      <h2 className={`text-3xl font-semibold tracking-[-0.015em] md:text-4xl ${t.ink}`}>{title}</h2>
      {lead && <p className={`mt-3 max-w-2xl text-lg leading-[1.7] ${t.ink2}`}>{lead}</p>}
    </div>
  );
}

const CASH_APPS = [
  { name: "Revolut", logo: "/images/platforms/revolut.png" },
  { name: "Venmo", logo: "/images/platforms/venmo.png" },
  { name: "Wise", logo: "/images/platforms/wise.svg" },
  { name: "PayPal", logo: "/images/platforms/paypal.svg" },
  { name: "Cash App", logo: "/images/platforms/cashapp.webp" },
  { name: "Zelle", logo: "/images/platforms/zelle.png" },
];

/**
 * The claim page a recipient really sees (dark card, "Claim in crypto" or "Claim to cash"), playing through a claim on a loop:
 * pick cash, pick an app, done. It is a picture of the real page, not the page itself.
 */
function ClaimCard() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const steps = [2600, 2200, 2200, 2600];
    let i = 0;
    let id = 0;
    const tick = () => {
      i = (i + 1) % steps.length;
      setPhase(i);
      id = window.setTimeout(tick, steps[i]);
    };
    id = window.setTimeout(tick, steps[0]);
    return () => window.clearTimeout(id);
  }, []);
  const tile = "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#0f0f12] bg-[#1C1C22]";
  return (
    <div className="pl-float relative w-full max-w-[430px] overflow-hidden rounded-[30px] border border-white/10 bg-[#0f0f12] p-6 text-slate-100 shadow-[0_50px_90px_-30px_rgba(255,70,20,0.45),0_30px_60px_-30px_rgba(0,0,0,0.6)]">
      <div className="pl-sheen" aria-hidden />
      <div className="flex items-center gap-3.5">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF1301] to-[#EAB308] text-lg font-bold text-white">R</span>
        <div className="min-w-0">
          <p className="text-[15px] text-slate-400">Rally sent you</p>
          <p className="text-[36px] font-semibold leading-none tracking-[-0.03em] text-white">$400.00</p>
        </div>
      </div>
      <p className="mt-3 text-[15px] text-slate-400">&ldquo;Summer Quest, 1st place&rdquo;</p>

      <div className="relative mt-5 min-h-[300px]">
        {/* 0 and 1: the two ways to claim */}
        <div className={`absolute inset-0 transition-all duration-500 ${phase <= 1 ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"}`}>
          <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-4 text-base font-semibold text-white shadow-md">
            <Wallet className="h-4 w-4" />
            Claim in crypto
          </div>
          <div className="my-3.5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-base font-medium uppercase tracking-widest text-slate-500">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <div className={`rounded-2xl bg-gradient-to-r from-orange-500 via-amber-400 to-red-500 p-[1.5px] transition-transform duration-300 ${phase === 1 ? "scale-[0.97]" : ""}`}>
            <div className="flex flex-col gap-3 rounded-[calc(1rem-1.5px)] bg-[#0f0f12] px-4 py-3.5 font-semibold">
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Landmark className="h-4 w-4" />Claim to cash</span>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-medium text-amber-300">Easiest</span>
              </span>
              <span className="flex items-center -space-x-2.5">
                {CASH_APPS.map((a) => (
                  <span key={a.name} className={tile}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.logo} alt={a.name} className="h-6 w-6 object-contain" />
                  </span>
                ))}
                <span className={tile}><Landmark className="h-5 w-5 text-slate-200" /></span>
                <span className={`${tile} text-lg font-semibold text-slate-200`}>+</span>
              </span>
            </div>
          </div>
          <p className="mt-4 text-center text-[14px] text-slate-500">No wallet and no seed phrase needed</p>
        </div>

        {/* 2: pick an app */}
        <div className={`absolute inset-0 transition-all duration-500 ${phase === 2 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}>
          <p className="mb-3 text-sm font-semibold tracking-[0.14em] text-slate-400">SEND FUNDS TO</p>
          <div className="flex flex-col gap-2.5">
            {CASH_APPS.slice(0, 4).map((a, i) => (
              <div key={a.name} className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 transition-colors duration-500 ${i === 1 && phase === 2 ? "border-[#FF7A2A]/60 bg-[#FF7A2A]/[0.07]" : "border-white/[0.07] bg-[#1A1A20]"}`} style={{ transitionDelay: i === 1 ? "700ms" : "0ms" }}>
                <span className={tile}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={a.logo} alt="" className="h-6 w-6 object-contain" /></span>
                <span className="flex-1 text-base font-bold text-white">{a.name}</span>
                <span className="text-slate-500">→</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3: done */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-all duration-500 ${phase === 3 ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`}>
          <svg width="72" height="72" viewBox="0 0 76 76" fill="none"><circle cx="38" cy="38" r="34" stroke="#5fd49c" strokeWidth="3" /><path d="M24 39l10 10 19-21" stroke="#5fd49c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset={phase === 3 ? 0 : 60} style={{ transition: "stroke-dashoffset 0.7s ease 0.25s" }} /></svg>
          <p className="mt-4 text-2xl font-semibold text-white">On its way to Venmo</p>
          <p className="mt-1 text-slate-400">$395.75 · no Loofta fee</p>
        </div>
      </div>
    </div>
  );
}

const FLOATERS = [
  { n: "Mira", amt: "+$400", x: "-4%", y: "-9%", c: "#f97316", d: 0 },
  { n: "Jon", amt: "+$250", x: "62%", y: "-6%", c: "#3b82f6", d: 1.2 },
  { n: "Sana", amt: "+$150", x: "-8%", y: "96%", c: "#a855f7", d: 2.4 },
  { n: "Leo", amt: "+$100", x: "58%", y: "93%", c: "#22c55e", d: 0.6 },
];

/** Slow colour behind the hero, and a few payouts drifting past the card. */
function HeroMotion() {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[520px] w-[520px] rounded-full opacity-70 blur-3xl pl-blob" style={{ background: "radial-gradient(circle, rgba(255,106,31,0.45), rgba(255,106,31,0) 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute -left-32 top-[40%] h-[460px] w-[460px] rounded-full opacity-60 blur-3xl pl-blob2" style={{ background: "radial-gradient(circle, rgba(124,92,255,0.30), rgba(124,92,255,0) 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute bottom-[-120px] right-[18%] h-[420px] w-[420px] rounded-full opacity-60 blur-3xl pl-blob" style={{ background: "radial-gradient(circle, rgba(255,184,0,0.35), rgba(255,184,0,0) 70%)" }} />
    </>
  );
}

function Floaters() {
  return (
    <>
      {FLOATERS.map((f) => (
        <div key={f.n} className="pl-drift pointer-events-none absolute z-10 hidden items-center gap-2.5 rounded-full border border-black/[0.05] bg-white/90 py-1.5 pl-1.5 pr-4 text-[15px] font-semibold shadow-[0_14px_34px_-14px_rgba(40,25,15,0.3)] backdrop-blur lg:flex" style={{ left: f.x, top: f.y, animationDelay: `${f.d}s` }}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: f.c }}>{f.n[0]}</span>
          {f.n}
          <span className="text-[#1F9D55]">{f.amt}</span>
        </div>
      ))}
    </>
  );
}

/** Counts up to a value the first time it scrolls into view. */
function CountUp({ value }: { value: string }) {
  const m = /^([\d,]+)(.*)$/.exec(value);
  const target = m ? Number(m[1].replace(/,/g, "")) : 0;
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !m) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const run = (now: number) => {
        const k = Math.min(1, (now - start) / 1400);
        setN(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!m) return <span>{value}</span>;
  return <span ref={ref}>{n.toLocaleString("en-US")}{m[2]}</span>;
}

const PORTAL_CSS = `
@keyframes pl-up{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes pl-float{0%,100%{transform:translateY(0) rotate(-0.4deg)}50%{transform:translateY(-12px) rotate(0.4deg)}}
@keyframes pl-drift{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes pl-blob{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-40px,30px) scale(1.12)}}
@keyframes pl-blob2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(50px,-30px) scale(1.1)}}
@keyframes pl-sheen{0%{transform:translateX(-120%)}60%,100%{transform:translateX(220%)}}
.pl-hero > *{animation:pl-up .9s cubic-bezier(.22,1,.36,1) both}
.pl-hero > *:nth-child(2){animation-delay:.12s}.pl-hero > *:nth-child(3){animation-delay:.24s}.pl-hero > *:nth-child(4){animation-delay:.36s}
.pl-float{animation:pl-float 7s ease-in-out infinite}
.pl-drift{animation:pl-drift 5.5s ease-in-out infinite}
.pl-blob{animation:pl-blob 14s ease-in-out infinite}.pl-blob2{animation:pl-blob2 18s ease-in-out infinite}
.pl-sheen{position:absolute;inset:0;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.07),transparent);animation:pl-sheen 6s ease-in-out infinite;pointer-events:none}
.pl-r{opacity:0;transform:translateY(28px);transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
.pl-r.pl-in{opacity:1;transform:none}
.pl-lift{transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
.pl-lift:hover{transform:translateY(-6px);box-shadow:0 28px 50px -24px rgba(40,25,15,.3)}
@media (prefers-reduced-motion:reduce){.pl-hero>*,.pl-float,.pl-drift,.pl-blob,.pl-blob2,.pl-sheen{animation:none}.pl-r{opacity:1;transform:none;transition:none}}
`;

const USE_CASE_ICONS = [
  { Icon: Video, bg: "bg-[#FFEDE5] text-[#E8461A]" },
  { Icon: Share2, bg: "bg-[#E6EEFF] text-[#2F63E0]" },
  { Icon: Sparkles, bg: "bg-[#F1E8FF] text-[#7C3AED]" },
  { Icon: Trophy, bg: "bg-[#FFF3D6] text-[#B7791F]" },
  { Icon: Gift, bg: "bg-[#FFE6F1] text-[#D6246E]" },
  { Icon: Users, bg: "bg-[#DDF5EA] text-[#15803D]" },
];

/* =====================================================
   PAGE
   ===================================================== */

export type PortalActions = { onSignIn: () => void; signedIn?: boolean };

/**
 * The business page. `portal` renders it inside the partner portal for anyone who is not signed in: dark, in the portal's
 * own fonts and colors, with Sign in and the tutorial as the two actions. Without it, it is the public /partners page.
 */
export default function PartnersContent({ portal }: { portal?: PortalActions } = {}) {
  const [theme, setTheme] = useState<Theme>(portal ? "portal" : DEFAULT_THEME);

  useEffect(() => {
    if (portal) return;
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // storage can be blocked; the default theme is fine
    }
  }, []);

  const changeTheme = (next: Theme) => {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // not persisted, still applied for this visit
    }
  };

  const t = THEMES[theme];
  const isPortal = !!portal;
  // The partner program card is a dark band on the landing, for contrast.
  const d = isPortal ? THEMES.dark : t;

  // On the partner landing every section fades up as it scrolls into view.
  useEffect(() => {
    if (!isPortal) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    els.forEach((el) => el.classList.add("pl-r"));
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("pl-in"); io.unobserve(e.target); } }),
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isPortal]);

  return (
    <>
      {!isPortal && <MinimalHeader />}
      <main
        className={`relative transition-colors ${isPortal ? "" : "overflow-hidden"} ${isPortal ? "" : `min-h-[calc(100vh-var(--header-h,0px))] pb-32 ${READABLE_FONT}`} ${t.page}`}
      >
        {!isPortal && <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-60px] h-[560px] w-[1000px] -translate-x-1/2"
          style={{
            background: `radial-gradient(ellipse at center, ${t.glow}, rgba(234,179,8,0.04) 44%, transparent 66%)`,
          }}
        />}

        <div className={isPortal ? "relative" : "relative mx-auto max-w-[920px] px-6 pt-24 md:px-10 md:pt-32"}>
          {/* Theme switch */}
          {!isPortal && (
            <div className="mb-10 flex justify-end">
              <ThemeToggle theme={theme as Exclude<Theme, "portal">} onChange={changeTheme} />
            </div>
          )}

          {/* Hero */}
          {isPortal && <style>{PORTAL_CSS}</style>}
          <section className="relative mb-20">
            {isPortal && <HeroMotion />}
            <div className={isPortal ? "relative grid items-center gap-12 lg:grid-cols-[1.3fr_0.7fr]" : ""}>
              <div className={isPortal ? "pl-hero" : ""}>
                <span className={isPortal ? "text-[17px] font-semibold text-[#E8461A]" : "text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]"}>
                  {isPortal ? "Partner Portal" : "Loofta for Business"}
                </span>
                <h1 className={`mt-[18px] ${isPortal ? "text-[clamp(40px,4.9vw,74px)] font-bold leading-[0.98] tracking-[-0.045em]" : "text-[clamp(38px,5.4vw,62px)] font-semibold leading-[1.05] tracking-[-0.025em]"} ${t.ink}`}>
                  Pay your clippers, affiliates and creators.{" "}
                  <span className={isPortal ? "text-[#A1A1A6]" : "bg-gradient-to-r from-[#FF1301] to-[#EAB308] bg-clip-text text-transparent"}>
                    Earn on every payout.
                  </span>
                </h1>
                <p className={`mt-[22px] max-w-2xl text-[clamp(18px,2vw,22px)] leading-[1.6] ${t.ink2}`}>
                  Send money to a social handle or email, in USDC or any token. Your people choose how to
                  get paid: Venmo, Cash App, Revolut, Zelle, a bank account or crypto. You never collect a
                  wallet address or bank details, we handle the support, and a share of their cash-out
                  fees comes back to you.
                </p>
                <div className="mt-9">
                  <ContactButtons theme={theme} portal={portal} />
                </div>
              </div>
              {isPortal && (
                <div className="relative flex justify-center lg:justify-end">
                  <Floaters />
                  <ClaimCard />
                </div>
              )}
            </div>

            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {STATS.map((s) => (
                <div key={s.label} className={`rounded-[22px] border p-6 ${t.card} ${isPortal ? "pl-lift" : ""}`}>
                  <p className={`text-4xl font-semibold ${t.ink}`}>{isPortal ? <CountUp value={s.value} /> : s.value}</p>
                  <p className={`mt-1 text-base leading-snug ${t.ink2}`}>{s.label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Use cases */}
          <section data-reveal className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Use cases"
              title="Built for every way you pay people"
              lead="One payout flow, however your program is set up."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {USE_CASES.map((u, i) => (
                <div key={u.title} className={`rounded-[22px] border p-7 ${t.card} ${isPortal ? "pl-lift" : ""}`}>
                  {isPortal && (() => { const { Icon, bg } = USE_CASE_ICONS[i % USE_CASE_ICONS.length]; return <span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${bg}`}><Icon className="h-5 w-5" /></span>; })()}
                  <h3 className={`text-xl font-semibold ${t.ink}`}>{u.title}</h3>
                  <p className={`mt-2 text-lg leading-[1.6] ${t.ink2}`}>{u.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* How it works */}
          <section data-reveal className="mb-20">
            <SectionTitle theme={theme} eyebrow="How it works" title="Three steps, no wallet addresses" />
            <div className="flex flex-col gap-7">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base font-semibold ${isPortal ? "bg-gradient-to-br from-[#FF6A1F] to-[#E8461A] text-white shadow-[0_8px_20px_-8px_rgba(232,70,26,0.7)]" : `text-white ${BRAND_GRADIENT}`}`}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className={`text-xl font-semibold ${t.ink}`}>{step.title}</h3>
                    <p className={`mt-1.5 text-lg leading-[1.7] ${t.ink2}`}>{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* We pay you */}
          <section data-reveal className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Partner program"
              title="We pay you. Your payouts can pay you back."
              lead="Most payout tools are a cost line. With Loofta, when your recipients cash out, a share of the fee comes back to you, and you can add your own markup on top."
            />
            <div className={`rounded-[26px] border p-7 ${isPortal ? "border-white/10 bg-[#14141A] shadow-[0_40px_80px_-30px_rgba(20,20,26,0.6)]" : t.card}`}>
              <p className={`text-base font-semibold uppercase tracking-[0.14em] ${d.ink3}`}>
                Example: you pay out $100,000 a month
              </p>
              <div className={`mt-4 divide-y ${d.line}`}>
                <div className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className={`text-lg ${d.ink}`}>You send $100,000, public</p>
                    <p className={`text-base ${d.ink3}`}>0.20% send fee, recipients already on Loofta</p>
                  </div>
                  <p className={`text-xl font-semibold ${d.ink}`}>$200</p>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className={`text-lg ${d.ink}`}>Recipients cash out $50,000 to Venmo, Cash App, Revolut or Zelle</p>
                    <p className={`text-base ${d.ink3}`}>No Loofta fee on cash-outs</p>
                  </div>
                  <p className={`text-xl font-semibold ${d.ink}`}>$1,000</p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left">
                  <thead>
                    <tr className={`border-b ${d.line}`}>
                      <th className={`py-3 pr-4 text-base font-medium ${d.ink3}`}>Your rebate</th>
                      <th className={`py-3 pr-4 text-base font-medium ${d.ink3}`}>You earn back</th>
                      <th className={`py-3 text-base font-medium ${d.ink3}`}>After the $200 send fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REBATE_ROWS.map((r) => (
                      <tr key={r.rebate} className={`border-b last:border-b-0 ${d.line}`}>
                        <td className={`py-3 pr-4 text-lg ${d.ink}`}>{r.rebate}</td>
                        <td className={`py-3 pr-4 text-lg font-semibold ${d.ink}`}>{r.back}</td>
                        <td className={`py-3 text-lg font-semibold ${r.net.startsWith("+") ? "text-[#16A34A]" : d.ink}`}>
                          {r.net}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={`mt-4 text-base leading-relaxed ${d.ink3}`}>
                An illustration, not a quote. What you earn depends on your volume and how many
                recipients cash out to a fee-bearing method. The rebate is rolling out with our first
                partners, and rates are set per partner.
              </p>
            </div>
          </section>

          {/* Support */}
          <section data-reveal className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Support"
              title="We handle the support for your payouts"
              lead="Your recipients are our customers on the claim page. When something goes wrong, they contact us, not your team."
            />
            <div className={`rounded-[22px] border p-7 ${t.cardSoft}`}>
              <ul className="flex flex-col gap-3">
                {SUPPORT_POINTS.map((p) => (
                  <li key={p} className="flex items-start gap-3">
                    <Check className="mt-1 h-5 w-5 flex-shrink-0 text-[#16A34A]" />
                    <span className={`text-lg leading-[1.6] ${t.ink}`}>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Switching */}
          <section data-reveal className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Compare"
              title="Using Whop or another payout tool? Ask these four questions."
              lead="Here is what you get with Loofta. Put the same questions to your current provider."
            />
            <div className={`overflow-hidden rounded-[22px] border ${t.card}`}>
              {QUESTIONS.map((row, i) => (
                <div
                  key={row.q}
                  className={`grid grid-cols-1 gap-1 px-6 py-5 sm:grid-cols-[1.4fr_1fr] sm:gap-6 ${i > 0 ? `border-t ${t.line}` : ""}`}
                >
                  <p className={`text-lg font-medium ${t.ink}`}>{row.q}</p>
                  <p className={`flex items-start gap-2 text-lg ${t.ink2}`}>
                    <Check className="mt-1 h-5 w-5 flex-shrink-0 text-[#16A34A]" />
                    {row.a}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Pricing */}
          <section data-reveal className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Pricing"
              title="Simple, per payout"
              lead="No monthly fee, no setup fee. Higher volume? Custom rates, ask us."
            />
            <div className={`overflow-x-auto rounded-[22px] border ${t.card}`}>
              <table className="w-full min-w-[480px] text-left">
                <thead>
                  <tr className={`border-b ${t.line}`}>
                    <th className={`px-6 py-3 text-base font-medium ${t.ink3}`}>What</th>
                    <th className={`px-6 py-3 text-base font-medium ${t.ink3}`}>Who pays</th>
                    <th className={`px-6 py-3 text-base font-medium ${t.ink3}`}>Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {PRICING.map((r) => (
                    <tr key={r.what} className={`border-b last:border-b-0 ${t.line}`}>
                      <td className={`px-6 py-3.5 text-lg ${t.ink}`}>{r.what}</td>
                      <td className={`px-6 py-3.5 text-lg ${t.ink2}`}>{r.who}</td>
                      <td className={`px-6 py-3.5 text-lg font-semibold ${r.fee === "Free" ? "text-[#16A34A]" : t.ink}`}>
                        {r.fee}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Developers */}
          <section data-reveal className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="For developers"
              title="Plug it into your stack"
              lead="Self-serve API keys and docs, an MCP server for your AI agent, or a Telegram bot. White-label claim pages on request. An embeddable payout portal is coming next."
            />
            <pre className={`overflow-x-auto rounded-[18px] border p-5 font-mono text-base leading-[1.6] ${t.code}`}>
              {API_SNIPPET}
            </pre>
          </section>

          {/* FAQ */}
          <section data-reveal className="mb-20">
            <SectionTitle theme={theme} title="Frequently asked questions" />
            <div className="flex flex-col gap-7">
              {FAQ.map((item) => (
                <div key={item.question}>
                  <h3 className={`text-lg font-semibold ${t.ink}`}>{item.question}</h3>
                  <p className={`mt-2 text-lg leading-[1.7] ${t.ink2}`}>{item.answer}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Contact CTA */}
          <div data-reveal className={`relative overflow-hidden rounded-[28px] ${isPortal ? "bg-gradient-to-br from-[#FF6A1F] via-[#F2551B] to-[#C23A12] shadow-[0_40px_80px_-30px_rgba(232,70,26,0.7)]" : `p-[1px] ${BRAND_GRADIENT}`}`}>
            <div className={`rounded-[27px] px-6 py-9 sm:px-10 sm:py-12 ${isPortal ? "" : t.ctaInner}`}>
              <p className={`text-2xl font-semibold ${isPortal ? "text-white" : t.ink}`}>Let&apos;s set up your first payout</p>
              <p className={`mb-7 mt-2.5 max-w-lg text-lg leading-relaxed ${isPortal ? "text-white/85" : t.ink2}`}>
                A 15 minute walkthrough, then your API key. Tell us how many people you pay and where
                they are. Telegram is fastest.
              </p>
              <ContactButtons theme={theme} portal={portal} inverse={isPortal} />
              <p className={`mt-4 text-base ${isPortal ? "text-white/75" : t.ink3}`}>
                {TELEGRAM_HANDLE} · <a href={CONTACT_HREF} className="underline underline-offset-4">{CONTACT_EMAIL}</a>
              </p>
            </div>
          </div>
        </div>
      </main>
      {!isPortal && <Footer />}
    </>
  );
}
