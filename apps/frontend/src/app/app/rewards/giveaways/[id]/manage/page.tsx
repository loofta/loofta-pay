"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { Connection, SendTransactionError } from "@solana/web3.js";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/store/auth";
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { PrivacyConfettiBurst } from "@/components/PrivacyConfettiBurst";
import { PrivacyGlyph } from "@/components/PrivacyGlyph";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { InsufficientBalanceCard } from "@/components/app/InsufficientBalanceCard";
import { getRpcForMode, getRpcFallbackForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { buildGiveawayFundingPrivateTransfer } from "@/services/api/claims";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending review",
  REJECTED: "Rejected",
  PENDING_FUNDING: "Approved — needs funding",
  FUNDED: "Funded",
  OPEN: "Open",
  ENTRIES_CLOSED: "Entries closed",
  DRAWING: "Drawing winners",
  WINNERS_SELECTED: "Winners selected",
  PAYOUT_IN_PROGRESS: "Paying out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  UNDERFUNDED_EXPIRED: "Expired — underfunded",
  REFUNDED: "Refunded",
};

function statusColor(status: string): string {
  if (status === "PENDING_APPROVAL") return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  if (status === "REJECTED" || status === "UNDERFUNDED_EXPIRED" || status === "CANCELLED") return "text-red-400 bg-red-500/10 border-red-500/30";
  if (status === "PENDING_FUNDING") return "text-[#FF7A2A] bg-[#FF7A2A]/10 border-[#FF7A2A]/30";
  if (status === "OPEN" || status === "COMPLETED") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  return "text-slate-300 bg-white/[0.06] border-white/10";
}

interface GiveawayDetail {
  id: string; title: string; status: string; selection_mode: string; winner_count: number;
  prize_amount_usd: string; burner_address: string | null; funding_required_usd: string | null;
  funding_confirmed_usd: string; mint: string | null; entries_close_at: string;
  tasks: Array<{ id: string; task_type: string; config: { target?: string } }>;
}

interface Entry {
  id: string; user_id: string; entry_index: number; x_handle: string; status: string;
  payout_choice: string | null; payout_status: string | null;
}

