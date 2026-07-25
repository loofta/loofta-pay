"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Connection } from "@solana/web3.js";
import type { ConnectedStandardSolanaWallet, useSignTransaction } from "@privy-io/react-auth/solana";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import {
  pajLinkStatus,
  pajListBanks,
  pajListBankAccounts,
  pajConfirmBankAccount,
  pajSaveBankAccount,
  pajGetValue,
  pajCreateOfframp,
  pajConfirmOfframpSent,
  pajGetOrder,
  PajCashApiError,
  PAJ_TERMINAL_STATUSES,
  type PajCashOrder,
  type PajBank,
  type PajSavedBankAccount,
  type PajResolvedBankAccount,
} from "@/services/pajCash";
import { PajCashLinkFlow } from "./PajCashLinkFlow";
import { PajCashKycStep } from "./PajCashKycStep";
import { BankCombobox } from "./BankCombobox";

type SignTransactionFn = ReturnType<typeof useSignTransaction>["signTransaction"];

type Step =
  | "checking-link" | "link"
  | "bank-select" | "bank-add"
  | "amount" | "kyc"
  | "sending" | "awaiting-payout" | "complete" | "failed";

interface PajCashOfframpViewProps {
  dark: boolean;
  devnetMode: boolean;
  solanaAddress: string | null;
  wallet: ConnectedStandardSolanaWallet | undefined;
  signTransaction: SignTransactionFn;
  userId: string | undefined;
  prefillEmail?: string | null;
  maxAmountUsdc: number;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
  onComplete?: () => void;
}

const POLL_INTERVAL_MS = 5_000;

