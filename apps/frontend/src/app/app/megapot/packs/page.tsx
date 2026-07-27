"use client";

// Mystery Pack — full-screen mobile-first experience. Pack opens award 1-100 Megapot lottery
// tickets, gated behind a slide-to-pay + confirm step (see SlideToPay). Payment is a real,
// plain on-chain USDC transfer from the user's embedded Solana wallet to Loofta's treasury
// (POST /packs/pay-tx builds it, gas + destination ATA sponsored so the user only signs once) —
// verified server-side before any roll happens (PackService.verifyPackPaymentOnChain), same
// "never trust the client" discipline as the existing ticket-purchase flow. Ticket-purchase
// automation on top of this charge is a separate, later phase — see PackController/PackService
// in the backend. The odds ladder (in the info sheet) always lists every tier, including
// Rare/Epic, regardless of whether they're currently enabled server-side, so enabling them
// later needs zero change here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { X, Info, Volume2, VolumeX } from "lucide-react";
import SlideToPay from "@/components/megapot/SlideToPay";
import { warmUpAudio } from "@/lib/packSoundEffects";
import type { PackOpenResult, PackRarity } from "@/components/megapot/MegapotPack";

const MegapotPack = dynamic(() => import("@/components/megapot/MegapotPack"), { ssr: false });

interface PackTierPublic {
  tierKey: string;
  ticketsAwarded: number;
  rarity: PackRarity;
  displayOrder: number;
}

