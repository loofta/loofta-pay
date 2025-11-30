'use client'

import { useState, type SVGProps, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { findTokenBySelection } from "@/lib/tokens";
import { maskLink } from "@/lib/format";

async function createClaim(formData: {
  amount: string;
  toSel: TokenSelection;
  recipient: string;
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

export default function ClaimPage() {
  const { authenticated, email: userEmail, login } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();
  const [toSel, setToSel] = useState<TokenSelection | undefined>(undefined);
  const [amount, setAmount] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string>("");
  const [notifyChecked, setNotifyChecked] = useState<boolean>(Boolean(userEmail));
  const [notifyEmail, setNotifyEmail] = useState<string>(userEmail || "");
  const [amountMode, setAmountMode] = useState<"USD" | "TOKEN">("USD");
  const [showConfetti, setShowConfetti] = useState<boolean>(false);

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
    const maxPx = 84; // ~text-7xl
    const minPx = 26; // lower bound to keep readable
    const startDigits = 5;
    const stepPerDigit = 6; // px reduction per extra digit
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

  async function onCreate() {
    if (!selectedTo || !amount || !recipient) {
      toast({ variant: "destructive", title: "Missing fields", description: "Amount, destination token and recipient are required." });
      return;
    }
    setCreating(true);
    try {
      // Always store USD on the backend
      let amountUsdStr = amount;
      if (amountMode === "TOKEN") {
        if (!tokenPriceUSD || tokenPriceUSD <= 0) {
          throw new Error("Cannot convert token to USD without a valid token price");
        }
        const usd = parseFloat(amount) * tokenPriceUSD;
        amountUsdStr = toFixedTrim(usd, 2);
      }
      const res = await createClaim({
        amount: amountUsdStr,
        toSel: { symbol: selectedTo.symbol, chain: selectedTo.chain },
        recipient,
        // Only include email if user opted in and a valid email is present
        notifyEmailTo: notifyChecked && notifyEmail ? notifyEmail : undefined,
      } as any);
      setLink(res.link);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2500);
      toast({ title: "Payment link created", description: "Share the link with your recipient." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to create payment link", description: e?.message || "Unknown error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <div className="flex flex-col md:flex-row items-center justify-center gap-32 min-h-[calc(100vh-7rem)]">
            {/* Left column - text only */}
            <div className="w-full md:w-1/2">
              <h1 className="text-5xl md:text-6xl font-medium font-display text-white leading-tight mb-8">
                Create a new <br /><span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Payment Link</span>
              </h1>
              <p className="text-gray-100 text-xl mb-8">Joined the thousands of people who have already used Loofta to request payments from friends and paid gigs. You create the link, and they can pay you with ANY token they want.</p>

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
                  <span className="text-gray-300 text-xl">Share the link — they can pay you with ANY token they want</span>
                </li>
              </ul>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#FF0F00] font-bold rounded-2xl text-lg hover:bg-gray-100 transition-all duration-200 shadow-lg"
                  onClick={() => (typeof login === 'function' ? login() : undefined)}
                >
                  Create an account
                </button>

              </div>
            </div>

            {/* Right column - card with form / loader / success */}
            <div className="w-full md:w-1/2">
              <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                {showConfetti ? <ConfettiCanvas /> : null}
                {creating ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="relative h-12 w-12">
                      <span className="absolute inset-0 rounded-full bg-gradient-to-r from-yellow-500 to-red-600 opacity-30 animate-ping" />
                      <span className="absolute inset-0 rounded-full border-2 border-gray-300" />
                      <span className="absolute inset-1 rounded-full border-t-2 border-yellow-500 animate-spin" />
                    </div>
                    <div className="mt-4 text-sm text-gray-700">Creating your payment link…</div>
                  </div>
                ) : link ? (
                  <div>
                    <div className="flex justify-center">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-400/30 shadow">
                        <CheckIcon className="h-12 w-12" />
                      </div>
                    </div>
                    <div className="mt-4 text-center">
                      <h2 className="text-2xl md:text-3xl text-gray-900 font-semibold">Congrats! Your one‑time payment link is ready</h2>
                      <p className="mt-1 text-lg md:text-xl text-gray-700 font-medium font-display">Share this link with your recipient.</p>
                    </div>
                    <div className="mt-5">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <a className="text-gray-900 underline decoration-gray-400 hover:decoration-gray-700 break-all" href={link} target="_blank" rel="noreferrer">
                          {maskLink(link)}
                        </a>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(link);
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
                        const url = encodeURIComponent(link);
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
                    <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-4 text-center space-y-3">
                      <div className="text-lg font-semibold text-gray-900">Create your profile</div>
                      <div className="text-sm text-gray-600">
                        Claim your username to get a personal payment link and earn points on every payment.
                      </div>
                      <GradientActionButton
                        className="w-auto px-5 py-2 h-10"
                        onClick={() => (typeof login === 'function' ? login() : undefined)}
                      >
                        Create profile & claim username
                      </GradientActionButton>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 max-w-sm mx-auto">
                    <div>
                      <div className="text-sm font-medium text-gray-700">Amount you receive</div>
                      {/* Big amount input with suffix */}
                      <div className="mt-4 overflow-visible">
                        <div className="flex items-baseline justify-start gap-0 whitespace-nowrap">
                          {/* Mirror for precise width measurement */}
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
                            className={`text-left font-semibold tracking-tight border-0 bg-transparent shadow-none outline-none focus-visible:ring-0 placeholder:text-gray-300 text-gray-900 tabular-nums p-0 m-0 appearance-none`}
                            style={{ fontSize: `${amountFontPx}px`, lineHeight: 1.1, width: `${inputWidthPx + amountGapPx}px` }}
                          />
                          <span className={`font-semibold text-gray-400 ml-0`} style={{ fontSize: `${suffixFontPx}px`, lineHeight: 1.1 }}>
                            {amountMode === "USD" ? "USD" : (selectedTo?.symbol || "TOKEN")}
                          </span>
                        </div>
                        {/* Converter line - click to switch mode */}
                        {selectedTo ? (
                          <button
                            type="button"
                            onClick={() => switchMode(amountMode === "USD" ? "TOKEN" : "USD")}
                            className="mt-6 inline-flex items-center gap-2 text-[15px] font-medium text-orange-400 hover:text-orange-300"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
                              <path d="M7 7h10M7 7l3-3M7 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M17 17H7m10 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {amountMode === "USD" ? (
                              tokenValue != null
                                ? <span>{toFixedTrim(tokenValue || 0, 6)} {selectedTo?.symbol}</span>
                                : <span>—</span>
                            ) : (
                              usdValue != null
                                ? <span>{toFixedTrim(usdValue || 0, 2)} USD</span>
                                : <span>—</span>
                            )}
                          </button>
                        ) : (
                          <div className="mt-6 text-gray-500 text-sm">Select a token to see conversion</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Destination token</label>
                      <div className="mt-1 w-full">
                        <TokenCombobox
                          tokens={tokens}
                          value={toSel}
                          onChange={setToSel}
                          placeholder="Select token"
                          onQuery={async (q) => tokens.filter(t => t.symbol.toLowerCase().includes((q || '').toLowerCase()))}
                          className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50 w-full text-lg text-center h-14 focus:ring-0 focus-visible:ring-0 focus:outline-none focus:border-orange-400 transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Recipient address</label>
                      <Input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="Paste wallet address to receive funds"
                        className="text-lg text-gray-900 placeholder:text-lg placeholder:text-gray-400 bg-white text-left h-14 focus:ring-0 focus-visible:ring-0 focus:outline-none focus:border-orange-400 transition-colors"
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
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                      <div className="flex items-center gap-2">
                        <input
                          id="notify"
                          type="checkbox"
                          className="h-5 w-5 rounded-md border-2 border-orange-400 bg-white accent-orange-500 transition-all focus:outline-none focus:ring-2 focus:ring-orange-300 hover:shadow-[0_0_0_3px_rgba(234,179,8,0.20)]"
                          checked={notifyChecked}
                          onChange={(e) => setNotifyChecked(e.target.checked)}
                        />
                        <label htmlFor="notify" className="text-sm font-medium text-orange-500">Email me payment status updates</label>
                      </div>
                      {notifyChecked ? (
                        <div className="mt-2">
                          <Input
                            type="email"
                            placeholder="your@email.com"
                            value={notifyEmail}
                            onChange={(e) => setNotifyEmail(e.target.value)}
                            className="text-base text-gray-900 placeholder:text-base placeholder:text-gray-400 bg-white text-left py-5 focus:ring-0 focus-visible:ring-0 focus:outline-none focus:border-orange-400 transition-colors"
                          />
                          <div className="mt-1 text-xs text-gray-500">Optional. We’ll only email about this claim’s status.</div>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-gray-500">Optional. Add an email if you want notifications. You can skip this.</div>
                      )}
                    </div>
                    <div>
                      <GradientActionButton
                        onClick={onCreate}
                        disabled={creating || !(parsedAmount > 0 && !!selectedTo && !!(recipient || "").trim())}
                        loading={creating}
                        loadingText="Creating…"
                      >
                        Create payment link
                      </GradientActionButton>
                    </div>
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


