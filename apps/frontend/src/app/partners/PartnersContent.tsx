'use client'

import { useEffect, useState } from "react";
import { ArrowRight, Check, Moon, Sun } from "lucide-react";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { PARTNERS_FAQ as FAQ } from "./data";

/* =====================================================
   THEME — businesses usually prefer a light page, so the page opens light and
   switches to the dark brand look on demand. The choice is remembered per browser.
   Class strings are written out in full so Tailwind can see them.
   ===================================================== */

type Theme = "light" | "dark";
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
  { what: "Cash out to Venmo, Cash App, Revolut, Zelle", who: "Recipient", fee: "2% (min $0.10)" },
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

function ContactButtons({ theme, primaryLabel = "Book a 15 minute walkthrough" }: { theme: Theme; primaryLabel?: string }) {
  const t = THEMES[theme];
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

/* =====================================================
   PAGE
   ===================================================== */

export default function PartnersContent() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
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

  return (
    <>
      <MinimalHeader />
      <main
        className={`relative min-h-[calc(100vh-var(--header-h,0px))] overflow-hidden pb-32 transition-colors ${READABLE_FONT} ${t.page}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-60px] h-[560px] w-[1000px] -translate-x-1/2"
          style={{
            background: `radial-gradient(ellipse at center, ${t.glow}, rgba(234,179,8,0.04) 44%, transparent 66%)`,
          }}
        />

        <div className="relative mx-auto max-w-[920px] px-6 pt-24 md:px-10 md:pt-32">
          {/* Theme switch */}
          <div className="mb-10 flex justify-end">
            <ThemeToggle theme={theme} onChange={changeTheme} />
          </div>

          {/* Hero */}
          <section className="mb-20">
            <span className="text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
              Loofta for Business
            </span>
            <h1 className={`mt-[18px] text-[clamp(38px,5.4vw,62px)] font-semibold leading-[1.05] tracking-[-0.025em] ${t.ink}`}>
              Pay your clippers, affiliates and creators.
              <br />
              <span className="bg-gradient-to-r from-[#FF1301] to-[#EAB308] bg-clip-text text-transparent">
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
              <ContactButtons theme={theme} />
            </div>

            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {STATS.map((s) => (
                <div key={s.label} className={`rounded-[22px] border p-6 ${t.card}`}>
                  <p className={`text-4xl font-semibold ${t.ink}`}>{s.value}</p>
                  <p className={`mt-1 text-base leading-snug ${t.ink2}`}>{s.label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Use cases */}
          <section className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Use cases"
              title="Built for every way you pay people"
              lead="One payout flow, however your program is set up."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {USE_CASES.map((u) => (
                <div key={u.title} className={`rounded-[22px] border p-7 ${t.card}`}>
                  <h3 className={`text-xl font-semibold ${t.ink}`}>{u.title}</h3>
                  <p className={`mt-2 text-lg leading-[1.6] ${t.ink2}`}>{u.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* How it works */}
          <section className="mb-20">
            <SectionTitle theme={theme} eyebrow="How it works" title="Three steps, no wallet addresses" />
            <div className="flex flex-col gap-7">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base font-semibold text-white ${BRAND_GRADIENT}`}
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
          <section className="mb-20">
            <SectionTitle
              theme={theme}
              eyebrow="Partner program"
              title="We pay you. Your payouts can pay you back."
              lead="Most payout tools are a cost line. With Loofta, when your recipients cash out, a share of the fee comes back to you, and you can add your own markup on top."
            />
            <div className={`rounded-[26px] border p-7 ${t.card}`}>
              <p className={`text-base font-semibold uppercase tracking-[0.14em] ${t.ink3}`}>
                Example: you pay out $100,000 a month
              </p>
              <div className={`mt-4 divide-y ${t.line}`}>
                <div className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className={`text-lg ${t.ink}`}>You send $100,000, public</p>
                    <p className={`text-base ${t.ink3}`}>0.20% send fee, recipients already on Loofta</p>
                  </div>
                  <p className={`text-xl font-semibold ${t.ink}`}>$200</p>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className={`text-lg ${t.ink}`}>Recipients cash out $50,000 to Venmo, Cash App, Revolut or Zelle</p>
                    <p className={`text-base ${t.ink3}`}>2% fee, paid by the recipients</p>
                  </div>
                  <p className={`text-xl font-semibold ${t.ink}`}>$1,000</p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left">
                  <thead>
                    <tr className={`border-b ${t.line}`}>
                      <th className={`py-3 pr-4 text-base font-medium ${t.ink3}`}>Your rebate</th>
                      <th className={`py-3 pr-4 text-base font-medium ${t.ink3}`}>You earn back</th>
                      <th className={`py-3 text-base font-medium ${t.ink3}`}>After the $200 send fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REBATE_ROWS.map((r) => (
                      <tr key={r.rebate} className={`border-b last:border-b-0 ${t.line}`}>
                        <td className={`py-3 pr-4 text-lg ${t.ink}`}>{r.rebate}</td>
                        <td className={`py-3 pr-4 text-lg font-semibold ${t.ink}`}>{r.back}</td>
                        <td className={`py-3 text-lg font-semibold ${r.net.startsWith("+") ? "text-[#16A34A]" : t.ink}`}>
                          {r.net}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={`mt-4 text-base leading-relaxed ${t.ink3}`}>
                An illustration, not a quote. What you earn depends on your volume and how many
                recipients cash out to a fee-bearing method. The rebate is rolling out with our first
                partners, and rates are set per partner.
              </p>
            </div>
          </section>

          {/* Support */}
          <section className="mb-20">
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
          <section className="mb-20">
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
          <section className="mb-20">
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
          <section className="mb-20">
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
          <section className="mb-20">
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
          <div className={`relative overflow-hidden rounded-[28px] p-[1px] ${BRAND_GRADIENT}`}>
            <div className={`rounded-[27px] px-6 py-9 sm:px-10 sm:py-12 ${t.ctaInner}`}>
              <p className={`text-2xl font-semibold ${t.ink}`}>Let&apos;s set up your first payout</p>
              <p className={`mb-7 mt-2.5 max-w-lg text-lg leading-relaxed ${t.ink2}`}>
                A 15 minute walkthrough, then your API key. Tell us how many people you pay and where
                they are. Telegram is fastest.
              </p>
              <ContactButtons theme={theme} />
              <p className={`mt-4 text-base ${t.ink3}`}>
                {TELEGRAM_HANDLE} · <a href={CONTACT_HREF} className="underline underline-offset-4">{CONTACT_EMAIL}</a>
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
