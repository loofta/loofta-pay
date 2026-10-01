"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  AtSign,
  Check,
  ChevronDown,
  Gift,
  Landmark,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { Turnstile } from "@marsidev/react-turnstile";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import { Footer } from "@/components/layout/Footer";
import { AmountInput } from "@/components/AmountInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SocialPlatformIcon, type SocialIconPlatform } from "@/components/SocialPlatformIcon";
import { SOCIAL_PLATFORMS } from "@/lib/socialPlatforms";
import { createClaimFromEmailGuest, createClaimFromSocialGuest, createClaimFromUsernameGuest } from "@/lib/createClaimGuest";
import { createClaimFromEmail } from "@/lib/createClaimFromEmail";
import { createClaimFromUsername } from "@/lib/createClaimFromUsername";
import { createClaimFromSocial } from "@/lib/createClaimFromSocial";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { PrivacyTimingControls } from "@/components/app/PrivacyTimingControls";
import { useToast } from "@/components/ui/use-toast";
import {
  Icon3DArrowUser,
  Icon3DNumber,
  Icon3DShield,
  Icon3DStar,
} from "@/components/ui/icons3d";
import { cmcLogoForSymbol } from "@/lib/tokenImages";

// Same list + default (Twitter) as the platform picker on the real Send form
// (app/app/page.tsx SOCIAL_PICKS) — Twitter and Loofta both route through
// createClaimFromUsernameGuest, the rest through createClaimFromSocialGuest, see onSend below.
const GUEST_SOCIAL_PICKS: { id: SocialIconPlatform; name: string }[] = [
  { id: "loofta", name: "Loofta" },
  { id: "twitter", name: "Twitter" },
  ...SOCIAL_PLATFORMS.map((p) => ({ id: p.id as SocialIconPlatform, name: p.name })),
];

/* =====================================================
   DESIGN TOKENS — same system as home-v2, this is a fork
   ===================================================== */

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

const INK = "text-[#F4F2EC]";
const INK_2 = "text-[#A9A7A0]";
const INK_3 = "text-[#7D7B76]";
const BORDER_LINE = "border-[rgba(255,255,255,0.12)]";
const BORDER_LINE_2 = "border-[rgba(255,255,255,0.07)]";
const BG_PAPER_2 = "bg-[#17171E]";

const easeBrand = [0.16, 1, 0.3, 1] as const;

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.9, ease: easeBrand },
};

/* =====================================================
   WORD-BY-WORD SCROLL REVEAL
   ===================================================== */

