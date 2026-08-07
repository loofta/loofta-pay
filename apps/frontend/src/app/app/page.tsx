'use client'

import { useState, useEffect, useRef, type ReactNode, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { useMultiSendStore } from "@/store/multiSend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSendFlow } from "@/components/app/MultiSendFlow";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { MessageInput } from "@/components/MessageInput";
import { SocialPlatformIcon, type SocialIconPlatform } from "@/components/SocialPlatformIcon";
import { SOCIAL_PLATFORMS } from "@/lib/socialPlatforms";
import { createClaimFromEmail } from "@/lib/createClaimFromEmail";
import { createClaimFromUsername } from "@/lib/createClaimFromUsername";
import { createClaimFromSocial } from "@/lib/createClaimFromSocial";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, AtSign, ChevronDown, LinkIcon, Lock, Mail, User, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/use-toast";

const ClaimPageContent = dynamic<{ embedInApp?: boolean }>(
  () => import("@/app/app/claim/ClaimPageContent").then((mod) => ({ default: mod.ClaimPageContent })),
  { ssr: false }
);

type SendMethod = "email" | "social" | "username";
type SocialSendPlatform = SocialIconPlatform;
const SOCIAL_PICKS: { id: SocialSendPlatform; name: string }[] = [
  { id: "twitter", name: "Twitter" },
  ...SOCIAL_PLATFORMS.map((p) => ({ id: p.id as SocialSendPlatform, name: p.name })),
];

const HOME_TAB_KEY = "loofta.home.tab";

/**
 * Twitter/Discord/GitHub logins triggered from privyLogin() can fall back to a full top-level
 * redirect (not a popup) in some browsers/webviews — same behavior as the Telegram relay flow —
 * which reloads this page and wipes plain React state. sessionStorage survives that reload, so
 * the draft is restored on the next mount instead of forcing the sender to retype everything.
 */
const SEND_DRAFT_KEY = "loofta.send.formDraft";
type SendDraft = {
  recipient: string;
  amount: string;
  description: string;
  gifUrl: string | null;
  sendMethod: SendMethod;
  socialPlatform: SocialSendPlatform | null;
};
function readSendDraft(): SendDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SEND_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as SendDraft) : null;
  } catch {
    return null;
  }
}

const bold = (chunks: ReactNode) => (
  <span className="font-medium text-slate-300">{chunks}</span>
);

