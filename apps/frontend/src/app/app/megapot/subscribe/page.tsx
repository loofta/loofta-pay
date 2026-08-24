"use client";

// Megapot ticket subscription — a fixed 30-day run where the user picks tickets/day at signup;
// price and total tickets both scale with that choice at the same $28-per-30-tickets rate ($2
// cheaper than buying 30 tickets one at a time at $1 each — ~6.7% off, not a round 10%), rather
// than a fixed 30-ticket bundle that just finishes faster at a higher cadence. Own dedicated
// page, same precedent as Mystery Packs
// (/app/megapot/packs) rather than folded into the Buy tab's already-large page.tsx. Numbers can
// be quick-pick (fresh random each day) or user-chosen at signup — when chosen, the exact same
// numbers are bought every single day for the whole run (reusing the shared ChooseNumbers picker
// from megapot/page.tsx's Buy tab, shuffle button included). Payment is a real, plain on-chain
// USDC transfer from the user's embedded Solana wallet to Loofta's treasury (POST
// /lottery/subscription/pay builds it, gas + destination ATA sponsored so the user only signs
// once) — verified server-side before the subscription activates, same "never trust the client"
// discipline as the ticket-purchase and Mystery Pack flows.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { ChooseNumbers, randomTicket, type TicketNumbers } from "@/components/megapot/ChooseNumbers";

const BalanceModal = dynamic(() => import("@/components/BalanceModal").then(m => ({ default: m.BalanceModal })), { ssr: false });

// Must match the backend's MegapotSubscriptionService constants (SUBSCRIPTION_DAYS,
// PRICE_USDC_PER_TICKET_PER_DAY, MIN/MAX_TICKETS_PER_DAY) — the backend is authoritative and
// re-validates all of this server-side; these are only for the picker UI's own display math.
const SUBSCRIPTION_DAYS = 30;
const PRICE_USDC_PER_TICKET_PER_DAY = 28;
const CADENCE_OPTIONS = [1, 2, 3, 4, 5, 10];

function computeTotalTickets(ticketsPerDay: number): number {
  return ticketsPerDay * SUBSCRIPTION_DAYS;
}
function computePriceUsdc(ticketsPerDay: number): number {
  return ticketsPerDay * PRICE_USDC_PER_TICKET_PER_DAY;
}

interface SubscriptionBatch {
  id: string;
  batchNumber: number;
  numTickets: number;
  status: "pending" | "bought" | "failed" | "refunded";
  lotteryTicketId: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface SubscriptionSummary {
  id: string;
  status: "active" | "completed" | "cancelled" | "expired";
  totalTickets: number;
  ticketsPerDay: number;
  ticketsBought: number;
  priceUsdc: number;
  startedAt: string;
  nextBatchDueAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  refundUsdc: number | null;
  pickedNumbers: TicketNumbers[] | null;
  batches: SubscriptionBatch[];
}

/** buildPaymentTx sponsors gas + the treasury's own destination ATA, so an "insufficient funds"
 *  simulation failure here can only ever mean the user's own USDC balance. Same translation
 *  approach as friendlyPackPayError in the Mystery Pack page. */
function friendlyPayError(rawMessage: string | undefined, priceUsdc: number): string {
  const s = (rawMessage ?? "").toLowerCase();
  if (s.includes("insufficient funds")) return `Not enough USDC in your wallet — that cadence costs $${priceUsdc}.`;
  if (s.includes("user rejected") || s.includes("denied")) return "Payment cancelled.";
  if (s.includes("simulation failed") || /custom program error/i.test(s)) return "Payment couldn't be completed right now. Please try again in a moment.";
  return rawMessage && rawMessage.length < 200 ? rawMessage : "Payment failed — please try again.";
}

function formatCountdown(dueAt: string | null): string {
  if (!dueAt) return "—";
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms <= 0) return "any moment";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 1) return `~${hours}h ${mins}m`;
  return `~${mins}m`;
}

