"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { AtSign, Loader2, Check, ExternalLink, ArrowRight, Mail, ShieldCheck, Zap, Wallet, VenetianMask } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { AmountInput } from "@/components/AmountInput";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { Slider } from "@/components/ui/slider";
import { SocialPlatformIcon, type SocialIconPlatform } from "@/components/SocialPlatformIcon";
import {
  SolanaWalletConnectProvider,
  useWallet as useSolanaWalletAdapter,
  WalletMultiButton,
} from "@/components/SolanaWalletConnect";
import { buildUSDCTransferTransaction, sendSignedUSDCTransfer } from "@/services/solanaTransfer";
import {
  buildMagicBlockPrivateTransferNoFee,
  totalWithMagicBlockPrivateFee,
  MAGICBLOCK_MAX_SPLIT,
} from "@/services/magicblockPrivateTransfer";
import { privatePaymentFundsAppearCopy } from "@/lib/privatePaymentCopy";
import { getSolanaHttpRpc, getSolanaCluster, isNonMainnetCluster } from "@/lib/solanaCluster";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { resolveFomoHandle, type FomoResolution } from "@/services/api/fomo";
import { DELAY_UNITS, DELAY_UNIT_MAX, DELAY_UNIT_MS, DELAY_UNIT_LABEL, type DelayUnit, formatDelayDuration } from "@/lib/privacyDelay";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";
const MIN_USD = 1;
const easeBrand = [0.16, 1, 0.3, 1] as const;
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111114]";
const CARD_LABEL = "text-base font-medium uppercase tracking-[0.18em] text-slate-500";
// shadcn Slider is themed with light shadcn tokens; recolor track/range/thumb for the dark card.
const SLIDER_DARK =
  "[&>span:first-child]:bg-white/10 [&>span:first-child>span]:bg-[#FF7A2A] [&_[role=slider]]:border-[#FF7A2A] [&_[role=slider]]:bg-[#16161a] [&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:focus-visible:ring-orange-400 [&_[role=slider]]:focus-visible:ring-offset-[#16161a]";

const PLATFORMS: { id: SocialIconPlatform | "email"; label: string }[] = [
  { id: "twitter", label: "X handle" },
  { id: "github", label: "GitHub" },
  { id: "discord", label: "Discord" },
  { id: "telegram", label: "Telegram" },
  { id: "email", label: "Email" },
];

const STEPS = [
  { title: "Type their Fomo username", body: "We look up the verified Solana wallet behind it. You never touch an address." },
  { title: "Connect your wallet", body: "Phantom, Solflare or any Solana wallet. No Loofta account, no sign up." },
  { title: "Sign once, it lands", body: "USDC goes straight from your wallet to theirs. Confirmed on Solana in seconds." },
];

const FAQ = [
  {
    q: "Where does the money go?",
    a: "Directly to the Solana wallet linked to that fomo.family account. Loofta never holds it. The transaction is signed by your wallet and settles on-chain.",
  },
  {
    q: "What does private mode do?",
    a: "MagicBlock hides the link between your wallet and theirs on-chain, so who paid whom isn't a public record. A small fee is included and funds can take a few minutes to fully land.",
  },
  {
    q: "Do I need a Loofta account?",
    a: "No. This page works with just a Solana wallet. If you also want to pay people by email, X handle, GitHub, Discord or Telegram, that's what the Loofta app is for.",
  },
];

// Only look a handle up once typing has actually stopped. At 450ms every pause mid-word fired its
// own lookup, so typing one handle slowly burned a vendor call per prefix ("l", "li", "lis", …).
const RESOLVE_DEBOUNCE_MS = 800;
const MIN_HANDLE_LENGTH = 2;
/** Handles already looked up this session — retyping or correcting a handle shouldn't refetch.
 *  The backend caches too; this just stops the round trip leaving the browser at all. */
const resolutionCache = new Map<string, FomoResolution>();

const HANDLE_WORDS = ["username", "teammate", "thattrader", "yourfriend"];
const HANDLE_FLIP_MS = 2200;

