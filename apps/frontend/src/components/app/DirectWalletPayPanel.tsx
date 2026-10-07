"use client";

/**
 * Connect-wallet + pay panel for sending straight to a Solana wallet address — no claim, no
 * burner, no /c/[id] involved at all. The recipient already has a wallet, so there's nothing to
 * claim; money either lands in their wallet directly (public) or via MagicBlock's public Payments
 * API (private), both signed and broadcast from the payer's own connected wallet. Originally built
 * for /fomo's PayCard (paying a resolved fomo.family username's wallet) and extracted here so
 * home-v3's "pay a raw wallet address" mode can reuse the exact same flow instead of duplicating
 * it. Must render inside SolanaWalletConnectProvider.
 */

import { useState } from "react";
import Link from "next/link";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, Check, ExternalLink, ArrowRight, Wallet, VenetianMask } from "lucide-react";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import {
  useWallet as useSolanaWalletAdapter,
  WalletMultiButton,
} from "@/components/SolanaWalletConnect";
import { buildUSDCTransferTransaction, sendSignedUSDCTransfer } from "@/services/solanaTransfer";
import { buildMagicBlockPrivateTransferNoFee, totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { getSolanaHttpRpc, getSolanaCluster, isNonMainnetCluster } from "@/lib/solanaCluster";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { formatDelayDuration } from "@/lib/privacyDelay";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";
const easeBrand = [0.16, 1, 0.3, 1] as const;
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111114]";

export function explorerTxUrl(sig: string): string {
  const cluster = getSolanaCluster();
  const suffix = isNonMainnetCluster() ? `?cluster=${cluster}` : "";
  return `https://solscan.io/tx/${sig}${suffix}`;
}

/** What to promise after a private send — built from the settings the payment actually went out
 *  with (MagicBlock's transfer endpoint has no documented max delay, so there's no single ceiling
 *  to quote instead; see @/lib/privacyDelay). */
export function privateDeliveryCopy(split: number, delayMs: number): string {
  const parts = split > 1 ? `${split} parts` : null;
  const window = delayMs > 0 ? formatDelayDuration(delayMs).replace(/^up to /, "") : null;
  if (parts && window) return `Arriving in ${parts} over the next ${window}.`;
  if (parts) return `Arriving in ${parts}, all within moments.`;
  if (window) return `Arriving within ${window}.`;
  return "On its way now.";
}

export function isUserRejection(message: unknown): boolean {
  return typeof message === "string" && /reject|cancel|denied|declined/i.test(message);
}

export type PayStatus = "idle" | "building" | "awaiting_signature" | "broadcasting" | "done";

const STATUS_STEPS: { key: PayStatus; label: string }[] = [
  { key: "building", label: "Preparing" },
  { key: "awaiting_signature", label: "Confirm in wallet" },
  { key: "broadcasting", label: "Sending" },
];

export function DirectWalletPayPanel({
  amountUsd,
  recipientAddress,
  recipientName,
  blocker,
  isPrivate,
  split,
  maxDelayMs,
  onReset,
}: {
  amountUsd: number;
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
    console.log("[DirectWalletPayPanel] paying", {
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
      await waitForSignatureConfirmation(connection, signature, 60_000, 1500, "directWalletPay");
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