function revealWords(text: string, opts: { delayOffset?: number; className?: string } = {}) {
  const { delayOffset = 0, className } = opts;
  const words = text.split(" ");
  return words.flatMap((word, i) => {
    const el = (
      <motion.span
        key={`${word}-${i}`}
        className="inline-block will-change-[transform,filter]"
        initial={{ opacity: 0, y: "0.4em", filter: "blur(8px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: easeBrand, delay: delayOffset + i * 0.032 }}
      >
        <span className={className}>{word}</span>
      </motion.span>
    );
    return i < words.length - 1 ? [el, " "] : [el];
  });
}

/* =====================================================
   HEADER
   ===================================================== */

function Header() {
  const navItems = [
    { label: "Send", href: "#send" },
    { label: "Claim", href: "#claim" },
    { label: "Privacy", href: "#privacy" },
    { label: "Giveaways", href: "#giveaways" },
    { label: "Rewards", href: "#rewards" },
    { label: "Business", href: "#business" },
  ];

  return (
    <header className={`sticky top-0 z-50 border-b ${BORDER_LINE_2} bg-[rgba(11,11,15,0.72)] px-6 py-5 backdrop-blur-[14px] md:px-10`}>
      <div className="mx-auto grid max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center">
        <Link href="/" className="col-start-1 justify-self-start">
          <Image src="/loofta_white.svg" alt="Loofta" width={138} height={30} priority className="h-[30px] w-auto" />
        </Link>

        <nav className="col-start-2 hidden gap-[34px] justify-self-center md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`font-grotesk text-base font-medium ${INK_2} transition-colors hover:text-[#F4F2EC]`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="relative col-start-3 justify-self-end">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-full opacity-70 blur-xl"
            style={{ background: "linear-gradient(90deg, #FF1301, #EAB308)" }}
          />
          <Link
            href={APP_URL}
            className={`inline-flex items-center gap-2.5 rounded-full px-6 py-[13px] font-display text-[17px] font-medium text-white shadow-[0_14px_34px_-12px_rgba(255,19,1,0.6)] transition-transform duration-200 hover:-translate-y-0.5 ${BRAND_GRADIENT}`}
          >
            Open app
          </Link>
        </div>
      </div>
    </header>
  );
}

/* =====================================================
   HERO — real send widget, same card structure as /fomo's PayCard
   (amount first, then recipient, then privacy — same static glow
   behind the card, same dividers), the only difference being a
   mode picker since this sends to an email OR a social handle,
   not just one fomo.family username. Branches on auth state at
   creation time, same as the main Send & Receive form's handleSend:
   signed-in visitors create through the authenticated endpoints
   (created_by correctly stamped to their account — required for
   /c/[id]'s own isCreatorView-gated UI, e.g. Edit recipient, and to
   avoid "Payment not found" firing for a signed-in creator viewing
   their own just-created claim), everyone else through the guest
   Turnstile-protected create-from-*-guest endpoints. No login
   required to send either way — only changes which endpoint set is
   used and how the claim gets attributed.
   ===================================================== */

const CARD_LABEL = `text-[13px] font-semibold uppercase tracking-[0.18em] ${INK_3}`;

// Stable reference, not a fresh object literal on every render — see the same fix and comment on
// TURNSTILE_OPTIONS in app/app/page.tsx (this form re-renders on every keystroke too, and a new
// `options` object identity was silently resetting the widget's challenge each time).
const TURNSTILE_OPTIONS = { appearance: "interaction-only" as const };

type SendMode = "social" | "email";

// Same rotating-example-word treatment as /fomo's HandleToken (FomoDepositContent.tsx) — flips
// through example handles so "@handle" in the headline reads as the product itself, not a
// placeholder. Static on prefers-reduced-motion.
const HANDLE_WORDS = ["username", "myfriend", "teammate"];
const HANDLE_FLIP_MS = 2200;

function HeroHandleWord() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => {
      setActive((i) => {
        setPrev(i);
        return (i + 1) % HANDLE_WORDS.length;
      });
    }, HANDLE_FLIP_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  return (
    <button
      type="button"
      onClick={() => {
        const el = document.getElementById("hero-recipient");
        el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        el?.focus({ preventScroll: true });
      }}
      aria-label="Type a social handle"
      className={`group inline-block align-baseline whitespace-nowrap rounded-[0.3em] border ${BORDER_LINE} bg-[#17171E] px-[0.25em] leading-[1.02] text-left hover:border-white/25 transition-colors`}
    >
      <span className={`${INK_3} group-hover:${INK_2} transition-colors`}>@</span>
      <span className="inline-grid w-max overflow-hidden align-baseline">
        {HANDLE_WORDS.map((word, i) => {
          const state = i === active ? "in" : i === prev ? "out" : "hidden";
          return (
            <span
              key={word}
              aria-hidden={i !== active}
              className={[
                `col-start-1 row-start-1 whitespace-nowrap ${INK} will-change-transform`,
                "transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                state === "in" ? "translate-y-0 opacity-100" : state === "out" ? "-translate-y-[110%] opacity-0" : "translate-y-[110%] opacity-0",
              ].join(" ")}
            >
              {word}
            </span>
          );
        })}
      </span>
    </button>
  );
}

function SendWidget() {
  const { toast } = useToast();
  const router = useRouter();
  const { authenticated } = useAuth();
  const { user, getAccessToken } = usePrivy();
  // Own identifiers, for the self-send guard in onSend below — same check as the main Send form.
  const ownUsername = useAuthStore((s) => s.username ?? null);
  const ownLooUsername = useAuthStore((s) => s.looUsername ?? null);
  const ownTwitterUsername = useAuthStore((s) => s.twitterUsername ?? null);
  const ownEmail = useAuthStore((s) => s.email ?? null);
  const [mode, setMode] = useState<SendMode>("social");
  const [recipient, setRecipient] = useState("");
  const [socialPlatform, setSocialPlatform] = useState<SocialIconPlatform>("twitter");
  const [amount, setAmount] = useState("50");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Same privacy toggle + split/delay sliders as the Send & Receive form (app/app/page.tsx) —
  // carried to /c/[id] via ?split=&delayMin= so the pay-time sliders there start from this
  // choice instead of resetting, same as privacyQuery() there.
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [split, setSplit] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [privacyInfoOpen, setPrivacyInfoOpen] = useState(false);

  const trimmedRecipient = recipient.trim().replace(/^@+/, "");
  const amountNum = Number(amount);
  const canSend = trimmedRecipient.length > 0 && amountNum >= 5;

  const onSend = async () => {
    if (!canSend || sending) return;
    // Self-send guard — see the matching comment in app/app/page.tsx's handleSend.
    if (authenticated) {
      const myIdentifiers = [ownUsername, ownLooUsername, ownTwitterUsername, ownEmail]
        .filter((v): v is string => !!v)
        .map((v) => v.replace(/^@/, "").replace(/^loo-/i, "").toLowerCase().trim());
      const candidateRecipient = trimmedRecipient.replace(/^loo-/i, "").toLowerCase().trim();
      if (candidateRecipient && myIdentifiers.includes(candidateRecipient)) {
        toast({ variant: "destructive", title: "Can't send to yourself", description: "Pick a different recipient for this payment." });
        return;
      }
    }
    if (!authenticated && !turnstileToken) {
      toast({ variant: "destructive", title: "One sec", description: "Still verifying you're not a bot — try again in a moment." });
      return;
    }
    setSending(true);
    try {
      const isTwitter = mode === "social" && socialPlatform === "twitter";
      const isLoofta = mode === "social" && socialPlatform === "loofta";
      let created: { id: string };
      if (authenticated) {
        // Signed-in creation — created_by gets correctly stamped to this account (see file header
        // comment), unlike the guest path below.
        const accessToken = await getAccessToken();
        created = mode === "email"
          ? await createClaimFromEmail({ email: trimmedRecipient.toLowerCase(), amount, userId: user?.id, accessToken, isPrivate: isPrivateMode })
          : isTwitter
            ? await createClaimFromUsername({ username: trimmedRecipient, amount, userId: user?.id, accessToken, isPrivate: isPrivateMode, treatUnregisteredAsTwitter: true })
            : isLoofta
              ? await createClaimFromUsername({ username: `loo-${trimmedRecipient.replace(/^loo-/i, "").toLowerCase()}`, amount, userId: user?.id, accessToken, isPrivate: isPrivateMode })
              : await createClaimFromSocial({ platform: socialPlatform as "discord" | "github" | "telegram", handle: trimmedRecipient, amount, userId: user?.id, accessToken, isPrivate: isPrivateMode });
      } else {
        created = mode === "email"
          ? await createClaimFromEmailGuest({ email: trimmedRecipient.toLowerCase(), amount, isPrivate: isPrivateMode, turnstileToken: turnstileToken! })
          : isTwitter
            ? await createClaimFromUsernameGuest({ username: trimmedRecipient, amount, isPrivate: isPrivateMode, treatUnregisteredAsTwitter: true, turnstileToken: turnstileToken! })
            : isLoofta
              ? await createClaimFromUsernameGuest({ username: `loo-${trimmedRecipient.replace(/^loo-/i, "").toLowerCase()}`, amount, isPrivate: isPrivateMode, turnstileToken: turnstileToken! })
              : await createClaimFromSocialGuest({ platform: socialPlatform as "discord" | "github" | "telegram", handle: trimmedRecipient, amount, isPrivate: isPrivateMode, turnstileToken: turnstileToken! });
      }
      const query = isPrivateMode ? `?split=${split}&delayMs=${delayMs}` : "";
      // Client-side transition, not window.location.href — a full page reload forces /c/[id] (a
      // large route) to cold-compile in dev, which made this look stuck on "Sending…" for
      // several seconds even though the claim had already been created successfully.
      router.push(`/c/${created.id}${query}`);
    } catch (e: unknown) {
      setSending(false);
      const msg = e instanceof Error ? e.message : undefined;
      toast({ variant: "destructive", title: "Error", description: msg && msg.length < 200 ? msg : "Failed to create payment" });
    }
  };

  const reduceMotion = useReducedMotion();

  return (
    <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.12 }} className="relative w-full max-w-[480px]">
      {/* Static glow, not an animated sheen — same treatment as /fomo's PayCard. */}
      <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[#FF4A26]/[0.08] blur-3xl" aria-hidden />
      <div className="relative rounded-[1.75rem] border border-white/10 bg-[#16161a] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] overflow-hidden">
        {/* One-time sheen sweep on load, not a looping animation — plays once and stops. */}
        {!reduceMotion && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-[-60%] z-[3] w-[60%] -skew-x-[18deg]"
            style={{ background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.4), transparent)" }}
            initial={{ left: "-60%" }}
            animate={{ left: "120%" }}
            transition={{ duration: 1, delay: 0.5, ease: "easeInOut" }}
          />
        )}

        {/* Amount — the hero of the card, same as /fomo's PayCard. */}
        <div className="relative z-[1] px-6 sm:px-7 pt-6 pb-7">
          <div className="flex items-center justify-between mb-6">
            <span className={CARD_LABEL}>Amount</span>
            <span className={`text-base ${INK_3}`}>on Solana</span>
          </div>
          <AmountInput
            id="hero-amount"
            value={amount}
            onChange={(raw) => setAmount(raw.replace(/[^0-9]/g, ""))}
            dark
            prefix="$"
            maxDecimals={0}
            maxFontPx={96}
            minFontPx={40}
            placeholder="0"
            aria-label="Amount in USD"
          />
          {amountNum > 0 && amountNum < 5 && (
            <p className="text-base text-amber-400 mt-2">Min. amount is $5</p>
          )}
        </div>

        <div className="h-px bg-white/[0.07]" aria-hidden />

        {/* To — mode picker is the one real difference from /fomo's single fomo-handle field. */}
        <div className="relative z-[1] px-6 sm:px-7 py-6">
          <div className="flex items-center justify-between mb-3">
            <span className={CARD_LABEL}>To</span>
          </div>
          <div className="flex gap-1.5 rounded-2xl bg-white/[0.06] p-1.5 mb-3">
            {([
              { k: "social" as const, label: "Social handle", icon: <AtSign className="h-4 w-4" /> },
              { k: "email" as const, label: "Email", icon: <Mail className="h-4 w-4" /> },
            ]).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => { setMode(o.k); setRecipient(""); }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 font-grotesk text-sm font-semibold transition-all duration-200 ${mode === o.k
                  ? `bg-white/[0.14] ${INK} shadow-[0_2px_8px_rgba(0,0,0,0.4)]`
                  : `${INK_3} hover:${INK_2}`
                  }`}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative">
            {mode === "email" ? (
              <span className={`absolute left-4 top-1/2 -translate-y-1/2 ${INK_3}`} aria-hidden>
                <Mail className="h-5 w-5" />
              </span>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={`absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-2 pr-1.5 py-1.5 rounded-lg bg-white/10 border border-white/15 ${INK_2} hover:${INK} hover:bg-white/[0.16] transition-colors z-10`}
                  >
                    <SocialPlatformIcon platform={socialPlatform} className="h-5 w-5" />
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-44 p-1 bg-[#17171E] border-white/10 text-white">
                  {GUEST_SOCIAL_PICKS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSocialPlatform(p.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 font-grotesk text-sm font-medium transition-colors ${socialPlatform === p.id ? `bg-white/10 ${INK}` : `${INK_2} hover:${INK} hover:bg-white/[0.06]`}`}
                    >
                      <SocialPlatformIcon platform={p.id} className="h-4 w-4 shrink-0" />
                      {p.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <input
              id="hero-recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.replace(/^@+/, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
              placeholder={mode === "email" ? "satoshi@gmail.com" : socialPlatform === "loofta" ? "Loofta username" : "satoshi"}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`w-full h-14 rounded-2xl bg-white/5 border ${BORDER_LINE} ${INK} placeholder:text-[#7D7B76] pr-4 focus:border-white/30 transition-colors ${mode === "email" ? "pl-12" : "pl-16"}`}
              style={{ fontSize: "20px" }}
            />
          </div>
        </div>

        <div className="h-px bg-white/[0.07]" aria-hidden />

        {/* Privacy + pay */}
        <div className="relative z-[1] px-6 sm:px-7 pt-5 pb-6 space-y-4">
          <IncognitoModeToggle checked={isPrivateMode} onCheckedChange={setIsPrivateMode} onLabel="Send privately" offLabel="Send privately" className="[&>span]:text-base" />

          <AnimatePresence initial={false}>
            {isPrivateMode && (
              <motion.div
                key="hero-privacy-controls"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: easeBrand }}
                className="overflow-hidden"
              >
                <PrivacyTimingControls
                  idPrefix="hero"
                  split={split}
                  onSplitChange={setSplit}
                  delayMs={delayMs}
                  onDelayMsChange={setDelayMs}
                  amountUsd={amountNum}
                  infoOpen={privacyInfoOpen}
                  onInfoOpenChange={setPrivacyInfoOpen}
                  theme="dark"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={onSend}
            disabled={!canSend || sending}
            className={`flex w-full items-center justify-center gap-2.5 rounded-full py-[18px] font-display text-lg font-medium text-white transition-all duration-300 disabled:opacity-50 ${BRAND_GRADIENT} shadow-[0_14px_34px_-12px_rgba(255,19,1,0.6)] hover:-translate-y-0.5 disabled:hover:translate-y-0`}
          >
            {sending ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Sending…</>
            ) : (
              <>Send it <ArrowRight className="h-5 w-5" strokeWidth={2} /></>
            )}
          </button>

          <div className={`flex items-center justify-center gap-2 font-grotesk text-base ${INK_3}`}>
            <Lock className="h-3.5 w-3.5" />
            They don&apos;t need an account yet
          </div>
        </div>
      </div>

      {!authenticated && (
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onSuccess={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          onError={(code) => {
            console.error("[Turnstile] error:", code);
            toast({ variant: "destructive", title: "Bot check failed", description: `Turnstile error: ${code}` });
          }}
          options={TURNSTILE_OPTIONS}
          className="fixed bottom-4 right-4 z-50"
        />
      )}
    </motion.div>
  );
}

