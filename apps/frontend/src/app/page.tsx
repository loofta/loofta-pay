'use client'

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SendFlowInApp } from "@/components/app/SendFlowInApp";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";
import { motion, AnimatePresence } from "framer-motion";
import { AtSign, LinkIcon, Mail, PlusIcon } from "lucide-react";

const ClaimPageContent = dynamic<{ embedInApp?: boolean }>(
  () => import("@/app/claim/ClaimPageContent").then((mod) => ({ default: mod.ClaimPageContent })),
  { ssr: false }
);

const HOME_TAB_KEY = "loofta.home.tab";

export default function Home() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { authenticated } = useAuth();
  const username = useAuthStore((s) => s.username ?? null);
  const { login: privyLogin } = usePrivy();
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
    if (searchParams.get("tab") === "receive") setActiveTabState("receive");
  }, [searchParams]);

  // When ?to=username (e.g. redirect from /link/@username), show Send tab and pay-to-user form
  const toParam = searchParams.get("to");
  useEffect(() => {
    if (!toParam) return;
    const clean = toParam.replace(/^@/, "").trim().toLowerCase();
    if (!clean) return;
    setActiveTabState("send");
    setRecipient(clean.replace(/^@+/, ""));
    setSelectedRecipient(clean);
    setSendStep(2);
    const amt = searchParams.get("amount");
    if (amt != null && amt !== "" && !isNaN(Number(amt)) && Number(amt) >= 0) setAmount(amt);
  }, [toParam, searchParams]);

  // Open create-payment-link card when ?create=1 (e.g. redirect from /claim)
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setActiveTabState("receive");
      setShowClaimOverlay(true);
    }
  }, [searchParams]);

  const setActiveTab = (tab: "send" | "receive") => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") localStorage.setItem(HOME_TAB_KEY, tab);
  };
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [sendStep, setSendStep] = useState<1 | 2 | 3>(1);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dropdownClosed, setDropdownClosed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showClaimOverlay, setShowClaimOverlay] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchCacheRef = useRef<Map<string, { usernames: string[]; ts: number }>>(new Map());
  const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

  const searchQuery = recipient.replace(/^@/, "").trim().toLowerCase();
  const showDropdown = false; // Autocomplete/suggestions disabled for now
  // --- Amount hero sizing (copied from ClaimPageContent style) ---
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const [amountInputWidthPx, setAmountInputWidthPx] = useState<number>(0);

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
      // Keep trailing dot so user can type decimals (e.g. "10." → "10.5")
      return hadTrailingDot && dec === "" ? `${int}.` : result;
    }
    return p[0] || "";
  }

  function onChangeAmount(v: string) {
    setAmount(sanitizeNumberInput(v, 9));
  }

  const displayAmount = (amount && amount.length > 0) ? amount : "0";

  // count only digits for sizing (ignore dot)
  const totalDigitsCount = (() => {
    const onlyDigits = String(amount || "").replace(/[^0-9]/g, "");
    return onlyDigits.length || 1;
  })();

  function computeFontPx(digits: number) {
    const maxPx = 72; // tweak: slightly smaller than claim page for your card
    const minPx = 28;
    const startDigits = 5;
    const stepPerDigit = 7;
    const delta = Math.max(0, digits - startDigits) * stepPerDigit;
    return Math.max(minPx, maxPx - delta);
  }

  const amountFontPx = computeFontPx(totalDigitsCount);
  const suffixFontPx = Math.max(18, Math.round(amountFontPx * 0.62));
  const amountGapPx = 8;
  const looksLikeEmail = recipient.includes("@") && recipient.includes(".");

  useEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAmountInputWidthPx(Math.ceil(rect.width));
  }, [displayAmount, amountFontPx]);

  const faqItems = [
    { question: "What is the network fee?", answer: "All payments with USDC on Solana are free — gas is sponsored. On other networks we apply a small platform fee for the cross-chain transfer (near zero)." },
    { question: "What is a burner wallet?", answer: "A burner wallet is a temporary deposit address we generate for your payment. You send funds to this address and Loofta Pay routes them to the recipient. You don't need to connect a wallet to pay—just send to the deposit address." },
    { question: "How do private payments work?", answer: "Private payments use Magicblock Private Ephemeral Rollup so the transfer is secure and private." },
    { question: "Can I send to someone before they have an account?", answer: "Yes. You can send to a Twitter/X username or email. They'll get a link to sign up and claim the payment. Once they log in with that identity, they can claim the funds." },
    { question: "APY on received amount & auto-compound?", answer: "We're building APY in USD on your received balance, with every claimed payment auto-compounding. Coming soon." },
    { question: "Points system", answer: "A points system is coming soon. You'll earn points for receiving and for sending both private and standard payments." },
    {
      question: "I'm on devnet — how do I get test SOL and USDC?",
      answer: (
        <>
          Get free devnet SOL from the{" "}
          <a href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer" className="underline text-amber-400 hover:text-amber-300">
            Solana faucet
          </a>
          . For devnet USDC, use the{" "}
          <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="underline text-amber-400 hover:text-amber-300">
            Circle faucet
          </a>
          .
        </>
      ),
    },
  ];

  // Exact email only: no partial match to avoid linking/leaking users
  const isExactEmail = (q: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }
    const cached = searchCacheRef.current.get(searchQuery);
    if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL_MS) {
      setSuggestions(cached.usernames);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cachedAgain = searchCacheRef.current.get(searchQuery);
      if (cachedAgain && Date.now() - cachedAgain.ts < SEARCH_CACHE_TTL_MS) {
        setSuggestions(cachedAgain.usernames);
        return;
      }
      setLoadingSuggestions(true);
      try {
        if (isExactEmail(searchQuery)) {
          // Only resolve by exact email – no partial email search (privacy)
          const r = await fetch(`/api/users/resolve-recipient?q=${encodeURIComponent(searchQuery)}`);
          const data = await r.json();
          const list = data?.username ? [data.username] : [];
          setSuggestions(list);
          searchCacheRef.current.set(searchQuery, { usernames: list, ts: Date.now() });
        } else {
          const r = await fetch(`/api/users/search-usernames?q=${encodeURIComponent(searchQuery)}`);
          const data = await r.json();
          const list = data.usernames || [];
          setSuggestions(list);
          searchCacheRef.current.set(searchQuery, { usernames: list, ts: Date.now() });
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [recipient]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownClosed(true);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSendContinue = async () => {
    const trimmed = recipient.replace(/^@/, "").trim();
    if (!trimmed) return;
    let resolvedUsername = trimmed.toLowerCase();
    if (trimmed.includes("@")) {
      try {
        const r = await fetch(`/api/users/resolve-recipient?q=${encodeURIComponent(trimmed)}`);
        const data = await r.json();
        if (data?.username) resolvedUsername = data.username;
      } catch {
        // keep
      }
    }
    setSelectedRecipient(resolvedUsername);
    setSendStep(2);
  };

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header + tab content: min one screen so FAQ is below the fold */}
        <div className="min-h-[calc(100vh-var(--header-h,0px))]">

          <div className="hidden md:block">
            <SendReceiveTabs activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab)} />
          </div>

          {activeTab === "send" && (
            <>
              {sendStep === 3 && claimId ? (
                <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setClaimId(null);
                        setSelectedRecipient(null);
                        setSendStep(1);
                      }}
                      className="text-slate-300 hover:text-white text-sm font-medium"
                    >
                      ← New payment
                    </button>
                  </div>
                  <p className="text-slate-200 mb-4">Payment link created. Share it or open it to view status.</p>
                  <Link
                    href={`/c/${claimId}`}
                    className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-6 py-3 text-white font-semibold hover:opacity-90"
                  >
                    View payment
                  </Link>
                </div>
              ) : selectedRecipient ? (
                <SendFlowInApp
                  recipientUsername={selectedRecipient}
                  initialAmount={amount}
                  onBack={() => {
                    setSelectedRecipient(null);
                    setSendStep(1);
                  }}
                  onClaimCreated={(id) => {
                    router.push(`/c/${id}`);
                  }}
                />
              ) : (
                <>
                  {!authenticated && (
                    <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-red-500/10 border border-white/10 px-4 py-3 mb-6">
                      <p className="text-base text-slate-300">
                        Log in to keep track of this payment and reclaim your money if needed.
                      </p>
                      <button
                        type="button"
                        onClick={() => privyLogin({ loginMethods: ["email"], disableSignup: false })}
                        className="inline-block mt-2 text-base font-medium text-amber-400 hover:text-amber-300"
                      >
                        Sign in →
                      </button>
                    </div>
                  )}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                    <div ref={wrapperRef} className="relative">
                      <Label className="text-slate-300 text-xl font-sans font-medium mb-5">Send</Label>

                      <div className="rounded-2xl mt-3 mb-6">
                        <span
                          ref={mirrorRef}
                          aria-hidden="true"
                          className="invisible absolute -z-50 font-sans font-medium tracking-tight tabular-nums"
                          style={{ fontSize: `${amountFontPx}px`, lineHeight: 1.05 }}
                        >
                          {displayAmount}
                        </span>

                        <div className="flex flex-col">
                          <div className="flex items-baseline tabular-nums">
                            <input
                              inputMode="decimal"
                              value={amount}
                              onChange={(e) => onChangeAmount(e.target.value)}
                              placeholder="0"
                              className={[
                                "text-white placeholder:text-slate-600",
                                "font-semibold font-sans tracking-tight tabular-nums",
                                "border-0 bg-transparent outline-none p-0 m-0 text-center",
                              ].join(" ")}
                              style={{
                                fontSize: `${amountFontPx}px`,
                                lineHeight: 1.05,
                                width: `${amountInputWidthPx + amountGapPx}px`,
                              }}
                              aria-label="Amount in USD"
                            />
                            <span
                              className="font-semibold font-sans text-slate-500 ml-1"
                              style={{ fontSize: `${suffixFontPx}px`, lineHeight: 1.05 }}
                            >
                              USD
                            </span>
                          </div>
                        </div>
                      </div>
                      <Label className="text-slate-300 text-xl font-sans font-medium">To</Label>
                      <div className="relative mt-3">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                          {looksLikeEmail ? <Mail className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
                        </span>
                        <Input
                          type="text"
                          name="send-to-recipient"
                          placeholder="Loofta, Twitter username, exact email"
                          value={recipient}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const trimmed = raw.replace(/^@+/, "").trimStart();
                            setRecipient(trimmed);
                          }}
                          autoComplete="off"
                          className="h-12 pl-10 mb-2 bg-white/5 border-white/10 text-white text-md placeholder:text-slate-500 placeholder:text-[20px]"
                          style={{
                            fontSize: `20px`,
                          }}
                        />
                      </div>
                      {showDropdown && (
                        <ul className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-white/10 bg-[#1a1a1f] py-1 shadow-lg max-h-48 overflow-auto">
                          {loadingSuggestions ? (
                            <li className="px-3 py-2 text-slate-300 text-sm">Searching…</li>
                          ) : suggestions.length > 0 ? (
                            suggestions.map((u) => (
                              <li key={u}>
                                <button
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-white hover:bg-white/10 text-sm"
                                  onClick={() => {
                                    setRecipient(u);
                                    setDropdownClosed(true);
                                  }}
                                >
                                  <span>@{u}</span>
                                  {suggestions.length === 1 && isExactEmail(searchQuery) && (
                                    <span className="text-slate-400 text-sm ml-1">(from email)</span>
                                  )}
                                </button>
                              </li>
                            ))
                          ) : (
                            <li className="px-3 py-2 text-slate-400 text-sm">No users found</li>
                          )}
                        </ul>
                      )}
                      <p className="text-sm text-slate-400 mt-0.5 mb-1.5">
                        Loofta or Twitter username, or exact email – they claim by signing in with that account.
                      </p>
                    </div>
                    <Button
                      onClick={handleSendContinue}
                      disabled={!recipient.trim()}
                      className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                    >
                      Continue
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === "receive" && (
            <div className="space-y-4">
              {showClaimOverlay ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowClaimOverlay(false)}
                    className="flex items-center gap-2 text-slate-300 hover:text-white text-sm font-medium"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back to receive
                  </button>
                  <ClaimPageContent embedInApp />
                </>
              ) : (
                <>
                  {/* Share your personal link */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                    <p className="text-slate-300 text-xl font-medium flex gap-3 font-sans items-center">
                      <LinkIcon className={"text-orange-400 w-4 h-4"} />
                      Share your personal link
                    </p>
                    {authenticated && username ? (
                      <>
                        <p className="text-slate-300 text-sm">
                          Anyone can pay you by opening this link. You receive in your preferred token and chain.
                        </p>
                        <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                          <span className="flex-1 text-sm font-mono text-white truncate">
                            {typeof window !== "undefined" ? `${window.location.origin}/link/@${username}` : `/link/@${username}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const link = typeof window !== "undefined" ? `${window.location.origin}/link/@${username}` : "";
                              navigator.clipboard.writeText(link);
                              setLinkCopied(true);
                              setTimeout(() => setLinkCopied(false), 2000);
                            }}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-white/10 text-slate-300 hover:text-white hover:bg-white/15 text-sm font-medium transition-colors"
                          >
                            {linkCopied ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <Button
                          variant="receiveSignIn"
                          className="w-full h-12 rounded-xl"
                          onClick={() => useAuthStore.getState().setOpenShareModal(true)}
                        >
                          Share & settings
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-300 text-sm">
                          Sign in to get your own payment link. Add Twitter later to get a unique @username.
                        </p>
                        <Button
                          type="button"
                          variant="receiveSignIn"
                          onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
                          className="w-full h-12 rounded-xl font-semibold"
                        >
                          Sign in to get your payment link
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Create new payment link */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                    <p className="text-slate-300 text-xl flex gap-3 font-sans font-medium items-center">
                      <PlusIcon className={"text-orange-400 w-4 h-4"} />
                      Create new payment link
                    </p>
                    <p className="text-slate-300 text-sm">
                      Create a one-off payment request. You choose amount, token, and chain. No account required to create.
                    </p>
                    <Button
                      type="button"
                      onClick={() => setShowClaimOverlay(true)}
                      className="w-full h-11 rounded-xl text-base font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 border-0"
                    >
                      Create new payment link
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FAQ — below the fold, above footer (same styling as /about), wider than main column */}
      <section className="md:pb-16 px-4 pb-24">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-medium font-sans text-white text-center mb-8 md:mb-10">
            Frequently asked<br />questions
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
                      <div className="px-6 pb-5">
                        <p className="text-lg text-slate-400">
                          {item.answer}
                        </p>
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