/** The headline's emphasized words rendered as the product itself: an oversized inline @handle
 *  token that flips through examples with a masked slide, and focuses the real input on click.
 *  Every word is laid out in the same grid cell so the token keeps the width of the longest one
 *  and never jumps between flips. Static on prefers-reduced-motion. */
function HandleToken() {
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
        const el = document.getElementById("fomo-handle");
        el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        el?.focus({ preventScroll: true });
      }}
      aria-label="Type a Fomo username"
      className={`group inline-block align-baseline whitespace-nowrap rounded-[0.3em] border border-white/10 bg-[#16161a] px-[0.25em] leading-[1.15] text-left hover:border-white/25 transition-colors ${FOCUS_RING}`}
    >
      <span className="text-slate-500 group-hover:text-slate-300 transition-colors">@</span>
      <span className="inline-grid overflow-hidden align-baseline">
        {HANDLE_WORDS.map((word, i) => {
          const state = i === active ? "in" : i === prev ? "out" : "hidden";
          return (
            <span
              key={word}
              aria-hidden={i !== active}
              className={[
                "col-start-1 row-start-1 text-slate-100 will-change-transform",
                "transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                state === "in" ? "translate-y-0 opacity-100" : state === "out" ? "-translate-y-[110%] opacity-0" : "translate-y-[110%] opacity-0",
              ].join(" ")}
            >
              {word}
            </span>
          );
        })}
      </span>
      <span className="text-slate-500 group-hover:text-slate-300 transition-colors">.</span>
    </button>
  );
}

/** Logo + one CTA, nothing else: this page is a conversion surface, so the header has no nav to
 *  wander off into (MinimalHeader would add Rewards/Win/balance/login chrome that only makes sense
 *  for a signed-in Loofta user). Same CTA treatment as the marketing home header. */
function FomoHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#111114]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className={`inline-flex items-center rounded ${FOCUS_RING}`} aria-label="Loofta home">
          <Image src="/loofta_white.svg" alt="Loofta" width={110} height={24} priority />
        </Link>
        <Link
          href={APP_URL}
          className={`group inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-display text-base font-medium text-white shadow-[0_20px_50px_-15px_rgba(255,19,1,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-15px_rgba(255,19,1,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] ${BRAND_GRADIENT} ${FOCUS_RING}`}
        >
          Go to Loofta Pay
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </header>
  );
}

function explorerTxUrl(sig: string): string {
  const cluster = getSolanaCluster();
  const suffix = isNonMainnetCluster() ? `?cluster=${cluster}` : "";
  return `https://solscan.io/tx/${sig}${suffix}`;
}

/** What to promise after a private send — built from the settings the payment actually went out
 *  with (MagicBlock's transfer endpoint has no documented max delay, so there's no single ceiling
 *  to quote instead; see @/lib/privacyDelay). */
function privateDeliveryCopy(split: number, delayMs: number): string {
  const parts = split > 1 ? `${split} parts` : null;
  const window = delayMs > 0 ? formatDelayDuration(delayMs).replace(/^up to /, "") : null;
  if (parts && window) return `Arriving in ${parts} over the next ${window}.`;
  if (parts) return `Arriving in ${parts}, all within moments.`;
  if (window) return `Arriving within ${window}.`;
  return "On its way now.";
}

function isUserRejection(message: unknown): boolean {
  return typeof message === "string" && /reject|cancel|denied|declined/i.test(message);
}

type PayStatus = "idle" | "building" | "awaiting_signature" | "broadcasting" | "done";

const STATUS_STEPS: { key: PayStatus; label: string }[] = [
  { key: "building", label: "Preparing" },
  { key: "awaiting_signature", label: "Confirm in wallet" },
  { key: "broadcasting", label: "Sending" },
];

/** Connect-wallet + pay panel. Same primitives as the guest checkout USDC-on-Solana flow
 *  (components/app/GuestCheckoutPay.tsx): a plain SPL transfer, or a MagicBlock private transfer
 *  built by their public Payments API when private mode is on. Must render inside
 *  SolanaWalletConnectProvider. */
