"use client";

import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from "react";
import {
  useWallets as useEvmWallets,
  useCreateWallet,
  useSendTransaction as useEvmSendTransaction,
  useFundWallet,
} from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { base } from "viem/chains";
import { erc20Abi, createPublicClient, http } from "viem";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ArrowRight, ArrowLeft, ArrowUp, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { getPlatform } from "@/lib/peerPlatforms";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import { findTokenBySelection } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { getDepositInfo, getExecutionStatus } from "@/services/nearIntents";
import { assertEvmSponsorAllowed, createSponsoredZkp2pClient, createZkp2pDeposit, withdrawZkp2pDeposit, BASE_USDC_ADDRESS } from "@/lib/zkp2pClient";
import { useBeamStore, type BeamActivePayment } from "@/store/beam";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";

const BEAM_PLATFORM_IDS = ["venmo", "cashapp", "revolut"] as const;
const BEAM_CAP_USDC = 100;
const BEAM_RATE_PERCENT = 0.2; // 1:0.998 → 0.2% spread
const BEAM_RATE = 1 - BEAM_RATE_PERCENT / 100; // 0.998
const BEAM_PLATFORMS = BEAM_PLATFORM_IDS.map((id) => getPlatform(id)).filter(Boolean) as NonNullable<ReturnType<typeof getPlatform>>[];

type FundingMethod = "blink" | "near-intents" | "moonpay" | "coinbase" | "balance";
type Step = "compose" | "fund" | "near-fund" | "sending";
type BeamHistoryItem = {
  id: string;
  created_at: string;
  platform: string;
  platform_identifier: string;
  amount_usdc: number;
  amount_payout: number;
  currency: string;
  status: string;
  completed_at: string | null;
};

function currencySymbol(currency: string): string {
  return currency === "EUR" ? "€" : "$";
}

const basePublicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

function computeFontPx(digits: number) {
  const maxPx = 72;
  const minPx = 28;
  const startDigits = 5;
  const stepPerDigit = 7;
  const delta = Math.max(0, digits - startDigits) * stepPerDigit;
  return Math.max(minPx, maxPx - delta);
}

// Plain-language status for a settled (non-active) history row — no backend/protocol jargon.
function statusInfo(status: string): { label: string; textClass: string } {
  switch (status) {
    case "COMPLETE": return { label: "Sent", textClass: "text-emerald-400" };
    case "FAILED": return { label: "Failed", textClass: "text-red-400" };
    case "CANCELLED": return { label: "Cancelled", textClass: "text-slate-400" };
    case "DEPOSITED": return { label: "On its way", textClass: "text-amber-400" };
    case "FUNDED": return { label: "Sending…", textClass: "text-amber-400" };
    default: return { label: "In progress", textClass: "text-amber-400" };
  }
}

