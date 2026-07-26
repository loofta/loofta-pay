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

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { motion, AnimatePresence } from "framer-motion";
import { X, Info } from "lucide-react";
import SlideToPay from "@/components/megapot/SlideToPay";
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
const FALLBACK_PRICE_USDC = 2;

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

  useEffect(() => {
    fetch("/api/lottery/packs/config")
      .then(res => (res.ok ? res.json() : Promise.reject(new Error("Failed to load pack config"))))
      .then(data => {
        setTiers(data.tiers ?? []);
        setPriceUsdc(typeof data.priceUsdc === "number" ? data.priceUsdc : null);
      })
      .catch(() => setTiers([]));
  }, []);

  const priceLabel = `$${priceUsdc ?? FALLBACK_PRICE_USDC}`;

  const resolveOpen = useCallback(async (): Promise<PackOpenResult> => {
    setError(null);
    if (!paymentTxHash) throw new Error("Payment not completed");
    const token = await getAccessToken();
    const res = await fetch("/api/lottery/packs/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ paymentTxHash }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Failed to open pack");
    const data = await res.json();
    return { ticketsAwarded: data.ticketsAwarded, rarity: data.rarity };
  }, [getAccessToken, paymentTxHash]);

  // Real on-chain payment: build the transfer server-side (treasury sponsors gas + its own ATA),
  // sign+send it with the user's embedded wallet, then hand the signature to resolveOpen above —
  // PackService verifies it landed for the right amount before ever rolling a tier.
  const handleConfirmPayment = useCallback(async () => {
    setPaying(true);
    setPayError(null);
    try {
      if (!embeddedWallet?.address) throw new Error("No Solana wallet found");
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

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
    } catch (err: any) {
      setPayError(err?.message ?? "Payment failed — please try again.");
    } finally {
      setPaying(false);
    }
  }, [embeddedWallet, getAccessToken, signAndSendTransaction]);

  const handleOpenAnother = useCallback(() => {
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
    <div className="relative w-full bg-[#08060A] text-white overflow-hidden mobile-first flex flex-col" style={{ height: "calc(100dvh - var(--header-h, 0px))" }}>
      {/* Top chrome — a normal flex item (not absolutely positioned), so the canvas below is
          guaranteed to start after it. */}
      <div className="shrink-0 flex items-center justify-between px-4 pb-2 pt-3">
        <Link href="/app/megapot" className="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 backdrop-blur hover:bg-white/15 transition-colors">
          <X className="w-4 h-4" />
          <span className="sr-only">Exit</span>
        </Link>
        <span className="text-sm font-semibold tracking-wide text-slate-200">Mystery Pack</span>
        {/* Same info box on both breakpoints — just more visible on desktop (icon + label vs. icon-only on mobile). */}
        <button onClick={() => setInfoOpen(true)} className="flex items-center justify-center gap-1.5 h-9 w-9 sm:w-auto sm:px-3.5 rounded-full bg-white/10 backdrop-blur hover:bg-white/15 transition-colors">
          <Info className="w-4 h-4" />
          <span className="hidden sm:inline text-sm font-medium text-slate-200">Odds</span>
        </button>
      </div>

      {/* Full-bleed canvas fills everything below the header — the pack-opening scene now gets
          the whole remaining viewport instead of a small bounded card, and MegapotPack's own
          ResizeObserver keeps the camera/renderer matched to it as that space changes (mobile
          address-bar collapse, orientation, etc). */}
      <div key={openCount} className="relative flex-1 min-h-0">
        {authenticated ? (
          <MegapotPack
            resolveOpen={resolveOpen}
            onOpened={setResult}
            onError={() => setError("Couldn't open your pack — please try again.")}
            assets={{ logo: "/loofta.svg", logoWhite: "/loofta_white.svg", megapotDark: "/images/megapot/logo.svg" }}
            canOpen={paid}
            idleSubtitle={paid ? "You always win at least 1 ticket — never a loss" : "Slide below to pay, then tap the pack"}
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
          cannot be opened (see canOpen above) until this is completed. */}
      {authenticated && !paid && !result && (
        <div className="absolute inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-80 z-30" style={{ bottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
          <SlideToPay amountLabel={priceLabel} onConfirm={handleConfirmPayment} busy={paying} error={payError} />
          {payError && <p className="mt-2 text-center text-sm text-red-400">{payError}</p>}
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
            className="absolute inset-x-0 bottom-0 z-[60] rounded-t-3xl border-t border-white/10 bg-[#111114] px-5 pt-5 shadow-[0_-20px_60px_rgba(0,0,0,0.5)]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
            <div className="flex flex-col items-center text-center gap-1 mb-4">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border ${RARITY_STYLE[result.rarity]}`}>
                {RARITY_LABEL[result.rarity]}
              </span>
              <p className="text-2xl font-bold mt-1">{result.ticketsAwarded} {result.ticketsAwarded === 1 ? "ticket" : "tickets"} won!</p>
              <p className="text-base text-slate-400">Added to today&apos;s Megapot draw</p>
            </div>
            {/* No second ticket here — the 3D scene behind this sheet already reveals the ticket,
                a duplicate 2D one below it just repeated the same information. */}
            <div className="flex flex-col sm:flex-row-reverse gap-3 mt-1">
              <button onClick={handleOpenAnother} className="w-full sm:flex-1 py-3 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] font-semibold text-white">
                Open another
              </button>
              <Link href="/app/megapot" className="w-full sm:flex-1 py-3 rounded-xl bg-white/10 text-center font-semibold text-slate-200 hover:bg-white/15 transition-colors">
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
