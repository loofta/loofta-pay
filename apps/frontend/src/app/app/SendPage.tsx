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
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { PrivacyTimingControls } from "@/components/app/PrivacyTimingControls";
import { MessageInput } from "@/components/MessageInput";
import { sora, manrope } from "@/components/home-v4/fonts";
import { SocialPlatformIcon, type SocialIconPlatform } from "@/components/SocialPlatformIcon";
import { SOCIAL_PLATFORMS } from "@/lib/socialPlatforms";
import { createClaimFromEmail } from "@/lib/createClaimFromEmail";
import { createClaimFromUsername } from "@/lib/createClaimFromUsername";
import { createClaimFromSocial } from "@/lib/createClaimFromSocial";
import { createClaimFromEmailGuest, createClaimFromSocialGuest, createClaimFromUsernameGuest } from "@/lib/createClaimGuest";
import { GuestSendPayButton } from "@/components/app/GuestSendPayButton";
import { UNREGISTERED_ACCOUNT_FEE_USD, unregisteredClaimFeeUsd } from "@/lib/unregisteredAccountFee";
import { isEmailRecipient, lookupPayTarget, payTargetQueryKey, resolvePayTargetQuery, type PayTarget } from "@/lib/lookupPayTarget";
import { totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { DEFAULT_SPREAD_MS, randomPrivacySplit } from "@/lib/privacyDelay";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, AtSign, Check, ChevronDown, Copy, LinkIcon, Lock, Mail, PlusIcon, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/use-toast";
import { SolanaWalletConnectProvider } from "@/components/SolanaWalletConnect";
import { DirectWalletPayPanel } from "@/components/app/DirectWalletPayPanel";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { isValidSolanaAddress } from "@/lib/refundAddresses";
import { useSolDomain } from "@/hooks/useSolDomain";
import { DIRECT_CASH_PLATFORMS, type DirectCashPlatformId } from "@/lib/peerPlatforms";
import { cashoutGrossUsdc } from "@/services/peerCash";

const ClaimPageContent = dynamic<{ embedInApp?: boolean }>(
  () => import("@/app/app/claim/ClaimPageContent").then((mod) => ({ default: mod.ClaimPageContent })),
  { ssr: false }
);

type SendMethod = "email" | "social" | "username";
/** Top-level: claim-to-handle/email, direct Solana wallet, or a Peer cash-app handle. */
type DestKind = "handle" | "wallet" | "cash";
type SocialSendPlatform = SocialIconPlatform;
const SOCIAL_PICKS: { id: SocialSendPlatform; name: string }[] = [
  { id: "loofta", name: "Loofta" },
  { id: "twitter", name: "Twitter" },
  ...SOCIAL_PLATFORMS.map((p) => ({ id: p.id as SocialSendPlatform, name: p.name })),
];

const HOME_TAB_KEY = "loofta.home.tab";

/** Privy login methods used across /app — email + social only. Wallet is not a Privy login
 *  method here (see AuthProvider); external Solana wallets are for DirectWalletPayPanel guest pays. */
const PRIVY_LOGIN_METHODS = ["email", "twitter", "discord", "github"] as const;

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
  // Own identifiers, for the self-send guard in handleSend below — never let a signed-in sender
  // target their own account by any of the handles it's reachable by.
  const ownLooUsername = useAuthStore((s) => s.looUsername ?? null);
  const ownTwitterUsername = useAuthStore((s) => s.twitterUsername ?? null);
  const ownEmail = useAuthStore((s) => s.email ?? null);
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
    if (tab === "receive") {
      router.replace("/app/receive");
      return;
    }
    setActiveTabState("send");
  }, [searchParams, router]);

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

  // /me/[@username] personal links land here with ?payto= (not ?to=) — a locked recipient,
  // distinct from the generic "send again" ?to=/?method= prefill. There's exactly one valid
  // target for a personal link, so the email/social/username picker is skipped entirely instead
  // of relying on a ?method= param that the link never carried.
  const payToParam = searchParams.get("payto");
  useEffect(() => {
    if (!payToParam) return;
    const clean = payToParam.replace(/^@+/, "").trim();
    if (!clean) return;
    setActiveTabState("send");
    setLockedRecipient(clean);
    const amt = searchParams.get("amount");
    if (amt != null && amt !== "" && !isNaN(Number(amt)) && Number(amt) >= 0) setAmount(amt);
  }, [payToParam, searchParams]);

  const clearLockedRecipient = () => {
    setLockedRecipient(null);
    router.replace("/?tab=send");
  };

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setActiveTabState("receive");
      setShowClaimOverlay(true);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
  }, [searchParams]);

  // ?balance=topup|withdraw|history — lets an external link (marketing pages, docs, claim P2P
  // cash-out) deep-link straight into BalanceModal. Optional ?method=peer|paj|crypto opens a
  // specific withdraw rail (see MinimalHeader → BalanceModal initialWithdrawMethod).
  useEffect(() => {
    const tab = searchParams.get("balance");
    if (tab === "topup" || tab === "withdraw" || tab === "history") {
      const methodRaw = searchParams.get("method");
      const method =
        methodRaw === "peer" || methodRaw === "paj" || methodRaw === "crypto"
          ? methodRaw
          : undefined;
      window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab, method } }));
    }
  }, [searchParams]);

  const setActiveTab = (tab: "send" | "receive") => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") localStorage.setItem(HOME_TAB_KEY, tab);
  };
  const { toast } = useToast();

  // AppShell's useTerminalPromoToast nudges toward the AI terminal whenever this is "send" — it
  // lives in the shared toast stack (alongside the unclaimed-payment/add-email nudges) rather
  // than a one-off toast() call here, so it stacks with them instead of fighting over the
  // single-toast slot. Resets to null on unmount so the promo can't linger after navigating away.
  const setHomeActiveTab = useAuthStore((s) => s.setHomeActiveTab);
  useEffect(() => {
    setHomeActiveTab(activeTab);
    return () => setHomeActiveTab(null);
  }, [activeTab, setHomeActiveTab]);

  const [recipient, setRecipient] = useState(() => readSendDraft()?.recipient ?? "");
  /** Set from a /me/[@username] personal link — locks the recipient to that exact account and
   *  hides the email/social/username picker, since a personal link only ever has one target. */
  const [lockedRecipient, setLockedRecipient] = useState<string | null>(null);
  const [amount, setAmount] = useState(() => readSendDraft()?.amount ?? "");
  const [description, setDescription] = useState(() => readSendDraft()?.description ?? "");
  const [gifUrl, setGifUrl] = useState<string | null>(() => readSendDraft()?.gifUrl ?? null);
  /** Handle/email claim path vs raw wallet — hush-style two-tab destination. */
  const [destKind, setDestKind] = useState<DestKind>("handle");
  /** "SEND TO" pill selection — matches the reference screenshot's Email/Social handle tabs, plus a Loofta username option. */
  const [sendMethod, setSendMethod] = useState<SendMethod>(() => readSendDraft()?.sendMethod ?? "social");
  /** Defaults to Twitter — the most common case — rather than making everyone pick a platform first. */
  const [socialPlatform, setSocialPlatform] = useState<SocialSendPlatform | null>(
    () => readSendDraft()?.socialPlatform ?? "twitter",
  );
  const [cashPlatform, setCashPlatform] = useState<DirectCashPlatformId>("venmo");
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [payTarget, setPayTarget] = useState<PayTarget>({ registered: false, requirePrivatePayments: false });
  const [resolvedQueryKey, setResolvedQueryKey] = useState("");

  // Keep the draft in sync so a mid-login page reload (see SEND_DRAFT_KEY above) can restore it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft: SendDraft = { recipient, amount, description, gifUrl, sendMethod, socialPlatform };
    sessionStorage.setItem(SEND_DRAFT_KEY, JSON.stringify(draft));
  }, [recipient, amount, description, gifUrl, sendMethod, socialPlatform]);

  // Homepage "Cash apps" hands off here: /app/send?cash=venmo&to=&amount=
  useEffect(() => {
    const cash = searchParams.get("cash");
    if (!cash || !DIRECT_CASH_PLATFORMS.some((p) => p.id === cash)) return;
    setDestKind("cash");
    setCashPlatform(cash as DirectCashPlatformId);
    const to = searchParams.get("to");
    const amt = searchParams.get("amount");
    if (to) setRecipient(to.replace(/^[@$]/, ""));
    if (amt && Number(amt) > 0) setAmount(amt);
  }, [searchParams]);

  const sendPayTargetQuery = destKind === "handle" && !lockedRecipient
    ? resolvePayTargetQuery({
        recipient,
        method: isEmailRecipient(recipient) ? "email" : sendMethod,
        socialPlatform,
      })
    : null;
  const sendQueryKey = payTargetQueryKey(sendPayTargetQuery);
  const payTargetResolved = !!sendPayTargetQuery && sendQueryKey === resolvedQueryKey;

  useEffect(() => {
    if (!sendPayTargetQuery) {
      setPayTarget({ registered: false, requirePrivatePayments: false });
      setResolvedQueryKey("");
      return;
    }
    const key = sendQueryKey;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      lookupPayTarget(sendPayTargetQuery, ac.signal)
        .then((target) => {
          setPayTarget(target);
          setResolvedQueryKey(key);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setPayTarget({ registered: false, requirePrivatePayments: false });
          setResolvedQueryKey("");
        });
    }, 350);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [sendQueryKey]);

  useEffect(() => {
    if (payTarget.requirePrivatePayments) setIsPrivateMode(true);
  }, [payTarget.requirePrivatePayments]);
  const [creating, setCreating] = useState(false);
  /** Locks this claim's privacy in at creation when on; left off, the payer decides at pay time
   *  on /c/[id] instead (its own incognito toggle, authenticated or guest). */
  /** Same split/delay timing-obfuscation sliders as /fomo — chosen here, carried to /c/[id] via
   *  ?split=&delayMin= so the pay-time sliders there start from this choice instead of resetting
   *  to 1/0 (see the redirect below and the query-param read in c/[id]/page.tsx). */
  const [split, setSplit] = useState(randomPrivacySplit);
  const [delayMs, setDelayMs] = useState(DEFAULT_SPREAD_MS);
  const [privacyInfoOpen, setPrivacyInfoOpen] = useState(false);
  const { showMultiSend, setShowMultiSend } = useMultiSendStore();
  const [linkCopied, setLinkCopied] = useState(false);
  const [showClaimOverlay, setShowClaimOverlay] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
    setAmount(sanitizeNumberInput(v, 2));
  }

  const displayAmount = (amount && amount.length > 0) ? amount : "0";

  const totalDigitsCount = (() => {
    const onlyDigits = String(amount || "").replace(/[^0-9]/g, "");
    return onlyDigits.length || 1;
  })();

  function computeFontPx(digits: number) {
    const maxPx = 76;
    const minPx = 28;
    const startDigits = 5;
    const stepPerDigit = 7;
    const delta = Math.max(0, digits - startDigits) * stepPerDigit;
    return Math.max(minPx, maxPx - delta);
  }

  const amountFontPx = computeFontPx(totalDigitsCount);
  const suffixFontPx = Math.max(18, Math.round(amountFontPx * (40 / 76)));
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
  // Private payments floor at $1. A public payment only needs a cent.
  const payingPrivate = isPrivateMode || payTarget.requirePrivatePayments;
  const isCashDest = destKind === "cash";
  const minAmountUsd = isCashDest || payingPrivate ? 1 : 0.01;
  const amountNum = Number(amount);
  const walletInput = destKind === "wallet" ? recipient.trim() : "";
  // A .sol name resolves to its wallet; anything else is used as typed.
  const walletDomain = useSolDomain(walletInput, apiCluster);
  const walletAddress = walletDomain.status === "resolved" ? walletDomain.address : walletInput;
  const walletAddressValid = destKind === "wallet" && isValidSolanaAddress(walletAddress);
  // Flat claim fee for an email / social handle that is not a Loofta account yet.
  // A registered user, a Loofta username, and a direct wallet pay skip it.
  // An email typed on the Social tab still counts as email.
  const treatingAsEmail = sendMethod === "email" || isEmailRecipient(recipient);
  const isLooftaUsernameDest =
    !!lockedRecipient ||
    sendMethod === "username" ||
    (sendMethod === "social" && socialPlatform === "loofta" && !treatingAsEmail);
  const platformFeeUsd = unregisteredClaimFeeUsd({
    destApplies: destKind === "handle" && !isLooftaUsernameDest && recipient.replace(/^@/, "").trim().length > 0,
    registered: payTarget.registered,
    lookupResolved: payTargetResolved,
  });
  const basePay = Number.isFinite(amountNum) ? amountNum : 0;
  const payTotal = (payingPrivate ? totalWithMagicBlockPrivateFee(basePay) : basePay) + platformFeeUsd;
  const canSend = lockedRecipient
    ? !!amount && Number.isFinite(amountNum) && amountNum >= minAmountUsd
    : destKind === "wallet" || destKind === "cash"
      ? false // wallet uses DirectWalletPayPanel; cash apps open the Peer cash-out
      : recipient.trim().length > 0 &&
        !!amount &&
        Number.isFinite(amountNum) &&
        amountNum >= minAmountUsd &&
        (sendMethod !== "social" || !!socialPlatform);

  // Carries the split/delay choice made above into /c/[id]'s own sliders (see the query-param
  // read in c/[id]/page.tsx) so they start from this instead of resetting to 1/0. delayMs (not
  // delayMin) since the delay picker now goes up to days, not just minutes — see
  // @/lib/privacyDelay.
  const privacyQuery = () =>
    payingPrivate ? `?split=${split}&delayMs=${delayMs}` : "";

  // Signed-out handle/email send: one step (connect wallet, pay, land on /c/[id] with the link).
  // Personal links and the legacy loo- username method have no guest endpoint.
  const guestOneStep = !authenticated && destKind === "handle" && !lockedRecipient && sendMethod !== "username" && !payTarget.requirePrivatePayments && !(payTarget.registered && isPrivateMode);
  const guestTrimmed = recipient.replace(/^@/, "").trim();
  const guestBlocker = !guestTrimmed
    ? treatingAsEmail ? "Enter an email" : "Enter a handle"
    : sendMethod === "social" && !socialPlatform
      ? "Pick a platform"
      : !Number.isFinite(amountNum) || amountNum < minAmountUsd
        ? `Enter an amount of at least $${minAmountUsd}`
        : null;
  const createGuestClaim = async (turnstileToken: string) => {
    const fullDescription = [description.trim(), gifUrl].filter(Boolean).join(" ").trim() || undefined;
    const base = {
      amount,
      isPrivate: isPrivateMode,
      description: fullDescription,
      cluster: apiCluster as "devnet" | "mainnet",
      turnstileToken,
      ...(isPrivateMode ? { split, maxDelayMs: delayMs } : {}),
    };
    const result =
      treatingAsEmail
        ? await createClaimFromEmailGuest({ ...base, email: guestTrimmed.toLowerCase() })
        : socialPlatform === "loofta"
          ? await createClaimFromUsernameGuest({ ...base, username: `loo-${guestTrimmed.replace(/^loo-/i, "").toLowerCase()}` })
          : !socialPlatform || socialPlatform === "twitter"
            ? await createClaimFromUsernameGuest({ ...base, username: guestTrimmed.toLowerCase(), treatUnregisteredAsTwitter: true })
            : await createClaimFromSocialGuest({ ...base, platform: socialPlatform as "discord" | "github" | "telegram", handle: guestTrimmed });
    sessionStorage.removeItem(SEND_DRAFT_KEY);
    return result;
  };

  const handleSend = async () => {
    if (!amount) return;
    if (!lockedRecipient && !recipient.replace(/^@/, "").trim()) return;
    if (amountNum < minAmountUsd) {
      toast({ variant: "destructive", title: "Invalid amount", description: `Minimum payment amount is $${minAmountUsd.toFixed(2)} USDC${isPrivateMode ? " for a private payment" : ""}.` });
      return;
    }
    const trimmed = recipient.replace(/^@/, "").trim();
    const fullDescription = [description.trim(), gifUrl].filter(Boolean).join(" ").trim() || undefined;

    // Handle/email (and personal-link) sends require login — guest pay stays on the wallet-address
    // tab via DirectWalletPayPanel. Draft is already in sessionStorage for Privy redirect returns.
    if (!authenticated) {
      privyLogin({ loginMethods: [...PRIVY_LOGIN_METHODS], disableSignup: false });
      return;
    }

    // Self-send guard — checks every handle this account is reachable by.
    const myIdentifiers = [username, ownLooUsername, ownTwitterUsername, ownEmail]
      .filter((v): v is string => !!v)
      .map((v) => v.replace(/^@/, "").replace(/^loo-/i, "").toLowerCase().trim());
    const candidateRecipient = (lockedRecipient || trimmed).replace(/^@/, "").replace(/^loo-/i, "").toLowerCase().trim();
    if (candidateRecipient && myIdentifiers.includes(candidateRecipient)) {
      toast({ variant: "destructive", title: "Can't send to yourself", description: "Pick a different recipient for this payment." });
      return;
    }

    setCreating(true);
    try {
      const accessToken = await getAccessToken();
      const privacyChoice = (isPrivateMode || payTarget.requirePrivatePayments) ? { split, maxDelayMs: delayMs } : {};
      let result: { id: string };
      if (lockedRecipient) {
        // Exact DB username as embedded in the personal link — no "loo-" reconstruction and
        // no email/social branching, since the link already pins one specific existing account.
        result = await createClaimFromUsername({
          username: lockedRecipient,
          amount,
          userId: user?.id,
          accessToken,
          isPrivate: isPrivateMode || payTarget.requirePrivatePayments,
          description: fullDescription,
          cluster: apiCluster,
          ...privacyChoice,
        });
      } else if (treatingAsEmail) {
        result = await createClaimFromEmail({
          email: trimmed.toLowerCase(),
          amount,
          userId: user?.id,
          accessToken,
          isPrivate: isPrivateMode || payTarget.requirePrivatePayments,
          description: fullDescription,
          cluster: apiCluster,
          ...privacyChoice,
        });
      } else if (sendMethod === "social" && socialPlatform === "loofta") {
        // Same "loo-" username namespace the old dedicated Username pill used — normalize either
        // way in case the recipient typed it with or without the prefix themselves.
        result = await createClaimFromUsername({
          username: `loo-${trimmed.replace(/^loo-/i, "").toLowerCase()}`,
          amount,
          userId: user?.id,
          accessToken,
          isPrivate: isPrivateMode || payTarget.requirePrivatePayments,
          description: fullDescription,
          cluster: apiCluster,
          ...privacyChoice,
        });
      } else if (sendMethod === "social" && socialPlatform && socialPlatform !== "twitter" && socialPlatform !== "loofta") {
        result = await createClaimFromSocial({
          platform: socialPlatform,
          handle: trimmed,
          amount,
          userId: user?.id,
          accessToken,
          // Locks this claim's privacy in upfront when toggled on here — leave it off and the
          // payer (self or a guest, on /c/[id]) still decides at pay time either way.
          isPrivate: isPrivateMode || payTarget.requirePrivatePayments,
          description: fullDescription,
          cluster: apiCluster,
          ...privacyChoice,
        });
      } else if (sendMethod === "username") {
        // "loo-" is a fixed prefix in the UI (recipient state only holds the suffix here).
        result = await createClaimFromUsername({
          username: `loo-${trimmed.toLowerCase()}`,
          amount,
          userId: user?.id,
          accessToken,
          isPrivate: isPrivateMode || payTarget.requirePrivatePayments,
          description: fullDescription,
          cluster: apiCluster,
          ...privacyChoice,
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
          isPrivate: isPrivateMode || payTarget.requirePrivatePayments,
          description: fullDescription,
          cluster: apiCluster,
          treatUnregisteredAsTwitter: true,
          ...privacyChoice,
        });
      }
      sessionStorage.removeItem(SEND_DRAFT_KEY);
      const payingPrivate = isPrivateMode || payTarget.requirePrivatePayments;
      router.push(`/c/${result.id}?pay=1${payingPrivate ? `&split=${split}&delayMs=${delayMs}` : ""}`);
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
    <div className={`${sora.variable} ${manrope.variable} min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}>
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="min-h-[calc(100vh-var(--header-h,0px))]">

          <SendReceiveTabs activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab)} />

          {activeTab === "send" && (
            <>
              {showMultiSend && canMultiSend ? (
                <MultiSendFlow onBack={() => { setShowMultiSend(false); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }} />
              ) : (
                <div id="send-form" className="rounded-[30px] border border-white/[0.07] bg-[#141419] p-7 space-y-6">
                  <div className="flex items-center justify-between">
                    <span style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 600, fontSize: 17, color: "#F2EFE8" }}>{t('send')}</span>
                    {canMultiSend && (
                      <button
                        type="button"
                        onClick={() => { setShowMultiSend(true); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
                        className="text-[#FF7A2A] transition-opacity hover:opacity-80"
                        style={{ fontWeight: 700, fontSize: 14 }}
                      >
                        {t('multiSend')} →
                      </button>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="flex flex-col items-center gap-2.5 py-1">
                    <div className="flex items-baseline justify-center tabular-nums">
                      <span
                        className="mr-1"
                        style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 600, fontSize: `${suffixFontPx}px`, lineHeight: 1, color: "#5E6880" }}
                      >
                        $
                      </span>
                      <span
                        ref={mirrorRef}
                        aria-hidden="true"
                        className="invisible absolute -z-50 tabular-nums"
                        style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 700, fontSize: `${amountFontPx}px`, letterSpacing: "-0.05em", lineHeight: 1 }}
                      >
                        {displayAmount}
                      </span>
                      <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => onChangeAmount(e.target.value)}
                        placeholder="0"
                        className="border-0 bg-transparent p-0 m-0 text-[#F2EFE8] outline-none placeholder:text-[#5E6880] tabular-nums"
                        style={{
                          fontFamily: "var(--font-home-sora), Sora, sans-serif",
                          fontWeight: 700,
                          fontSize: `${amountFontPx}px`,
                          letterSpacing: "-0.05em",
                          lineHeight: 1,
                          width: `${Math.max(amountInputWidthPx, Math.round(amountFontPx * 0.6)) + amountGapPx}px`,
                        }}
                        aria-label={t('amountLabel')}
                      />
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {[5, 10, 25, 50].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => onChangeAmount(String(preset))}
                          className="rounded-full border border-white/[0.08] bg-[#1E1E25] px-3.5 py-1.5 text-[13px] font-bold text-[#C9C6CF] transition-colors hover:text-white"
                        >
                          ${preset}
                        </button>
                      ))}
                    </div>
                  </div>
                  {amountNum > 0 && amountNum < minAmountUsd && (
                    <p className="text-sm text-amber-400 -mt-3">{`Min. amount is $${minAmountUsd.toFixed(2)} USDC${isPrivateMode ? " for a private payment" : ""}`}</p>
                  )}

                  {lockedRecipient ? (
                    /* Personal /me/[@username] link — one exact, non-editable target. No picker,
                       no editable field: just show who's getting paid and let them change amount. */
                    <div>
                      <Label className="text-slate-400 text-sm mb-2 block">{t('to')}</Label>
                      <div className="flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                        <span className="flex items-center gap-2 min-w-0 text-white text-[20px] font-medium">
                          <AtSign className="h-4 w-4 text-slate-500 shrink-0" />
                          <span className="truncate">{lockedRecipient}</span>
                        </span>
                        <button
                          type="button"
                          onClick={clearLockedRecipient}
                          className="shrink-0 text-slate-500 hover:text-white text-sm font-medium transition-colors"
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                  {/* Same destination control as the homepage send card */}
                  <div>
                    <span className="mb-2.5 block uppercase" style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", color: "#9A98A3" }}>{t('to')}</span>
                    <div className="mb-3 flex gap-1 rounded-full bg-[#050505] p-1">
                      {([
                        { k: "handle" as const, label: "Handle or email" },
                        { k: "wallet" as const, label: "Wallet" },
                      ]).map((o) => {
                        const selected = o.k === "wallet" ? destKind === "wallet" : destKind !== "wallet";
                        return (
                          <button
                            key={o.k}
                            type="button"
                            onClick={() => {
                              if (o.k === "wallet") {
                                if (destKind !== "wallet") {
                                  setDestKind("wallet");
                                  setRecipient("");
                                }
                              } else if (destKind === "wallet") {
                                setDestKind("handle");
                                setRecipient("");
                              }
                            }}
                            className="flex-1 rounded-full py-2.5 text-sm font-semibold transition-all duration-200"
                            style={{
                              background: selected ? "#F2F2F2" : "transparent",
                              color: selected ? "#050505" : "#9A98A3",
                            }}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                    {destKind !== "wallet" && (
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          { id: "social" as const, label: "Social", icon: <AtSign className="h-3.5 w-3.5" /> },
                          { id: "email" as const, label: "Email", icon: <Mail className="h-3.5 w-3.5" /> },
                        ]).map((o) => {
                          const selected = destKind === "handle" && sendMethod === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => {
                                setDestKind("handle");
                                setSendMethod(o.id);
                                setRecipient("");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                              style={{
                                background: selected ? "rgba(255,255,255,0.14)" : "transparent",
                                color: selected ? "#F2EFE8" : "#9A98A3",
                              }}
                            >
                              {o.icon}
                              {o.label}
                            </button>
                          );
                        })}
                        {DIRECT_CASH_PLATFORMS.map((p) => {
                          const selected = destKind === "cash" && cashPlatform === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setDestKind("cash");
                                setCashPlatform(p.id as DirectCashPlatformId);
                                setRecipient("");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                              style={{
                                background: selected ? "rgba(255,255,255,0.14)" : "transparent",
                                color: selected ? "#F2EFE8" : "#9A98A3",
                              }}
                            >
                              <img src={p.logo} alt="" className="h-3.5 w-3.5 rounded object-cover" />
                              {p.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {destKind === "cash" ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2">
                        <img
                          src={DIRECT_CASH_PLATFORMS.find((p) => p.id === cashPlatform)?.logo}
                          alt=""
                          className="h-4 w-4 rounded object-cover"
                        />
                      </span>
                      <Input
                        type="text"
                        name="send-to-cash-app"
                        placeholder={DIRECT_CASH_PLATFORMS.find((p) => p.id === cashPlatform)?.placeholder ?? "@handle"}
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value.replace(/^[@$]+/, "").trimStart())}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="h-12 pl-10 bg-white/5 border-white/10 text-[#F2EFE8] placeholder:text-[#6E6C78]"
                        style={{ fontSize: 17, fontWeight: 600 }}
                      />
                    </div>
                  ) : destKind === "wallet" ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                        <Wallet className="h-4 w-4" />
                      </span>
                      <Input
                        type="text"
                        name="send-to-wallet"
                        placeholder="Solana wallet address"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value.trim())}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="h-12 pl-10 bg-white/5 border-white/10 text-[#F2EFE8] placeholder:text-[#6E6C78]"
                        style={{ fontSize: 17, fontWeight: 600 }}
                      />
                    </div>
                  ) : (
                  /* Input row — for Social handle, the leading icon is a popover trigger (visibly a
                      control at rest, not just on hover) so picking a platform never adds/removes a
                      row and shifts this input's position. For Username, "loo-" is a fixed, non-editable
                      prefix rendered outside the actual input value — it can't be backspaced away since
                      it was never part of the editable text. */
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
                          style={{ fontSize: 17, fontWeight: 600 }}
                        >
                          loo-
                        </span>
                        <span
                          className="absolute left-10 top-1/2 -translate-y-1/2 text-[#F2EFE8] select-none pointer-events-none"
                          style={{ fontSize: 17, fontWeight: 600 }}
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
                        "h-12 bg-white/5 border-white/10 text-[#F2EFE8] placeholder:text-[#6E6C78]",
                        sendMethod === "social" ? "pl-16" : sendMethod === "username" ? "" : "pl-10",
                      ].join(" ")}
                      style={
                        sendMethod === "username"
                          ? { fontSize: 17, fontWeight: 600, paddingLeft: `${40 + looPrefixWidthPx}px` }
                          : { fontSize: 17, fontWeight: 600 }
                      }
                    />
                  </div>
                  )}
                  {destKind === "handle" && payTargetResolved && recipient.replace(/^@/, "").trim().length >= 2 && (
                    <p className="-mt-2" style={{ fontSize: 13, fontWeight: 400, color: "#77757F" }}>
                      {payTarget.requirePrivatePayments
                        ? "They only accept private payments. The privacy fee is added on top of what you pay."
                        : payTarget.registered
                          ? "Pays straight to their Loofta wallet."
                          : authenticated || sendMethod !== "username"
                            ? platformFeeUsd > 0
                              ? isPrivateMode
                                ? `$${UNREGISTERED_ACCOUNT_FEE_USD.toFixed(2)} claim fee and the privacy fee are included · they don't need an account yet`
                                : `$${UNREGISTERED_ACCOUNT_FEE_USD.toFixed(2)} claim fee is included in the price · they don't need an account yet`
                              : isPrivateMode
                                ? "Privacy fee is included in the price"
                                : "They don't need an account yet"
                            : t("signInToSendHandle")}
                    </p>
                  )}
                    </>
                  )}

                  {(destKind === "handle" || !!lockedRecipient) && destKind !== "cash" && (
                  <div>
                    <span className="mb-2.5 block uppercase" style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", color: "#9A98A3" }}>Message · optional</span>
                    <MessageInput
                      value={description}
                      onChange={setDescription}
                      placeholder="Add a message..."
                      maxLength={500}
                      gifUrl={gifUrl}
                      onGifChange={setGifUrl}
                      className="mt-1.5 [&_input]:h-[52px] [&_input]:rounded-2xl [&_input]:bg-[#0E0E12] [&_input]:border-white/[0.08] [&_input]:text-[#F2EFE8] [&_input]:text-[16px] [&_input]:font-normal [&_input]:placeholder:text-[#6E6C78]"
                    />
                  </div>
                  )}

                  {destKind !== "cash" && (
                  <IncognitoModeToggle
                    checked={isPrivateMode || payTarget.requirePrivatePayments}
                    onCheckedChange={(on) => { if (!payTarget.requirePrivatePayments) setIsPrivateMode(on); }}
                  />
                  )}

                  <AnimatePresence initial={false}>
                    {payingPrivate && destKind !== "cash" && (
                      <motion.div
                        key="send-privacy-controls"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <PrivacyTimingControls
                          idPrefix="send"
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

                  {destKind === "cash" ? (
                    <>
                    <GradientActionButton
                      onClick={() => {
                        const handle = recipient.trim().replace(/^[@$]/, "");
                        if (!handle || !(amountNum >= 1)) return;
                        if (!authenticated) {
                          privyLogin({ loginMethods: [...PRIVY_LOGIN_METHODS], disableSignup: false });
                          return;
                        }
                        window.dispatchEvent(new CustomEvent("openBalanceModal", {
                          detail: {
                            tab: "withdraw",
                            method: "peer",
                            peerPay: { platformId: cashPlatform, identifier: handle, amountUsd: amountNum },
                          },
                        }));
                      }}
                      disabled={!recipient.trim() || !(amountNum >= 1)}
                      className="!h-auto !min-h-[58px] !flex-col !gap-0 !rounded-[18px] !py-2.5 !text-[17px]"
                      style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 600 }}
                    >
                      {authenticated || amountNum >= 1 ? (
                        <>
                          <span className="flex items-center gap-2">
                            {amountNum >= 1
                              ? `Pay $${cashoutGrossUsdc(amountNum).toFixed(2)}`
                              : `Pay to ${DIRECT_CASH_PLATFORMS.find((p) => p.id === cashPlatform)?.name ?? "app"}`}
                            <ArrowRight className="h-4 w-4" />
                          </span>
                          {amountNum >= 1 && (
                            <span className="text-sm font-normal text-white/80">They receive ${amountNum.toFixed(2)}</span>
                          )}
                        </>
                      ) : (
                        <>{t("signInToContinue")} <ArrowRight className="h-4 w-4" /></>
                      )}
                    </GradientActionButton>
                    <p className="flex items-center justify-center gap-1.5 text-sm text-slate-500 -mt-2">
                      <Lock className="h-3.5 w-3.5" />
                      A peer pays that handle in USD. Getting your USDC back costs a bridge fee.
                    </p>
                    </>
                  ) : destKind === "wallet" && !lockedRecipient ? (
                    <SolanaWalletConnectProvider rpcUrl={getSolanaHttpRpc()}>
                      <DirectWalletPayPanel
                        amountUsd={amountNum}
                        recipientAddress={walletAddressValid ? walletAddress : null}
                        recipientName={walletDomain.status === "resolved" ? walletInput : walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : "this wallet"}
                        blocker={
                          amountNum < minAmountUsd
                            ? `Enter an amount of at least $${minAmountUsd}`
                            : !walletAddress
                              ? "Enter a wallet address"
                              : !walletAddressValid
                                ? walletDomain.status === "resolving" ? "Looking up name…" : walletDomain.status === "not-found" ? "That .sol name does not resolve" : "Not a valid Solana address"
                                : null
                        }
                        isPrivate={isPrivateMode}
                        split={split}
                        maxDelayMs={delayMs}
                        onReset={() => {
                          setAmount("");
                          setRecipient("");
                        }}
                      />
                    </SolanaWalletConnectProvider>
                  ) : guestOneStep ? (
                  <>
                  <GuestSendPayButton
                    amountUsd={amountNum}
                    platformFeeUsd={platformFeeUsd}
                    isPrivate={isPrivateMode}
                    split={split}
                    delayMs={delayMs}
                    blocker={guestBlocker}
                    claimKey={[sendMethod, socialPlatform, guestTrimmed, amount, isPrivateMode, split, delayMs, description, gifUrl].join("|")}
                    createClaim={createGuestClaim}
                    onPaid={(id) => router.push(`/c/${id}${privacyQuery()}`)}
                    onError={(message) => toast({ variant: "destructive", title: "Payment failed", description: message })}
                    renderButton={({ onClick, disabled, loading, label }) => (
                      <GradientActionButton onClick={onClick} disabled={disabled} loading={loading} loadingText={label} className="!h-[58px] !rounded-[18px] !text-[17px]" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 600 }}>
                        {label} {!disabled && <ArrowRight className="h-4 w-4" />}
                      </GradientActionButton>
                    )}
                  />
                  <p className="flex items-center justify-center gap-1.5 text-sm text-slate-500 -mt-2">
                    <Lock className="h-3.5 w-3.5" />
                    {payTarget.registered
                      ? "No sign-in needed · paid straight to their Loofta wallet"
                      : "No sign-in needed · you get the claim link after paying"}
                  </p>
                  </>
                  ) : (
                  /* Handle/email claim path (and locked personal-link targets) */
                  <>
                  <GradientActionButton
                    onClick={handleSend}
                    disabled={!canSend || creating}
                    loading={creating}
                    loadingText={authenticated ? "Creating payment…" : t("signInToContinue")}
                    className="!h-[58px] !rounded-[18px] !text-[17px]"
                    style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif", fontWeight: 600 }}
                  >
                    {authenticated ? (
                      <>
                        {`Pay $${payTotal.toFixed(2)}${payingPrivate ? " privately" : ""}`}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    ) : (
                      <>{t("signInToContinue")} <ArrowRight className="h-4 w-4" /></>
                    )}
                  </GradientActionButton>
                  <p className="flex items-center justify-center gap-1.5 text-sm text-slate-500 -mt-2">
                    <Lock className="h-3.5 w-3.5" />
                    {authenticated
                      ? payTarget.requirePrivatePayments
                        ? "Private only · the privacy fee is included in the price"
                        : `Paid from your Loofta balance${
                          payingPrivate && platformFeeUsd > 0
                            ? " · price includes the privacy fee and the $0.10 claim fee"
                            : payingPrivate
                              ? " · price includes the privacy fee"
                              : platformFeeUsd > 0
                                ? " · price includes the $0.10 claim fee"
                                : payTarget.registered
                                  ? " · pays their Loofta wallet"
                                  : ""
                        }`
                      : t("signInToSendHandleHint")}
                  </p>
                  </>
                  )}
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
                          onClick={() => privyLogin({ loginMethods: [...PRIVY_LOGIN_METHODS], disableSignup: false })}
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

      {/* FAQ — pushed well below the send/receive card, not competing with it for attention */}
      <section className="md:pb-16 px-4 mt-16 md:mt-24 pb-24">
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
