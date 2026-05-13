'use client'

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction as usePrivySolanaSignTransaction,
} from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { useMultiSendStore, type MultiSendRow, type MultiSendLink } from "@/store/multiSend";
import { getRpcForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import {
  createMultiPayments,
  multiConfirm,
  type MultiSendRecipient,
  type MultiSendLinkItem,
  type MultiFeeItem,
  type MultiCreateResult,
} from "@/services/api/sendPayment";
import { buildClaimPrivateTransfer } from "@/services/api/claims";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { PlusIcon, XIcon, CheckCircle2, Copy, ExternalLink, Loader2, ArrowLeft } from "lucide-react";
import { MessageInput } from "@/components/MessageInput";

type ConfirmFeeData = {
  senderWallet: string;
  paymentIds: string[];
  links: MultiSendLinkItem[];
  feeItems: MultiFeeItem[];
  totalAmountUsdc: number;
  totalFeeUsdc: number;
};

// "idle" = on the form. "review" = review screen shown, no modal open.
// All other phases = review screen shown + modal open.
type SendPhase =
  | { kind: "idle" }
  | { kind: "review" }
  | { kind: "creating" }
  | { kind: "building" }
  | { kind: "awaiting_signature" }
  | { kind: "broadcasting" }
  | { kind: "done"; recipientCount: number; totalUsdc: number; links: MultiSendLinkItem[]; failedCount?: number }
  | { kind: "error"; message: string; retry?: ConfirmFeeData };

const SETTLEMENT_PHASES = ["creating", "building", "awaiting_signature", "broadcasting", "error"] as const;
const BUSY_PHASES = ["creating", "building", "awaiting_signature", "broadcasting"];

function looksLikeEmail(s: string): boolean {
  return s.includes("@") && /.+@.+\..+/.test(s.trim());
}

function inferType(s: string): "email" | "username" {
  return looksLikeEmail(s) ? "email" : "username";
}

function newRow(): MultiSendRow {
  return { id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, recipient: "", amount: "100", message: "" };
}

function defaultRows(): MultiSendRow[] {
  return [
    { id: "ms-row-0", recipient: "", amount: "100", message: "" },
    { id: "ms-row-1", recipient: "", amount: "100", message: "" },
  ];
}

export interface MultiSendFlowProps {
  onBack: () => void;
}

export function MultiSendFlow({ onBack }: MultiSendFlowProps) {
  const { rows, reviewPending, completedLinks, hydrated, setRows, setReviewPending, setCompletedLinks, clear } = useMultiSendStore();
  const [phase, setPhase] = useState<SendPhase>({ kind: "idle" });

  const { user, getAccessToken, login, authenticated } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaPayment = useSolanaPayment({ enabled: reviewPending || phase.kind === "review" });
  const { signTransaction: privySolanaSignTransaction } = usePrivySolanaSignTransaction();
  const { toast } = useToast();

  const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";

  useEffect(() => {
    if (phase.kind === "idle" || phase.kind === "review" || phase.kind === "done") {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  }, [phase.kind]);

  // Restore state after store rehydrates (survives page refresh)
  useEffect(() => {
    if (!hydrated) return;
    if (completedLinks && completedLinks.length > 0) {
      setPhase({
        kind: "done",
        recipientCount: completedLinks.length,
        totalUsdc: completedLinks.reduce((s, l) => s + parseFloat(l.amount), 0),
        links: completedLinks,
      });
    } else if (reviewPending) {
      setPhase((p) => p.kind === "idle" ? { kind: "review" } : p);
    }
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  function addRow() {
    if (rows.length >= 10) return;
    setRows([...rows, newRow()]);
  }

  function removeRow(id: string) {
    if (rows.length <= 2) return;
    setRows(rows.filter((r) => r.id !== id));
  }

  function updateRow(id: string, field: keyof Omit<MultiSendRow, "id">, value: string) {
    setRows(rows.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }

  const totalUsd = rows.reduce((sum, r) => {
    const n = parseFloat(r.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const MIN_AMOUNT = 5;

  const filledRows = rows.filter((r) => {
    const n = parseFloat(r.amount);
    return r.recipient.trim().length > 0 && Number.isFinite(n) && n >= MIN_AMOUNT;
  });

  const canReview = filledRows.length >= 2;

  const recipients: MultiSendRecipient[] = rows
    .filter((r) => r.recipient.trim().length > 0)
    .map((r) => ({
      amount: parseFloat(r.amount),
      recipient_type: inferType(r.recipient),
      recipient_identifier: r.recipient.trim().replace(/^@/, "").toLowerCase(),
      message: [r.message.trim(), r.gif].filter(Boolean).join(" ").trim() || undefined,
    }));

  async function createPayments(senderWallet: string) {
    console.info(`[MultiSend] createPayments senderWallet=${senderWallet.slice(0, 8)}… recipients=${recipients.length}`);
    setPhase({ kind: "creating" });
    try {
      const accessToken = await getAccessToken();
      if (!user?.id) throw new Error("Not authenticated");

      const result: MultiCreateResult = await createMultiPayments(
        { recipients, sender_wallet: senderWallet, cluster: apiCluster },
        user.id,
        accessToken,
      );

      console.info(`[MultiSend] payment records created payment_ids=${result.payment_ids.join(",")}`);
      await executePayment({
        senderWallet,
        paymentIds: result.payment_ids,
        links: result.links,
        feeItems: result.fee_items,
        totalAmountUsdc: result.total_amount_usdc,
        totalFeeUsdc: result.total_fee_usdc,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.info(`[MultiSend] createPayments failed: ${msg}`);
      setPhase({ kind: "error", message: msg });
      toast({ variant: "destructive", title: "Failed to create payments", description: msg });
    }
  }

  async function broadcastAndWaitForHash(
    signedBytes: Uint8Array,
    paymentId: string,
    sendTo: string,
    cluster: "mainnet" | "devnet",
  ): Promise<string> {
    console.info(`[MultiSend] broadcasting paymentId=${paymentId} sendTo=${sendTo} cluster=${cluster}`);
    const rpc = sendTo === "ephemeral" ? getEphemeralRpcForMode(cluster) : getRpcForMode(cluster);
    const broadcastConn = new Connection(rpc, "confirmed");
    const sig = await broadcastConn.sendRawTransaction(signedBytes, { skipPreflight: true, maxRetries: 3 });
    console.info(`[MultiSend] broadcast ok sig=${sig.slice(0, 12)}… paymentId=${paymentId}`);
    const fallbackConn = sendTo === "ephemeral" ? new Connection(getRpcForMode(cluster), "confirmed") : undefined;
    // MagicBlock base-layer txs confirm in seconds or not at all — 30s is plenty.
    // Ephemeral cluster may need longer due to rollup finality.
    const timeoutMs = sendTo === "base" ? 30_000 : 120_000;
    try {
      await waitForSignatureConfirmation(broadcastConn, sig, timeoutMs, 1500, "multiSend", fallbackConn);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // MagicBlock private transfers can land on-chain with a Custom error code (e.g. Custom:1)
      // even though the payment was processed — MagicBlock commits the transfer on HTTP 200
      // and its crank delivers regardless of auxiliary instruction failures.
      // Re-throw only for non-Custom errors (timeout, wrong cluster, etc.).
      if (msg.includes("InstructionError") && msg.includes('"Custom":')) {
        console.warn(`[MultiSend] MagicBlock custom error (non-fatal, payment delivered): ${msg} sig=${sig.slice(0, 12)}…`);
      } else {
        throw e;
      }
    }
    console.info(`[MultiSend] confirmed sig=${sig.slice(0, 12)}… paymentId=${paymentId}`);
    return sig;
  }

  async function executePayment(confirmState: ConfirmFeeData) {
    console.info(`[MultiSend] executePayment paymentIds=${confirmState.paymentIds.join(",")}`);
    const { senderWallet, paymentIds, links } = confirmState;

    try {
      const accessToken = await getAccessToken();
      if (!user?.id) throw new Error("Not authenticated");

      const cluster = networkMode === "mainnet" ? "mainnet" : "devnet";

      type BroadcastResult =
        | { status: "fulfilled"; value: { paymentId: string; sig: string; feeUsdc: number | undefined } }
        | { status: "rejected"; reason: unknown };
      const broadcastResults: BroadcastResult[] = [];

      // Build → sign → broadcast one at a time so each tx uses a fresh blockhash
      // and fresh MagicBlock encrypted-balance state.
      const chain = getPrivySolanaChainForMode(networkMode);
      const wallet = solanaWallets.find((w) => w.address === senderWallet) ?? solanaWallets[0];
      if (!wallet) throw new Error("Loofta wallet not found. Try logging out and back in.");

      console.info(`[MultiSend] building+signing+broadcasting ${paymentIds.length} txs one-by-one cluster=${cluster}`);

      for (const paymentId of paymentIds) {
        try {
          setPhase({ kind: "building" });
          const txData = await buildClaimPrivateTransfer(paymentId, user.id!, senderWallet, accessToken, apiCluster);
          const feeUsdc = txData.feeAmountUsdc ?? 0;

          setPhase({ kind: "broadcasting" });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const signedOutput = await (privySolanaSignTransaction as any)({
            transaction: Buffer.from(txData.transactionBase64, "base64") as Uint8Array,
            wallet,
            chain,
            options: { uiOptions: { showWalletUIs: false } },
          });
          const signedBytes: Uint8Array = signedOutput.signedTransaction;

          const sig = await broadcastAndWaitForHash(signedBytes, paymentId, txData.sendTo, cluster);
          broadcastResults.push({ status: "fulfilled", value: { paymentId, sig, feeUsdc } });
          multiConfirm([paymentId], user.id!, accessToken, sig, feeUsdc).catch(() => { });
        } catch (e) {
          broadcastResults.push({ status: "rejected", reason: e });
        }
      }

      const succeededResults = broadcastResults.filter((r): r is { status: "fulfilled"; value: { paymentId: string; sig: string; feeUsdc: number | undefined } } => r.status === "fulfilled");
      const failedCount = broadcastResults.length - succeededResults.length;

      if (succeededResults.length === 0) {
        const firstErr = (broadcastResults[0] as { status: "rejected"; reason: unknown }).reason;
        throw new Error(firstErr instanceof Error ? firstErr.message : "All payments failed on-chain");
      }

      const confirmedIds = new Set(succeededResults.map((r) => r.value.paymentId));
      const confirmedLinks = links.filter((l) => confirmedIds.has(l.id));
      const confirmedUsdc = succeededResults.reduce((s, r) => {
        const row = confirmState.feeItems.find((f) => f.payment_id === r.value.paymentId);
        return s + (row ? parseFloat(row.amount) : 0);
      }, 0);

      console.info(`[MultiSend] done succeeded=${succeededResults.length} failed=${failedCount}`);
      setCompletedLinks(confirmedLinks as MultiSendLink[]);
      setReviewPending(false);
      if (failedCount === 0) setRows(defaultRows());
      setPhase({
        kind: "done",
        recipientCount: succeededResults.length,
        totalUsdc: confirmedUsdc,
        links: confirmedLinks,
        failedCount,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.info(`[MultiSend] executePayment failed: ${msg}`);
      setPhase({ kind: "error", message: msg, retry: confirmState });
      toast({ variant: "destructive", title: "Multi-send failed", description: msg });
    }
  }

  function handleRequestPayment() {
    if (!authenticated) {
      login({ loginMethods: ["email"], disableSignup: false });
      return;
    }
    if (filledRows.length < 2) {
      toast({ variant: "destructive", title: "At least 2 recipients required", description: "Fill in at least 2 recipients to use multi-send." });
      return;
    }
    setReviewPending(true);
    setPhase({ kind: "review" });
  }

  async function handlePayNow() {
    const senderAddress = deriveSolanaEmbeddedAddress(user);
    const wallet = solanaWallets.find((w) => w.address === senderAddress) ?? solanaWallets[0];
    if (!wallet) {
      toast({ variant: "destructive", title: "No Loofta wallet", description: "Your embedded wallet was not found. Try logging out and back in." });
      return;
    }
    await createPayments(wallet.address);
  }

  // ── Done screen ────────────────────────────────────────────────────────────
  if (phase.kind === "done") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <CheckCircle2 className="text-green-400 w-6 h-6 shrink-0" />
          <p className="text-white text-xl font-semibold">
            {phase.failedCount ? `${phase.recipientCount} of ${phase.recipientCount + phase.failedCount} payments sent` : "All payments sent!"}
          </p>
        </div>
        <p className="text-slate-400 text-base">
          ${phase.totalUsdc.toFixed(2)} USDC sent to {phase.recipientCount} recipient{phase.recipientCount > 1 ? "s" : ""}.
        </p>
        {!!phase.failedCount && (
          <p className="text-amber-400 text-base md:text-sm">
            {phase.failedCount} payment{phase.failedCount > 1 ? "s" : ""} failed to confirm on-chain. The funds were not deducted for those.
          </p>
        )}

        <div className="space-y-2">
          {phase.links.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white text-base font-medium truncate">{item.recipient_identifier}</p>
                  <p className="text-slate-400 text-base md:text-sm">${parseFloat(item.amount).toFixed(2)} USDC</p>
                </div>
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  title="Open payment"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(item.link)}
                className="w-full flex items-center justify-center gap-1.5 text-base md:text-sm text-slate-400 hover:text-white hover:bg-white/10 border border-white/10 rounded-lg py-1.5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy link
              </button>
            </div>
          ))}
        </div>

        <Button
          onClick={() => {
            clear();
            setPhase({ kind: "idle" });
          }}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white font-semibold hover:opacity-90"
        >
          Create a new payment
        </Button>
      </div>
    );
  }

  // ── Review screen (shown for review phase + all settlement sub-phases) ─────
  // reviewPending persists across refresh; the settlement modal opens on top.
  if (reviewPending || phase.kind === "review") {
    const validRows = rows.filter((r) => {
      const n = parseFloat(r.amount);
      return r.recipient.trim().length > 0 && Number.isFinite(n) && n >= MIN_AMOUNT;
    });
    const reviewTotal = validRows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const phaseKind = phase.kind as string;
    const settlementModalOpen = (SETTLEMENT_PHASES as readonly string[]).includes(phaseKind);
    const isBusy = BUSY_PHASES.includes(phaseKind);

    function closeSettlementModal() {
      if (!isBusy) {
        setPhase({ kind: "review" });
      }
    }

    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setReviewPending(false);
              setPhase({ kind: "idle" });
            }}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Back to form"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="text-white text-xl font-semibold">Review Payment</p>
        </div>

        <div className="space-y-1">
          {/* Header */}
          <div className="flex justify-between text-slate-500 text-base px-1 pb-1">
            <span>Recipient</span>
            <span className="flex gap-5 shrink-0">
              <span>Amount</span>
              <span>~Fee</span>
            </span>
          </div>
          {validRows.map((row, idx) => {
            const amt = parseFloat(row.amount);
            const net = Math.round(amt * 1_000_000);
            const mbGross = Math.ceil((net * 10_000) / (10_000 - 10));
            const fee = Math.ceil(((mbGross - net) / 1_000_000 + 0.20) * 100) / 100;
            return (
              <div key={row.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2.5 gap-2">
                <div className="min-w-0">
                  <p className="text-slate-400 text-base md:text-sm">Recipient {idx + 1}</p>
                  <p className="text-white text-base font-medium truncate">
                    {row.recipient.trim().replace(/^@/, "")}
                  </p>
                  {row.message.trim() && (
                    <p className="text-slate-500 text-base md:text-sm truncate">{row.message.trim()}</p>
                  )}
                </div>
                <span className="flex gap-5 text-right shrink-0">
                  <span className="text-white text-base md:text-sm">${amt.toFixed(2)}</span>
                  <span className="text-slate-400 text-base md:text-sm">+${fee.toFixed(2)}</span>
                </span>
              </div>
            );
          })}
          {/* Total row */}
          {(() => {
            const totalFee = validRows.reduce((s, r) => {
              const amt = parseFloat(r.amount);
              const net = Math.round(amt * 1_000_000);
              const mbGross = Math.ceil((net * 10_000) / (10_000 - 10));
              return s + Math.ceil(((mbGross - net) / 1_000_000 + 0.20) * 100) / 100;
            }, 0);
            return (
              <div className="flex justify-between items-center border-t border-white/10 px-3 pt-3 mt-1">
                <span className="text-white font-semibold text-lg">{validRows.length} recipient{validRows.length !== 1 ? "s" : ""}</span>
                <span className="flex gap-5 text-right shrink-0">
                  <span className="text-white font-semibold text-lg">${reviewTotal.toFixed(2)}</span>
                  <span className="text-slate-400 text-base">+${totalFee.toFixed(2)} fees</span>
                </span>
              </div>
            );
          })()}
        </div>

        <p className="text-slate-500 text-base md:text-sm">
          Fees are estimated. Exact breakdown confirmed before payment.
        </p>

        {(() => {
          const totalFees = validRows.reduce((s, r) => {
            const amt = parseFloat(r.amount);
            const net = Math.round(amt * 1_000_000);
            const mbGross = Math.ceil((net * 10_000) / (10_000 - 10));
            return s + Math.ceil(((mbGross - net) / 1_000_000 + 0.20) * 100) / 100;
          }, 0);
          const reviewTotalWithFees = reviewTotal + totalFees;
          const hasEnough = solanaPayment.hasEnoughBalance(reviewTotalWithFees);
          const isBalanceBusy = solanaPayment.isBalanceLoading;
          if (!isBalanceBusy && !hasEnough) {
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5">
                  <svg viewBox="0 0 56 57" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 shrink-0" aria-hidden>
                    <path d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z" fill="#FF4A26" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white text-base">Loofta wallet</div>
                    <div className="text-base md:text-sm text-amber-400 mt-0.5">
                      ${solanaPayment.balanceUSD.toFixed(2)} available — ${reviewTotalWithFees.toFixed(2)} needed (incl. fees)
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("openBalanceModal"))}
                  className="w-full h-12 rounded-xl font-semibold text-base border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
                >
                  Add funds to your balance
                </button>
              </div>
            );
          }
          return (
            <Button
              onClick={handlePayNow}
              disabled={isBalanceBusy}
              className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
            >
              {isBalanceBusy ? "Loading balance…" : "Pay now"}
            </Button>
          );
        })()}

        {/* Settlement modal: creating → building → signing → broadcasting → error */}
        <Dialog
          open={settlementModalOpen}
          onOpenChange={(open) => { if (!open) closeSettlementModal(); }}
        >
          <DialogContent
            className="sm:max-w-sm p-6 border-white/10 bg-[#0f0f12] text-white [&_.text-gray-900]:!text-white [&_.text-muted-foreground]:!text-slate-400 [&_.bg-orange-100]:!bg-orange-500/20 [&_.text-orange-600]:!text-orange-300 [&_.bg-amber-50\/90]:!bg-amber-500/15 [&_.border-amber-200]:!border-amber-400/30 [&_.text-amber-950]:!text-amber-200"
            onPointerDownOutside={(e) => { if (isBusy) e.preventDefault(); }}
            onEscapeKeyDown={(e) => { if (isBusy) e.preventDefault(); }}
            aria-describedby={undefined}
          >
            {/* creating / building / awaiting_signature / broadcasting */}
            {(phase.kind === "creating" || phase.kind === "building" || phase.kind === "awaiting_signature" || phase.kind === "broadcasting") && (
              <>
                <DialogHeader className="flex flex-col items-center justify-center text-center space-y-0 pb-4 sm:text-center" aria-hidden>
                  <div className="mb-4 flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                    </div>
                  </div>
                  <DialogTitle className="text-xl font-semibold text-gray-900 text-center">
                    {(phase.kind === "creating" || phase.kind === "building") && "Preparing payments"}
                    {phase.kind === "awaiting_signature" && "Approve in your wallet"}
                    {phase.kind === "broadcasting" && "Finishing on-chain steps"}
                  </DialogTitle>
                  <p className="pt-2 text-base md:text-sm text-center text-muted-foreground max-w-sm">
                    {(phase.kind === "creating" || phase.kind === "building") &&
                      "Setting up transactions. Please keep this window open."}
                    {phase.kind === "awaiting_signature" && (
                      <>
                        Your wallet may show{" "}
                        <span className="font-medium text-orange-600">
                          {filledRows.length} transaction{filledRows.length === 1 ? "" : "s"}
                        </span>{" "}
                        in one approval. Do not close this tab until you finish signing.
                      </>
                    )}
                    {phase.kind === "broadcasting" &&
                      "Broadcasting to Solana. Confirmations can take a few seconds each."}
                  </p>
                </DialogHeader>
                <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 text-center text-base md:text-sm text-amber-950">
                  Stay on this page until the payment completes.
                </div>
              </>
            )}

            {/* error */}
            {phase.kind === "error" && (
              <>
                <DialogTitle className="text-white text-lg font-semibold mb-1">Payment failed</DialogTitle>
                <p className="text-red-400 text-base md:text-sm pt-2">{phase.message}</p>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="ghost"
                    className="flex-1 text-slate-400 hover:text-white"
                    onClick={() => setPhase({ kind: "review" })}
                  >
                    Back
                  </Button>
                  {phase.retry && (
                    <Button
                      className="flex-1 bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white font-semibold hover:opacity-90"
                      onClick={() => executePayment(phase.retry!)}
                    >
                      Try again
                    </Button>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="text-white text-xl font-semibold">Multi Send</p>
      </div>

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={row.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-base font-medium">Recipient {idx + 1}</span>
              {rows.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                  aria-label="Remove recipient"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div>
              <Label className="text-slate-400 text-base md:text-sm">To (username or email)</Label>
              <Input
                value={row.recipient}
                onChange={(e) => updateRow(row.id, "recipient", e.target.value)}
                placeholder="alice or alice@email.com"
                className="mt-1 h-10 bg-white/5 border-white/10 text-white placeholder:text-slate-500 text-base"
              />
            </div>

            <div>
              <Label className="text-slate-400 text-base md:text-sm">Amount (USD)</Label>
              <Input
                type="number"
                value={row.amount}
                onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                min="5"
                step="1"
                placeholder="100"
                className="mt-1 h-10 bg-white/5 border-white/10 text-white placeholder:text-slate-500 text-base"
              />
              {row.amount && parseFloat(row.amount) > 0 && parseFloat(row.amount) < MIN_AMOUNT && (
                <p className="text-amber-400 text-base md:text-sm mt-0.5">Min $5</p>
              )}
            </div>

            <div>
              <Label className="text-slate-400 text-base md:text-sm">Message (optional)</Label>
              <MessageInput
                value={row.message}
                onChange={(v) => updateRow(row.id, "message", v)}
                gifUrl={row.gif ?? null}
                onGifChange={(url) => updateRow(row.id, "gif", url ?? "")}
                placeholder="Optional note"
                maxLength={500}
                className="mt-1 [&_input]:h-10 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:placeholder:text-slate-500"
              />
            </div>
          </div>
        ))}
      </div>

      {rows.length < 10 && (
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-base md:text-sm font-medium transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Add recipient
        </button>
      )}

      <div className="flex items-center justify-between text-base text-slate-400 border-t border-white/10 pt-3">
        <span>{rows.length} recipient{rows.length > 1 ? "s" : ""}</span>
        <span className="text-white font-medium">${totalUsd.toFixed(2)} total</span>
      </div>

      {filledRows.length === 1 && (
        <p className="text-amber-400 text-base md:text-sm text-center">Multi-send requires at least 2 recipients</p>
      )}

      <Button
        onClick={handleRequestPayment}
        disabled={authenticated && !canReview}
        className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
      >
        {!authenticated ? "Sign in to continue" : "Continue to pay"}
      </Button>

      <p className="text-slate-500 text-base md:text-sm text-center">
        All transfers are private MagicBlock payments. Each recipient gets their own payment link.
      </p>
    </div>
  );
}