export default function BeamPage() {
  const { authenticated, userId, login, getAccessToken } = useAuth();
  const { toast } = useToast();
  const { wallets: evmWallets } = useEvmWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { createWallet: createEvmWallet } = useCreateWallet();
  const { sendTransaction: privySendEvmTx } = useEvmSendTransaction();
  const { fundWallet: privyFundWalletEvm } = useFundWallet();

  const activePayments = useBeamStore((s) => s.active);
  const upsertActive = useBeamStore((s) => s.upsertActive);
  const patchActive = useBeamStore((s) => s.patchActive);
  const removeActive = useBeamStore((s) => s.removeActive);

  const evmWalletsRef = useRef(evmWallets);
  useEffect(() => { evmWalletsRef.current = evmWallets; }, [evmWallets]);
  const privySendEvmTxRef = useRef(privySendEvmTx);
  useEffect(() => { privySendEvmTxRef.current = privySendEvmTx; }, [privySendEvmTx]);

  const [view, setView] = useState<"send" | "history">("send");
  const [step, setStep] = useState<Step>("compose");
  const [amountStr, setAmountStr] = useState("");
  const [platformId, setPlatformId] = useState<string>(BEAM_PLATFORM_IDS[0]);
  const [identifier, setIdentifier] = useState("");
  const [baseWalletAddr, setBaseWalletAddr] = useState<string | null>(null);
  const [beamId, setBeamId] = useState<string | null>(null);
  const [amountPayout, setAmountPayout] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailFullRecord, setDetailFullRecord] = useState<any | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [sendingPaymentId, setSendingPaymentId] = useState<string | null>(null);

  const [history, setHistory] = useState<BeamHistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Revolut can pay out in EUR (Venmo/Cash App are USD-only fiat rails, so they stay USD).
  // Fetched live since FX moves — the rate used to size a payment is locked onto that
  // payment's record so signing later uses the exact same conversion, not a refreshed one.
  const [usdToEurRate, setUsdToEurRate] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchRate = () => {
      fetch("/api/fx/usd-eur").then((r) => r.json()).then((d) => {
        if (!cancelled && typeof d.rate === "number") setUsdToEurRate(d.rate);
      }).catch(() => {});
    };
    fetchRate();
    const id = setInterval(fetchRate, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Big auto-sizing amount input (same technique as the main Send flow)
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const [amountInputWidthPx, setAmountInputWidthPx] = useState(0);
  const displayAmount = amountStr.length > 0 ? amountStr : "0";
  const amountFontPx = computeFontPx(displayAmount.replace(/[^0-9]/g, "").length || 1);
  const suffixFontPx = Math.max(18, Math.round(amountFontPx * 0.62));
  useEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    setAmountInputWidthPx(Math.ceil(el.getBoundingClientRect().width));
  }, [displayAmount, amountFontPx]);

  // NEAR Intents sub-flow
  const { data: tokens = [] } = useTokensQuery();
  const [nearFromSelection, setNearFromSelection] = useState<TokenSelection | undefined>(undefined);
  const [nearDepositAddr, setNearDepositAddr] = useState<string | null>(null);
  const [nearDepositMemo, setNearDepositMemo] = useState<string | null>(null);
  const [nearSubmitting, setNearSubmitting] = useState(false);
  const nearPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const solanaAddress = solanaWallets?.[0]?.address;
  const usdcBaseToken = useMemo(
    () => tokens.find((t) => t.symbol?.toUpperCase() === "USDC" && t.chain?.toLowerCase() === "base"),
    [tokens],
  );
  const nearFromToken = useMemo(
    () => (nearFromSelection ? findTokenBySelection(tokens, nearFromSelection) : undefined),
    [tokens, nearFromSelection],
  );

  const platform = getPlatform(platformId);
  // Revolut can be paid out in EUR; Venmo/Cash App only ever move USD.
  const currency = platformId === "revolut" ? "EUR" : "USD";
  const fxRateFromUsd = currency === "EUR" ? usdToEurRate : 1;
  const amountNum = parseFloat(amountStr || "0"); // what the recipient will receive, in `currency`
  // The sender always pays in USDC — convert the receive amount to its USD equivalent, then
  // gross up for ZKP2P's spread so the recipient nets exactly the amount entered above.
  const usdEquivalent = fxRateFromUsd ? amountNum / fxRateFromUsd : NaN;
  const payAmount = Math.round((usdEquivalent / BEAM_RATE) * 1e6) / 1e6;

  const findEvmWallet = useCallback(
    () => evmWalletsRef.current.find((w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function"),
    [],
  );

  const ensureBaseWallet = useCallback(async (): Promise<string> => {
    let wallet = findEvmWallet();
    if (!wallet) {
      try { await createEvmWallet(); } catch (e: any) {
        if (!String(e?.message).toLowerCase().includes("already has")) throw e;
      }
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 300));
        wallet = findEvmWallet();
        if (wallet) break;
      }
    }
    if (!wallet) throw new Error("Could not load your wallet. Please try again.");
    return wallet.address;
  }, [findEvmWallet, createEvmWallet]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/beam/history", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (view === "history") loadHistory();
  }, [view, loadHistory]);

  const resetCompose = useCallback(() => {
    setStep("compose");
    setAmountStr("");
    setIdentifier("");
    setBeamId(null);
    setAmountPayout(null);
    setBaseWalletAddr(null);
    setNearDepositAddr(null);
    setNearDepositMemo(null);
    setNearFromSelection(undefined);
    setSendingPaymentId(null);
  }, []);

  // Moves a payment to background tracking while bringing the "sending" step to the
  // foreground — the user can hit Back at any point (or switch to History) and it keeps
  // going regardless, but by default they see it as a proper step, not a floating card.
  const startPaymentTracking = useCallback((payment: BeamActivePayment, kickoff: (p: BeamActivePayment) => void) => {
    upsertActive(payment);
    setSendingPaymentId(payment.id);
    setStep("sending");
    kickoff(payment);
  }, [upsertActive]);

  // Step 1: compose — create the Beam payment record
  const handleCompose = async () => {
    if (!platform) return;
    if (!(amountNum > 0)) { toast({ variant: "destructive", title: "Enter an amount" }); return; }
    if (amountNum > BEAM_CAP_USDC) { toast({ variant: "destructive", title: `Beam payments are capped at ${currencySymbol(currency)}${BEAM_CAP_USDC}` }); return; }
    if (!identifier.trim()) { toast({ variant: "destructive", title: `Enter their ${platform.idLabel}` }); return; }
    if (currency === "EUR" && !fxRateFromUsd) {
      toast({ variant: "destructive", title: "Still fetching the exchange rate", description: "Give it a second and try again." });
      return;
    }

    setSubmitting(true);
    try {
      const addr = await ensureBaseWallet();
      setBaseWalletAddr(addr);

      const token = await getAccessToken();
      const res = await fetch("/api/beam", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          platform: platformId,
          identifier: identifier.trim(),
          amountUSDC: payAmount,
          currency,
          baseWalletAddress: addr,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Could not create payment");

      const payoutAmount = data.amountPayout ?? amountNum;
      setBeamId(data.id);
      setAmountPayout(payoutAmount);

      // If the wallet already holds enough USDC (e.g. left over from a previous payment),
      // skip straight to signing instead of making the user pick a funding method again.
      let existingBalance = 0n;
      try {
        existingBalance = await basePublicClient.readContract({
          address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [addr as `0x${string}`],
        }) as bigint;
      } catch { /* fall through to normal funding flow */ }
      const requiredAtomic = BigInt(Math.round(payAmount * 1_000_000));

      if (existingBalance >= requiredAtomic) {
        await confirmFunded(data.id, "balance", null);
        startPaymentTracking({
          id: data.id, platform: platformId, identifier, amountUsdc: payAmount,
          amountPayout: payoutAmount, currency, fxRateFromUsd: fxRateFromUsd ?? 1,
          baseWalletAddress: addr, stage: "sending",
          label: `Sending to ${identifier}…`, startedAt: Date.now(),
        }, signAndSendDeposit);
        toast({ title: "Using your balance", description: `$${payAmount.toFixed(2)} covered — sending now.` });
      } else {
        setStep("fund");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not start this payment";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // Poll our backend until the payment is confirmed delivered — runs detached from
  // whatever the user is doing on the page (they may have started a new payment by now).
  const resumeCompletionPoll = useCallback((payment: BeamActivePayment) => {
    patchActive(payment.id, { stage: "sending", label: `Sending to ${payment.identifier}…` });
    const poll = async () => {
      try {
        const t = await getAccessToken();
        const r = await fetch(`/api/beam/${payment.id}`, { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json() as { status?: string };
        if (d.status === "COMPLETE") {
          removeActive(payment.id);
          toast({ title: "Sent!", description: `${currencySymbol(payment.currency)}${payment.amountPayout.toFixed(2)} is on its way to ${payment.identifier}.` });
          return true;
        }
        if (d.status === "FAILED" || d.status === "CANCELLED") {
          removeActive(payment.id);
          return true;
        }
      } catch { /* keep polling */ }
      return false;
    };
    (async () => {
      if (await poll()) return;
      const interval = setInterval(async () => { if (await poll()) clearInterval(interval); }, 10000);
    })();
  }, [getAccessToken, patchActive, removeActive, toast]);

  // Cancels a payment that already has a ZKP2P deposit on-chain — only possible while
  // no peer has claimed it yet (checked via lock-state before signing anything).
  const cancelDepositedPayment = useCallback(async (payment: BeamActivePayment) => {
    if (!payment.zkp2pDepositId) return;
    setCancellingId(payment.id);
    try {
      const token = await getAccessToken();
      const lockRes = await fetch(`/api/beam/${payment.id}/lock-state`, { headers: { Authorization: `Bearer ${token}` } });
      const lockData = await lockRes.json() as { locked?: boolean; message?: string };
      if (!lockRes.ok) throw new Error(lockData.message || "Could not check this payment's status.");
      if (lockData.locked) {
        toast({ variant: "destructive", title: "Can't cancel", description: "A peer has already picked this up — it should complete shortly." });
        return;
      }

      const evmWallet = findEvmWallet();
      if (!evmWallet) throw new Error("Your wallet isn't ready yet — please try again in a moment.");
      const rawProvider = await (evmWallet as any).getEthereumProvider();
      const privySendTx = privySendEvmTxRef.current;
      const { client } = await createSponsoredZkp2pClient({
        rawProvider,
        privySendTx: privySendTx as any,
        baseWalletAddress: payment.baseWalletAddress,
      });
      await withdrawZkp2pDeposit({ client, zkp2pDepositId: payment.zkp2pDepositId });

      await fetch(`/api/beam/${payment.id}/mark-cancelled`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      removeActive(payment.id);
      setHistory((prev) => (prev ? prev.filter((h) => h.id !== payment.id) : prev));
      setDetailId(null);
      toast({ title: "Cancelled", description: "Your funds are back in your wallet." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not cancel this payment.";
      toast({ variant: "destructive", title: "Cancel failed", description: msg });
    } finally {
      setCancellingId(null);
    }
  }, [getAccessToken, findEvmWallet, removeActive, toast]);

  // Signs the on-chain send (background, no UI blocking) then hands off to completion polling.
  const signAndSendDeposit = useCallback(async (payment: BeamActivePayment) => {
    const platformInfo = getPlatform(payment.platform);
    if (!platformInfo) {
      patchActive(payment.id, { stage: "error", errorMsg: "This payment method isn't supported." });
      return;
    }
    patchActive(payment.id, { stage: "sending", label: `Sending to ${payment.identifier}…` });
    try {
      const evmGateToken = await getAccessToken();
      await assertEvmSponsorAllowed(payment.baseWalletAddress, userId ?? "", evmGateToken);

      const evmWallet = findEvmWallet();
      if (!evmWallet) throw new Error("Your wallet isn't ready yet — please try again in a moment.");
      const rawProvider = await (evmWallet as any).getEthereumProvider();
      const privySendTx = privySendEvmTxRef.current;

      const { client, addresses, abis, publicClient } = await createSponsoredZkp2pClient({
        rawProvider,
        privySendTx: privySendTx as any,
        baseWalletAddress: payment.baseWalletAddress,
      });

      const { depositId, depositTxHash } = await createZkp2pDeposit({
        client, publicClient, addresses, abis,
        privySendTx: privySendTx as any,
        baseWalletAddress: payment.baseWalletAddress,
        processorName: platformInfo.processorName,
        identifier: payment.identifier,
        // Fallback covers payments tracked in localStorage from before currency/fxRateFromUsd existed.
        currency: payment.currency ?? "USD",
        fxRateFromUsd: payment.fxRateFromUsd ?? 1,
        ratePercent: BEAM_RATE_PERCENT,
        amountUsdc: payment.amountUsdc,
      });

      const token = await getAccessToken();
      await fetch(`/api/beam/${payment.id}/record-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ depositId, txHash: depositTxHash }),
      });
      if (depositId) patchActive(payment.id, { zkp2pDepositId: depositId });

      resumeCompletionPoll(payment);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong sending this payment.";
      patchActive(payment.id, { stage: "error", errorMsg: msg });
    }
  }, [getAccessToken, userId, findEvmWallet, patchActive, resumeCompletionPoll]);

  // Polls the sender's Base balance until it covers the requested amount, then proceeds automatically.
  const waitForFundingThenSend = useCallback((payment: BeamActivePayment) => {
    patchActive(payment.id, { stage: "funding", label: "Getting your payment ready…" });
    const minAtomic = BigInt(Math.round(payment.amountUsdc * 1_000_000));
    const started = Date.now();
    const poll = async () => {
      try {
        const bal = await basePublicClient.readContract({
          address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [payment.baseWalletAddress as `0x${string}`],
        }) as bigint;
        if (bal >= minAtomic) { signAndSendDeposit(payment); return; }
      } catch { /* keep polling */ }
      if (Date.now() - started > 10 * 60 * 1000) {
        patchActive(payment.id, { stage: "error", errorMsg: "This is taking longer than expected. If you completed payment, it should still go through shortly." });
        return;
      }
      setTimeout(poll, 4000);
    };
    poll();
  }, [patchActive, signAndSendDeposit]);

  // On mount: resume any payment left in-flight from a previous visit, using the backend's
  // authoritative status (not our locally-cached stage) to decide where to pick back up.
  useEffect(() => {
    const ids = Object.keys(useBeamStore.getState().active);
    if (!ids.length) return;
    (async () => {
      for (const id of ids) {
        const payment = useBeamStore.getState().active[id];
        if (!payment) continue;
        try {
          const token = await getAccessToken();
          const r = await fetch(`/api/beam/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          const d = await r.json() as { status?: string; zkp2p_deposit_id?: string | null };
          if (!r.ok || !d.status || d.status === "COMPLETE" || d.status === "FAILED" || d.status === "CANCELLED") {
            removeActive(id);
            continue;
          }
          if (d.status === "DEPOSITED") {
            if (d.zkp2p_deposit_id) patchActive(id, { zkp2pDepositId: d.zkp2p_deposit_id });
            resumeCompletionPoll(useBeamStore.getState().active[id] ?? payment);
          } else {
            waitForFundingThenSend(payment);
          }
        } catch { /* leave it in the store — resumes again next visit */ }
      }
    })();
    // run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmFunded = useCallback(async (id: string, method: FundingMethod, reference: string | null) => {
    const token = await getAccessToken();
    await fetch(`/api/beam/${id}/confirm-funded`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fundingMethod: method, fundingReference: reference }),
    });
  }, [getAccessToken]);

  // Marks a payment cancelled — used whenever a funding attempt was started (so the
  // backend row moved past PENDING_FUNDING) but the user backed out before any money moved.
  const cancelBeam = useCallback(async (id: string) => {
    try {
      const token = await getAccessToken();
      await fetch(`/api/beam/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch { /* best effort */ }
  }, [getAccessToken]);

  // Cancels a payment surfaced only via History (e.g. left over from a previous session,
  // so it isn't tracked in this browser's local state) — only for pre-deposit statuses,
  // which need no on-chain interaction.
  const cancelHistoryPayment = useCallback(async (id: string) => {
    setCancellingId(id);
    try {
      await cancelBeam(id);
      setHistory((prev) => (prev ? prev.filter((h) => h.id !== id) : prev));
      setDetailId(null);
      toast({ title: "Cancelled" });
    } finally {
      setCancellingId(null);
    }
  }, [cancelBeam, toast]);

  // Only cancels if the payment is still waiting on funds — if the balance already
  // landed and processing moved on, this is a no-op so we never cancel a real payment.
  const cancelIfStillFunding = useCallback(async (payment: BeamActivePayment) => {
    const current = useBeamStore.getState().active[payment.id];
    if (!current || current.stage !== "funding") return;
    try {
      const bal = await basePublicClient.readContract({
        address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [payment.baseWalletAddress as `0x${string}`],
      }) as bigint;
      const minAtomic = BigInt(Math.round(payment.amountUsdc * 1_000_000));
      if (bal >= minAtomic) return; // funds did land — let the normal flow pick it up
    } catch {
      return; // network hiccup — don't cancel on uncertainty
    }
    removeActive(payment.id);
    cancelBeam(payment.id);
  }, [removeActive, cancelBeam]);

  const handleCoinbase = async () => {
    if (!beamId || !baseWalletAddr || !platform) return;
    try {
      const accessToken = await getAccessToken();
      const sessionRes = await fetch("/api/coinbase/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ walletAddress: baseWalletAddr, blockchains: ["base"] }),
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(err.detail || err.error || `Session error ${sessionRes.status}`);
      }
      const { token: sessionToken } = await sessionRes.json();
      if (!sessionToken) throw new Error("No session token returned.");

      const params = new URLSearchParams();
      params.set("appId", "68e3c83a-3d5a-49aa-a8fa-7ef26d824de1");
      params.set("defaultNetwork", "base");
      params.set("defaultAsset", "USDC");
      params.set("addresses", JSON.stringify({ [baseWalletAddr]: ["base"] }));
      params.set("assets", JSON.stringify(["USDC"]));
      // Preset the exact USDC amount rather than a fiat amount — fiat presets get converted
      // from the buyer's local currency (EUR, etc.), which can quietly deliver a different
      // amount of USDC than the payment actually needs. This is the grossed-up total
      // (recipient amount + spread) since the sender absorbs the rate.
      params.set("presetCryptoAmount", String(payAmount));
      params.set("sessionToken", sessionToken);
      const onrampUrl = `https://pay.coinbase.com/buy/select-asset?${params.toString()}`;

      await confirmFunded(beamId, "coinbase", sessionToken);
      const popup = window.open(onrampUrl, "coinbase-onramp", "width=460,height=730,left=200,top=100,resizable=yes,scrollbars=yes");
      if (!popup) window.open(onrampUrl, "_blank");

      const payment: BeamActivePayment = {
        id: beamId, platform: platformId, identifier, amountUsdc: payAmount,
        amountPayout: amountPayout ?? amountNum, currency, fxRateFromUsd: fxRateFromUsd ?? 1,
        baseWalletAddress: baseWalletAddr, stage: "funding", label: "Getting your payment ready…", startedAt: Date.now(),
      };
      startPaymentTracking(payment, waitForFundingThenSend);

      // Coinbase's popup gives no completion signal — if the user closes it without
      // buying, cancel instead of leaving this looking "in progress" for 10 minutes.
      if (popup) {
        const watchClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(watchClosed);
            setTimeout(() => cancelIfStillFunding(payment), 4000);
          }
        }, 1000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not open Coinbase Onramp.";
      toast({ variant: "destructive", title: "Onramp error", description: msg });
    }
  };

  const handleMoonpay = async () => {
    if (!beamId || !baseWalletAddr || !platform) return;
    const paymentId = beamId;
    try {
      await confirmFunded(beamId, "moonpay", null);
      const result = await privyFundWalletEvm({
        address: baseWalletAddr,
        options: {
          chain: base,
          amount: payAmount.toString(),
          asset: "USDC",
          defaultFundingMethod: "card",
          card: { preferredProvider: "moonpay" },
        },
      });
      if (result?.status !== "completed") {
        // User backed out of MoonPay without buying — nothing to track.
        cancelBeam(paymentId);
        return;
      }
      startPaymentTracking({
        id: beamId, platform: platformId, identifier, amountUsdc: payAmount,
        amountPayout: amountPayout ?? amountNum, currency, fxRateFromUsd: fxRateFromUsd ?? 1,
        baseWalletAddress: baseWalletAddr, stage: "funding", label: "Getting your payment ready…", startedAt: Date.now(),
      }, waitForFundingThenSend);
    } catch (err: unknown) {
      cancelBeam(paymentId);
      const msg = err instanceof Error ? err.message : "Could not open MoonPay.";
      toast({ variant: "destructive", title: "MoonPay error", description: msg });
    }
  };

  const handleBlink = async () => {
    if (!beamId || !baseWalletAddr || !platform) return;
    const paymentId = beamId;
    try {
      await confirmFunded(beamId, "blink", null);
      const { Deposit, DepositError, getDisplayMessage } = await import("@swype-org/deposit");
      const getBlinkSigner = async (data: unknown) => {
        const token = await getAccessToken();
        const res = await fetch("/api/blink/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Signer request failed");
        }
        return res.json();
      };
      const deposit = new Deposit({ signer: getBlinkSigner, debug: true, containerElement: document.body });
      try {
        await deposit.requestDeposit({
          amount: payAmount,
          chainId: 8453,
          address: baseWalletAddr,
          token: BASE_USDC_ADDRESS,
        });
      } finally {
        deposit.destroy();
      }
      startPaymentTracking({
        id: beamId, platform: platformId, identifier, amountUsdc: payAmount,
        amountPayout: amountPayout ?? amountNum, currency, fxRateFromUsd: fxRateFromUsd ?? 1,
        baseWalletAddress: baseWalletAddr, stage: "funding", label: "Getting your payment ready…", startedAt: Date.now(),
      }, waitForFundingThenSend);
    } catch (err: unknown) {
      cancelBeam(paymentId);
      const { DepositError, getDisplayMessage } = await import("@swype-org/deposit");
      const msg = err instanceof DepositError ? getDisplayMessage(err) : (err instanceof Error ? err.message : "That didn't go through.");
      toast({ variant: "destructive", title: "Blink error", description: `${msg} — try a different payment method.` });
    }
  };

  const handleGetNearDepositAddress = async () => {
    if (!nearFromToken || !usdcBaseToken || !baseWalletAddr || !beamId || !platform) return;
    setNearSubmitting(true);
    try {
      const refundAddress = nearFromToken.chain?.toLowerCase() === "solana" ? solanaAddress : baseWalletAddr;
      if (!refundAddress) throw new Error("No refund address available for this source chain.");
      const info = await getDepositInfo({
        fromToken: nearFromToken,
        toToken: usdcBaseToken,
        amount: payAmount.toString(),
        recipient: baseWalletAddr,
        sender: refundAddress,
        refundAddress,
        slippageBps: 100,
      });
      if (!info.depositAddress) throw new Error("No payment address returned");
      setNearDepositAddr(info.depositAddress);
      setNearDepositMemo(info.memo ?? null);
      await confirmFunded(beamId, "near-intents", info.depositAddress);

      const capturedId = beamId, capturedAddr = baseWalletAddr, capturedPlatformId = platformId, capturedIdentifier = identifier;
      const capturedPayAmount = payAmount, capturedPayout = amountPayout ?? amountNum;
      const capturedCurrency = currency, capturedFxRate = fxRateFromUsd ?? 1;
      nearPollRef.current = setInterval(async () => {
        try {
          const status = await getExecutionStatus(info.depositAddress!);
          const s = String(status?.status || "").toUpperCase();
          if (s.includes("SUCCESS")) {
            if (nearPollRef.current) clearInterval(nearPollRef.current);
            startPaymentTracking({
              id: capturedId, platform: capturedPlatformId, identifier: capturedIdentifier, amountUsdc: capturedPayAmount,
              amountPayout: capturedPayout, currency: capturedCurrency, fxRateFromUsd: capturedFxRate,
              baseWalletAddress: capturedAddr, stage: "sending", label: `Sending to ${capturedIdentifier}…`, startedAt: Date.now(),
            }, signAndSendDeposit);
          }
        } catch { /* keep polling */ }
      }, 8000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not get a payment address";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setNearSubmitting(false);
    }
  };

  useEffect(() => () => { if (nearPollRef.current) clearInterval(nearPollRef.current); }, []);

  // Opening a History item fetches the live record — this also re-triggers the backend's own
  // on-chain fulfilment check for DEPOSITED payments, and gives us the deposit id + wallet
  // address needed to offer cancellation even for payments we never locally tracked.
  useEffect(() => {
    setDetailFullRecord(null);
    if (!detailId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/beam/${detailId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!cancelled && res.ok) setDetailFullRecord(data);
      } catch { /* keep showing the History snapshot */ }
    })();
    return () => { cancelled = true; };
  }, [detailId, getAccessToken]);

  // Once the currently-shown "sending" payment disappears from tracking (completed,
  // cancelled, or dismissed), automatically return to compose — the toast already
  // communicated the outcome, and the payment is now visible in History either way.
  useEffect(() => {
    if (step === "sending" && sendingPaymentId && !activePayments[sendingPaymentId]) {
      resetCompose();
    }
  }, [step, sendingPaymentId, activePayments, resetCompose]);

  if (!authenticated) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
        <p className="text-slate-400 max-w-sm">Pay anyone's Venmo, Cash App, or Revolut directly with crypto — no account on those apps needed.</p>
        <Button onClick={() => login()} className="px-8 py-6 text-base rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white border-0 hover:opacity-90">
          Log in to send a payment
        </Button>
      </div>
    );
  }

  const detailHistory = detailId ? (history?.find((h) => h.id === detailId) ?? null) : null;
  const sendingPayment = sendingPaymentId ? activePayments[sendingPaymentId] : null;

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6">
        <BeamTabs activeTab={view} onTabChange={setView} />

        {view === "history" ? (
          <div className="space-y-3">
            {historyLoading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4 rounded-2xl border border-white/10 bg-white/5">
                <Skeleton className="w-9 h-9 rounded-lg bg-white/10 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 bg-white/10" />
                  <Skeleton className="h-3 w-24 bg-white/10" />
                </div>
                <div className="text-right shrink-0 ml-2 space-y-2">
                  <Skeleton className="h-5 w-16 bg-white/10 ml-auto" />
                  <Skeleton className="h-3 w-12 bg-white/10 ml-auto" />
                </div>
              </div>
            ))}
            {!historyLoading && history?.length === 0 && (
              <p className="text-center text-slate-500 py-10">No payments yet.</p>
            )}
            {history?.map((h) => {
              const p = getPlatform(h.platform);
              const s = statusInfo(h.status);
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setDetailId(h.id)}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-colors text-left"
                >
                  {p?.logo && <img src={p.logo} alt="" className="w-9 h-9 rounded-lg object-contain shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-semibold truncate">{p?.name ?? h.platform} · {h.platform_identifier}</p>
                    <p className="text-sm text-slate-500">{new Date(h.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-white font-bold text-lg tabular-nums">{currencySymbol(h.currency)}{h.amount_payout.toFixed(2)}</p>
                    <p className={cn("text-sm font-semibold", s.textClass)}>{s.label}</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {step === "compose" && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <Label className="text-slate-300 text-xl font-sans font-medium">Send</Label>
                  </div>

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
                          inputMode="numeric"
                          value={amountStr}
                          onBeforeInput={(e) => {
                            const data = (e.nativeEvent as InputEvent).data;
                            if (data && /[^0-9]/.test(data)) e.preventDefault();
                          }}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/[^0-9]/g, "");
                            e.target.value = cleaned;
                            setAmountStr(cleaned);
                          }}
                          placeholder="0"
                          className={[
                            "text-white placeholder:text-slate-600",
                            "font-semibold font-sans tracking-tight tabular-nums",
                            "border-0 bg-transparent outline-none p-0 m-0 text-center",
                          ].join(" ")}
                          style={{
                            fontSize: `${amountFontPx}px`,
                            lineHeight: 1.05,
                            width: `${Math.max(amountInputWidthPx, Math.round(amountFontPx * 0.6)) + 8}px`,
                          }}
                          aria-label="Amount"
                        />
                        <span
                          className="font-semibold font-sans text-slate-500 ml-1"
                          style={{ fontSize: `${suffixFontPx}px`, lineHeight: 1.05 }}
                        >
                          {currency}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Label className="text-slate-300 text-xl font-sans font-medium">To</Label>
                  <div className="relative mt-3">
                    <div className="grid grid-cols-3 gap-2">
                      {BEAM_PLATFORMS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPlatformId(p.id)}
                          className={cn(
                            "flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-colors",
                            platformId === p.id ? "border-orange-400/60 bg-orange-500/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                          )}
                        >
                          <img src={p.logo} alt="" className="w-8 h-8 rounded-lg object-contain" />
                          <span className="text-sm text-white font-medium">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {platform && (
                    <div className="relative mt-3">
                      <Input
                        type="text"
                        name="beam-recipient-identifier"
                        placeholder={platform.placeholder}
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        autoComplete="off"
                        className="h-12 mb-2 bg-white/5 border-white/10 text-white text-md placeholder:text-slate-500 placeholder:text-[14px] sm:placeholder:text-[20px]"
                        style={{ fontSize: `20px` }}
                      />
                    </div>
                  )}
                  <p className="text-base sm:text-sm text-slate-400 mt-0.5 mb-1.5">
                    {platform ? `${platform.idLabel} · max ${currencySymbol(currency)}${BEAM_CAP_USDC} received` : `Max ${currencySymbol(currency)}${BEAM_CAP_USDC} received`}
                  </p>
                </div>
                <Button
                  onClick={handleCompose}
                  disabled={submitting || !identifier.trim()}
                  className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
                </Button>
              </div>
            )}

            {step === "fund" && (
              <div className="space-y-4">
                <button type="button" onClick={() => setStep("compose")} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white mb-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">To {platform?.name} · {identifier}</span>
                    <span className="text-white font-semibold">{currencySymbol(currency)}{amountNum.toFixed(2)}</span>
                  </div>
                  {currency === "USD" && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Network fee</span>
                      <span className="text-white font-semibold">${(payAmount - amountNum).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-white/10">
                    <span className="text-base text-slate-200 font-medium">Total to pay{currency === "EUR" ? " (in USDC)" : ""}</span>
                    <span className="text-white font-bold text-xl tabular-nums">${Number.isFinite(payAmount) ? payAmount.toFixed(2) : "—"}</span>
                  </div>
                </div>

                <FundingCard title="Card via Coinbase" subtitle="Apple Pay · card · bank transfer" onClick={handleCoinbase} />
                <FundingCard title="Card via MoonPay" subtitle="Apple Pay · Google Pay · card" onClick={handleMoonpay} />
                <FundingCard title="Pay with Blink" subtitle="ETH · USDC · USDT — any chain" onClick={handleBlink} />
                <FundingCard title="Pay with another crypto" subtitle="Any token, any chain" onClick={() => setStep("near-fund")} />
              </div>
            )}

            {step === "near-fund" && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    if (nearDepositAddr && beamId) {
                      if (nearPollRef.current) clearInterval(nearPollRef.current);
                      cancelBeam(beamId);
                      setNearDepositAddr(null);
                      setNearDepositMemo(null);
                    }
                    setStep("fund");
                  }}
                  className="flex items-center gap-1 text-sm text-slate-400 hover:text-white mb-2"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                {!nearDepositAddr ? (
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
                    <label className="text-sm text-slate-400 block">Pay with</label>
                    <TokenCombobox tokens={tokens} value={nearFromSelection} onChange={setNearFromSelection} placeholder="Select a token" />
                    <Button
                      disabled={!nearFromToken || nearSubmitting}
                      onClick={handleGetNearDepositAddress}
                      className="w-full h-12 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white border-0 hover:opacity-90"
                    >
                      {nearSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Get payment address"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
                    <p className="text-sm text-slate-400">Send exactly the quoted amount to:</p>
                    <div className="bg-white p-3 rounded-xl inline-block">
                      <QRCodeSVG value={nearDepositAddr} size={160} />
                    </div>
                    <p className="text-white font-mono text-sm break-all">{nearDepositAddr}</p>
                    {nearDepositMemo && <p className="text-slate-400 text-sm">Memo: <span className="font-mono text-white">{nearDepositMemo}</span></p>}
                    <p className="text-sm text-slate-500 flex items-center justify-center gap-2"><Clock className="h-4 w-4" /> Waiting for your payment…</p>
                  </div>
                )}
              </div>
            )}

            {step === "sending" && sendingPayment && (() => {
              const payment = sendingPayment;
              const isError = payment.stage === "error";
              return (
                <div className="space-y-4">
                  <button type="button" onClick={resetCompose} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white mb-2">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <div
                    className={cn(
                      "rounded-2xl border p-8 flex flex-col items-center gap-4 text-center",
                      isError ? "border-red-500/20 bg-red-500/[0.06]" : "border-white/10 bg-white/5",
                    )}
                  >
                    {isError ? (
                      <AlertTriangle className="h-16 w-16 text-red-400" />
                    ) : (
                      <img
                        src={payment.stage === "funding" ? "/images/icons/deposit-bridge.svg" : "/images/icons/withdraw-peer.svg"}
                        alt=""
                        className="w-20 h-20 object-contain drop-shadow-md"
                      />
                    )}
                    <p className="text-2xl font-bold text-white">{isError ? "Something went wrong" : payment.label}</p>
                    <p className="text-lg font-medium text-slate-200">
                      {currencySymbol(payment.currency)}{payment.amountPayout.toFixed(2)} to {getPlatform(payment.platform)?.name ?? payment.platform} · {payment.identifier}
                    </p>
                    {payment.stage === "funding" && (
                      <p className="text-base text-slate-300">
                        Waiting for your funds to land — this can take a minute depending on how you're paying.
                      </p>
                    )}
                    {payment.stage === "sending" && (
                      <p className="text-base text-slate-300">
                        Waiting for someone to pick this up on {getPlatform(payment.platform)?.name ?? payment.platform} — usually quick, but depends on who's available right now. Feel free to go back — it'll keep going and show up in History.
                      </p>
                    )}
                    {isError && payment.errorMsg && <p className="text-base text-red-400">{payment.errorMsg}</p>}

                    {isError && (
                      <div className="flex gap-2 w-full">
                        <Button
                          onClick={() => waitForFundingThenSend(payment)}
                          className="flex-1 bg-gradient-to-r from-[#FF1301] to-[#EAB308] hover:opacity-90 text-white"
                        >
                          Retry
                        </Button>
                        <Button
                          onClick={() => { removeActive(payment.id); cancelBeam(payment.id); }}
                          variant="outline"
                          className="flex-1 border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white"
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                    {payment.stage === "funding" && (
                      <Button
                        onClick={() => { removeActive(payment.id); cancelBeam(payment.id); }}
                        variant="outline"
                        className="w-full border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white"
                      >
                        Cancel payment
                      </Button>
                    )}
                    {payment.stage === "sending" && payment.zkp2pDepositId && (
                      <Button
                        onClick={() => cancelDepositedPayment(payment)}
                        disabled={cancellingId === payment.id}
                        variant="outline"
                        className="w-full border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white"
                      >
                        {cancellingId === payment.id ? "Checking…" : "Cancel payment"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent
          className={cn(
            "text-white sm:max-w-lg rounded-2xl p-8 flex flex-col items-center gap-4 text-center",
            detailHistory?.status === "COMPLETE" ? "border-emerald-500/20 bg-emerald-500/[0.06]"
              : detailHistory?.status === "FAILED" ? "border-red-500/20 bg-red-500/[0.06]"
              : "border-white/10 bg-[#0f0f12]",
          )}
        >
          <DialogTitle className="sr-only">Payment status</DialogTitle>
          {detailHistory ? (() => {
            // Prefer the freshly-fetched record — opening this dialog re-triggers the backend's
            // own on-chain fulfilment check, so this can be more current than the History snapshot.
            const status = detailFullRecord?.status ?? detailHistory.status;
            const canOnChainCancel = status === "DEPOSITED" && detailFullRecord?.zkp2p_deposit_id && detailFullRecord?.base_wallet_address;
            return (
              <>
                {status === "COMPLETE" ? (
                  <CheckCircle2 className="h-16 w-16 text-emerald-400" />
                ) : status === "FAILED" ? (
                  <AlertTriangle className="h-16 w-16 text-red-400" />
                ) : (
                  <img src="/images/icons/withdraw-peer.svg" alt="" className="w-20 h-20 object-contain drop-shadow-md" />
                )}
                <p className="text-2xl font-bold text-white">{statusInfo(status).label}</p>
                <p className="text-lg font-medium text-slate-200">
                  {currencySymbol(detailHistory.currency)}{detailHistory.amount_payout.toFixed(2)} to {getPlatform(detailHistory.platform)?.name ?? detailHistory.platform} · {detailHistory.platform_identifier}
                </p>
                <p className="text-sm text-slate-400">{new Date(detailHistory.created_at).toLocaleString()}</p>
                {!["COMPLETE", "FAILED", "CANCELLED", "DEPOSITED"].includes(status) && (
                  <Button
                    onClick={() => cancelHistoryPayment(detailHistory.id)}
                    disabled={cancellingId === detailHistory.id}
                    variant="outline"
                    className="w-full border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white"
                  >
                    {cancellingId === detailHistory.id ? "Cancelling…" : "Cancel payment"}
                  </Button>
                )}
                {canOnChainCancel && (
                  <Button
                    onClick={() => cancelDepositedPayment({
                      id: detailHistory.id,
                      platform: detailHistory.platform,
                      identifier: detailHistory.platform_identifier,
                      amountUsdc: detailHistory.amount_usdc,
                      amountPayout: detailHistory.amount_payout,
                      currency: detailHistory.currency,
                      fxRateFromUsd: 1,
                      baseWalletAddress: detailFullRecord.base_wallet_address,
                      stage: "sending",
                      label: "",
                      startedAt: 0,
                      zkp2pDepositId: detailFullRecord.zkp2p_deposit_id,
                    })}
                    disabled={cancellingId === detailHistory.id}
                    variant="outline"
                    className="w-full border-white/20 !bg-transparent text-slate-200 hover:!bg-white/10 hover:text-white"
                  >
                    {cancellingId === detailHistory.id ? "Checking…" : "Cancel payment"}
                  </Button>
                )}
              </>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconBubble({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span className="relative shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full">
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          active
            ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_10px_24px_rgba(255,122,42,0.25)]"
            : "bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
          active ? "scale-[1.02]" : "scale-100",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute -inset-1 rounded-full blur-md opacity-0 transition-opacity duration-300",
          active ? "opacity-60 bg-[radial-gradient(circle,rgba(255,122,42,0.55),transparent_60%)]" : "",
        )}
      />
      <span
        className={cn(
          "relative z-10 shrink-0 flex items-center justify-center text-white",
          active ? "text-white" : "text-slate-300",
          "[&>svg]:h-4 [&>svg]:w-4 [&>svg]:stroke-[2.25]",
          "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          active ? "translate-y-[-0.5px]" : "translate-y-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}

function BeamTabs({ activeTab, onTabChange }: { activeTab: "send" | "history"; onTabChange: (tab: "send" | "history") => void }) {
  const tabTextClass = (tab: "send" | "history") =>
    cn("relative z-10 transition-colors duration-300 font-sans font-medium text-lg", activeTab === tab ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200");

  const tabBase =
    "group relative z-10 flex-1 min-w-[132px] whitespace-nowrap rounded-xl px-4 py-2.5 " +
    "inline-flex items-center justify-center gap-2 font-semibold text-[16px] tracking-[-0.01em] " +
    "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]";

  const sliderX = activeTab === "history" ? "translate-x-full" : "translate-x-0";

  return (
    <div className="flex items-center justify-between gap-2 mb-6">
      <div className="relative flex rounded-2xl p-1 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border border-white/[0.06] overflow-hidden">
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "bg-gradient-to-b from-white/[0.08] to-white/[0.03] shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] border border-white/[0.08]",
            sliderX,
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] opacity-40",
            "bg-[radial-gradient(80%_140%_at_50%_0%,rgba(255,122,42,0.35),transparent_60%)]",
            sliderX,
          )}
        />
        <button type="button" onClick={() => onTabChange("send")} className={tabBase}>
          <IconBubble active={activeTab === "send"}>
            <ArrowUp />
          </IconBubble>
          <span className={tabTextClass("send")}>Send</span>
        </button>
        <button type="button" onClick={() => onTabChange("history")} className={tabBase}>
          <IconBubble active={activeTab === "history"}>
            <Clock />
          </IconBubble>
          <span className={tabTextClass("history")}>History</span>
        </button>
      </div>
    </div>
  );
}

function FundingCard({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-left transition-all"
    >
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold text-white">{title}</p>
        <p className="text-sm mt-0.5 text-slate-400">{subtitle}</p>
      </div>
      <ArrowRight className="h-5 w-5 shrink-0 text-slate-500" />
    </button>
  );
}