function PayPanel({
  amountUsd,
  amountValid,
  recipientAddress,
  recipientName,
  blocker,
  isPrivate,
  split,
  maxDelayMs,
  onReset,
}: {
  amountUsd: number;
  amountValid: boolean;
  recipientAddress: string | null;
  recipientName: string;
  /** Why the pay action isn't available yet, shown on the button itself. Null when ready. */
  blocker: string | null;
  isPrivate: boolean;
  split: number;
  maxDelayMs: number;
  onReset: () => void;
}) {
  const { publicKey, signTransaction, connected, connecting, disconnect } = useSolanaWalletAdapter();
  const [status, setStatus] = useState<PayStatus>("idle");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [sentPrivately, setSentPrivately] = useState(false);
  // Captured at send time: the sliders stay interactive, so reading them on the success screen
  // would describe settings the payment never used.
  const [sentDelivery, setSentDelivery] = useState({ split: 1, delayMs: 0 });
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "";
  const ready = !blocker && !!recipientAddress && connected && !!publicKey && !!signTransaction && status === "idle";
  const total = isPrivate ? totalWithMagicBlockPrivateFee(amountUsd) : amountUsd;

  const handlePay = async () => {
    if (!publicKey || !signTransaction || !recipientAddress) return;
    setError(null);
    setStatus("building");
    // Deliberate: money is leaving a wallet to an address the payer never typed and never sees,
    // so the resolved destination has to be inspectable rather than taken on faith.
    console.log("[fomo] paying", {
      recipient: recipientName,
      solanaAddress: recipientAddress,
      amountUsd,
      private: isPrivate,
      ...(isPrivate ? { split, maxDelayMs } : {}),
    });
    try {
      const connection = new Connection(getSolanaHttpRpc(), "confirmed");
      let signature: string;
      if (isPrivate) {
        // No memo on purpose: a handle in the memo would undo the point of the private transfer.
        const tx = await buildMagicBlockPrivateTransferNoFee({
          from: publicKey.toBase58(),
          to: recipientAddress,
          amountUSDC: amountUsd,
          split,
          maxDelayMs,
        });
        setStatus("awaiting_signature");
        const signed = await signTransaction(tx);
        setStatus("broadcasting");
        signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
      } else {
        const tx = await buildUSDCTransferTransaction({
          senderAddress: publicKey.toBase58(),
          recipientAddress,
          amountUSDC: amountUsd,
          connection,
        });
        setStatus("awaiting_signature");
        const signed = await signTransaction(tx as VersionedTransaction);
        setStatus("broadcasting");
        signature = await sendSignedUSDCTransfer(signed as VersionedTransaction, connection);
      }
      await waitForSignatureConfirmation(connection, signature, 60_000, 1500, "fomoDeposit");
      setTxSig(signature);
      setSentPrivately(isPrivate);
      setSentDelivery({ split, delayMs: maxDelayMs });
      setStatus("done");
    } catch (e: any) {
      setStatus("idle");
      const msg = e?.message;
      // Declining the signature is a choice, not an error: return to idle quietly.
      if (isUserRejection(msg)) return;
      setError(typeof msg === "string" && msg.length < 200 ? msg : "Payment failed. Please try again.");
    }
  };

  if (status === "done" && txSig) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: easeBrand }}
        className="space-y-5 text-center py-2"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          {sentPrivately ? <VenetianMask className="h-7 w-7" strokeWidth={2} /> : <Check className="h-7 w-7" strokeWidth={2.5} />}
        </div>
        <div>
          <p className="font-display text-2xl font-semibold text-slate-100">
            {sentPrivately ? `Sent $${amountUsd} privately` : `Sent $${amountUsd}`}
          </p>
          <p className="mt-1 text-base text-slate-400">
            {sentPrivately
              ? `To ${recipientName}. ${privateDeliveryCopy(sentDelivery.split, sentDelivery.delayMs)}`
              : `to ${recipientName}`}
          </p>
        </div>
        <a
          href={explorerTxUrl(txSig)}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-base text-slate-300 hover:text-white hover:underline underline-offset-2 transition-colors ${FOCUS_RING}`}
        >
          View on Solscan <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
        <div className="grid gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setTxSig(null);
              setStatus("idle");
              onReset();
            }}
            className={`h-11 rounded-xl border border-white/10 text-base font-medium text-slate-300 hover:bg-white/[0.06] transition-colors ${FOCUS_RING}`}
          >
            Send another
          </button>
          <Link
            href={APP_URL}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-base font-semibold text-white ${BRAND_GRADIENT} hover:opacity-90 transition-opacity ${FOCUS_RING}`}
          >
            Pay anyone with Loofta <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      {connected && publicKey ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
          <span className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" aria-hidden />
            <span className="text-base font-mono text-slate-300 truncate">{short}</span>
          </span>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={status !== "idle"}
            className={`shrink-0 rounded-lg px-2 py-1.5 text-base text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-50 ${FOCUS_RING}`}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="[&_.wallet-adapter-dropdown]:block [&_.wallet-adapter-dropdown]:w-full [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center [&_.wallet-adapter-button]:h-12 [&_.wallet-adapter-button]:rounded-2xl [&_.wallet-adapter-button]:text-base [&_.wallet-adapter-button]:font-semibold [&_.wallet-adapter-button]:font-sans [&_.wallet-adapter-button]:transition-opacity [&_.wallet-adapter-button:hover]:opacity-90">
          <WalletMultiButton style={{ background: "linear-gradient(90deg,#FF1301,#EAB308)" }}>
            {connecting ? "Connecting…" : <><Wallet className="h-4 w-4 mr-2" aria-hidden /> Connect wallet to pay</>}
          </WalletMultiButton>
        </div>
      )}

      {connected && publicKey && (
        <>
          <GradientActionButton
            onClick={handlePay}
            disabled={!ready}
            loading={status !== "idle"}
            loadingText={STATUS_STEPS.find((s) => s.key === status)?.label ?? "Working…"}
            title={blocker ?? undefined}
          >
            {blocker ?? (isPrivate ? `Pay $${total.toFixed(2)} privately` : `Pay $${amountUsd}`)}
          </GradientActionButton>

          {status !== "idle" && (
            <ol className="flex items-center justify-center gap-4 text-base" aria-live="polite">
              {STATUS_STEPS.map((s, i) => {
                const activeIndex = STATUS_STEPS.findIndex((x) => x.key === status);
                const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
                return (
                  <li key={s.key} className="flex items-center gap-1.5">
                    {state === "done" ? (
                      <Check className="h-4 w-4 text-emerald-400" aria-hidden />
                    ) : state === "active" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-orange-400" aria-hidden />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-white/20" aria-hidden />
                    )}
                    <span className={state === "todo" ? "text-slate-500" : "text-slate-200"}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-base text-red-400 text-center">
          {error}
        </p>
      )}
    </div>
  );
}

function PayCard() {
  const [amount, setAmount] = useState("");
  const [handle, setHandle] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [split, setSplit] = useState(3);
  const [delayMs, setDelayMs] = useState(5 * 60_000);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("minutes");
  const [infoOpen, setInfoOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<FomoResolution | null>(null);
  const reduceMotion = useReducedMotion();

  const amountNum = parseFloat(amount) || 0;
  const amountValid = amountNum >= MIN_USD;
  const cleanHandle = handle.trim().replace(/^@+/, "").toLowerCase();

  useEffect(() => {
    // Never keep a stale match on screen while the handle is being edited: it belongs to whoever
    // was typed before, and paying it would send money to the wrong person.
    setResolution(null);

    if (cleanHandle.length < MIN_HANDLE_LENGTH) {
      setResolving(false);
      return;
    }

    const cached = resolutionCache.get(cleanHandle);
    if (cached) {
      setResolution(cached);
      setResolving(false);
      return;
    }

    setResolving(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await resolveFomoHandle(cleanHandle, controller.signal);
        resolutionCache.set(cleanHandle, res);
        setResolution(res);
      } catch (e: any) {
        if (e?.name !== "AbortError") setResolution(null);
      } finally {
        setResolving(false);
      }
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [cleanHandle]);

  const recipientName = resolution?.displayName || (cleanHandle ? `@${cleanHandle}` : "");
  const readyToPay = amountValid && !!resolution?.resolvable;
  const blocker = !amountValid
    ? "Enter an amount"
    : !cleanHandle
      ? "Enter a Fomo username"
      : resolving
        ? "Checking username…"
        : !resolution?.resolvable
          ? "This username can't be paid yet"
          : null;
  const total = isPrivate ? totalWithMagicBlockPrivateFee(amountNum) : amountNum;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[#FF4A26]/[0.08] blur-3xl" aria-hidden />
      <div className="relative rounded-[1.75rem] border border-white/10 bg-[#16161a] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] overflow-hidden">
        {/* Amount: the hero of the card. Same field as the send form, scaled up. */}
        <div className="px-6 sm:px-7 pt-6 pb-7">
          <div className="flex items-center justify-between mb-6">
            <span className={CARD_LABEL}>Amount</span>
            <span className="text-base text-slate-500">on Solana</span>
          </div>
          <AmountInput
            id="fomo-amount"
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
          {amountNum > 0 && !amountValid && (
            <p className="text-base text-amber-400 mt-2">Min. amount is ${MIN_USD}</p>
          )}
        </div>

        <div className="h-px bg-white/[0.07]" aria-hidden />

        {/* To */}
        <div className="px-6 sm:px-7 py-6">
          <label htmlFor="fomo-handle" className={`${CARD_LABEL} mb-3 block`}>
            To
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden>
              <AtSign className="h-5 w-5" />
            </span>
            <input
              id="fomo-handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/^@+/, "").replace(/\s/g, ""))}
              placeholder="fomo username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`w-full h-14 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 pl-12 pr-4 focus:border-white/30 transition-colors ${FOCUS_RING}`}
              style={{ fontSize: "22px" }}
            />
          </div>

          <div className="min-h-[3.5rem] mt-3" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {cleanHandle && (
                <motion.div
                  key={resolving ? "resolving" : resolution?.resolvable ? "ok" : resolution?.found ? "nowallet" : "none"}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.2, ease: easeBrand }}
                >
                  {resolving ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
                      <span className="h-10 w-10 rounded-full bg-white/10 animate-pulse shrink-0" aria-hidden />
                      <div className="flex-1 space-y-1.5">
                        <span className="block h-4 w-28 rounded bg-white/10 animate-pulse" />
                        <span className="block h-3.5 w-20 rounded bg-white/10 animate-pulse" />
                      </div>
                      <span className="sr-only">Looking up @{cleanHandle}</span>
                    </div>
                  ) : resolution?.resolvable ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3.5 py-3">
                      {resolution.profilePicture ? (
                        // Avatar host varies (S3/defined.fi), so a plain img instead of next/image domain config.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolution.profilePicture} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-slate-400 shrink-0" aria-hidden>
                          <AtSign className="h-4 w-4" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-slate-100 text-base font-medium truncate">{resolution.displayName || `@${cleanHandle}`}</p>
                        <p className="text-slate-400 text-base truncate">@{cleanHandle} · wallet verified</p>
                      </div>
                      <Check className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden />
                    </div>
                  ) : (
                    // Deliberately not an alert: this is a routing moment, not an error, and the
                    // resolver returns the same response for "no such handle" and "real account
                    // with no verified wallet" (see fomo.service.ts), so we must not imply the
                    // person doesn't exist. Mirrors the resolved row's shape so nothing jumps.
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-500 shrink-0" aria-hidden>
                          <AtSign className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-200 text-base font-medium truncate">@{cleanHandle}</p>
                          <p className="text-slate-500 text-base">No verified wallet yet</p>
                        </div>
                      </div>
                      <p className="mt-3 text-base leading-[1.55] text-slate-400">
                        Fomo only publishes a wallet once an account has traded, and it can take a while to
                        show up. You can still pay them through Loofta, they choose how to receive it.{" "}
                        <Link
                          href={amountValid ? `${APP_URL}?amount=${amountNum}` : APP_URL}
                          className={`text-slate-300 underline decoration-white/30 underline-offset-4 hover:decoration-white transition-colors rounded ${FOCUS_RING}`}
                        >
                          Pay by email or handle
                        </Link>
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="h-px bg-white/[0.07]" aria-hidden />

        {/* Privacy + summary + pay */}
        <div className="px-6 sm:px-7 pt-5 pb-6 space-y-4">
          {/* The shared toggle labels at text-sm; this page's floor is text-base. Overridden here
              rather than in the component so the other surfaces using it are left alone. */}
          <IncognitoModeToggle
            checked={isPrivate}
            onCheckedChange={setIsPrivate}
            onLabel="Deposit privately"
            offLabel="Deposit privately"
            className="py-2.5 [&>span]:text-base"
          />
          <AnimatePresence initial={false}>
            {isPrivate && (
              <motion.div
                key="privacy-controls"
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: easeBrand }}
                className="overflow-hidden"
              >
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-5">
                  <p className="text-base leading-[1.5] text-slate-400">
                    MagicBlock hides the link between your wallet and theirs on-chain. Split the amount and
                    spread it over time to make it harder to trace. Gasless: you don&apos;t need SOL, MagicBlock
                    takes its fee in USDC. Loofta takes nothing.
                  </p>

                  <div>
                    <div className="flex items-baseline justify-between mb-3">
                      <label htmlFor="fomo-split" className="text-base text-slate-200">Split into</label>
                      <span className="font-display text-lg font-semibold text-slate-100 tabular-nums">
                        {split} {split === 1 ? "part" : "parts"}
                      </span>
                    </div>
                    <Slider
                      id="fomo-split"
                      min={1}
                      max={MAGICBLOCK_MAX_SPLIT}
                      step={1}
                      value={[split]}
                      onValueChange={([v]) => setSplit(v)}
                      aria-label="Number of parts"
                      className={SLIDER_DARK}
                    />
                    {amountValid && split > 1 && (
                      <p className="mt-2 text-base text-slate-500 tabular-nums">
                        About ${(amountNum / split).toFixed(2)} per part
                      </p>
                    )}
                  </div>

                  <div>
                    {(() => {
                      const amountInUnit = Math.min(DELAY_UNIT_MAX[delayUnit], Math.round(delayMs / DELAY_UNIT_MS[delayUnit]));
                      const changeUnit = (next: DelayUnit) => {
                        if (next === delayUnit) return;
                        const nextAmount = Math.min(DELAY_UNIT_MAX[next], Math.round(delayMs / DELAY_UNIT_MS[next]));
                        setDelayUnit(next);
                        setDelayMs(nextAmount * DELAY_UNIT_MS[next]);
                      };
                      return (
                        <>
                          <div className="flex items-baseline justify-between mb-3">
                            <label htmlFor="fomo-delay" className="text-base text-slate-200">Spread over</label>
                            <span className="font-display text-lg font-semibold text-slate-100 tabular-nums">
                              {amountInUnit === 0 ? "No delay" : `up to ${amountInUnit} ${DELAY_UNIT_LABEL[delayUnit]}${amountInUnit === 1 ? "" : "s"}`}
                            </span>
                          </div>
                          <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-white/[0.06] p-1">
                            {DELAY_UNITS.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => changeUnit(u)}
                                className={`rounded-full px-3 py-1 text-sm font-medium capitalize transition-colors ${
                                  delayUnit === u ? "bg-white/[0.14] text-white" : "text-slate-500 hover:text-slate-200"
                                }`}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                          <Slider
                            id="fomo-delay"
                            min={0}
                            max={DELAY_UNIT_MAX[delayUnit]}
                            step={1}
                            value={[amountInUnit]}
                            onValueChange={([v]) => setDelayMs(v * DELAY_UNIT_MS[delayUnit])}
                            aria-label={`Maximum delivery delay in ${delayUnit}`}
                            className={SLIDER_DARK}
                          />
                          <p className="mt-2 text-base text-slate-500">
                            {amountInUnit === 0
                              ? "Every part is delivered right away."
                              : `Each part lands at a random moment within ${amountInUnit} ${DELAY_UNIT_LABEL[delayUnit]}${amountInUnit === 1 ? "" : "s"}.`}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {readyToPay && (
            <dl className="space-y-2 text-base tabular-nums">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-400">To</dt>
                <dd className="text-slate-100 font-medium truncate">{recipientName}</dd>
              </div>
              {isPrivate && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Delivery</dt>
                  <dd className="text-slate-100">
                    {split === 1 ? "1 part" : `${split} parts`}{delayMs > 0 ? `, within ${formatDelayDuration(delayMs).replace(/^up to /, "")}` : ""}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-400">Fee</dt>
                <dd className="text-slate-100">{isPrivate ? `$${(total - amountNum).toFixed(2)} to MagicBlock, gasless` : "Network fee in SOL, from your wallet"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/[0.07]">
                <dt className="text-slate-300 font-medium">You pay</dt>
                <dd className="font-display text-xl font-semibold text-slate-100">${isPrivate ? total.toFixed(2) : amountNum}</dd>
              </div>
            </dl>
          )}

          <SolanaWalletConnectProvider rpcUrl={getSolanaHttpRpc()}>
            <PayPanel
              amountUsd={amountNum}
              amountValid={amountValid}
              recipientAddress={resolution?.resolvable ? resolution.solanaAddress : null}
              recipientName={recipientName}
              blocker={blocker}
              isPrivate={isPrivate}
              split={split}
              maxDelayMs={delayMs}
              onReset={() => {
                setAmount("");
                setHandle("");
                setResolution(null);
              }}
            />
          </SolanaWalletConnectProvider>

          <p className="flex items-center justify-center gap-1.5 text-base text-slate-500">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Your wallet signs. Funds go straight to theirs.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function FomoDepositContent() {
  const reduceMotion = useReducedMotion();
  const fadeUp = (delay = 0) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: easeBrand, delay },
  });

  return (
    <>
      <FomoHeader />
      <main className="min-h-screen bg-[#111114] relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.07] blur-[140px]" aria-hidden />

        {/* Hero + form */}
        <section className="relative max-w-6xl mx-auto px-4 md:px-8 pt-14 md:pt-24 pb-16 md:pb-24">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-14 items-start">
            <div className="lg:pt-4">
              <motion.div {...fadeUp(0)} className="inline-flex items-center gap-3 mb-7">
                <Image
                  src="/images/fomo-logo.png"
                  alt="Fomo"
                  width={44}
                  height={44}
                  className="h-11 w-11 rounded-xl border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                  priority
                />
                <span className="font-display text-xl font-semibold text-slate-100">fomo.family</span>
              </motion.div>

              <motion.h1
                {...fadeUp(0.05)}
                className="font-display text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-[1.08] tracking-[-0.03em] text-slate-100 mb-5"
              >
                Send money to any <HandleToken />
              </motion.h1>

              <motion.p {...fadeUp(0.1)} className="font-grotesk text-lg md:text-xl leading-[1.55] text-slate-300 max-w-md mb-6">
                Tip a trader, pay back a friend, fund a teammate. Type their fomo.family handle, connect a
                Solana wallet, and USDC lands in their verified wallet. No addresses, no sign up.
              </motion.p>

              <motion.ul {...fadeUp(0.15)} className="space-y-2.5 text-base text-slate-300 mb-8">
                {[
                  { icon: ShieldCheck, text: "Verified wallet, resolved from the username" },
                  { icon: Zap, text: "Settles on Solana in seconds, your wallet pays the fee" },
                  { icon: VenetianMask, text: "Private mode hides who paid whom on-chain" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 border border-white/10 text-[#FFA97D] shrink-0" aria-hidden>
                      <Icon className="h-4 w-4" />
                    </span>
                    {text}
                  </li>
                ))}
              </motion.ul>

              <motion.p {...fadeUp(0.2)} className="text-base text-slate-500">
                Not on Fomo?{" "}
                <a href="#anyone" className={`text-slate-300 underline decoration-white/30 underline-offset-4 hover:decoration-white transition-colors rounded ${FOCUS_RING}`}>
                  Pay them by X, GitHub, Discord, Telegram or email
                </a>
              </motion.p>
            </div>

            <motion.div {...fadeUp(0.1)}>
              <PayCard />
            </motion.div>
          </div>
        </section>

        {/* How it works */}
        <section className="relative max-w-6xl mx-auto px-4 md:px-8 pb-20 md:pb-28">
          <p className="font-grotesk text-base font-semibold text-slate-400 uppercase tracking-widest mb-8">How it works</p>
          <ol className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-4">
                <span className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-white text-base font-semibold ${BRAND_GRADIENT}`} aria-hidden>
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-slate-100 font-semibold text-xl font-display mb-1.5">{step.title}</h3>
                  <p className="font-grotesk text-lg leading-[1.6] text-slate-300">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Conversion: pay anyone */}
        <section id="anyone" className="relative max-w-6xl mx-auto px-4 md:px-8 pb-20 md:pb-28 scroll-mt-24">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-12 overflow-hidden relative">
            <div className="pointer-events-none absolute -right-20 -bottom-24 h-[360px] w-[360px] rounded-full bg-[#FF4A26]/[0.08] blur-[100px]" aria-hidden />
            <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="max-w-2xl">
                <h2 className="font-display text-3xl md:text-[2.6rem] font-medium leading-[1.08] tracking-[-0.02em] text-slate-100 mb-4">
                  Not everyone is on Fomo. Loofta pays them anyway.
                </h2>
                <p className="font-grotesk text-lg md:text-xl leading-[1.6] text-slate-300 mb-6">
                  Send USDC to a freelancer, a contributor or a client using only their handle or email.
                  They get a private claim link and choose how to receive it, into a wallet they already
                  have or straight to a bank. Built for creators, freelancers, web3 contributors and
                  distributed teams.
                </p>
                <ul className="flex flex-wrap gap-2 mb-8">
                  {PLATFORMS.map((p) => (
                    <li
                      key={p.id}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-base text-slate-200"
                    >
                      {p.id === "email" ? <Mail className="h-4 w-4" aria-hidden /> : <SocialPlatformIcon platform={p.id} className="h-4 w-4" />}
                      {p.label}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <Link
                    href={APP_URL}
                    className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-lg font-semibold text-white hover:opacity-90 active:scale-[0.98] transition-[opacity,transform] ${BRAND_GRADIENT} ${BRAND_SHADOW} ${FOCUS_RING}`}
                  >
                    Open Loofta <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                  <Link
                    href="/pay-with-email"
                    className={`inline-flex items-center justify-center rounded-full px-6 py-3.5 text-lg font-medium text-slate-300 border border-white/10 hover:bg-white/[0.06] transition-colors ${FOCUS_RING}`}
                  >
                    See how it works
                  </Link>
                </div>
              </div>

              <div className="hidden lg:block w-72">
                <div className="rounded-2xl border border-white/10 bg-[#16161a] p-5 space-y-4 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]">
                  <p className="text-base text-slate-500">Send to</p>
                  <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-slate-100 text-lg">
                    <SocialPlatformIcon platform="twitter" className="h-4 w-4 text-slate-400" />
                    <span>@yourdesigner</span>
                  </div>
                  <div className="flex items-baseline gap-1 tabular-nums">
                    <span className="text-slate-500 font-semibold text-lg">$</span>
                    <span className="font-display text-4xl font-semibold text-slate-100">120</span>
                  </div>
                  <div className={`h-11 rounded-2xl flex items-center justify-center text-base font-semibold text-white ${BRAND_GRADIENT}`} aria-hidden>
                    Send
                  </div>
                  <p className="text-base text-slate-500 text-center">They claim it when they&apos;re ready</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="relative max-w-6xl mx-auto px-4 md:px-8 pb-28">
          <h2 className="text-slate-100 font-semibold text-3xl font-display mb-8">Questions</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {FAQ.map((item) => (
              <div key={item.q}>
                <h3 className="text-slate-100 font-semibold text-xl font-display mb-2">{item.q}</h3>
                <p className="font-grotesk text-lg leading-[1.65] text-slate-300">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