export default function Home() {
  const t = useTranslations('HomePage');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { authenticated } = useAuth();
  const username = useAuthStore((s) => s.username ?? null);
  const networkMode = useAuthStore((s) => s.networkMode);
  const canMultiSend = true;
  const { login: privyLogin, getAccessToken, user } = usePrivy();
  const [activeTab, setActiveTabState] = useState<"send" | "receive">(() => {
    const fromUrl = searchParams.get("tab") === "receive" ? "receive" : null;
    if (fromUrl) return fromUrl;
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(HOME_TAB_KEY);
      if (stored === "send" || stored === "receive") return stored;
    }
    return "send";
  });

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "receive") setActiveTabState("receive");
    else setActiveTabState("send");
  }, [searchParams]);

  const toParam = searchParams.get("to");
  useEffect(() => {
    if (!toParam) return;
    const clean = toParam.replace(/^@/, "").trim().toLowerCase();
    if (!clean) return;
    setActiveTabState("send");
    setRecipient(clean.replace(/^@+/, ""));
    const amt = searchParams.get("amount");
    if (amt != null && amt !== "" && !isNaN(Number(amt)) && Number(amt) >= 0) setAmount(amt);
    // Set by history's "send again" link so a repeat send lands on the same method/platform
    // tab the original payment used, instead of always defaulting to email.
    const method = searchParams.get("method");
    if (method === "email" || method === "username" || method === "social") setSendMethod(method);
    if (method === "social") {
      const platform = searchParams.get("platform");
      if (platform === "twitter" || platform === "discord" || platform === "github" || platform === "telegram") {
        setSocialPlatform(platform);
      }
    }
  }, [toParam, searchParams]);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setActiveTabState("receive");
      setShowClaimOverlay(true);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
  }, [searchParams]);

  const setActiveTab = (tab: "send" | "receive") => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") localStorage.setItem(HOME_TAB_KEY, tab);
  };
  const { toast } = useToast();
  const [recipient, setRecipient] = useState(() => readSendDraft()?.recipient ?? "");
  const [amount, setAmount] = useState(() => readSendDraft()?.amount ?? "");
  const [description, setDescription] = useState(() => readSendDraft()?.description ?? "");
  const [gifUrl, setGifUrl] = useState<string | null>(() => readSendDraft()?.gifUrl ?? null);
  /** "SEND TO" pill selection — matches the reference screenshot's Email/Social handle tabs, plus a Loofta username option. */
  const [sendMethod, setSendMethod] = useState<SendMethod>(() => readSendDraft()?.sendMethod ?? "email");
  /** Defaults to Twitter — the most common case — rather than making everyone pick a platform first. */
  const [socialPlatform, setSocialPlatform] = useState<SocialSendPlatform | null>(
    () => readSendDraft()?.socialPlatform ?? "twitter",
  );

  // Keep the draft in sync so a mid-login page reload (see SEND_DRAFT_KEY above) can restore it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft: SendDraft = { recipient, amount, description, gifUrl, sendMethod, socialPlatform };
    sessionStorage.setItem(SEND_DRAFT_KEY, JSON.stringify(draft));
  }, [recipient, amount, description, gifUrl, sendMethod, socialPlatform]);
  const [creating, setCreating] = useState(false);
  const { showMultiSend, setShowMultiSend } = useMultiSendStore();
  const [linkCopied, setLinkCopied] = useState(false);
  const [showClaimOverlay, setShowClaimOverlay] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const [amountInputWidthPx, setAmountInputWidthPx] = useState<number>(0);
  const looPrefixMirrorRef = useRef<HTMLSpanElement | null>(null);
  const [looPrefixWidthPx, setLooPrefixWidthPx] = useState<number>(0);

  function sanitizeNumberInput(v: string, maxDecimals: number = 9) {
    let s = String(v || "").replace(/,/g, ".");
    s = s.replace(/[^0-9.]/g, "");
    const hadTrailingDot = s.endsWith(".");
    const parts = s.split(".");
    if (parts.length > 2) {
      s = parts[0] + "." + parts.slice(1).join("");
    }
    const p = s.split(".");
    if (p.length === 2) {
      const int = p[0] || "";
      const dec = (p[1] || "").slice(0, Math.max(0, maxDecimals));
      const result = dec.length > 0 ? `${int}.${dec}` : int;
      return hadTrailingDot && dec === "" ? `${int}.` : result;
    }
    return p[0] || "";
  }

  function onChangeAmount(v: string) {
    setAmount(v.replace(/[^0-9]/g, ""));
  }

  const displayAmount = (amount && amount.length > 0) ? amount : "0";

  const totalDigitsCount = (() => {
    const onlyDigits = String(amount || "").replace(/[^0-9]/g, "");
    return onlyDigits.length || 1;
  })();

  function computeFontPx(digits: number) {
    const maxPx = 72;
    const minPx = 28;
    const startDigits = 5;
    const stepPerDigit = 7;
    const delta = Math.max(0, digits - startDigits) * stepPerDigit;
    return Math.max(minPx, maxPx - delta);
  }

  const amountFontPx = computeFontPx(totalDigitsCount);
  const suffixFontPx = Math.max(18, Math.round(amountFontPx * 0.62));
  const amountGapPx = 8;

  useEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAmountInputWidthPx(Math.ceil(rect.width));
  }, [displayAmount, amountFontPx]);

  useEffect(() => {
    const el = looPrefixMirrorRef.current;
    if (!el) return;
    setLooPrefixWidthPx(Math.ceil(el.getBoundingClientRect().width));
  }, [sendMethod]);

  const faqItems: { question: string; answer: ReactNode }[] = useMemo(() => [
    {
      question: t('faq.fees.question'),
      answer: (
        <>
          <p className="mb-3 last:mb-0">
            {t.rich('faq.fees.answer1', { bold })}
          </p>
          <p className="mb-0">
            {t('faq.fees.answer2')}
          </p>
        </>
      ),
    },
    {
      question: t('faq.privatePayments.question'),
      answer: t('faq.privatePayments.answer'),
    },
    {
      question: t('faq.sendBeforeAccount.question'),
      answer: t('faq.sendBeforeAccount.answer'),
    },
    {
      question: t('faq.retrieveWallet.question'),
      answer: (
        <>
          <p className="mb-3 last:mb-0">
            {t.rich('faq.retrieveWallet.answer1', { bold })}
          </p>
          <p className="mb-3 last:mb-0">
            {t.rich('faq.retrieveWallet.answer2', { bold })}
          </p>
          <p className="mb-3 last:mb-0">
            {t.rich('faq.retrieveWallet.answer3', { bold })}
          </p>
          <p className="mb-0">
            {t.rich('faq.retrieveWallet.answer4', { bold })}
          </p>
        </>
      ),
    },
    {
      question: t('faq.burnerWallet.question'),
      answer: t('faq.burnerWallet.answer'),
    },
    {
      question: t('faq.morphoVault.question'),
      answer: (
        <>
          <p className="mb-3 last:mb-0">{t('faq.morphoVault.answer1')}</p>
          <p className="mb-3 last:mb-0">{t('faq.morphoVault.answer2')}</p>
          <p className="mb-0">{t('faq.morphoVault.answer3')}</p>
        </>
      ),
    },
    {
      question: t('faq.looftaPoints.question'),
      answer: (
        <>
          <p className="mb-3 last:mb-0">{t('faq.looftaPoints.answer1')}</p>
          <p className="mb-0">{t('faq.looftaPoints.answer2')}</p>
        </>
      ),
    },
    {
      question: t('faq.apy.question'),
      answer: t('faq.apy.answer'),
    },
    {
      question: t('faq.devnet.question'),
      answer: t.rich('faq.devnet.answer', {
        solanaLink: (chunks) => (
          <a href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer" className="underline text-amber-400 hover:text-amber-300">
            {chunks}
          </a>
        ),
        circleLink: (chunks) => (
          <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="underline text-amber-400 hover:text-amber-300">
            {chunks}
          </a>
        ),
      }),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t]);

  const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";
  const minAmountUsd = 5;
  const amountNum = Number(amount);
  const canSend =
    recipient.trim().length > 0 &&
    !!amount &&
    Number.isFinite(amountNum) &&
    amountNum >= minAmountUsd &&
    (sendMethod !== "social" || !!socialPlatform);

  const handleSend = async () => {
    const trimmed = recipient.replace(/^@/, "").trim();
    if (!trimmed || !amount) return;
    if (!authenticated) {
      privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false });
      return;
    }
    if (amountNum < minAmountUsd) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Minimum payment amount is $5.00 USDC." });
      return;
    }
    setCreating(true);
    const fullDescription = [description.trim(), gifUrl].filter(Boolean).join(" ").trim() || undefined;
    try {
      const accessToken = await getAccessToken();
      let result: { id: string };
      if (sendMethod === "social" && socialPlatform && socialPlatform !== "twitter") {
        result = await createClaimFromSocial({
          platform: socialPlatform,
          handle: trimmed,
          amount,
          userId: user?.id,
          accessToken,
          // Privacy is opt-in and decided at pay time (the incognito toggle on /c/[id]), not here.
          isPrivate: false,
          description: fullDescription,
          cluster: apiCluster,
        });
      } else if (sendMethod === "email") {
        result = await createClaimFromEmail({
          email: trimmed.toLowerCase(),
          amount,
          userId: user?.id,
          accessToken,
          // Privacy is opt-in and decided at pay time (the incognito toggle on /c/[id]), not here.
          isPrivate: false,
          description: fullDescription,
          cluster: apiCluster,
        });
      } else if (sendMethod === "username") {
        // "loo-" is a fixed prefix in the UI (recipient state only holds the suffix here).
        result = await createClaimFromUsername({
          username: `loo-${trimmed.toLowerCase()}`,
          amount,
          userId: user?.id,
          accessToken,
          // Privacy is opt-in and decided at pay time (the incognito toggle on /c/[id]), not here.
          isPrivate: false,
          description: fullDescription,
          cluster: apiCluster,
        });
      } else {
        // Twitter handle (resolved via the existing username/twitter_username fallback).
        // treatUnregisteredAsTwitter tags an unresolved handle as pending-Twitter (not a bare
        // pending username) so "edit recipient" on /c/[id] later shows Twitter as selected.
        result = await createClaimFromUsername({
          username: trimmed.toLowerCase(),
          amount,
          userId: user?.id,
          accessToken,
          // Privacy is opt-in and decided at pay time (the incognito toggle on /c/[id]), not here.
          isPrivate: false,
          description: fullDescription,
          cluster: apiCluster,
          treatUnregisteredAsTwitter: true,
        });
      }
      sessionStorage.removeItem(SEND_DRAFT_KEY);
      router.push(`/c/${result.id}`);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to create payment",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="min-h-[calc(100vh-var(--header-h,0px))]">

          <div className="hidden md:block">
            <SendReceiveTabs activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab)} />
          </div>

          {activeTab === "send" && (
            <>
              {showMultiSend && canMultiSend ? (
                <MultiSendFlow onBack={() => { setShowMultiSend(false); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }} />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 text-xl font-sans font-medium">{t('send')}</Label>
                    {canMultiSend && (
                      <button
                        type="button"
                        onClick={() => { setShowMultiSend(true); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
                        className="text-slate-500 hover:text-slate-300 text-sm font-medium transition-colors"
                      >
                        {t('multiSend')}
                      </button>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="rounded-2xl">
                    <div className="flex items-baseline tabular-nums">
                      <span
                        className="font-semibold font-sans text-slate-500 mr-1"
                        style={{ fontSize: `${suffixFontPx}px`, lineHeight: 1.05 }}
                      >
                        $
                      </span>
                      <span
                        ref={mirrorRef}
                        aria-hidden="true"
                        className="invisible absolute -z-50 font-sans font-medium tracking-tight tabular-nums"
                        style={{ fontSize: `${amountFontPx}px`, lineHeight: 1.05 }}
                      >
                        {displayAmount}
                      </span>
                      <input
                        inputMode="numeric"
                        value={amount}
                        onBeforeInput={(e) => {
                          const data = (e.nativeEvent as InputEvent).data;
                          if (data && /[^0-9]/.test(data)) e.preventDefault();
                        }}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^0-9]/g, "");
                          e.target.value = cleaned;
                          onChangeAmount(cleaned);
                        }}
                        placeholder="0"
                        className={[
                          "text-white placeholder:text-slate-600",
                          "font-semibold font-sans tracking-tight tabular-nums",
                          "border-0 bg-transparent outline-none p-0 m-0",
                        ].join(" ")}
                        style={{
                          fontSize: `${amountFontPx}px`,
                          lineHeight: 1.05,
                          width: `${Math.max(amountInputWidthPx, Math.round(amountFontPx * 0.6)) + amountGapPx}px`,
                        }}
                        aria-label={t('amountLabel')}
                      />
                    </div>
                  </div>
                  {amountNum > 0 && amountNum < minAmountUsd && (
                    <p className="text-sm text-amber-400 -mt-3">Min. amount is $5.00 USDC</p>
                  )}

                  {/* SEND TO pills */}
                  <div>
                    <Label className="text-slate-400 text-sm mb-2 block">{t('to')}</Label>
                    <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10">
                      {([
                        { id: "email" as const, label: "Email", icon: Mail },
                        { id: "social" as const, label: "Social handle", icon: AtSign },
                        { id: "username" as const, label: "Username", icon: User },
                      ]).map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSendMethod(id)}
                          title={label}
                          aria-label={label}
                          className={[
                            "inline-flex items-center justify-center gap-1.5 h-11 min-w-11 px-4 rounded-full text-sm font-medium transition-colors",
                            sendMethod === id
                              ? "bg-white text-[#0f0f12]"
                              : "text-slate-400 hover:text-white",
                          ].join(" ")}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {/* Icon-only on mobile unless selected (keeps tap targets from cramping);
                              always shown from sm: up, since desktop has plenty of room. */}
                          <span
                            className={[
                              "whitespace-nowrap overflow-hidden transition-all duration-200",
                              sendMethod === id
                                ? "max-w-[160px] opacity-100"
                                : "max-w-0 opacity-0 sm:max-w-[160px] sm:opacity-100",
                            ].join(" ")}
                          >
                            {label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input row — for Social handle, the leading icon is a popover trigger (visibly a
                      control at rest, not just on hover) so picking a platform never adds/removes a
                      row and shifts this input's position. For Username, "loo-" is a fixed, non-editable
                      prefix rendered outside the actual input value — it can't be backspaced away since
                      it was never part of the editable text. */}
                  <div className="relative">
                    {sendMethod === "social" ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-2 pr-1.5 py-1.5 rounded-lg bg-white/10 border border-white/15 text-slate-200 hover:text-white hover:bg-white/[0.16] transition-colors"
                          >
                            {socialPlatform ? (
                              <SocialPlatformIcon platform={socialPlatform} className="h-4 w-4" />
                            ) : (
                              <AtSign className="h-4 w-4" />
                            )}
                            <ChevronDown className="h-3 w-3 opacity-70" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-44 p-1 bg-[#1a1a1f] border-white/10 text-white">
                          {SOCIAL_PICKS.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setSocialPlatform(p.id)}
                              className={[
                                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                                socialPlatform === p.id ? "bg-white/10 text-white" : "text-slate-300 hover:text-white hover:bg-white/[0.06]",
                              ].join(" ")}
                            >
                              <SocialPlatformIcon platform={p.id} className="h-4 w-4 shrink-0" />
                              {p.name}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    ) : sendMethod === "username" ? (
                      <>
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                          <AtSign className="h-4 w-4" />
                        </span>
                        <span
                          ref={looPrefixMirrorRef}
                          aria-hidden="true"
                          className="invisible absolute -z-50 font-medium whitespace-pre"
                          style={{ fontSize: `20px` }}
                        >
                          loo-
                        </span>
                        <span
                          className="absolute left-10 top-1/2 -translate-y-1/2 text-white font-medium select-none pointer-events-none"
                          style={{ fontSize: `20px` }}
                        >
                          loo-
                        </span>
                      </>
                    ) : (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                        <Mail className="h-4 w-4" />
                      </span>
                    )}
                    <Input
                      type="text"
                      name="send-to-recipient"
                      placeholder={
                        sendMethod === "email"
                          ? t('recipientPlaceholder')
                          : sendMethod === "username"
                            ? "Loofta username"
                            : socialPlatform
                              ? `${SOCIAL_PICKS.find((p) => p.id === socialPlatform)?.name ?? ""} username`
                              : "Pick a platform"
                      }
                      value={recipient}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const trimmed = sendMethod === "username"
                          ? raw.replace(/^loo-/, "").replace(/[^a-z0-9_-]/gi, "")
                          : raw.replace(/^@+/, "").trimStart();
                        setRecipient(trimmed);
                      }}
                      autoComplete="off"
                      className={[
                        "h-12 bg-white/5 border-white/10 text-white text-md placeholder:text-slate-500 placeholder:text-[20px]",
                        sendMethod === "social" ? "pl-16" : sendMethod === "username" ? "" : "pl-10",
                      ].join(" ")}
                      style={
                        sendMethod === "username"
                          ? { fontSize: `20px`, paddingLeft: `${40 + looPrefixWidthPx}px` }
                          : { fontSize: `20px` }
                      }
                    />
                  </div>

                  <div>
                    <Label className="text-slate-400 text-sm">Message (optional)</Label>
                    <MessageInput
                      value={description}
                      onChange={setDescription}
                      placeholder="Add a message..."
                      maxLength={500}
                      gifUrl={gifUrl}
                      onGifChange={setGifUrl}
                      className="mt-1.5 [&_input]:h-11 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:text-[20px] [&_input]:placeholder:text-slate-500 [&_input]:placeholder:text-[20px]"
                    />
                  </div>

                  <GradientActionButton
                    onClick={authenticated ? handleSend : () => privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
                    disabled={authenticated && (!canSend || creating)}
                    loading={creating}
                    loadingText="Creating payment…"
                  >
                    {authenticated ? (
                      <>Send <ArrowRight className="h-4 w-4" /></>
                    ) : t('signInToContinue')}
                  </GradientActionButton>
                  <p className="flex items-center justify-center gap-1.5 text-sm text-slate-500 -mt-2">
                    <Lock className="h-3.5 w-3.5" />
                    They don&apos;t need an account yet
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === "receive" && (
            <div className="space-y-4">
              {showClaimOverlay ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setShowClaimOverlay(false); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
                    className="text-slate-400 hover:text-white text-base font-medium"
                  >
                    {t('backToReceive')}
                  </button>
                  <ClaimPageContent embedInApp />
                </>
              ) : (
                <>
                  {/* Share your personal link */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                    <p className="text-slate-300 text-xl font-medium flex gap-3 font-sans items-center">
                      <LinkIcon className={"text-orange-400 w-4 h-4"} />
                      {t('sharePersonalLink')}
                    </p>
                    {authenticated && username ? (
                      <>
                        <p className="text-slate-300 text-lg sm:text-base">
                          {t('personalLinkDescription')}
                        </p>
                        <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                          <span className="flex-1 text-base sm:text-sm font-mono text-white truncate">
                            {typeof window !== "undefined" ? `${window.location.origin}/me/@${username}` : `/me/@${username}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const link = typeof window !== "undefined" ? `${window.location.origin}/me/@${username}` : "";
                              navigator.clipboard.writeText(link);
                              setLinkCopied(true);
                              setTimeout(() => setLinkCopied(false), 2000);
                            }}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-white/10 text-slate-300 hover:text-white hover:bg-white/15 text-sm font-medium transition-colors"
                          >
                            {linkCopied ? t('copied') : t('copy')}
                          </button>
                        </div>
                        <Button
                          variant="receiveSignIn"
                          className="w-full h-12 rounded-xl"
                          onClick={() => useAuthStore.getState().setOpenShareModal(true)}
                        >
                          {t('shareAndSettings')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-300 text-base sm:text-sm">
                          {t('signInForLink')}
                        </p>
                        <Button
                          type="button"
                          variant="receiveSignIn"
                          onClick={() => privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
                          className="w-full h-12 rounded-xl font-semibold"
                        >
                          {t('signInToGetLink')}
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Create new payment link */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                    <p className="text-slate-300 text-xl flex gap-3 font-sans font-medium items-center">
                      <PlusIcon className={"text-orange-400 w-4 h-4"} />
                      {t('createPaymentLink')}
                    </p>
                    <p className="text-slate-300 text-lg sm:text-base">
                      {t('createLinkDescription')}
                    </p>
                    <Button
                      type="button"
                      onClick={() => { setShowClaimOverlay(true); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
                      className="w-full h-11 rounded-xl text-base font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 border-0"
                    >
                      {t('createNewLink')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FAQ */}
      <section className="md:pb-16 px-4 mt-2 pb-24">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-medium font-sans text-white text-center mb-8 md:mb-10">
            {t('faqTitle')}
          </h2>
          <div className="flex flex-col gap-4">
            {faqItems.map((item, index) => (
              <div
                key={index}
                className="rounded-[20px] border border-white/10 bg-white/5 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => {
                    requestAnimationFrame(() => {
                      setOpenFaq(openFaq === index ? null : index);
                    });
                  }}
                  className="w-full px-6 py-5 flex items-center justify-between text-left"
                >
                  <span className="text-lg md:text-xl font-semibold font-sans text-slate-200">
                    {item.question}
                  </span>
                  <motion.span
                    className="text-4xl text-orange-500 shrink-0 ml-4"
                    animate={{ rotate: openFaq === index ? 45 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {openFaq === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-5 text-lg text-slate-400 leading-relaxed">
                        {item.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