function StatusCard({ subscription, onCancel, cancelling, cancelError }: {
  subscription: SubscriptionSummary;
  onCancel: () => void;
  cancelling: boolean;
  cancelError: string | null;
}) {
  const pct = Math.round((subscription.ticketsBought / subscription.totalTickets) * 100);
  const canCancel = subscription.status === "active" && subscription.ticketsBought === 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold text-white">Your subscription</p>
        <span className={[
          "text-xs font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 border",
          subscription.status === "active" ? "text-amber-300 border-amber-400/30 bg-amber-400/10" :
          subscription.status === "completed" ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" :
          subscription.status === "cancelled" ? "text-slate-400 border-slate-500/30 bg-slate-500/10" :
          "text-red-400 border-red-400/30 bg-red-400/10",
        ].join(" ")}>
          {subscription.status}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-sm text-slate-400">
          <span>{subscription.ticketsBought} of {subscription.totalTickets} tickets bought</span>
          <span>{subscription.ticketsPerDay}/day</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {subscription.status === "active" && (
        <p className="text-sm text-slate-400">Next ticket in {formatCountdown(subscription.nextBatchDueAt)}</p>
      )}

      {subscription.pickedNumbers && subscription.pickedNumbers.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-400">Your numbers (same every day)</p>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.06]">
            {subscription.pickedNumbers.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 px-3 py-2">
                {t.main.map((n, pos) => (
                  <span key={pos} className="w-7 h-7 rounded-full bg-white/[0.08] border border-white/[0.08] text-slate-200 text-xs font-semibold flex items-center justify-center shrink-0">
                    {n}
                  </span>
                ))}
                <span className="w-px h-3.5 bg-white/10 mx-0.5 shrink-0" />
                <span className="w-7 h-7 rounded-full bg-white/80 text-[#0f0f12] text-xs font-bold flex items-center justify-center shrink-0 shadow-sm">
                  {t.bonus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {subscription.status === "cancelled" && subscription.refundUsdc != null && (
        <p className="text-sm text-emerald-400">Cancelled — ${subscription.refundUsdc.toFixed(2)} refunded to your wallet.</p>
      )}
      {subscription.status === "expired" && subscription.refundUsdc != null && (
        <p className="text-sm text-amber-300">Expired — ${subscription.refundUsdc.toFixed(2)} refunded for undelivered tickets.</p>
      )}
      {subscription.status === "completed" && (
        <p className="text-sm text-emerald-400">All {subscription.totalTickets} tickets delivered — thanks for subscribing!</p>
      )}

      {canCancel && (
        <div className="pt-1 space-y-2">
          <p className="text-sm text-slate-500">You can still cancel for a full refund — this goes away once your first ticket buys.</p>
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="w-full h-11 rounded-xl text-sm font-semibold border border-white/10 text-slate-200 hover:bg-white/[0.06] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel &amp; refund ${subscription.priceUsdc.toFixed(2)}
          </button>
          {cancelError && <p className="text-sm text-red-400 text-center">{cancelError}</p>}
        </div>
      )}
      {subscription.status === "active" && subscription.ticketsBought > 0 && (
        <p className="text-sm text-slate-500">Already started — runs to completion automatically.</p>
      )}
    </div>
  );
}

export default function MegapotSubscribePage() {
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find(w => w.address === embeddedSolAddress) ?? wallets[0];

  const {
    balanceUSD: ownBalance,
    walletAddress: ownSolanaAddress,
    isLoading: loadingOwnBalance,
    refetch: refetchOwnBalance,
  } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated });
  const [showBalanceModal, setShowBalanceModal] = useState(false);

  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [ticketsPerDay, setTicketsPerDay] = useState(1);
  const [numberMode, setNumberMode] = useState<"random" | "custom">("random");
  const [pickedTickets, setPickedTickets] = useState<TicketNumbers[]>([randomTicket()]);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // The picker always holds exactly `ticketsPerDay` sets — one per ticket bought each day, reused
  // unchanged for the whole 30-day run. Growing keeps existing picks and adds fresh random ones;
  // shrinking just trims from the end.
  useEffect(() => {
    setPickedTickets(prev => {
      if (prev.length === ticketsPerDay) return prev;
      if (prev.length > ticketsPerDay) return prev.slice(0, ticketsPerDay);
      return [...prev, ...Array.from({ length: ticketsPerDay - prev.length }, () => randomTicket())];
    });
  }, [ticketsPerDay]);

  const fetchSubscription = useCallback(async () => {
    if (!authenticated) { setLoadingSubscription(false); return; }
    setLoadingSubscription(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/lottery/subscription", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setSubscription(await res.json());
    } catch { /* best-effort — worst case the signup form just shows */ }
    finally { setLoadingSubscription(false); }
  }, [authenticated, getAccessToken]);

  useEffect(() => { fetchSubscription(); }, [fetchSubscription]);

  const hasActiveSubscription = subscription?.status === "active";
  const totalTickets = computeTotalTickets(ticketsPerDay);
  const priceUsdc = computePriceUsdc(ticketsPerDay);
  const insufficientBalance = !loadingOwnBalance && ownBalance < priceUsdc;

  const ticketsForRequest = numberMode === "custom" ? pickedTickets.map(t => ({ main: t.main, bonus: t.bonus })) : undefined;
  const customNumbersIncomplete = numberMode === "custom" &&
    (pickedTickets.length !== ticketsPerDay || pickedTickets.some(t => t.main.length !== 5 || !t.bonus));

  const handleSubscribe = useCallback(async () => {
    setSubscribeError(null);
    setSubscribing(true);
    try {
      if (!embeddedWallet?.address) throw new Error("No Solana wallet found");
      if (customNumbersIncomplete) throw new Error("Finish picking your numbers first");
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      const payRes = await fetch("/api/lottery/subscription/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketsPerDay, userSolanaAddress: embeddedWallet.address, tickets: ticketsForRequest }),
      });
      const payData = await payRes.json().catch(() => ({}));
      if (!payRes.ok) throw new Error(payData?.message ?? "Failed to prepare payment");

      const txBytes = Buffer.from(payData.txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({
        transaction: txBytes as unknown as Uint8Array,
        wallet: embeddedWallet as any,
      });
      const signature = bs58.encode(sigBytes as Uint8Array);

      const activateRes = await fetch("/api/lottery/subscription/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ paymentTxHash: signature, ticketsPerDay, tickets: ticketsForRequest }),
      });
      const activateData = await activateRes.json().catch(() => ({}));
      if (!activateRes.ok) throw new Error(activateData?.message ?? "Payment sent but activation failed — contact support with your tx signature.");
      setSubscription(activateData);
    } catch (err: any) {
      setSubscribeError(friendlyPayError(err?.message, priceUsdc));
    } finally {
      setSubscribing(false);
    }
  }, [embeddedWallet, getAccessToken, signAndSendTransaction, ticketsPerDay, priceUsdc, ticketsForRequest, customNumbersIncomplete]);

  const handleCancel = useCallback(async () => {
    if (!subscription) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lottery/subscription/${subscription.id}/cancel`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Failed to cancel");
      await fetchSubscription();
    } catch (err: any) {
      setCancelError(err?.message ?? "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }, [subscription, getAccessToken, fetchSubscription]);

  const cadenceLabel = useMemo(() => (n: number) => n === 1 ? "1/day" : `${n}/day`, []);

  return (
    <div className="bg-[#0f0f12] text-white mobile-first min-h-[calc(100svh-var(--header-h,0px))]">
      <div className="w-full max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <Link href="/app/megapot" className="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
            <span className="sr-only">Back</span>
          </Link>
          <span className="text-sm font-semibold tracking-wide text-slate-200">Ticket Subscription</span>
          <div className="w-9" />
        </div>

        {!authenticated ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col items-center gap-4 text-center">
            <p className="text-slate-300 text-base">Sign in to subscribe.</p>
            <button onClick={login} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] font-semibold text-white">
              Sign in
            </button>
          </div>
        ) : loadingSubscription ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : hasActiveSubscription ? (
          <StatusCard subscription={subscription!} onCancel={handleCancel} cancelling={cancelling} cancelError={cancelError} />
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1a1108] to-[#15110d] p-5 text-center space-y-1.5">
              <div className="mb-1 text-4xl leading-none">🎟️</div>
              <p className="text-2xl font-bold text-white">${priceUsdc} for {totalTickets} tickets</p>
              <p className="text-sm text-slate-400">Over {SUBSCRIPTION_DAYS} days — save ${totalTickets - priceUsdc} vs buying one at a time</p>
            </div>

            {subscription && (subscription.status === "completed" || subscription.status === "cancelled" || subscription.status === "expired") && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm text-slate-400">Your last subscription is {subscription.status}. Start a new one below.</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-400">How many tickets per day?</p>
              <div className="grid grid-cols-3 gap-2">
                {CADENCE_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => setTicketsPerDay(n)}
                    className={[
                      "h-14 rounded-xl text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5",
                      ticketsPerDay === n
                        ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] text-white shadow-[0_4px_12px_rgba(255,122,42,0.35)]"
                        : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                    ].join(" ")}
                  >
                    <span>{cadenceLabel(n)}</span>
                    <span className={ticketsPerDay === n ? "text-xs font-normal text-white/80" : "text-xs font-normal text-slate-500"}>
                      ${computePriceUsdc(n)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-sm text-slate-500 text-center">{totalTickets} tickets total, one draw a day for {SUBSCRIPTION_DAYS} days</p>
              <p className="text-sm text-slate-600 text-center">One-time — runs for {SUBSCRIPTION_DAYS} days only, doesn&apos;t auto-renew</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-400">Random numbers or pick your own?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setNumberMode("random")}
                  className={[
                    "h-11 rounded-xl text-sm font-semibold transition-all",
                    numberMode === "random"
                      ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] text-white shadow-[0_4px_12px_rgba(255,122,42,0.35)]"
                      : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                  ].join(" ")}
                >
                  Random each day
                </button>
                <button
                  onClick={() => setNumberMode("custom")}
                  className={[
                    "h-11 rounded-xl text-sm font-semibold transition-all",
                    numberMode === "custom"
                      ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] text-white shadow-[0_4px_12px_rgba(255,122,42,0.35)]"
                      : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                  ].join(" ")}
                >
                  Choose my numbers
                </button>
              </div>
              {numberMode === "custom" && (
                <>
                  <p className="text-sm text-slate-600">Same numbers get bought every day for the full {SUBSCRIPTION_DAYS} days.</p>
                  <ChooseNumbers tickets={pickedTickets} setTickets={setPickedTickets} hideCountControls />
                </>
              )}
            </div>

            {insufficientBalance ? (
              <div className="rounded-2xl border border-white/10 bg-[#111114] px-5 py-4 text-center space-y-3">
                <div>
                  <p className="text-base font-semibold text-slate-200">Not enough USDC</p>
                  <p className="text-sm text-slate-400 mt-1">Top up your balance to subscribe.</p>
                </div>
                <button
                  onClick={() => setShowBalanceModal(true)}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] font-semibold text-white hover:brightness-110 active:scale-[0.98] transition-[filter,transform]"
                >
                  Top up balance
                </button>
              </div>
            ) : (
              <button
                onClick={handleSubscribe}
                disabled={subscribing || customNumbersIncomplete}
                className="w-full h-14 rounded-2xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white active:scale-[0.99] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {subscribing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                Pay ${priceUsdc} &amp; subscribe
              </button>
            )}
            {subscribeError && <p className="text-sm text-red-400 text-center">{subscribeError}</p>}
            <p className="text-sm text-slate-600 text-center">Full refund if you cancel before your first ticket buys.</p>
          </div>
        )}
      </div>

      <BalanceModal
        open={showBalanceModal}
        onClose={() => setShowBalanceModal(false)}
        balanceUSD={ownBalance.toFixed(2)}
        balanceExact={ownBalance}
        loadingBalance={loadingOwnBalance}
        solanaAddress={ownSolanaAddress}
        onRefresh={() => refetchOwnBalance()}
        dark
        initialTab="topup"
        lockInitialTab
      />
    </div>
  );
}