const RARITY_ORDER: PackRarity[] = ["common", "uncommon", "rare", "epic"];
const RARITY_LABEL: Record<PackRarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };
const RARITY_STYLE: Record<PackRarity, string> = {
  common: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  uncommon: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rare: "border-purple-400/30 bg-purple-400/10 text-purple-300",
  epic: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

const sheetTransition = { type: "spring" as const, damping: 30, stiffness: 300 };
// Gives the just-revealed ticket a moment on screen, unobscured, before the result sheet slides
// up over the bottom of it — MegapotPack's own reveal animation already finished by the time
// onOpened fires, so showing the sheet instantly cut that moment short.
const RESULT_SHEET_DELAY_MS = 1400;
const FALLBACK_PRICE_USDC = 2;

// Same recovery pattern as megapot/page.tsx's WITHDRAWAL_STORAGE_KEY: a real on-chain payment
// must never be "lost" just because /packs/open failed for an unrelated reason (a transient DB
// error, a refresh mid-request, etc.) — that tx hash is still valid and reusable, so a reload
// should restore the paid gate instead of asking the user to pay a second time.
const PACK_PAYMENT_STORAGE_KEY = "megapot_pack_payment";
const PACK_PAYMENT_TTL_MS = 60 * 60 * 1000;
const SOUND_MUTED_STORAGE_KEY = "megapot_pack_sound_muted";

// Same convention as megapot/page.tsx's IS_LOCALHOST — gates the demo-open toggle to local dev
// only. The backend independently hard-blocks openPackDemo outside non-production environments
// regardless of what this sends, so this check is purely about not showing dev UI to real users.
const IS_LOCALHOST = typeof window !== "undefined" && window.location.hostname === "localhost";

// Mirrors the backend's DEMO_MODE_ALLOWED_USER_ID (pack.service.ts) — just controls whether the
// toggle is even shown off localhost; the real enforcement is server-side in openPackDemo, which
// checks the caller's verified id independently of anything this sends.
const DEMO_MODE_ALLOWED_USER_ID = "did:privy:cmmqqbaad00au0dkwumsmkget";

/** buildPaymentTx sponsors gas + the treasury's own destination ATA (see pack.service.ts), so an
 *  "insufficient funds" simulation failure here can only ever mean the user's own USDC balance —
 *  never SOL for fees. Translates that (and other common wallet-signing failures) out of the raw
 *  @solana/kit error dump (program logs, base64 simulation context) that Privy's signAndSendTransaction
 *  throws verbatim, which is meaningless to an end user. */
function friendlyPackPayError(rawMessage: string | undefined, priceLabel: string): string {
  const s = (rawMessage ?? "").toLowerCase();
  if (s.includes("insufficient funds")) {
    return `Not enough USDC in your wallet — opening a pack costs ${priceLabel}.`;
  }
  if (s.includes("user rejected") || s.includes("denied")) {
    return "Payment cancelled.";
  }
  if (s.includes("simulation failed") || /custom program error/i.test(s)) {
    return "Payment couldn't be completed right now. Please try again in a moment.";
  }
  return rawMessage && rawMessage.length < 200 ? rawMessage : "Payment failed — please try again.";
}

export default function MegapotPacksPage() {
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Same embedded-Solana-wallet resolution as the main Buy tab (megapot/page.tsx) — the Privy
  // linked account gives the address, useWallets() gives the actual signer object.
  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find(w => w.address === embeddedSolAddress) ?? wallets[0];

  const [tiers, setTiers] = useState<PackTierPublic[] | null>(null);
  const [priceUsdc, setPriceUsdc] = useState<number | null>(null);
  // null = not loaded yet (don't show the unavailable state prematurely), true/false once known.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [result, setResult] = useState<PackOpenResult | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Payment gate — the pack can be dragged/orbited freely underneath, but MegapotPack's
  // `canOpen` prop (wired to `paid` below) blocks the click-to-open action until this is true.
  const [paid, setPaid] = useState(false);
  const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [infoOpen, setInfoOpen] = useState(false);
  // Drag-to-peek on the result sheet — started only from the handle bar (dragListener={false}),
  // so the buttons underneath stay perfectly tap-safe with zero risk of an accidental drag.
  const resultSheetDragControls = useDragControls();
  const resultDelayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resultDelayTimeoutRef.current) clearTimeout(resultDelayTimeoutRef.current); }, []);

  // Dev-only: skips the whole payment gate and calls POST /packs/demo-open instead of /packs/open
  // — same real tier roll, no money involved in either direction (no charge, no treasury-funded
  // ticket purchase). Never shown/usable off localhost; the backend enforces this independently.
  const [demoMode, setDemoMode] = useState(false);

  // Sound effects default ON — persisted so a mute choice survives across packs/sessions.
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try { setMuted(localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "1"); } catch { /* ignore */ }
  }, []);
  const toggleMuted = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      try { localStorage.setItem(SOUND_MUTED_STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  useEffect(() => {
    fetch("/api/lottery/packs/config")
      .then(res => (res.ok ? res.json() : Promise.reject(new Error("Failed to load pack config"))))
      .then(data => {
        setTiers(data.tiers ?? []);
        setPriceUsdc(typeof data.priceUsdc === "number" ? data.priceUsdc : null);
        // Treasury can't currently cover a payout — never let anyone pay into a pack we can't
        // fund the win for (backend also refuses buildPaymentTx regardless, this is just so the
        // user sees why up front instead of hitting an error after tapping to pay).
        setAvailable(data.available !== false);
      })
      .catch(() => setTiers([]));
  }, []);

  // Restore an already-paid-but-not-yet-opened payment across a refresh (see constant comment
  // above) — cleared once /packs/open actually succeeds or the user starts over.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PACK_PAYMENT_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { paymentTxHash?: string; paidAt?: number };
      if (!parsed?.paymentTxHash || !parsed?.paidAt) return;
      if (Date.now() - parsed.paidAt > PACK_PAYMENT_TTL_MS) {
        localStorage.removeItem(PACK_PAYMENT_STORAGE_KEY);
        return;
      }
      setPaymentTxHash(parsed.paymentTxHash);
      setPaid(true);
    } catch { /* ignore malformed/missing storage */ }
  }, []);

  // Server-side recovery of a REAL payment localStorage doesn't know about — e.g. the on-chain
  // send actually landed but the client never got as far as writing to localStorage (closed tab,
  // crashed, cleared storage, different device). Without this, that money is just gone from the
  // user's perspective and nothing stops them paying again for the same intended pack — this is
  // exactly what happened when a payment landed on-chain but the app dropped it (see
  // findRecoverablePayment on the backend). Runs once paid isn't already true from localStorage.
  const checkRecoverablePayment = useCallback(async () => {
    if (paid) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/lottery/packs/pending-payment", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.paymentTxHash) {
        setPaymentTxHash(data.paymentTxHash);
        setPaid(true);
        try {
          localStorage.setItem(PACK_PAYMENT_STORAGE_KEY, JSON.stringify({ paymentTxHash: data.paymentTxHash, paidAt: Date.now() }));
        } catch { /* ignore storage failures */ }
      }
    } catch { /* best-effort — worst case the user just sees the normal pay gate */ }
  }, [paid, getAccessToken]);

  useEffect(() => {
    if (authenticated) checkRecoverablePayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const priceLabel = demoMode ? "$0" : `$${priceUsdc ?? FALLBACK_PRICE_USDC}`;

  const resolveOpen = useCallback(async (): Promise<PackOpenResult> => {
    setError(null);
    const token = await getAccessToken();
    const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    if (demoMode) {
      const res = await fetch("/api/lottery/packs/demo-open", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Failed to open demo pack");
      const data = await res.json();
      return { ticketsAwarded: data.ticketsAwarded, rarity: data.rarity };
    }

    if (!paymentTxHash) throw new Error("Payment not completed");
    const res = await fetch("/api/lottery/packs/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ paymentTxHash }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Failed to open pack");
    const data = await res.json();
    return { ticketsAwarded: data.ticketsAwarded, rarity: data.rarity };
  }, [getAccessToken, paymentTxHash, demoMode]);

  // Real on-chain payment: build the transfer server-side (treasury sponsors gas + its own ATA),
  // sign+send it with the user's embedded wallet, then hand the signature to resolveOpen above —
  // PackService verifies it landed for the right amount before ever rolling a tier.
  const handleConfirmPayment = useCallback(async () => {
    setPaying(true);
    setPayError(null);
    // Second (redundant, harmless) chance to pay the one-time AudioContext construction cost
    // ahead of the pack-open click — covers a user who taps Confirm without ever touching the
    // canvas first (MegapotPack's own pointerdown listener is the primary trigger).
    warmUpAudio();
    try {
      if (demoMode) {
        // Same slide-to-pay UX as a real payment (so it's actually useful for testing the flow),
        // but no wallet signature and no on-chain transfer at all — demo packs cost $0 by design
        // (see PackService.openPackDemo, which resolveOpen already calls in demo mode instead of
        // verifying a real tx hash). Tiny artificial delay so "Confirming…" doesn't just flash.
        await new Promise(r => setTimeout(r, 350));
        setPaid(true);
        return;
      }

      // Guard against paying twice for one intended pack: if a payment from THIS wallet already
      // landed on-chain but was never redeemed (e.g. a prior attempt here looked like it failed
      // client-side after actually broadcasting successfully), reuse it instead of charging
      // again. Real incident: exactly this happened once already — a confirmed $2 payment never
      // made it into paymentTxHash/localStorage and the user paid a second time for one pack.
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const pendingRes = await fetch("/api/lottery/packs/pending-payment", { headers: authHeader });
      if (pendingRes.ok) {
        const pending = await pendingRes.json();
        if (pending.paymentTxHash) {
          setPaymentTxHash(pending.paymentTxHash);
          setPaid(true);
          try {
            localStorage.setItem(PACK_PAYMENT_STORAGE_KEY, JSON.stringify({ paymentTxHash: pending.paymentTxHash, paidAt: Date.now() }));
          } catch { /* ignore storage failures */ }
          return;
        }
      }

      if (!embeddedWallet?.address) throw new Error("No Solana wallet found");

      const payTxRes = await fetch("/api/lottery/packs/pay-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ userSolanaAddress: embeddedWallet.address }),
      });
      if (!payTxRes.ok) throw new Error("Failed to prepare payment");
      const { txBase64 } = await payTxRes.json();

      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({
        transaction: txBytes as unknown as Uint8Array,
        wallet: embeddedWallet as any,
      });
      const signature = bs58.encode(sigBytes as Uint8Array);

      setPaymentTxHash(signature);
      setPaid(true);
      try {
        localStorage.setItem(PACK_PAYMENT_STORAGE_KEY, JSON.stringify({ paymentTxHash: signature, paidAt: Date.now() }));
      } catch { /* ignore storage failures — worst case, a refresh asks to pay again */ }
    } catch (err: any) {
      setPayError(friendlyPackPayError(err?.message, priceLabel));
    } finally {
      setPaying(false);
    }
  }, [embeddedWallet, getAccessToken, signAndSendTransaction, demoMode, priceLabel]);

  // A pack actually opening is the only thing that should ever consume the stored payment —
  // an /open error must NOT clear paid/paymentTxHash, so the user can just tap the pack again
  // and retry with the same already-verified payment instead of being asked to pay twice.
  const handleOpened = useCallback((r: PackOpenResult) => {
    try { localStorage.removeItem(PACK_PAYMENT_STORAGE_KEY); } catch { /* ignore */ }
    // Delayed so the ticket reveal itself gets a beat unobscured before the sheet slides up over
    // the bottom of it (see RESULT_SHEET_DELAY_MS).
    if (resultDelayTimeoutRef.current) clearTimeout(resultDelayTimeoutRef.current);
    resultDelayTimeoutRef.current = setTimeout(() => setResult(r), RESULT_SHEET_DELAY_MS);
  }, []);

  const handleOpenAnother = useCallback(() => {
    try { localStorage.removeItem(PACK_PAYMENT_STORAGE_KEY); } catch { /* ignore */ }
    setResult(null);
    setPaid(false);
    setPaymentTxHash(null);
    setPayError(null);
    setOpenCount(n => n + 1);
  }, []);

  // Grouped for display only — tickets/rarity, never the underlying odds. A tier that's
  // currently disabled server-side (weight untouched) still shows here exactly like an enabled
  // one, by design.
  const rarityGroups = useMemo(() => {
    const grouped: Record<PackRarity, number[]> = { common: [], uncommon: [], rare: [], epic: [] };
    (tiers ?? []).forEach(t => grouped[t.rarity]?.push(t.ticketsAwarded));
    return RARITY_ORDER.filter(r => grouped[r].length).map(r => {
      const nums = [...grouped[r]].sort((a, b) => a - b);
      const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`;
      return { rarity: r, label };
    });
  }, [tiers]);

  return (
    // Normal document flow, not `fixed` — this app already has a persistent global header
    // (MinimalHeader: `sticky top-0 z-40`, height tracked in the `--header-h` CSS var that
    // every other /app/* page respects via `min-h-[calc(100vh-var(--header-h,0px))]`). A `fixed
    // inset-0` page starts at the true viewport top and fights that header for the same screen
    // region no matter what offset math is layered on top of it. Plain flow makes the overlap
    // structurally impossible: this div can only ever start right after the real header.
    // `100svh` (small viewport height), not `100dvh` — this page never scrolls (overflow-hidden,
    // fixed full-bleed canvas), so it should lock to the smallest guaranteed-visible viewport
    // rather than the dynamic one. Real incident: on Brave iOS, 100dvh computed taller than the
    // actually-visible area, pushing the slide-to-pay button up into a dead gap of black space
    // above the browser's own bottom chrome. Matches the same 100svh fix already used by
    // megapot/page.tsx's own full-screen mobile layout.
    <div className="relative w-full bg-[#08060A] text-white overflow-hidden mobile-first flex flex-col" style={{ height: "calc(100svh - var(--header-h, 0px))" }}>
      {/* Top chrome — a normal flex item (not absolutely positioned), so the canvas below is
          guaranteed to start after it. */}
      <div className="shrink-0 flex items-center justify-between px-4 pb-2 pt-3">
        <Link href="/app/megapot" className="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 backdrop-blur hover:bg-white/15 transition-colors">
          <X className="w-4 h-4" />
          <span className="sr-only">Exit</span>
        </Link>
        <span className="text-sm font-semibold tracking-wide text-slate-200">Mystery Pack</span>
        <div className="flex items-center gap-2">
          {(IS_LOCALHOST || user?.id === DEMO_MODE_ALLOWED_USER_ID) && (
            <button
              onClick={() => setDemoMode(d => !d)}
              className={`flex items-center justify-center h-9 px-3 rounded-full text-xs font-bold tracking-wide transition-colors ${
                demoMode ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40" : "bg-white/10 text-slate-400 hover:bg-white/15"
              }`}
            >
              DEMO
            </button>
          )}
          <button onClick={toggleMuted} className="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 backdrop-blur hover:bg-white/15 transition-colors">
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span className="sr-only">{muted ? "Unmute sound" : "Mute sound"}</span>
          </button>
          {/* Same info box on both breakpoints — just more visible on desktop (icon + label vs. icon-only on mobile). */}
          <button onClick={() => setInfoOpen(true)} className="flex items-center justify-center gap-1.5 h-9 w-9 sm:w-auto sm:px-3.5 rounded-full bg-white/10 backdrop-blur hover:bg-white/15 transition-colors">
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium text-slate-200">Odds</span>
          </button>
        </div>
      </div>

      {/* Full-bleed canvas fills everything below the header — the pack-opening scene now gets
          the whole remaining viewport instead of a small bounded card, and MegapotPack's own
          ResizeObserver keeps the camera/renderer matched to it as that space changes (mobile
          address-bar collapse, orientation, etc). */}
      <div key={openCount} className="relative flex-1 min-h-0">
        {authenticated ? (
          <MegapotPack
            resolveOpen={resolveOpen}
            onOpened={handleOpened}
            onError={(err) => setError(err instanceof Error && err.message ? err.message : "Couldn't open your pack — please try again.")}
            assets={{ logo: "/loofta.svg", logoWhite: "/loofta_white.svg", megapotDark: "/images/megapot/logo.svg" }}
            canOpen={paid}
            idleLabel={paid ? "Tap the pack to open" : ""}
            idleSubtitle={paid ? (demoMode ? "Demo mode — $0, no real ticket" : "You always win at least 1 ticket") : ""}
            muted={muted}
            showOpenAnotherButton={false}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-slate-300">Sign in to open your first Mystery Pack.</p>
            <button onClick={login} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] font-semibold text-white">
              Sign in
            </button>
          </div>
        )}
      </div>

      {/* Payment gate — persistent until paid; the pack stays visible/draggable behind it but
          cannot be opened (see canOpen above) until this is completed. If the treasury can't
          currently cover a payout (available === false), don't offer payment at all — the
          backend refuses to build the charge anyway, so this just tells the user why up front
          instead of letting them tap "pay" into a dead end. Already-paid users are unaffected:
          this only ever replaces the pre-payment control. Demo mode still shows the same
          slide-to-pay control (so the flow itself is actually testable) — it just never touches
          the treasury either way, so the low-balance pause doesn't apply to it. */}
      {authenticated && !paid && !result && (
        <div className="absolute inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-80 z-30" style={{ bottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
          {!demoMode && available === false ? (
            <div className="rounded-2xl border border-white/10 bg-[#111114]/95 backdrop-blur px-5 py-4 text-center">
              <p className="text-base font-semibold text-slate-200">Mystery Packs are paused</p>
              <p className="text-sm text-slate-400 mt-1">We&apos;re topping up prize funds — check back soon.</p>
            </div>
          ) : (
            <>
              <SlideToPay amountLabel={priceLabel} onConfirm={handleConfirmPayment} busy={paying} error={payError} />
              {payError && <p className="mt-2 text-center text-sm text-red-400">{payError}</p>}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="absolute inset-x-4 z-40 text-center" style={{ bottom: "calc(env(safe-area-inset-bottom) + 24px)" }}>
          <p className="inline-block px-4 py-2 rounded-xl bg-red-500/15 border border-red-400/30 text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Result — a real bottom sheet with the ticket + two unambiguous actions, instead of
          relying on the tiny in-canvas "open another" button. */}
      <AnimatePresence>
        {result && (
          <motion.div
            key="result-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={sheetTransition}
            // Draggable down so the won ticket rendered in the 3D scene behind this sheet isn't
            // permanently half-covered — drag the handle down to peek at the full ticket, it
            // springs back to place on release (dragSnapToOrigin) rather than staying stuck open.
            // dragListener={false} + dragControls means ONLY the handle bar below can start this
            // drag — the buttons stay ordinary, un-draggable tap targets.
            drag="y"
            dragListener={false}
            dragControls={resultSheetDragControls}
            dragConstraints={{ top: 0, bottom: 260 }}
            dragElastic={0.15}
            dragSnapToOrigin
            className="absolute inset-x-0 bottom-0 z-[60] rounded-t-3xl border-t border-white/10 bg-[#111114] px-5 pt-5 shadow-[0_-20px_60px_rgba(0,0,0,0.5)]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
          >
            {/* Padded well beyond the visible bar itself — a 6px-tall strip is much too small a
                target to reliably grab on a touchscreen. */}
            <div
              onPointerDown={(e) => resultSheetDragControls.start(e)}
              className="flex justify-center pt-1 pb-4 -mt-1 cursor-grab active:cursor-grabbing touch-none"
            >
              <div className="h-1.5 w-10 rounded-full bg-white/25" />
            </div>
            <div className="flex flex-col items-center text-center gap-1 mb-4">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border ${RARITY_STYLE[result.rarity]}`}>
                {RARITY_LABEL[result.rarity]}
              </span>
              <p className="text-2xl font-bold mt-1">{result.ticketsAwarded} {result.ticketsAwarded === 1 ? "ticket" : "tickets"} won!</p>
              <p className="text-base text-slate-400">Added to today&apos;s Megapot draw</p>
            </div>
            {/* No second ticket here — the 3D scene behind this sheet already reveals the ticket,
                a duplicate 2D one below it just repeated the same information. Stacked (not
                side-by-side) on every breakpoint — on desktop the sheet spans the full width of
                the page, so a side-by-side row stretched both buttons uncomfortably wide; capped
                + centered instead of full-bleed there. */}
            <div className="flex flex-col gap-3 mt-1 sm:max-w-xs sm:mx-auto">
              <button onClick={handleOpenAnother} className="w-full py-3 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] font-semibold text-white hover:brightness-110 active:scale-[0.98] transition-[filter,transform]">
                Open another
              </button>
              <Link href="/app/megapot" className="w-full py-3 rounded-xl bg-white/10 text-center font-semibold text-slate-200 hover:bg-white/15 transition-colors">
                Exit
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Odds info — tucked behind the "i" button so the main view stays uncluttered/full-screen */}
      <AnimatePresence>
        {infoOpen && (
          <>
            <motion.div
              key="info-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[60] bg-black/60"
              onClick={() => setInfoOpen(false)}
            />
            <motion.div
              key="info-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={sheetTransition}
              className="absolute inset-x-0 bottom-0 z-[70] rounded-t-3xl border-t border-white/10 bg-[#111114] px-5 pt-5"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
              <h2 className="text-xl font-bold mb-1">Mystery Pack</h2>
              <p className="text-slate-400 text-base mb-4">{priceLabel} a pack. You always win at least 1 ticket — never a loss.</p>
              <p className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Odds ladder</p>
              <div className="grid grid-cols-2 gap-3">
                {rarityGroups.map(g => (
                  <div key={g.rarity} className={`rounded-xl border px-4 py-3 ${RARITY_STYLE[g.rarity]}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide">{RARITY_LABEL[g.rarity]}</p>
                    <p className="text-lg font-bold mt-0.5 text-white">{g.label} tickets</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
