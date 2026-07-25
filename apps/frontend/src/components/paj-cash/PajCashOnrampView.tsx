"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Copy, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  pajLinkStatus,
  pajGetValue,
  pajCreateOnramp,
  pajGetOrder,
  PajCashApiError,
  PAJ_TERMINAL_STATUSES,
  type PajCashOrder,
} from "@/services/pajCash";
import { PajCashLinkFlow } from "./PajCashLinkFlow";
import { PajCashKycStep } from "./PajCashKycStep";
import { AmountInput } from "@/components/AmountInput";

type Step = "checking-link" | "link" | "amount" | "kyc" | "instructions" | "complete" | "failed";

interface PajCashOnrampViewProps {
  dark: boolean;
  prefillEmail?: string | null;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
  onComplete?: () => void;
}

const POLL_INTERVAL_MS = 5_000;

export function PajCashOnrampView({ dark, prefillEmail, getAccessToken, onBack, onComplete }: PajCashOnrampViewProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("checking-link");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<PajCashOrder | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cardClass = `rounded-xl border-2 p-4 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const status = await pajLinkStatus(accessToken);
        if (cancelled) return;
        setStep(status.linked ? "amount" : "link");
      } catch {
        if (!cancelled) setStep("link");
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  // Live quote as the user types
  useEffect(() => {
    const amountNum = parseFloat(amount);
    if (!(amountNum > 0)) { setQuote(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const accessToken = await getAccessToken();
        const q = await pajGetValue("onramp", amountNum, "NGN", accessToken);
        if (!cancelled) setQuote(q.amount);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [amount, getAccessToken]);

  // Poll the order until terminal
  useEffect(() => {
    if (step !== "instructions" || !order) return;
    const poll = async () => {
      try {
        const accessToken = await getAccessToken();
        const updated = await pajGetOrder(order.id, accessToken);
        setOrder(updated);
        if (updated.status === "COMPLETE") {
          setStep("complete");
          onComplete?.();
        } else if (PAJ_TERMINAL_STATUSES.includes(updated.status)) {
          setStep("failed");
        }
      } catch {
        // transient — retried next tick
      }
    };
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, order, getAccessToken, onComplete]);

  const handleCreateOrder = async () => {
    const amountNum = parseFloat(amount);
    if (!(amountNum > 0)) return;
    setSubmitting(true);
    try {
      const accessToken = await getAccessToken();
      const created = await pajCreateOnramp(amountNum, accessToken);
      setOrder(created);
      setStep("instructions");
    } catch (err: unknown) {
      if (err instanceof PajCashApiError && err.code === "KYC_REQUIRED") {
        setStep("kyc");
        return;
      }
      const msg = err instanceof PajCashApiError ? err.message : "Could not create order.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!" });
  };

  if (step === "checking-link") {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className={`h-5 w-5 animate-spin ${dark ? "text-slate-400" : "text-gray-400"}`} />
      </div>
    );
  }

  if (step === "link") {
    return (
      <PajCashLinkFlow
        dark={dark}
        prefillEmail={prefillEmail}
        getAccessToken={getAccessToken}
        onBack={onBack}
        onLinked={() => setStep("amount")}
      />
    );
  }

  if (step === "kyc") {
    return (
      <PajCashKycStep
        dark={dark}
        getAccessToken={getAccessToken}
        onBack={() => setStep("amount")}
        onSubmitted={() => { toast({ title: "Verification submitted" }); handleCreateOrder(); }}
      />
    );
  }

  if (step === "amount") {
    return (
      <div className="py-2 space-y-3">
        <button type="button" onClick={onBack} className={`flex items-center gap-1 text-base font-medium transition-colors ${dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Top up with Naira</p>

        <div>
          <Label htmlFor="paj-onramp-amount" className={dark ? "text-slate-300" : undefined}>Amount (NGN)</Label>
          <AmountInput
            id="paj-onramp-amount"
            dark={dark}
            value={amount}
            onChange={setAmount}
            maxDecimals={2}
            prefix="₦"
            className="mt-1"
          />
          {quoteLoading ? (
            <p className={`text-base mt-1.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>Getting quote…</p>
          ) : quote !== null ? (
            <p className={`text-base mt-1.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>≈ {quote.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC</p>
          ) : null}
        </div>

        <Button
          onClick={handleCreateOrder}
          disabled={submitting || !(parseFloat(amount) > 0)}
          className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
        >
          {submitting ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Creating order…</span>
          ) : "Continue"}
        </Button>
      </div>
    );
  }

  if ((step === "instructions" || step === "complete" || step === "failed") && order) {
    return (
      <div className="py-2 space-y-3">
        <button type="button" onClick={onBack} className={`flex items-center gap-1 text-base font-medium transition-colors ${dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        {step === "complete" ? (
          <div className={cardClass}>
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-base font-semibold">Top-up complete</p>
            </div>
            <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Your balance has been updated.</p>
          </div>
        ) : step === "failed" ? (
          <div className={cardClass}>
            <div className="flex items-center gap-2 text-red-400 mb-1">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-base font-semibold">Order did not complete</p>
            </div>
            <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Status: {order.status}. Contact support if you already sent payment.</p>
          </div>
        ) : (
          <>
            <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Send this amount to complete your top-up</p>
            <div className={cardClass}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Amount</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>₦{Number(order.fiat_amount).toLocaleString()}</span>
                    <button type="button" onClick={() => copy(String(order.fiat_amount))} className={dark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-700"}><Copy className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Bank</span>
                  <span className={`font-mono text-base ${dark ? "text-white" : "text-gray-900"}`}>{order.onramp_bank_name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Account number</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-base ${dark ? "text-white" : "text-gray-900"}`}>{order.onramp_account_number}</span>
                    <button type="button" onClick={() => copy(order.onramp_account_number ?? "")} className={dark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-700"}><Copy className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Account name</span>
                  <span className={`font-mono text-base ${dark ? "text-white" : "text-gray-900"}`}>{order.onramp_account_name}</span>
                </div>
              </div>
            </div>
            <p className={`text-base flex items-center gap-2 ${dark ? "text-slate-500" : "text-gray-400"}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              Waiting for payment. This updates automatically once received.
            </p>
          </>
        )}
      </div>
    );
  }

  return null;
}