export function PajCashOfframpView({
  dark, devnetMode, solanaAddress, wallet, signTransaction, userId, prefillEmail,
  maxAmountUsdc, getAccessToken, onBack, onComplete,
}: PajCashOfframpViewProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("checking-link");

  const [savedAccounts, setSavedAccounts] = useState<PajSavedBankAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const [banks, setBanks] = useState<PajBank[]>([]);
  const [bankId, setBankId] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolved, setResolved] = useState<PajResolvedBankAccount | null>(null);
  const [resolving, setResolving] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);

  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<PajCashOrder | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inputClass = `mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`;
  const cardClass = `rounded-xl border-2 p-4 ${dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`;

  const backButton = (onClick: () => void) => (
    <button type="button" onClick={onClick} className={`flex items-center gap-1 text-base font-medium transition-colors ${dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>
      <ChevronLeft className="h-4 w-4" />
      Back
    </button>
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const status = await pajLinkStatus(accessToken);
        if (cancelled) return;
        setStep(status.linked ? "bank-select" : "link");
      } catch {
        if (!cancelled) setStep("link");
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  useEffect(() => {
    if (step !== "bank-select") return;
    let cancelled = false;
    setAccountsLoading(true);
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const accounts = await pajListBankAccounts(accessToken);
        if (!cancelled) setSavedAccounts(accounts);
      } catch {
        // leave empty — user can still add a new one
      } finally {
        if (!cancelled) setAccountsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, getAccessToken]);

  useEffect(() => {
    if (step !== "bank-add" || banks.length > 0) return;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        setBanks(await pajListBanks(accessToken));
      } catch (err: unknown) {
        const msg = err instanceof PajCashApiError ? err.message : "Could not load banks.";
        toast({ variant: "destructive", title: "PAJ Cash", description: msg });
      }
    })();
  }, [step, banks.length, getAccessToken, toast]);

  useEffect(() => {
    const amountNum = parseFloat(amount);
    if (!(amountNum > 0)) { setQuote(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const accessToken = await getAccessToken();
        const q = await pajGetValue("offramp", amountNum, "NGN", accessToken);
        if (!cancelled) setQuote(q.fiatAmount);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [amount, getAccessToken]);

  useEffect(() => {
    if (step !== "awaiting-payout" || !order) return;
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

  const handleResolve = async () => {
    if (!bankId || !accountNumber.trim()) return;
    setResolving(true);
    setResolved(null);
    try {
      const accessToken = await getAccessToken();
      const result = await pajConfirmBankAccount(bankId, accountNumber.trim(), accessToken);
      setResolved(result);
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not resolve this account.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setResolving(false);
    }
  };

  const handleSaveAccount = async () => {
    if (!bankId || !resolved) return;
    setSavingAccount(true);
    try {
      const accessToken = await getAccessToken();
      const bankName = banks.find((b) => b.id === bankId)?.name ?? resolved.bank.name;
      const saved = await pajSaveBankAccount(bankId, bankName, resolved.accountNumber, accessToken);
      setSavedAccounts((prev) => [saved, ...prev]);
      setSelectedAccountId(saved.id);
      setBankId(null);
      setAccountNumber("");
      setResolved(null);
      setStep("bank-select");
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not save this account.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleCreateOrder = async () => {
    const amountNum = parseFloat(amount);
    if (!selectedAccountId || !(amountNum > 0)) return;
    if (amountNum > maxAmountUsdc) {
      toast({ variant: "destructive", title: "Insufficient balance", description: `You have ${maxAmountUsdc.toFixed(6).replace(/\.?0+$/, "")} USDC available.` });
      return;
    }
    if (!solanaAddress || !wallet || !userId) {
      toast({ variant: "destructive", title: "Wallet not ready", description: "Your Loofta wallet is not available. Try refreshing." });
      return;
    }

    setSubmitting(true);
    try {
      const accessToken = await getAccessToken();
      const created = await pajCreateOfframp(selectedAccountId, amountNum, accessToken);
      setOrder(created);
      setStep("sending");

      const mode = devnetMode ? "devnet" : "mainnet";
      const connection = new Connection(getRpcForMode(mode), "confirmed");
      const sig = await sendUsdcWithBackendFeePayer({
        senderAddress: solanaAddress,
        recipientAddress: created.offramp_deposit_address ?? "",
        amountUSDC: Number(created.amount_usdc ?? amountNum),
        connection,
        wallet,
        privyUserId: userId,
        signTransaction,
        usdcMint: getUsdcMintForMode(mode),
        chain: getPrivySolanaChainForMode(mode),
        accessToken,
        network: mode,
      });

      const confirmed = await pajConfirmOfframpSent(created.id, sig, accessToken);
      setOrder(confirmed);
      setStep("awaiting-payout");
    } catch (err: unknown) {
      if (err instanceof PajCashApiError && err.code === "KYC_REQUIRED") {
        setStep("kyc");
        setSubmitting(false);
        return;
      }
      const msg = err instanceof Error ? err.message : "Could not complete withdrawal.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
      setStep("amount");
    } finally {
      setSubmitting(false);
    }
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
        onLinked={() => setStep("bank-select")}
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

  if (step === "bank-select") {
    return (
      <div className="py-2 space-y-3">
        {backButton(onBack)}
        <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Choose a bank account</p>

        {accountsLoading ? (
          <div className="flex justify-center py-4"><Loader2 className={`h-5 w-5 animate-spin ${dark ? "text-slate-400" : "text-gray-400"}`} /></div>
        ) : (
          <div className="space-y-2">
            {savedAccounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => { setSelectedAccountId(acc.id); setStep("amount"); }}
                className={`w-full flex items-center justify-between gap-3 p-4 rounded-xl border-2 text-left transition-all ${dark ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20" : "border-gray-100 bg-white hover:bg-orange-50/40 hover:border-orange-100 shadow-sm"}`}
              >
                <div className="min-w-0">
                  <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{acc.account_name}</p>
                  <p className={`text-base mt-0.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>{acc.bank_name} · {acc.account_number}</p>
                </div>
                <ArrowRight className={`h-4 w-4 shrink-0 ${dark ? "text-slate-500" : "text-gray-300"}`} />
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setStep("bank-add")}
          className={`w-full p-4 rounded-xl border-2 border-dashed text-base font-medium transition-all ${dark ? "border-white/20 text-slate-300 hover:bg-white/5" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
        >
          + Add a bank account
        </button>
      </div>
    );
  }

  if (step === "bank-add") {
    return (
      <div className="py-2 space-y-3">
        {backButton(() => setStep("bank-select"))}
        <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Add a bank account</p>

        <div>
          <Label className={dark ? "text-slate-300" : undefined}>Bank</Label>
          <div className="mt-1">
            <BankCombobox
              dark={dark}
              banks={banks}
              value={bankId}
              onChange={(id) => { setBankId(id); setResolved(null); }}
              disabled={banks.length === 0}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="paj-account-number" className={dark ? "text-slate-300" : undefined}>Account number</Label>
          <Input
            id="paj-account-number"
            inputMode="numeric"
            placeholder="0123456789"
            value={accountNumber}
            onChange={(e) => { setAccountNumber(e.target.value); setResolved(null); }}
            className={inputClass}
          />
        </div>

        {resolved ? (
          <div className={cardClass}>
            <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Account holder</p>
            <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{resolved.accountName}</p>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={handleResolve}
            disabled={resolving || !bankId || !accountNumber.trim()}
            className="w-full"
          >
            {resolving ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Looking up account…</span>
            ) : "Look up account"}
          </Button>
        )}

        {resolved && (
          <Button
            onClick={handleSaveAccount}
            disabled={savingAccount}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
          >
            {savingAccount ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Saving…</span>
            ) : "Save this account"}
          </Button>
        )}
      </div>
    );
  }

  if (step === "amount") {
    return (
      <div className="py-2 space-y-3">
        {backButton(() => setStep("bank-select"))}
        <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>Withdraw to Naira</p>

        <div>
          <Label htmlFor="paj-offramp-amount" className={dark ? "text-slate-300" : undefined}>Amount (USDC)</Label>
          <Input
            id="paj-offramp-amount"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
          {quoteLoading ? (
            <p className={`text-base mt-1.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>Getting quote…</p>
          ) : quote !== null ? (
            <p className={`text-base mt-1.5 ${dark ? "text-slate-400" : "text-gray-500"}`}>≈ ₦{quote.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          ) : null}
        </div>

        <Button
          onClick={handleCreateOrder}
          disabled={submitting || !(parseFloat(amount) > 0)}
          className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
        >
          {submitting ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Processing…</span>
          ) : "Withdraw"}
        </Button>
      </div>
    );
  }

  if (step === "sending" || step === "awaiting-payout" || step === "complete" || step === "failed") {
    return (
      <div className="py-2 space-y-3">
        {backButton(onBack)}
        {step === "complete" && order ? (
          <div className={cardClass}>
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-base font-semibold">Withdrawal complete</p>
            </div>
            <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>₦{Number(order.fiat_amount).toLocaleString()} sent to your bank account.</p>
          </div>
        ) : step === "failed" && order ? (
          <div className={cardClass}>
            <div className="flex items-center gap-2 text-red-400 mb-1">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-base font-semibold">Withdrawal did not complete</p>
            </div>
            <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>Status: {order.status}. Contact support — your USDC send is on-chain and traceable.</p>
          </div>
        ) : (
          <div className={cardClass}>
            <p className={`text-base flex items-center gap-2 ${dark ? "text-slate-300" : "text-gray-700"}`}>
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              {step === "sending" ? "Sending USDC…" : "Waiting for payout to your bank account…"}
            </p>
          </div>
        )}
      </div>
    );
  }

  return null;
}