/* =====================================================
   HERO
   ===================================================== */

function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-20 md:px-10 md:pb-32 md:pt-28">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-140px] h-[620px] w-[1100px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(255,106,0,0.14), rgba(234,179,8,0.06) 44%, transparent 66%)",
        }}
      />

      {/* items-start, not items-center — the right column's height changes when the privacy
          sliders expand, and items-center would re-center (visibly drag down) the left text
          every time that happens. Pinning both columns to the top keeps the headline still. */}
      <div className="relative z-[2] mx-auto grid max-w-[1320px] grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
        <div className="lg:pt-6">
          <div className="mb-6">
            <h1 className={`m-0 font-display text-[clamp(34px,3.8vw,54px)] font-medium leading-[1.15] tracking-[-0.03em] ${INK}`}>
              {revealWords("Send money to any")}
              <br />
              <motion.span
                className="inline-block will-change-[transform,filter]"
                initial={{ opacity: 0, y: "0.4em", filter: "blur(8px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, ease: easeBrand, delay: 0.2 }}
              >
                <HeroHandleWord />
              </motion.span>{" "}
              {revealWords("or email", { delayOffset: 0.35 })}
            </h1>
          </div>

          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.08 }}
            className={`mb-9 max-w-[540px] font-grotesk text-[clamp(18px,1.8vw,20px)] font-normal leading-[1.5] ${INK_2}`}
          >
            Just type an email address or social handle and send, they claim it whenever
            they&apos;re ready, in 150+ tokens or straight to their bank.
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.16 }}
            className="mb-9 flex flex-wrap gap-4"
          >
            <Link
              href={APP_URL}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-3 font-display text-base font-medium text-white shadow-[0_10px_24px_-10px_rgba(255,19,1,0.6)] transition-transform duration-200 hover:-translate-y-0.5 ${BRAND_GRADIENT}`}
            >
              Start sending, it&apos;s free
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <a
              href="/partners"
              className={`inline-flex items-center gap-2 rounded-full border-[1.5px] ${BORDER_LINE} px-5 py-3 font-display text-base font-medium ${INK} transition-colors duration-200 hover:border-white/40`}
            >
              For business
            </a>
          </motion.div>
        </div>

        <div className="flex justify-center lg:justify-start">
          <SendWidget />
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   PROOF STRIP
   ===================================================== */

function ProofStrip() {
  const logos = [
    { src: "/images/home-v2/solana-wordmark.svg", alt: "Solana", width: 170 },
    { src: "/images/home-v2/magicblock-wordmark.svg", alt: "MagicBlock", width: 144 },
    { src: "/images/home-v2/blink-wordmark-white.png", alt: "Blink", width: 88 },
    { src: "/images/home-v2/megapot-wordmark.svg", alt: "Megapot", width: 137 },
    { src: "/images/home-v2/superteam-ireland-wordmark.svg", alt: "Superteam Ireland", width: 110 },
  ];

  return (
    <section className="px-6 py-10 md:px-10">
      <div className="mx-auto max-w-[1320px] text-center">
        <p className={`mb-6 font-grotesk text-sm font-semibold uppercase tracking-[0.16em] ${INK_3}`}>
          Built on and backed by
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-5">
          {logos.map((l) => (
            <Image
              key={l.alt}
              src={l.src}
              alt={l.alt}
              width={l.width}
              height={26}
              className="h-[26px] w-auto grayscale opacity-[0.62] transition-all duration-300 hover:grayscale-0 hover:opacity-100"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   CLAIM — 150+ tokens + bank cash-out
   ===================================================== */

const MARQUEE_TOKENS: { symbol: string; name: string }[] = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "USDT", name: "Tether" },
  { symbol: "BNB", name: "BNB Chain" },
  { symbol: "MATIC", name: "Polygon" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "DOGE", name: "Dogecoin" },
];

function TokenPill({ symbol }: { symbol: string }) {
  const logo = cmcLogoForSymbol(symbol);
  return (
    <span className={`flex flex-shrink-0 items-center gap-3 rounded-full border ${BORDER_LINE} ${BG_PAPER_2} py-3.5 pl-3.5 pr-5`}>
      {logo && (
        <Image src={logo} alt={symbol} width={34} height={34} className="h-[34px] w-[34px] rounded-full" />
      )}
      <b className={`font-display text-[19px] font-medium ${INK}`}>{symbol}</b>
    </span>
  );
}

function TokenMarquee() {
  const track = [...MARQUEE_TOKENS, ...MARQUEE_TOKENS];
  return (
    <div className="relative mt-7 space-y-4 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div className="flex w-max gap-4 animate-marquee">
        {track.map((t, i) => <TokenPill key={`r1-${t.symbol}-${i}`} symbol={t.symbol} />)}
      </div>
      <div className="flex w-max gap-4 animate-[marquee_24s_linear_infinite_reverse]">
        {[...track].reverse().map((t, i) => <TokenPill key={`r2-${t.symbol}-${i}`} symbol={t.symbol} />)}
      </div>
    </div>
  );
}

function ClaimSection() {
  return (
    <section id="claim" className="px-6 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <motion.div {...fadeUp} className="mx-auto mb-14 max-w-[820px] text-center">
          <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
            Claim, your way
          </span>
          <h2 className={`mt-[18px] font-display text-[clamp(40px,5.4vw,72px)] font-medium leading-[1.02] tracking-[-0.035em] ${INK}`}>
            {revealWords("They receive it however")}
            <br />
            {revealWords("they", { delayOffset: 0.2 })}{" "}
            <span className="italic text-[#7D7B76]">{revealWords("actually want it.", { delayOffset: 0.24 })}</span>
          </h2>
          <p className={`mt-[22px] font-grotesk text-[clamp(18px,2vw,22px)] font-normal leading-[1.55] ${INK_2}`}>
            One link. The recipient picks the payout — hold it in any of 150+ tokens, or send it
            straight to a bank account in local currency. Loofta handles the swap and the rails.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6">
          <motion.div {...fadeUp} className={`rounded-[28px] border ${BORDER_LINE} ${BG_PAPER_2} p-10`}>
            <div className="flex items-baseline gap-3">
              <span className={`font-display text-[clamp(48px,8vw,88px)] font-medium tracking-[-0.03em] ${BRAND_GRADIENT} bg-clip-text text-transparent`}>150+</span>
              <span className={`font-display text-2xl font-medium ${INK}`}>supported tokens</span>
            </div>
            <p className={`mt-2 font-grotesk text-lg ${INK_2}`}>
              USDC, SOL, ETH, BTC, and every major asset across Solana, Base, Arbitrum, Ethereum and more.
            </p>
            <TokenMarquee />
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.08 }}
            className={`rounded-[28px] border ${BORDER_LINE} ${BG_PAPER_2} p-10`}
          >
            <h3 className={`font-display text-[34px] font-medium leading-[1.02] tracking-[-0.02em] ${INK}`}>
              Straight to the bank
            </h3>
            <p className={`mt-3.5 font-grotesk text-lg leading-[1.55] ${INK_2}`}>
              Cash out to a real bank account in USD, EUR, GBP, NGN or JPY, no exchange, no manual
              off-ramp. Money lands where they already spend it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3.5">
              {["USD", "EUR", "GBP", "NGN"].map((cur) => (
                <span
                  key={cur}
                  className={`inline-flex items-center gap-2.5 rounded-2xl border ${BORDER_LINE} bg-[rgba(255,255,255,0.04)] px-[22px] py-4 font-display text-[22px] font-medium ${INK}`}
                >
                  <Landmark className="h-5 w-5" style={{ color: "#7D7B76" }} />
                  {cur}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   PRIVACY, OPTIONAL
   ===================================================== */

function DashedConnector() {
  return <span aria-hidden className="relative w-px flex-1 border-l border-dashed border-white/20" />;
}

function PrivacySection() {
  return (
    <section id="privacy" className="px-6 py-24 md:px-10 md:py-28">
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <motion.div {...fadeUp}>
          <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
            Privacy, optional
          </span>
          <h2 className={`mt-[18px] font-display text-[clamp(40px,5.4vw,72px)] font-medium leading-[1.02] tracking-[-0.035em] ${INK}`}>
            {revealWords("Send in private")}
            <br />
            {revealWords("whenever you", { delayOffset: 0.2 })}{" "}
            <span className="italic text-[#FF6A00]">{revealWords("choose.", { delayOffset: 0.28 })}</span>
          </h2>
          <p className={`mt-[22px] font-grotesk text-[clamp(18px,2vw,22px)] leading-[1.6] ${INK_2}`}>
            Flip on Shielded mode and MagicBlock hides the link between sender and recipient — no
            one can trace who paid whom or how much. Leave it off for a normal transfer. The
            choice is yours, on every payment.
          </p>
          <ul className="mt-7 flex flex-col gap-3.5">
            {[
              "Optional Shielded mode, toggle it per payment",
              "No public sender-to-recipient trail when it's on",
              "Non-custodial, only you ever hold your keys",
            ].map((item) => (
              <li key={item} className={`flex items-start gap-3 font-grotesk text-lg font-medium ${INK}`}>
                <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white ${BRAND_GRADIENT}`}>
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.1 }}
          className={`relative hidden aspect-square flex-col items-center justify-between overflow-hidden rounded-[32px] border ${BORDER_LINE} ${BG_PAPER_2} p-8 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)] sm:flex sm:p-10`}
        >
          <div className="flex flex-col items-center gap-3">
            <Icon3DArrowUser size={72} showArrow={false} />
            <span className={`font-display text-xl font-semibold ${INK_2}`}>You</span>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-1">
            <DashedConnector />
            <ChevronDown className="h-4 w-4 text-white/25" strokeWidth={2.5} />
            <div className="relative flex h-[130px] w-[130px] shrink-0 items-center justify-center">
              <motion.span
                aria-hidden
                className="absolute h-[110px] w-[110px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,106,0,0.35), transparent 70%)" }}
                animate={{ opacity: [0.5, 0.9, 0.5], scale: [0.95, 1.05, 0.95] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <Icon3DShield size={96} />
            </div>
            <ChevronDown className="h-4 w-4 text-white/25" strokeWidth={2.5} />
            <DashedConnector />
          </div>

          <div className="flex flex-col items-center gap-3">
            <Icon3DArrowUser size={72} showArrow={false} />
            <span className={`font-display text-xl font-semibold ${INK_2}`}>Them</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* =====================================================
   HOW IT WORKS
   ===================================================== */

function HowItWorks() {
  const steps: { n: 1 | 2 | 3; title: string; body: string }[] = [
    { n: 1, title: "Type an email or @handle", body: "No wallet address, no ENS lookup, just who they already are." },
    { n: 2, title: "They get a claim link", body: "Sent instantly by email or DM, no account required to receive it." },
    { n: 3, title: "Claim in tokens or cash", body: "150+ tokens, or straight to a bank account, their call." },
  ];

  return (
    <section className="px-6 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <motion.div {...fadeUp} className="mx-auto mb-14 max-w-[720px] text-center">
          <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
            How it works
          </span>
          <h2 className={`mt-[18px] font-display text-[clamp(40px,5.4vw,72px)] font-medium leading-[1.02] tracking-[-0.035em] ${INK}`}>
            {revealWords("Three taps, done.")}
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 36 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, ease: easeBrand, delay: i * 0.15 }}
              className={`rounded-[26px] border ${BORDER_LINE} ${BG_PAPER_2} p-9`}
            >
              <Icon3DNumber n={s.n} size={72} />
              <h3 className={`mt-[22px] font-display text-[30px] font-medium leading-[1.02] ${INK}`}>{s.title}</h3>
              <p className={`mt-2.5 font-grotesk text-[19px] leading-[1.55] ${INK_2}`}>{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   GIVEAWAYS — new section, promoted out of the Business
   bullet list. Kept generalist (community/project teams),
   not enterprise-SDK framed like the Business section below.
   ===================================================== */

function GiveawaysSection() {
  const points: { icon: typeof Gift; title: string; body: string }[] = [
    { icon: ShieldCheck, title: "Escrow-funded", body: "Prize sits in escrow the moment you launch it, nothing to trust after that." },
    { icon: Sparkles, title: "On-chain draw", body: "Verifiably random winner selection, nothing for anyone to dispute." },
    { icon: Gift, title: "Free to list", body: "No setup cost, live in minutes, no code required." },
  ];

  return (
    <section id="giveaways" className="px-6 py-24 md:px-10 md:py-28">
      <div className={`mx-auto max-w-[1240px] overflow-hidden rounded-[40px] border ${BORDER_LINE} ${BG_PAPER_2} p-9 md:p-16`}>
        <motion.div {...fadeUp} className="mx-auto max-w-[820px] text-center">
          <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
            Giveaways
          </span>
          <h2 className={`mt-[18px] font-display text-[clamp(38px,4.6vw,64px)] font-medium leading-[1.02] tracking-[-0.035em] ${INK}`}>
            {revealWords("Grow your community")}
            <br />
            {revealWords("with a giveaway.", { delayOffset: 0.22, className: "italic text-[#FF6A00]" })}
          </h2>
          <p className={`mx-auto mt-[22px] max-w-[620px] font-grotesk text-xl leading-[1.6] ${INK_2}`}>
            Fund a prize, share one link, let people enter. The draw is on-chain and the prize is
            already in escrow — nothing to manually pay out, nothing to argue about after.
          </p>
        </motion.div>

        <div className="mx-auto mt-12 grid max-w-[980px] grid-cols-1 gap-5 sm:grid-cols-3">
          {points.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, ease: easeBrand, delay: i * 0.1 }}
              className={`rounded-[22px] border ${BORDER_LINE_2} bg-white/[0.03] p-6 text-center`}
            >
              <span className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-white ${BRAND_GRADIENT}`}>
                <p.icon className="h-5 w-5" strokeWidth={2} />
              </span>
              <h3 className={`mt-4 font-display text-xl font-medium ${INK}`}>{p.title}</h3>
              <p className={`mt-1.5 font-grotesk text-base leading-[1.5] ${INK_2}`}>{p.body}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <a
            href="/giveaways"
            className={`inline-flex items-center gap-2.5 rounded-full px-8 py-5 font-display text-[20px] font-medium text-white shadow-[0_14px_34px_-12px_rgba(255,19,1,0.6)] transition-transform duration-200 hover:-translate-y-0.5 ${BRAND_GRADIENT}`}
          >
            Launch a giveaway
            <ArrowRight className="h-5 w-5" strokeWidth={2} />
          </a>
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   BUSINESS
   ===================================================== */

function BusinessSection() {
  const bullets = [
    "Payouts to email, social handle or bank, no wallet required",
    "150+ settlement tokens with automatic swaps",
    "Drop-in SDK & hosted checkout, live in a day",
  ];

  return (
    <section id="business" className="px-6 py-24 md:px-10 md:py-28">
      <div className={`mx-auto max-w-[1240px] overflow-hidden rounded-[40px] border ${BORDER_LINE} ${BG_PAPER_2} p-9 md:p-16`}>
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div {...fadeUp}>
            <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
              For business
            </span>
            <h2 className={`mt-[18px] font-display text-[clamp(38px,4.6vw,58px)] font-medium leading-[1.02] tracking-[-0.035em] ${INK}`}>
              {revealWords("Onboard the next")}
              <br />
              {revealWords("generation of crypto users.", { delayOffset: 0.22 })}
            </h2>
            <p className={`mt-[22px] font-grotesk text-xl leading-[1.6] ${INK_2}`}>
              Integrate Loofta and let anyone pay or get paid with nothing but an email, no
              wallet setup, no drop-off. One SDK, and your users are live.
            </p>
            <ul className="mt-7 flex flex-col gap-3.5">
              {bullets.map((item) => (
                <li key={item} className={`flex items-start gap-3 font-grotesk text-lg font-medium ${INK}`}>
                  <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white ${BRAND_GRADIENT}`}>
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a
                href="https://t.me/looftaxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-full bg-[#F4F2EC] px-8 py-5 font-display text-[22px] font-medium text-[#0B0B0F] transition-transform duration-200 hover:-translate-y-0.5"
              >
                Talk to sales
                <ArrowRight className="h-5 w-5" strokeWidth={2} />
              </a>
              <Link
                href="/partners"
                className={`inline-flex items-center gap-2.5 rounded-full border-[1.5px] ${BORDER_LINE} bg-[#0B0B0F] px-8 py-5 font-display text-[22px] font-medium ${INK} transition-colors duration-200 hover:border-white/40`}
              >
                Read more
              </Link>
            </div>
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.1 }}
            className="rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[#141419] p-7 font-mono text-[15px] leading-[1.9] text-[#E6E4DE] shadow-[0_30px_70px_-30px_rgba(0,0,0,0.5)]"
          >
            <div className="mb-[18px] flex gap-2">
              {[0, 1, 2].map((i) => <span key={i} className="h-3 w-3 rounded-full bg-[#3A3A44]" />)}
            </div>
            <div className="text-[#6B6B78]">{"// send with just an email"}</div>
            <div><span className="text-[#FF9E6D]">await</span> loofta.<span className="text-[#7CD9A8]">send</span>({"{"}</div>
            <div>&nbsp;&nbsp;to: <span className="text-[#7CD9A8]">&quot;satoshi@gmail.com&quot;</span>,</div>
            <div>&nbsp;&nbsp;amount: <span className="text-[#7CD9A8]">50</span>,</div>
            <div>&nbsp;&nbsp;token: <span className="text-[#7CD9A8]">&quot;USDC&quot;</span>,</div>
            <div>&nbsp;&nbsp;rewards: <span className="text-[#FF9E6D]">true</span></div>
            <div>{"});"}</div>
            <div className="mt-3 text-[#6B6B78]">{"// -> recipient claims, no wallet needed"}</div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   REWARDS — daily jackpot (illustrative), live countdown
   ===================================================== */

function useCountdownTo710PMCET() {
  const [time, setTime] = useState({ h: "00", m: "00", s: "00" });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 10, 0));
      if (target.getTime() - now.getTime() <= 0) target.setUTCDate(target.getUTCDate() + 1);
      let secs = Math.floor((target.getTime() - now.getTime()) / 1000);
      const h = Math.floor(secs / 3600); secs %= 3600;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime({ h: pad(h), m: pad(m), s: pad(s) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return time;
}

function RewardsSection() {
  const { h, m, s } = useCountdownTo710PMCET();

  return (
    <section id="rewards" className="px-6 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-[40px] border border-[rgba(255,255,255,0.1)] bg-[#131319] px-5 py-12 text-center sm:px-8 md:px-16 md:py-14"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 60% 60% at 50% 0%, rgba(255,106,0,0.35), transparent 60%), radial-gradient(ellipse 70% 50% at 50% 120%, rgba(234,179,8,0.25), transparent 60%)",
            }}
          />
          <div className="relative z-[1]">
            <span className="inline-flex items-center gap-2 font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#EAB308]">
              Daily prize pool · powered by Megapot
            </span>

            <div className={`mt-[34px] font-display text-[clamp(38px,11vw,110px)] font-semibold leading-[0.9] tracking-[-0.03em] ${BRAND_GRADIENT} bg-clip-text text-transparent`}>
              $1,100,000
            </div>
            <p className={`mt-1.5 font-grotesk text-base ${INK_3}`}>
              draws every day at 5:10pm UTC
            </p>

            <div className="mt-[34px] flex justify-center gap-2.5 sm:gap-5">
              {[{ v: h, l: "Hrs" }, { v: m, l: "Min" }, { v: s, l: "Sec" }].map((c) => (
                <div key={c.l} className={`min-w-[76px] rounded-2xl border border-[rgba(255,255,255,0.12)] bg-white/[0.06] px-3 py-3.5 sm:min-w-[110px] sm:px-[26px] sm:py-5`}>
                  <div className={`font-display text-[32px] font-medium leading-none tabular-nums sm:text-[52px] ${INK}`}>{c.v}</div>
                  <div className="mt-1 font-grotesk text-sm font-semibold uppercase tracking-[0.16em] text-white/50">{c.l}</div>
                </div>
              ))}
            </div>

            <p className="mx-auto mt-10 max-w-[760px] font-grotesk text-[clamp(22px,2.6vw,32px)] font-medium leading-[1.4] text-white">
              Sending payments earns you Megapot tickets. Pay your friends,
              get paid, and stack entries into the jackpot, automatically.
            </p>

            <div className="mx-auto mt-8 inline-flex flex-col items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-white/[0.06] px-8 py-6 font-grotesk text-white sm:px-12 sm:py-8">
              <span className="h-[26px] w-[26px] sm:h-[34px] sm:w-[34px] [&>svg]:h-full [&>svg]:w-full">
                <Icon3DStar size={34} />
              </span>
              <span className="font-display text-2xl font-medium text-[#EAB308] sm:text-[32px]">Win tickets</span>
              <span className="text-base text-white/60 sm:text-lg">just by sending payments, no cost, no catch</span>
            </div>

            <a
              href="/blog/how-loofta-daily-lottery-works"
              className="mt-6 block font-grotesk text-sm font-medium text-white/60 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
            >
              Learn how the daily draw works
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* =====================================================
   FINAL CTA
   ===================================================== */

function FinalCTA() {
  return (
    <section className="px-6 py-28 text-center md:px-10 md:py-32">
      <motion.div {...fadeUp} className="mx-auto max-w-[1240px]">
        <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
          Get started
        </span>
        <h2 className={`mt-5 font-display text-[clamp(48px,7vw,100px)] font-medium leading-[1.02] tracking-[-0.035em] ${INK}`}>
          {revealWords("Send money like")}
          <br />
          {revealWords("you send a", { delayOffset: 0.2 })}{" "}
          {revealWords("text.", {
            delayOffset: 0.28,
            className: "italic text-[#FF6A00]",
          })}
        </h2>
        <p className={`mx-auto mt-[26px] max-w-[600px] font-grotesk text-[22px] ${INK_2}`}>
          Free to start. Your recipient claims in seconds. You collect Megapot tickets along the way.
        </p>
        <div className="mt-9 flex justify-center">
          <Link
            href={APP_URL}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-6 py-4 font-display text-lg font-medium text-white shadow-[0_14px_34px_-12px_rgba(255,19,1,0.6)] transition-transform duration-200 hover:-translate-y-0.5 sm:gap-2.5 sm:px-8 sm:py-5 sm:text-[22px] ${BRAND_GRADIENT}`}
          >
            Send your first payment
            <ArrowRight className="h-5 w-5" strokeWidth={2} />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

/* =====================================================
   PAGE

   Fork of HomeV2Content (see ../home-v2/HomeV2Content.tsx) —
   draft for review, not live yet. Two changes from v2:
   1. Hero's SendWidget is now a real form (hands off into the
      Send form prefilled) instead of a fake animated mock.
   2. New GiveawaysSection, given its own section instead of
      being one bullet buried inside BusinessSection.
   ===================================================== */

export default function HomeV3Content() {
  return (
    <div className={`min-h-screen bg-[#0B0B0F] font-grotesk ${INK}`}>
      <Header />
      <main id="send">
        <Hero />
        <ProofStrip />
        <ClaimSection />
        <PrivacySection />
        <HowItWorks />
        <GiveawaysSection />
        <BusinessSection />
        <RewardsSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
