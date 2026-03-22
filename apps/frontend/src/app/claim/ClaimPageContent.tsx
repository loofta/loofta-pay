'use client'

import React, { useState, type SVGProps, useRef, useEffect } from "react";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { findTokenBySelection } from "@/lib/tokens";
import { maskLink } from "@/lib/format";
import { useClaimStore } from "@/store/claim";
import { ArrowRight, Wallet } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { useRouter, usePathname } from "next/navigation";
import { PRIVATE_PAYMENT_COMING_SOON, PRIVATE_PAYMENT_ENABLED } from "@/services/privatePayment";

/** Inline Loofta logo SVG (matches pay modal). */
function LooftaIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = React.useId().replace(/:/g, "-");
  return (
    <svg viewBox="0 0 56 57" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden {...props}>
      <g filter={`url(#loofta-shadow-${id})`}>
        <path d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z" fill="#FF4A26" />
      </g>
      <defs>
        <filter id={`loofta-shadow-${id}`} x="0" y="0" width="56" height="57" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="2" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_617_42" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_617_42" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}

async function createClaim(formData: {
  amount: string;
  toSel: TokenSelection;
  recipient: string;
  userId?: string;
  isPrivate?: boolean;
}): Promise<{ id: string; link: string }> {
  const r = await fetch("/api/claims/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Failed to create claim");
  return await r.json();
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Named export for embedding in home page (accepts embedInApp). */
export function ClaimPageContent(props: { embedInApp?: boolean }) {
  const { embedInApp } = props ?? {};
  const router = useRouter();
  const pathname = usePathname();
  const { authenticated, email: userEmail, userId, login, ready } = useAuth();
  const { login: privyLogin } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { toast } = useToast();

  // Standalone /claim route: redirect to home receive tab with create form open (no standalone page)
  const isStandaloneClaim = !embedInApp && pathname === "/claim";
  useEffect(() => {
    if (isStandaloneClaim) router.replace("/?tab=receive&create=1");
  }, [isStandaloneClaim, router]);

  const { data: tokens = [] } = useTokensQuery();
  const [toSel, setToSel] = useState<TokenSelection | undefined>(undefined);
  const [amount, setAmount] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [recipientPrefilled, setRecipientPrefilled] = useState(false);
  const [receiveDestination, setReceiveDestination] = useState<"loofta" | "other">("loofta");
  const [creating, setCreating] = useState(false);
  const [amountMode, setAmountMode] = useState<"USD" | "TOKEN">("USD");
  const [showConfetti, setShowConfetti] = useState<boolean>(false);
  const { isPrivateMode, setIsPrivateMode, createdLink, setCreatedLink, clearLink, hydrated: claimHydrated } = useClaimStore();

  useEffect(() => {
    if (PRIVATE_PAYMENT_ENABLED) setIsPrivateMode(true);
  }, [setIsPrivateMode]);
  const [showPrivacyInfo, setShowPrivacyInfo] = useState<boolean>(false);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const [hasSeenPrivateTutorial, setHasSeenPrivateTutorial] = useState<boolean>(false);
  const [showAccessRequested, setShowAccessRequested] = useState<boolean>(false);
  const [pendingAccessRequest, setPendingAccessRequest] = useState<boolean>(false);

  // Handle email-only login for request access
  const handleRequestAccess = () => {
    //setPendingAccessRequest(true);
    // Privy login with email only - no wallet option
    privyLogin({
      loginMethods: ['email'],
      disableSignup: false,
    });
  };

  // Show success message when user authenticates after requesting access
  useEffect(() => {
    if (authenticated && pendingAccessRequest) {
      setShowAccessRequested(true);
      setPendingAccessRequest(false);
    }
  }, [authenticated, pendingAccessRequest]);

  const solanaWallet = solanaWallets?.[0];
  const defaultLooftaToken = tokens.find((t) => t.symbol === "USDC" && String(t.chain).toLowerCase().includes("sol"));

  // Prefill recipient with logged-in user's Solana wallet when they have one
  useEffect(() => {
    if (authenticated && solanaWallets?.length && !recipientPrefilled && solanaWallet?.address) {
      setRecipient((prev) => (prev ? prev : solanaWallet.address));
      setRecipientPrefilled(true);
    }
  }, [authenticated, solanaWallets, solanaWallet?.address, recipientPrefilled]);

  // When Loofta is selected, keep recipient + token in sync with Loofta defaults
  useEffect(() => {
    if (authenticated && receiveDestination === "loofta" && solanaWallet?.address && defaultLooftaToken) {
      setRecipient(solanaWallet.address);
      setToSel({ symbol: defaultLooftaToken.symbol, chain: defaultLooftaToken.chain });
    }
  }, [authenticated, receiveDestination, solanaWallet?.address, defaultLooftaToken?.symbol, defaultLooftaToken?.chain]);

  const selectedTo = findTokenBySelection(tokens, toSel || null);

  const tokenPriceUSD = typeof selectedTo?.price === "number" ? selectedTo.price : null;
  const parsedAmount = (() => {
    const n = parseFloat((amount || "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  })();
  const usdValue = amountMode === "USD"
    ? parsedAmount
    : (tokenPriceUSD ? parsedAmount * tokenPriceUSD : null);
  const tokenValue = amountMode === "TOKEN"
    ? parsedAmount
    : (tokenPriceUSD && tokenPriceUSD > 0 ? parsedAmount / tokenPriceUSD : null);

  // Compute digit count (all digits, ignoring separators) for responsive font sizing
  const totalDigitsCount = (() => {
    const raw = String(amount || "");
    const onlyDigits = raw.replace(/[^0-9]/g, "");
    return onlyDigits.length || 1;
  })();
  // Continuous font sizing: start large and step down per extra digit beyond 5
  function computeFontPx(digits: number) {
    const maxPx = 80; // ~text-7xl
    const minPx = 24; // lower bound to keep readable
    const startDigits = 5;
    const stepPerDigit = 8; // px reduction per extra digit (more aggressive)
    const delta = Math.max(0, digits - startDigits) * stepPerDigit;
    const size = Math.max(minPx, maxPx - delta);
    return size;
  }
  const amountFontPx = computeFontPx(totalDigitsCount);
  const suffixFontPx = Math.max(18, Math.round(amountFontPx * 0.7));
  // Width in ch so suffix hugs the number and gets pushed as digits increase
  const displayAmount = (amount && amount.length > 0) ? amount : "0";
  const amountInputWidthCh = Math.max(1, displayAmount.length);
  const amountGapPx = 8; // fixed padding between number and suffix
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const [inputWidthPx, setInputWidthPx] = useState<number>(0);
  useEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setInputWidthPx(Math.ceil(rect.width));
  }, [displayAmount, amountFontPx]);

  // Play audio when privacy modal opens
  useEffect(() => {
    if (showPrivacyInfo) {
      const audio = document.getElementById('privacy-audio') as HTMLAudioElement;
      if (audio) {
        audio.volume = 0.5;
        audio.play().catch(() => { }); // Ignore autoplay errors
      }
    }
  }, [showPrivacyInfo]);

  // Auto-select USDC on Solana when entering private mode (PER / private pay)
  useEffect(() => {
    if (isPrivateMode && tokens.length > 0) {
      const usdcSolana = tokens.find(t => t.symbol === 'USDC' && String(t.chain).toLowerCase().includes('sol'));
      if (usdcSolana) {
        setToSel({ symbol: usdcSolana.symbol, chain: usdcSolana.chain });
      }
    }
  }, [isPrivateMode, tokens]);

  function sanitizeNumberInput(v: string, maxDecimals: number = 9) {
    // keep digits and one dot, convert comma to dot
    let s = String(v || "").replace(/,/g, ".");
    s = s.replace(/[^0-9.]/g, "");
    const parts = s.split(".");
    if (parts.length > 2) {
      s = parts[0] + "." + parts.slice(1).join("");
    }
    const p = s.split(".");
    if (p.length === 2) {
      const int = p[0] || "";
      const dec = (p[1] || "").slice(0, Math.max(0, maxDecimals));
      return dec.length > 0 ? `${int}.${dec}` : int;
    }
    return p[0] || "";
  }
  function toFixedTrim(n: number, decimals: number) {
    return n.toFixed(decimals).replace(/\.?0+$/, "");
  }
  function onChangeAmount(v: string) {
    setAmount(sanitizeNumberInput(v, 9));
  }
  function switchMode(next: "USD" | "TOKEN") {
    if (next === amountMode) return;
    // convert the current value if price known
    if (!tokenPriceUSD || !Number.isFinite(parsedAmount)) {
      setAmountMode(next);
      return;
    }
    if (next === "USD") {
      const usd = parsedAmount * tokenPriceUSD; // current was TOKEN
      setAmount(toFixedTrim(usd, 2));
    } else {
      const tok = tokenPriceUSD > 0 ? parsedAmount / tokenPriceUSD : 0; // current was USD
      setAmount(toFixedTrim(tok, 6));
    }
    setAmountMode(next);
  }

  if (isStandaloneClaim) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#18181F]">
        <p className="text-slate-400 text-sm">Taking you to receive…</p>
      </div>
    );
  }

  async function onCreate(overrides?: { recipient?: string; toSel?: TokenSelection }) {
    const finalRecipient = overrides?.recipient || recipient;
    const finalToSel = overrides?.toSel ? findTokenBySelection(tokens, overrides.toSel) : selectedTo;

    if (!finalToSel || !amount || !finalRecipient) {
      toast({ variant: "destructive", title: "Missing fields", description: "Amount, destination token and recipient are required." });
      return;
    }
    setCreating(true);
    try {
      // Always store USD on the backend
      let amountUsdStr = amount;
      const price = typeof finalToSel.price === "number" ? finalToSel.price : tokenPriceUSD;
      if (amountMode === "TOKEN") {
        if (!price || price <= 0) {
          throw new Error("Cannot convert token to USD without a valid token price");
        }
        const usd = parseFloat(amount) * price;
        amountUsdStr = toFixedTrim(usd, 2);
      }
      const res = await createClaim({
        amount: amountUsdStr,
        toSel: { symbol: finalToSel.symbol, chain: finalToSel.chain },
        recipient: finalRecipient,
        userId: authenticated ? userId : undefined,
        isPrivate: PRIVATE_PAYMENT_COMING_SOON ? false : PRIVATE_PAYMENT_ENABLED || isPrivateMode,
      });
      setCreatedLink(res.link);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2500);
      toast({ title: "Payment link created", description: "Share the link with your recipient." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to create payment link ", description: e?.message || "Unknown error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {/* Privacy Tutorial Modal - Story Style */}
      {showPrivacyInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setShowPrivacyInfo(false); setTutorialStep(0); }}>
          {/* Audio element */}
          <audio id="privacy-audio" src="/sounds/privacy.mp3" preload="auto" />
          <div
            className="bg-white rounded-[20px] w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="flex gap-1.5 p-4 pb-0">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                  <div className={`h-full transition-all duration-300 ${tutorialStep >= i ? 'w-full' : 'w-0'}`} style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }} />
                </div>
              ))}
            </div>

            {/* Content - fixed height */}
            <div className="relative h-[360px] overflow-hidden">
              {/* Step 0: Intro */}
              <div className={`absolute inset-0 p-6 flex flex-col items-center justify-center text-center transition-all duration-300 ${tutorialStep === 0 ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <Image src="/images/icons/shield-icon.png" alt="" width={64} height={64} className="mb-5" />
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-3">Receive Privately</h3>
                <p className="text-slate-500">Get paid without anyone seeing how much or who paid you</p>
              </div>

              {/* Step 1: Private payment (MagicBlock PER) */}
              <div className={`absolute inset-0 p-6 flex flex-col items-center justify-center text-center transition-all duration-300 ${tutorialStep === 1 ? 'opacity-100 translate-x-0' : tutorialStep < 1 ? 'opacity-0 translate-x-full pointer-events-none' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <Image src="/images/icons/shield-icon.png" alt="" width={80} height={80} className="mb-5" />
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-3">MagicBlock PER</h3>
                <p className="text-slate-500">Payment is processed privately. You receive in your chosen token (e.g. USDC on Solana). Both addresses stay hidden.</p>
              </div>

              {/* Step 2: How it works */}
              <div className={`absolute inset-0 p-6 flex flex-col transition-all duration-300 ${tutorialStep === 2 ? 'opacity-100 translate-x-0' : tutorialStep < 2 ? 'opacity-0 translate-x-full pointer-events-none' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-6 text-center">How it works</h3>
                <div className="flex-1 flex  flex-col justify-center space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>1.</span>
                    <span className="text-slate-700 pt-1">Create your private link</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>2.</span>
                    <span className="text-slate-700  pt-1">They pay with any token</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>3.</span>
                    <span className="text-slate-700 pt-1">You receive privately (e.g. USDC)</span>
                  </div>
                </div>
              </div>

              {/* Step 3: Use your funds */}
              <div className={`absolute inset-0 p-6 flex flex-col transition-all duration-300 ${tutorialStep === 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}>
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-6 text-center">Use your funds</h3>
                <div className="flex-1 flex flex-col justify-center space-y-4">
                  <a href="https://z.cash/pay-with-zcash" target="_blank" rel="noopener noreferrer" className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8] hover:bg-gray-100 transition-colors">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>1.</span>
                    <span className="text-slate-700 pt-1">Swap to 120+ tokens on loofta</span>

                  </a>
                  <a href="/swap" className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8] hover:bg-gray-100 transition-colors">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>2.</span>
                    <span className="text-slate-700 pt-1">Pay at merchants</span>

                  </a>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>3.</span>
                    <span className="text-slate-700 pt-1">Hold in private pool</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="p-4 border-t border-gray-100">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (tutorialStep === 0) {
                      setShowPrivacyInfo(false);
                      setTutorialStep(0);
                    } else {
                      setTutorialStep(s => s - 1);
                    }
                  }}
                  className="flex-1 py-3 rounded-[12px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  {tutorialStep === 0 ? 'Skip' : 'Back'}
                </button>
                <button
                  onClick={() => tutorialStep < 3 ? setTutorialStep(s => s + 1) : (setShowPrivacyInfo(false), setTutorialStep(0))}
                  className="flex-1 py-3 rounded-[12px] font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                >
                  {tutorialStep === 3 ? 'Get Started' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Access Requested Success Modal */}
      {showAccessRequested && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAccessRequested(false)}>
          <div
            className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-8 text-center">
              {/* Success Icon */}
              <div className="flex justify-center mb-6">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(16,185,129,0.15) 100%)' }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-green-500">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                You're on the list!
              </h2>

              {/* Message */}
              <p className="text-gray-600 mb-2">
                Thanks for your interest in Loofta Pay!
              </p>
              <p className="text-gray-500 text-sm mb-6">
                We'll notify you at <span className="font-medium text-gray-700">{userEmail}</span> as soon as we're ready for you.
              </p>

              {/* Party emoji decoration */}
              <div className="flex justify-center gap-2 mb-6">
                <span className="text-3xl">🎉</span>
              </div>

              {/* CTA Button */}
              <button
                onClick={() => setShowAccessRequested(false)}
                className="w-full py-3.5 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      {!embedInApp && <div className="fixed inset-0 -z-10 bg-[#18181F]" />}
      <div className={embedInApp ? "w-full text-white" : "min-h-screen text-white"}>
        <div className={embedInApp ? "w-full max-w-lg mx-auto px-0" : "max-w-7xl mx-auto px-4 pb-12"}>
          <div className={embedInApp ? "w-full" : "flex flex-col md:flex-row items-center justify-center gap-16 min-h-[calc(100vh-7rem)]"}>
            {/* Left column - hidden when embedded */}
            {!embedInApp && (
              <div className="w-full md:w-1/2">
                {createdLink ? (
                  /* Success state left content */
                  <>
                    <h1 className="text-5xl md:text-6xl font-medium font-sans text-white leading-tight mb-8">
                      Payment Link <br /><span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Created!</span>
                    </h1>
                    <p className="text-gray-100 text-xl mb-8">
                      Your payment link is ready. Share it anywhere to get paid.
                    </p>
                    <button
                      type="button"
                      className="mt-8 inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity"
                      style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                      onClick={() => {
                        clearLink();
                        setAmount("");
                        setRecipient("");
                      }}
                    >
                      Create New Payment
                    </button>
                  </>
                ) : isPrivateMode || PRIVATE_PAYMENT_ENABLED ? (
                  /* Private mode left content */
                  <>
                    <h1 className="text-5xl md:text-6xl font-medium font-sans text-white leading-tight mb-8">
                      Receive <br /><span className="text-amber-400">Privately</span>
                    </h1>
                    <p className="text-gray-100 text-xl mb-8">
                      Get paid with complete financial privacy using MagicBlock PER (private USDC settlement).
                    </p>
                    <ul className="mt-6 space-y-4">
                      <li className="flex items-start gap-3">
                        <ShieldIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                        <span className="text-gray-300 text-xl">Amount hidden on-chain</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <LockIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                        <span className="text-gray-300 text-xl">Sender & recipient encrypted</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <EyeOffIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                        <span className="text-gray-300 text-xl">No transaction metadata exposed</span>
                      </li>
                    </ul>
                    <button
                      type="button"
                      onClick={() => setShowPrivacyInfo(true)}
                      className="mt-8 text-amber-400 hover:text-amber-300 text-lg flex items-center gap-2"
                    >
                      <InfoIcon className="w-5 h-5" />
                      How does private payment work?
                    </button>
                  </>
                ) : (
                  /* Standard mode left content */
                  <>
                    <h1 className="text-5xl md:text-6xl font-medium font-sans text-white leading-tight mb-8">
                      Create a new <br /><span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Payment Link</span>
                    </h1>
                    <p className="text-gray-100 text-xl mb-8">Joined the thousands who get paid with ANY token they want.</p>
                    <ul className="mt-6 space-y-4">
                      <li className="flex items-start gap-3">
                        <MoneyIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                        <span className="text-gray-300 text-xl">Set your amount</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <ChainIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                        <span className="text-gray-300 text-xl">Pick your preferred chain/token</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <ShareIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                        <span className="text-gray-300 text-xl">Share the link — they pay with ANY token</span>
                      </li>
                    </ul>


                    <Button variant="outline" className="mt-8 inline-flex items-center gap-2 rounded-[21px] text-slate-900/90 px-12 py-4 text-base font-medium border-2 shadow-md hover:scale-[1.02] transition-transform"
                      onClick={handleRequestAccess}
                    >
                      Request Access
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Right column - card */}
            <div className={`w-full ${embedInApp ? '' : (createdLink ? 'md:w-[480px]' : 'md:w-[420px]')} transition-all`}>
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-white shadow-2xl [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-600]:!text-slate-300 [&_.text-gray-500]:!text-slate-400 [&_.bg-white]:!bg-white/10 [&_.bg-gray-50]:!bg-white/5 [&_.border-gray-200]:!border-white/10 [&_.border-gray-100]:!border-white/10  [&_input]:!border-white/20 [&_input]:!text-white [&_input]:placeholder:!text-slate-400 [&_input]:focus-visible:!ring-white/30 [&_.border-gray-300]:!border-white/20">
                {showConfetti ? <ConfettiCanvas /> : null}
                {creating ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="relative h-12 w-12">
                      <span className="absolute inset-0 rounded-full bg-gradient-to-r from-yellow-500 to-red-600 opacity-30 animate-ping" />
                      <span className="absolute inset-0 rounded-full border-2 border-gray-300" />
                      <span className="absolute inset-1 rounded-full border-t-2 border-yellow-500 animate-spin" />
                    </div>
                    <div className="mt-4 text-base text-gray-700">Creating your payment link…</div>
                  </div>
                ) : createdLink ? (
                  <div>
                    <div className="flex justify-center">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-500/15 text-orange-500 border border-orange-400/30 shadow">
                        <CheckIcon className="h-12 w-12" />
                      </div>
                    </div>
                    <div className="mt-4 text-center">
                      <h2 className="text-2xl md:text-3xl text-gray-900 font-semibold">Congrats! Your payment link is ready</h2>
                      <p className="mt-1 text-lg md:text-xl text-gray-700 font-medium font-sans">Share this link with your recipient.</p>
                    </div>
                    <div className="mt-5">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <a className="text-gray-900 underline decoration-gray-400 hover:decoration-gray-700 break-all" href={createdLink} target="_blank" rel="noreferrer">
                          {maskLink(createdLink)}
                        </a>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(createdLink);
                              toast({ title: "Copied", description: "Payment link copied to clipboard." });
                            } catch {
                              toast({ variant: "destructive", title: "Copy failed", description: "Could not copy link. Please try again." });
                            }
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-gray-600">
                            <path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                          </svg>
                          Copy
                        </button>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      {(() => {
                        const url = encodeURIComponent(createdLink);
                        const text = encodeURIComponent("Pay me securely on Loofta with any token using this link:");
                        return (
                          <>
                            <a
                              href={`https://t.me/share/url?url=${url}&text=${text}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="text-sky-500"><path fill="currentColor" d="M9.04 15.49 8.9 18.6a.9.9 0 0 0 1.42.77l2.05-1.39 3.3 2.42c.61.45 1.48.12 1.67-.62l3.02-11.54c.2-.76-.52-1.44-1.25-1.16l-16 6.2c-.81.31-.78 1.49.04 1.75l4.9 1.55 9.04-6.48-9.16 7.39Z" /></svg>
                              Share
                            </a>
                            <a
                              href={`https://wa.me/?text=${text}%20${url}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="text-green-500"><path fill="currentColor" d="M20.52 3.48A11.82 11.82 0 0 0 12.07 0C5.52.03.2 5.34.22 11.88A11.77 11.77 0 0 0 2.5 18.5L1 24l5.63-1.48a11.86 11.86 0 0 0 5.44 1.39h.01c6.55-.03 11.86-5.34 11.89-11.89a11.8 11.8 0 0 0-3.45-8.54ZM12.08 21.3h-.01c-1.75 0-3.47-.47-4.98-1.36l-.36-.21-3.34.88.89-3.26-.23-.34a9.18 9.18 0 0 1-1.41-4.94c-.02-5.08 4.12-9.23 9.21-9.25h.01c2.46 0 4.77.96 6.51 2.7a9.14 9.14 0 0 1 2.7 6.53c-.02 5.08-4.16 9.25-9.26 9.25Zm5.04-6.9c-.27-.14-1.6-.79-1.85-.88-.25-.09-.43-.14-.62.14-.18.27-.71.88-.87 1.07-.16.18-.32.2-.59.07-.27-.14-1.12-.41-2.13-1.31-.79-.7-1.32-1.56-1.47-1.82-.15-.27-.02-.41.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.06-.22-.53-.45-.46-.62-.47l-.53-.01c-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.85.14.18 1.95 2.98 4.73 4.18.66.28 1.18.45 1.58.58.66.21 1.26.18 1.73.11.53-.08 1.6-.65 1.83-1.27.23-.62.23-1.15.16-1.26-.07-.11-.25-.18-.52-.31Z" /></svg>
                              WhatsApp
                            </a>
                            <a
                              href={`mailto:?subject=${encodeURIComponent("Payment request")}&body=${text}%0A%0A${url}`}
                              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Email
                            </a>
                          </>
                        );
                      })()}
                    </div>
                    <div className="mt-6">
                      <Button
                        variant="outline"
                        className="w-full rounded-xl border-2 border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-medium"
                        onClick={() => clearLink()}
                      >
                        Create a new link
                      </Button>
                    </div>
                    {!authenticated && (
                      <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-4 text-center space-y-3">
                        <div className="text-lg font-semibold text-gray-900">Create your profile</div>
                        <div className="text-base text-gray-600">
                          Claim your username to get a personal payment link and earn points on every payment.
                        </div>
                        <GradientActionButton
                          className="w-auto px-5 py-2 h-10"
                          onClick={() => (typeof login === 'function' ? login() : undefined)}
                        >
                          Create profile & claim username
                        </GradientActionButton>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Amount Input - with digit sizing */}
                    <div>
                      <div className="text-gray-600 mb-2">Amount you receive</div>
                      <div className="flex items-baseline gap-0">
                        <span
                          ref={mirrorRef}
                          aria-hidden="true"
                          className="invisible absolute -z-50 font-semibold tracking-tight tabular-nums"
                          style={{ fontSize: `${amountFontPx}px`, lineHeight: 1.1 }}
                        >
                          {displayAmount}
                        </span>
                        <input
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => onChangeAmount(e.target.value)}
                          placeholder="0"
                          className="text-gray-900 placeholder:text-gray-300 font-semibold font-sans tracking-tight border-0 bg-transparent outline-none tabular-nums p-0 m-0"
                          style={{ fontSize: `${amountFontPx}px`, lineHeight: 1.1, width: `${inputWidthPx + amountGapPx}px`, backgroundColor: 'transparent !important' }}
                        />
                        <span className="font-semibold font-sans text-slate-500 ml-1" style={{ fontSize: `${suffixFontPx}px`, lineHeight: 1.1 }}>
                          USD
                        </span>
                      </div>
                    </div>

                    {/* Private mode note - same form as standard; settlement via PER */}
                    {(isPrivateMode || PRIVATE_PAYMENT_ENABLED) && (
                      <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-slate-300">
                        Payment will be processed on Magicblock Private Ephemeral Rollup. You receive in your chosen token below.
                      </div>
                    )}

                    {/* Token display / selection - same for standard and private */}
                    {authenticated ? (
                      /* Logged in: Receive on Loofta (no token/wallet) or Use another wallet — like pay modal */
                      <>
                        <div className="flex flex-col gap-3">
                          <button
                            type="button"
                            onClick={() => setReceiveDestination("loofta")}
                            className={`flex items-center gap-3 w-full p-4 rounded-xl border transition-all text-left ${receiveDestination === "loofta" ? "border-orange-400/50 bg-orange-500/20" : "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"}`}
                          >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 p-1.5 ${receiveDestination === "loofta" ? "bg-orange-500/30 border border-orange-400/40" : "bg-white/10 border border-white/20"}`}>
                              <LooftaIcon className="w-full h-full object-contain" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-gray-900 block">Receive on Loofta</span>
                              <span className="text-sm text-gray-500">
                                {solanaWallet?.address && defaultLooftaToken
                                  ? `Your Loofta wallet · ${defaultLooftaToken.symbol}`
                                  : "Your Loofta wallet · USDC"}
                              </span>
                            </div>
                            {receiveDestination === "loofta" && solanaWallet?.address && defaultLooftaToken && (
                              <span className="text-xs font-medium text-emerald-300 bg-emerald-500/20 px-2 py-1 rounded-full shrink-0 border border-emerald-400/30">Ready</span>
                            )}
                          </button>

                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-sm font-medium text-gray-400">or</span>
                            <div className="flex-1 h-px bg-white/10" />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setReceiveDestination("other");
                              setRecipient("");
                              setToSel(undefined);
                            }}
                            className={`flex items-center gap-3 w-full p-4 rounded-xl border transition-all text-left ${receiveDestination === "other" ? "border-orange-400/50 bg-orange-500/20" : "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"}`}
                          >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${receiveDestination === "other" ? "bg-orange-500/30 border border-orange-400/40" : "bg-white/10 border border-white/20"}`}>
                              <Wallet className={`w-5 h-5 ${receiveDestination === "other" ? "text-orange-200" : "text-gray-700"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-gray-900 block">Use another wallet</span>
                              <span className="text-sm text-gray-500">Different token or network</span>
                            </div>
                            {receiveDestination === "other" ? (
                              <span className="text-xs font-medium text-emerald-300 bg-emerald-500/20 px-2 py-1 rounded-full shrink-0 border border-emerald-400/30">Selected</span>
                            ) : (
                              <ArrowRight className="w-5 h-5 text-gray-400 shrink-0" />
                            )}
                          </button>
                        </div>

                        {receiveDestination === "other" && (
                          <>
                            <div>
                              <label className="text-gray-600 mb-1 block">Token you want to receive</label>
                              <TokenCombobox
                                tokens={tokens}
                                value={toSel}
                                onChange={setToSel}
                                placeholder="Select token"
                                onQuery={async (q) => tokens.filter(t => t.symbol.toLowerCase().includes((q || '').toLowerCase()))}
                                className="bg-white text-gray-900 border border-gray-200 hover:border-orange-300 w-full h-12"
                              />
                            </div>
                            <div>
                              <label className="text-gray-600 mb-1 block">Wallet address</label>
                              <Input
                                type="text"
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                placeholder={(() => {
                                  const chain = String(selectedTo?.chain || '').toLowerCase();
                                  if (['solana', 'sol'].includes(chain)) return 'So1ana...';
                                  if (['near'].includes(chain)) return 'account.near';
                                  if (['bitcoin', 'btc'].includes(chain)) return 'bc1...';
                                  if (['zec', 'zcash'].includes(chain)) return 'zs1... or t1...';
                                  if (['cosmos', 'atom'].includes(chain)) return 'cosmos1...';
                                  if (['tron', 'trx'].includes(chain)) return 'T...';
                                  return '0x...';
                                })()}
                                className="h-12 text-gray-900 placeholder:text-gray-400 border-gray-200 focus:border-orange-400 bg-white/5 border border-white/10"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                onPaste={(e) => {
                                  try {
                                    const pasted = e.clipboardData?.getData('text/plain') || '';
                                    if (pasted) {
                                      e.preventDefault();
                                      setRecipient(pasted.trim());
                                    }
                                  } catch { }
                                }}
                              />
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      /* Not logged in: token + address only */
                      <>
                        <div>
                          <label className="text-gray-600 mb-1 block">Token you want to receive</label>
                          <TokenCombobox
                            tokens={tokens}
                            value={toSel}
                            onChange={setToSel}
                            placeholder="Select token"
                            onQuery={async (q) => tokens.filter(t => t.symbol.toLowerCase().includes((q || '').toLowerCase()))}
                            className="bg-white text-gray-900 border border-gray-200 hover:border-orange-300 w-full h-12"
                          />
                        </div>
                        <div>
                          <label className="text-gray-600 mb-1 block">Your wallet address</label>
                          <Input
                            type="text"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder={(() => {
                              const chain = String(selectedTo?.chain || '').toLowerCase();
                              if (['solana', 'sol'].includes(chain)) return 'So1ana...';
                              if (['near'].includes(chain)) return 'account.near';
                              if (['bitcoin', 'btc'].includes(chain)) return 'bc1...';
                              if (['zec', 'zcash'].includes(chain)) return 'zs1... or t1...';
                              if (['cosmos', 'atom'].includes(chain)) return 'cosmos1...';
                              if (['tron', 'trx'].includes(chain)) return 'T...';
                              return '0x...';
                            })()}
                            className="h-12 text-gray-900 placeholder:text-gray-400 border-gray-200 bg-white/5 border-white/10 focus:border-orange-400"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            onPaste={(e) => {
                              try {
                                const pasted = e.clipboardData?.getData('text/plain') || '';
                                if (pasted) {
                                  e.preventDefault();
                                  setRecipient(pasted.trim());
                                }
                              } catch { }
                            }}
                          />
                        </div>
                      </>
                    )}

                    {/* Private payment — switch hidden when app defaults to private (PER) */}
                    {!PRIVATE_PAYMENT_ENABLED ? (
                    <div
                      className={`p-4 rounded-xl border ${!PRIVATE_PAYMENT_COMING_SOON && isPrivateMode
                        ? 'bg-amber-500/10 border-amber-400/30'
                        : 'bg-white/5 border-white/10'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-base font-semibold text-white">
                              🔒 Private payment
                            </span>
                            {PRIVATE_PAYMENT_COMING_SOON && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-400/30">
                                Coming soon
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-400">
                            When on, payment uses MagicBlock PER. You receive in your chosen token (e.g. USDC on Solana); both addresses stay private.
                          </p>
                        </div>
                        <Switch
                          checked={PRIVATE_PAYMENT_COMING_SOON ? false : isPrivateMode}
                          onCheckedChange={PRIVATE_PAYMENT_COMING_SOON ? () => { } : (checked) => {
                            setIsPrivateMode(checked);
                            if (checked && !hasSeenPrivateTutorial) {
                              setShowPrivacyInfo(true);
                              setHasSeenPrivateTutorial(true);
                            }
                          }}
                          disabled={PRIVATE_PAYMENT_COMING_SOON}
                          className="shrink-0 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                        />
                      </div>
                    </div>
                    ) : (
                      <div className="p-4 rounded-xl border border-amber-400/30 bg-amber-500/10">
                        <p className="text-sm text-slate-200">
                          <span className="font-semibold text-white">🔒 Private payment</span>
                          {" "}— MagicBlock PER is on for every link you create.
                        </p>
                      </div>
                    )}

                    {/* Create Button - same for standard and private */}
                    {authenticated && !showAccessRequested ? (
                      <GradientActionButton
                        onClick={() => onCreate()}
                        disabled={
                          creating ||
                          !(parsedAmount > 0 &&
                            (receiveDestination === "loofta"
                              ? !!(solanaWallet?.address && defaultLooftaToken)
                              : !!selectedTo && !!(recipient || "").trim()))
                        }
                        loading={creating}
                        loadingText="Creating…"
                      >
                        {!PRIVATE_PAYMENT_COMING_SOON && (isPrivateMode || PRIVATE_PAYMENT_ENABLED) ? (
                          <>
                            <ShieldIcon className="w-5 h-5" />
                            Create private payment link
                          </>
                        ) : (
                          "Create Payment"
                        )}
                      </GradientActionButton>
                    ) : (
                      <button
                        onClick={handleRequestAccess}
                        className="w-full py-3.5 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                      >
                        <span className="flex items-center justify-center gap-2">
                          Login to create new payment
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ConfettiCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx0 = canvas.getContext("2d");
    if (!ctx0) return;
    const ctx = ctx0 as CanvasRenderingContext2D;
    let raf = 0;
    let running = true;
    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    function resize() {
      if (!canvas) return;
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || 300;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
    }
    resize();
    const onResize = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      resize();
    };
    window.addEventListener("resize", onResize);

    type P = { x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number; color: string; life: number; };
    const colors = ["#FF0F00", "#EAB308", "#22c55e", "#0ea5e9", "#9333ea"];
    const particles: P[] = [];
    const W = () => (parent?.clientWidth || window.innerWidth);
    const H = () => (parent?.clientHeight || 300);
    const now = performance.now();
    const duration = 1800;
    // Emit from top-center and sides
    function emit(count: number, originX: number, originY: number, spread: number) {
      for (let i = 0; i < count; i++) {
        const angle = (Math.random() - 0.5) * spread;
        const speed = 4 + Math.random() * 5;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          r: 2 + Math.random() * 3,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.2,
          color: colors[Math.floor(Math.random() * colors.length)],
          life: now + duration + Math.random() * 500,
        });
      }
    }
    emit(60, W() / 2, H() * 0.2, Math.PI);
    emit(40, W() * 0.1, H() * 0.3, Math.PI / 1.2);
    emit(40, W() * 0.9, H() * 0.3, Math.PI / 1.2);

    function tick() {
      if (!running) return;
      ctx.clearRect(0, 0, W(), H());
      const g = 0.15;
      const drag = 0.995;
      const t = performance.now();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vx *= drag;
        p.vy = p.vy * drag + g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
        ctx.restore();
        if (t > p.life || p.y > H() + 40) {
          particles.splice(i, 1);
        }
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      }
    }
    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />;
}

function MoneyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M6 9h0M18 15h0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChainIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M10 14l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="3" y="9" width="8" height="6" rx="3" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="9" width="8" height="6" rx="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ShareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 8l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WalletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="14" r="1.5" fill="currentColor" />
    </svg>
  );
}