interface ReviewItem {
  id: string; submission_data: Record<string, unknown> | null; verification_status: string;
  entry: { x_handle: string }; task: { task_type: string };
}

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ManageGiveawayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { getAccessToken, user } = usePrivy();
  const { toast } = useToast();
  const [selectedWinners, setSelectedWinners] = useState<Set<string>>(new Set());

  // Funding — "Pay now" mirrors the app's existing send-payment/multi-send pattern instead of
  // asking the creator to copy a raw address into another wallet.
  const networkMode = useAuthStore((s) => s.networkMode);
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const solanaPayment = useSolanaPayment();
  const [payPrivately, setPayPrivately] = useState(false);
  const [paying, setPaying] = useState(false);
  const [showManualAddress, setShowManualAddress] = useState(false);
  // Same "entering incognito mode" celebratory moment as send-payment/multi-send — mount a fresh
  // burst whenever the toggle flips on, clear it via onDone.
  const [privacyBurstKey, setPrivacyBurstKey] = useState<number | null>(null);
  const handleTogglePayPrivately = useCallback((checked: boolean) => {
    setPayPrivately(checked);
    if (checked) setPrivacyBurstKey(Date.now());
  }, []);

  const { data: giveaway, refetch: refetchGiveaway } = useQuery({
    queryKey: ["giveaway-manage", id],
    queryFn: async (): Promise<GiveawayDetail> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Not found or not your giveaway");
      return res.json();
    },
  });

  const { data: funding, refetch: refetchFunding } = useQuery({
    queryKey: ["giveaway-manage-funding", id],
    queryFn: async () => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/funding`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load funding status");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const { data: entries, refetch: refetchEntries } = useQuery({
    queryKey: ["giveaway-manage-entries", id],
    queryFn: async (): Promise<Entry[]> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/entries`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load entries");
      return (await res.json()).entries ?? [];
    },
  });

  const { data: reviewQueue, refetch: refetchReviewQueue } = useQuery({
    queryKey: ["giveaway-manage-review-queue", id],
    queryFn: async (): Promise<ReviewItem[]> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/review-queue`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load review queue");
      return (await res.json()).items ?? [];
    },
  });

  const review = useCallback(async (completionId: string, decision: "verified" | "rejected") => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/completions/${completionId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: `Marked ${decision}` });
      refetchReviewQueue();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to review", description: err.message });
    }
  }, [id, getAccessToken, toast, refetchReviewQueue]);

  const toggleWinner = useCallback((entryId: string) => {
    setSelectedWinners((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const submitManualWinners = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/select-winners`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ entry_ids: Array.from(selectedWinners) }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Winners selected" });
      refetchEntries();
      refetchGiveaway();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to select winners", description: err.message });
    }
  }, [id, selectedWinners, getAccessToken, toast, refetchEntries, refetchGiveaway]);

  const handleFund = useCallback(async (remainingUsd: number, burnerAddress: string) => {
    setPaying(true);
    try {
      if (payPrivately) {
        const senderAddress = solanaPayment.senderAddress;
        const wallet = solanaWallets?.find((w) => w.address === senderAddress);
        if (!senderAddress || !wallet) throw new Error("Embedded wallet not found. Try logging out and back in.");

        const accessToken = await getAccessToken();
        const cluster = networkMode === "mainnet" ? "mainnet" : "devnet";
        const txData = await buildGiveawayFundingPrivateTransfer(id, user?.id ?? "", senderAddress, accessToken, cluster, true);

        const rawTxBytes = Buffer.from(txData.transactionBase64, "base64");
        const chain = getPrivySolanaChainForMode(networkMode);
        const ephemeralRpc = getEphemeralRpcForMode(networkMode);
        const broadcastRpc = txData.sendTo === "ephemeral" ? ephemeralRpc : getRpcForMode(networkMode);
        const broadcastConn = new Connection(broadcastRpc, "confirmed");

        let signature: string;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const signedOutput = await (signTransaction as any)({
            transaction: rawTxBytes,
            wallet,
            chain,
            options: { uiOptions: { showWalletUIs: false } },
          });
          signature = await broadcastConn.sendRawTransaction(signedOutput.signedTransaction, { skipPreflight: true, maxRetries: 3 });
        } catch (e) {
          if (e instanceof SendTransactionError) {
            try { const logs = await e.getLogs(broadcastConn); console.error("[GiveawayFunding] broadcast failed:", logs); } catch { /* ignore */ }
            throw new Error(privatePayErrorMessageForUser(e.message, cluster));
          }
          if (e instanceof Error) throw new Error(privatePayErrorMessageForUser(e.message, cluster));
          throw e;
        }

        const fallbackRpcUrl = txData.sendTo === "ephemeral" ? null : getRpcFallbackForMode(networkMode);
        const fallbackConn = fallbackRpcUrl ? new Connection(fallbackRpcUrl, "confirmed") : undefined;
        try {
          await waitForSignatureConfirmation(broadcastConn, signature, 120_000, 1500, "giveawayFunding", fallbackConn);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (!(msg.includes("InstructionError") && msg.includes('"Custom":'))) throw e;
        }
      } else {
        await solanaPayment.makePayment({ amount: remainingUsd, recipientAddress: burnerAddress });
      }
      toast({ title: "Payment sent", description: "Confirming on-chain — this can take a few seconds." });
      await Promise.all([refetchFunding(), refetchGiveaway()]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Funding payment failed", description: err.message });
    } finally {
      setPaying(false);
    }
  }, [id, user?.id, getAccessToken, networkMode, payPrivately, solanaPayment, solanaWallets, signTransaction, toast, refetchFunding, refetchGiveaway]);

  if (!giveaway) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 animate-pulse">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
        </div>
      </div>
    );
  }

  const canPickManually = giveaway.status === "DRAWING" && giveaway.selection_mode === "manual";

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link href={`/rewards/giveaways/${id}`} className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Back to giveaway</span>
          </Link>
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-2xl font-medium text-white mb-2">{giveaway.title}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${statusColor(giveaway.status)}`}>
              {STATUS_LABELS[giveaway.status] ?? giveaway.status.replace(/_/g, " ")}
            </span>
          </div>

          {giveaway.status === "PENDING_FUNDING" && giveaway.burner_address && (() => {
            const requiredUsd = Number(giveaway.funding_required_usd ?? 0);
            const confirmedUsd = Number(funding?.fundingConfirmedUsd ?? giveaway.funding_confirmed_usd ?? 0);
            const remainingUsd = Math.max(0, requiredUsd - confirmedUsd);
            const insufficientBalance = !payPrivately && !solanaPayment.isBalanceLoading && !solanaPayment.hasEnoughBalance(remainingUsd);
            return (
              <div className="relative">
                {privacyBurstKey != null && <PrivacyConfettiBurst key={privacyBurstKey} onDone={() => setPrivacyBurstKey(null)} />}
                {payPrivately && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10 select-none [filter:drop-shadow(0_2px_5px_rgba(0,0,0,0.6))]">
                    <PrivacyGlyph size={24} opacity={1} className="text-slate-300" />
                  </div>
                )}
                <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${payPrivately ? "border-white/15 bg-black/40" : "border-white/10 bg-white/5"}`}>
                  <p className="text-base font-medium text-slate-400 uppercase tracking-widest">Fund this giveaway</p>
                  <p className="text-base text-slate-300">
                    <span className="font-semibold text-white">${remainingUsd.toFixed(2)} USDC</span> left to fund
                    {confirmedUsd > 0 && <span className="text-slate-500"> · ${confirmedUsd.toFixed(2)} of ${requiredUsd.toFixed(2)} confirmed</span>}
                  </p>

                  <IncognitoModeToggle
                    checked={payPrivately}
                    onCheckedChange={handleTogglePayPrivately}
                    onLabel="Pay privately"
                    offLabel="Pay privately"
                  />

                  {insufficientBalance ? (
                    <InsufficientBalanceCard balanceUSD={solanaPayment.balanceUSD} neededUSD={remainingUsd} showFeesLabel={false} />
                  ) : (
                    <GradientActionButton
                      disabled={paying || remainingUsd <= 0}
                      loading={paying}
                      loadingText="Paying…"
                      onClick={() => handleFund(remainingUsd, giveaway.burner_address!)}
                    >
                      Pay ${remainingUsd.toFixed(2)} now
                    </GradientActionButton>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowManualAddress((s) => !s)}
                    className="flex items-center gap-1 text-base text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showManualAddress ? "rotate-180" : ""}`} />
                    Or send USDC manually from another wallet
                  </button>
                  {showManualAddress && (
                    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
                      <span className="flex-1 min-w-0 truncate text-base text-slate-300 font-mono">{giveaway.burner_address}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => { refetchFunding(); refetchGiveaway(); }}
                    className="text-base text-slate-400 hover:text-white underline"
                  >
                    Refresh funding status
                  </button>
                  <p className="text-base text-slate-500">
                    Budget can&apos;t be changed after submission — contact support if this needs to change.
                  </p>
                </div>
              </div>
            );
          })()}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-base font-medium text-slate-400 uppercase tracking-widest mb-2">
              Entries {entries ? `(${entries.length})` : ""}
            </p>
            <div className="space-y-2">
              {(entries ?? []).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-medium text-white truncate">@{entry.x_handle}</p>
                    <p className="text-base text-slate-500">
                      #{entry.entry_index} · {entry.status}
                      {entry.payout_status && entry.status === "winner" ? ` · payout ${entry.payout_status}` : ""}
                    </p>
                  </div>
                  {canPickManually && (
                    <button
                      type="button"
                      onClick={() => toggleWinner(entry.id)}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-base font-medium border transition-colors ${
                        selectedWinners.has(entry.id) ? "border-[#FF7A2A] text-white bg-[#FF7A2A]/10" : "border-white/10 text-slate-300 hover:bg-white/[0.06]"
                      }`}
                    >
                      {selectedWinners.has(entry.id) ? "Selected" : "Pick as winner"}
                    </button>
                  )}
                </div>
              ))}
              {entries && entries.length === 0 && <p className="text-base text-slate-500">No entries yet</p>}
            </div>
            {canPickManually && (
              <div className="mt-3">
                <GradientActionButton
                  onClick={submitManualWinners}
                  disabled={selectedWinners.size === 0 || selectedWinners.size > giveaway.winner_count}
                >
                  Confirm {selectedWinners.size} / {giveaway.winner_count} winner{giveaway.winner_count === 1 ? "" : "s"}
                </GradientActionButton>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-base font-medium text-slate-400 uppercase tracking-widest mb-2">
              Task review queue {reviewQueue ? `(${reviewQueue.length})` : ""}
            </p>
            <div className="space-y-2">
              {(reviewQueue ?? []).map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-white">@{item.entry.x_handle} — {item.task.task_type.replace(/_/g, " ")}</p>
                      {item.submission_data && (
                        <p className="text-base text-slate-500 truncate">{JSON.stringify(item.submission_data)}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => review(item.id, "verified")} className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors" aria-label="Approve">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => review(item.id, "rejected")} className="p-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors" aria-label="Reject">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {reviewQueue && reviewQueue.length === 0 && <p className="text-base text-slate-500">Nothing to review right now</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
