"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useToast } from "@/components/ui/use-toast";
import { dealsApi, type DealPaymentResponse } from "@/services/api/deals";
import { tokensApi, type Token } from "@/services/api/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { roundUpDecimals, formatUTCTimestamp } from "@/lib/format";
import { PaymentStatusTracker } from "@/components/PaymentStatusTracker";
import { TokenIcon } from "@/components/TokenIcon";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { getRefundToForChain, isValidAddressForChain } from "@/lib/refundAddresses";
import { Input } from "@/components/ui/input";
import { usePayrollPayStore } from "@/store/payrollPay";
import { Loader2, ArrowLeft, Send, FileText, QrCode, ExternalLink, CheckCircle2, ShieldCheck } from "lucide-react";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import type { NearToken } from "@/services/nearIntents";

/** Flow: Pay → select token (see conversion) → Get deposit address → NEAR Intent deposit + PaymentStatusTracker. Cancel to choose another token. State persists in Zustand on refresh. */
export default function PayrollPayPaymentPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.orgId as string;
  const paymentId = params?.paymentId as string;
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const stored = usePayrollPayStore((s) => s.byPaymentId[paymentId]);

  const [payment, setPayment] = useState<DealPaymentResponse | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [payWithToken, setPayWithTokenState] = useState<TokenSelection | undefined>(stored?.payWithToken ?? undefined);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [status, setStatusState] = useState<string | null>(stored?.status ?? null);
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);
  const [depositFromPrepare, setDepositFromPrepareState] = useState<{
    depositAddress: string;
    minAmountInFormatted?: string;
    timeEstimate?: number;
    memo?: string | null;
    deadline?: string | null;
  } | null>(stored?.deposit ?? null);
  const [depositView, setDepositView] = useState<"details" | "qr">("details");
  const [refundAddress, setRefundAddress] = useState("");
  const [refundAddressError, setRefundAddressError] = useState<string | null>(null);
  const [retryReceiptLoading, setRetryReceiptLoading] = useState(false);
  const retryReceiptDone = useRef(false);

  const setPayWithToken = (v: TokenSelection | undefined) => {
    setPayWithTokenState(v);
    if (paymentId) usePayrollPayStore.getState().setPayWithToken(paymentId, v ?? null);
  };
  const setStatus = (v: string | null) => {
    setStatusState(v);
    if (paymentId) usePayrollPayStore.getState().setStatus(paymentId, v);
  };
  const setDepositFromPrepare = (v: typeof depositFromPrepare) => {
    setDepositFromPrepareState(v);
    if (paymentId) usePayrollPayStore.getState().setDeposit(paymentId, v ?? null);
  };

  const depositAddress =
    depositFromPrepare?.depositAddress ?? payment?.deposit_address ?? undefined;
  /** Receipt hash from API or persisted store (so retry receipt stays visible without refetch). */
  const displayReceiptHash = payment?.receipt_on_chain_tx_hash ?? stored?.receipt_on_chain_tx_hash ?? undefined;
  /** Only show deposit/status UI after user clicked "Get deposit address" on this page (so they always pick token first). */
  const showDepositUI = !!depositFromPrepare?.depositAddress;
  const amountToSend =
    depositFromPrepare?.minAmountInFormatted ?? quote?.amountInFormatted;
  /** Fallback when backend/quote didn't return formatted amount: derive from payment USD and token price. */
  const fallbackAmountFormatted = useMemo(() => {
    if (amountToSend || !payment || !payWithToken) return null;
    const amountUsd = Number(payment.amount || 0);
    const token = tokens.find(
      (t) =>
        (t.symbol || "").toLowerCase() === (payWithToken?.symbol || "").toLowerCase() &&
        (t.chain || "").toLowerCase() === (payWithToken?.chain || "").toLowerCase()
    );
    const price = token?.price;
    if (price && Number(price) > 0 && Number.isFinite(amountUsd)) {
      return String((amountUsd / Number(price)).toFixed(6));
    }
    return null;
  }, [amountToSend, payment?.amount, payment?.id, payWithToken, tokens]);
  const displayAmount = amountToSend ?? fallbackAmountFormatted;
  const timeEstimate = depositFromPrepare?.timeEstimate ?? undefined;
  const memo = depositFromPrepare?.memo ?? undefined;
  const deadline = depositFromPrepare?.deadline ?? payment?.intent_deadline ?? undefined;

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      dealsApi.payments.listOutstanding(orgId, userId),
      tokensApi.list().then((r) => r.tokens || []),
    ])
      .then(([payments, tokenList]) => {
        if (cancelled) return;
        const p = (payments || []).find((x) => x.id === paymentId);
        if (p) {
          setPayment(p);
          setTokens(tokenList);
        } else {
          setTokens(tokenList);
          dealsApi.payments.get(orgId, paymentId, userId).then((single) => {
            if (!cancelled && single) {
              const storedReceipt = usePayrollPayStore.getState().byPaymentId[paymentId]?.receipt_on_chain_tx_hash;
              setPayment((prev) => ({
                ...single,
                recipient_email: single.recipient_email ?? prev?.recipient_email ?? undefined,
                receipt_on_chain_tx_hash: single.receipt_on_chain_tx_hash ?? prev?.receipt_on_chain_tx_hash ?? storedReceipt ?? undefined,
              }));
            } else if (!cancelled) setPayment(null);
          }).catch(() => {
            if (!cancelled) setPayment(null);
          });
        }
      })
      .catch(() => {
        if (!cancelled) setPayment(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, orgId, paymentId]);

  /** Only stablecoins for payroll pay-with selection */
  const STABLECOIN_SYMBOLS = ["USDC", "USDT", "DAI"];
  const payWithTokens = useMemo(
    () =>
      tokens.filter((t) =>
        STABLECOIN_SYMBOLS.includes((t.symbol || "").toUpperCase())
      ),
    [tokens]
  );

  const destToken = useMemo(() => {
    if (!payment || !tokens.length) return null;
    const sym = (payment.preferred_token_symbol || "USDC").toUpperCase();
    const ch = (payment.preferred_network || "base").toLowerCase();
    return (
      tokens.find(
        (t) =>
          (t.symbol || "").toUpperCase() === sym &&
          (t.chain || "").toLowerCase() === ch
      ) ?? null
    );
  }, [payment, tokens]);

  useEffect(() => {
    if (!payment || !payWithToken || !destToken) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    const payWithTokenResolved = tokens.find(
      (t) =>
        (t.symbol || "").toLowerCase() === (payWithToken?.symbol || "").toLowerCase() &&
        (t.chain || "").toLowerCase() === (payWithToken?.chain || "").toLowerCase()
    );
    const fromTokenId = payWithToken.tokenId ?? payWithTokenResolved?.tokenId ?? payWithTokenResolved?.address;
    if (!fromTokenId || !destToken.tokenId) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    setQuote(null);
    const amountUsd = Number(payment.amount || 0);
    fetch("/api/payroll/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountUsd,
        fromToken: {
          tokenId: fromTokenId,
          decimals: payWithToken.decimals ?? payWithTokenResolved?.decimals,
          chain: payWithToken.chain,
          price: payWithTokenResolved?.price,
        },
        destToken: {
          tokenId: destToken.tokenId || destToken.address,
          decimals: destToken.decimals,
          chain: destToken.chain,
          price: destToken.price,
        },
        fromTokenPriceUSD: payWithTokenResolved?.price,
        destTokenPriceUSD: destToken.price,
        refundAddress: refundAddress.trim() && isValidAddressForChain(refundAddress.trim(), payWithToken.chain)
          ? refundAddress.trim()
          : getRefundToForChain(payWithToken.chain),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const formatted =
          data?.amountInFormatted ??
          (data?.amountInEst != null && Number.isFinite(Number(data.amountInEst))
            ? String(Number(data.amountInEst).toFixed(6))
            : undefined);
        if (formatted) setQuote({ amountInFormatted: formatted });
      })
      .catch(() => setQuote(null))
      .finally(() => setQuoteLoading(false));
  }, [payment?.id, payment?.amount, payWithToken?.tokenId, payWithToken?.decimals, payWithToken?.chain, payWithToken?.symbol, destToken?.tokenId, destToken?.decimals, destToken?.price, tokens, refundAddress]);

  const statusQuery = useQuery({
    queryKey: ["status", depositAddress],
    enabled: !!depositFromPrepare?.depositAddress && !!depositAddress,
    queryFn: async ({ queryKey }) => {
      const addr = queryKey[1] as string;
      if (!addr) throw new Error("No deposit address");
      const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(addr)}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Failed to load status");
      return (await r.json()) as Record<string, unknown>;
    },
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const s = query?.state?.data?.status as string | undefined;
      const terminal =
        s && ["SUCCESS", "FAILED", "REFUNDED", "EXPIRED"].includes(String(s).toUpperCase());
      return terminal ? false : 15_000;
    },
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    const s =
      (statusQuery.data?.status as string) ||
      (statusQuery.data?.executionStatus as string) ||
      null;
    if (s) {
      setStatus(s);
      setStatusData(statusQuery.data);
    }
  }, [statusQuery.data]);

  // Hydrate from Zustand after persist rehydration (e.g. on refresh)
  useEffect(() => {
    if (!stored) return;
    if (stored.deposit) setDepositFromPrepareState(stored.deposit);
    if (stored.payWithToken) setPayWithTokenState(stored.payWithToken);
    if (stored.status != null) setStatusState(stored.status);
  }, [paymentId, stored?.deposit, stored?.payWithToken, stored?.status]);

  useEffect(() => {
    const upper = status ? String(status).toUpperCase() : "";
    if (upper === "SUCCESS" && payment?.id && userId && orgId) {
      dealsApi.payments
        .checkComplete(orgId, payment.id, userId)
        .then((res) => {
          if (res.completed && res.payment) {
            setPayment((prev) => ({
              ...res.payment!,
              recipient_email: res.payment!.recipient_email ?? prev?.recipient_email ?? undefined,
              receipt_on_chain_tx_hash: res.payment!.receipt_on_chain_tx_hash ?? prev?.receipt_on_chain_tx_hash ?? undefined,
            }));
            dealsApi.payments.retryReceipt(orgId, payment.id, userId).catch(() => { });
          }
        })
        .catch(() => { });
    }
  }, [status, payment?.id, userId, orgId]);

  // When viewing a completed payment, retry attestation/receipt once so it gets posted if it failed before
  useEffect(() => {
    if (!payment?.id || payment.status !== "completed" || !userId || !orgId || retryReceiptDone.current) return;
    retryReceiptDone.current = true;
    dealsApi.payments
      .checkComplete(orgId, payment.id, userId)
      .then((res) => {
        if (res.payment) {
          setPayment((prev) => ({
            ...res.payment!,
            recipient_email: res.payment!.recipient_email ?? prev?.recipient_email ?? undefined,
            receipt_on_chain_tx_hash: res.payment!.receipt_on_chain_tx_hash ?? prev?.receipt_on_chain_tx_hash ?? undefined,
          }));
        }
      })
      .catch(() => { });
    dealsApi.payments
      .retryReceipt(orgId, payment.id, userId)
      .then((r) => {
        if (r.receiptPosted && r.receiptOnChainTxHash) {
          const hash = r.receiptOnChainTxHash ?? undefined;
          if (paymentId) usePayrollPayStore.getState().setReceiptOnChainTxHash(paymentId, hash ?? null);
          setPayment((prev) => (prev ? { ...prev, receipt_on_chain_tx_hash: hash } : null));
        }
      })
      .catch(() => { });
  }, [payment?.id, payment?.status, userId, orgId, paymentId]);

  const handlePrepare = async () => {
    if (!userId || !orgId || !payment || !payWithToken?.symbol || !payWithToken?.chain) {
      toast({
        variant: "destructive",
        title: "Choose a token",
        description: "Select a token to pay with.",
      });
      return;
    }
    const refundTrimmed = refundAddress.trim();
    if (refundTrimmed && !isValidAddressForChain(refundTrimmed, payWithToken.chain)) {
      setRefundAddressError(`Address format doesn't match ${payWithToken.chain}. Use a valid ${payWithToken.chain} address.`);
      toast({
        variant: "destructive",
        title: "Invalid refund address",
        description: `Must be a valid address for ${payWithToken.chain}.`,
      });
      return;
    }
    setRefundAddressError(null);
    setPreparing(true);
    try {
      const result = await dealsApi.payments.preparePay(
        orgId,
        [payment.id],
        userId,
        payWithToken,
        refundTrimmed || undefined
      );
      const first = result?.[0];
      if (!first?.deposit_address) {
        toast({
          variant: "destructive",
          title: "Could not prepare",
          description: "This token may not be supported. Try another.",
        });
        return;
      }
      setDepositFromPrepare({
        depositAddress: first.deposit_address,
        minAmountInFormatted: first.minAmountInFormatted,
        timeEstimate: first.timeEstimate,
        memo: first.memo ?? undefined,
        deadline: first.intent_deadline ?? undefined,
      });
      setPayment((prev) => ({ ...first, recipient_email: first.recipient_email ?? prev?.recipient_email ?? undefined }));
      toast({
        title: "Deposit address ready",
        description: "Send the exact amount to the address below.",
      });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Failed",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setPreparing(false);
    }
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-gray-600">Payment not found.</p>
        <Link href={`/payroll/${orgId}/pay`}>
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Pay
          </Button>
        </Link>
      </div>
    );
  }

  const upperStatus = String(status || "PENDING_DEPOSIT").toUpperCase();
  const isProcessing = upperStatus === "PROCESSING" || upperStatus === "KNOWN_DEPOSIT_TX";
  const isSuccess = upperStatus === "SUCCESS";
  const depositReceived = isProcessing || isSuccess;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/payroll/${orgId}/pay`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Pay
          </Link>
        </Button>
      </div>

      <div className="rounded-xl border-2 border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-2 text-base text-gray-600">Amount requested</div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-semibold text-gray-900">{payment.amount}</span>
          <span className="text-lg text-gray-500">{payment.amount_currency}</span>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Recipient email: {payment.recipient_email || "—"}
        </p>

        {payment.status === "completed" ? (
          <div className="mt-6 space-y-6">
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="font-medium">Payment completed</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {(depositFromPrepare?.depositAddress ?? payment.deposit_address) && (payment.preferred_network?.toLowerCase() === "near") && (
                <a
                  href={`https://explorer.near-intents.org/transactions/${depositFromPrepare?.depositAddress ?? payment.deposit_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700"
                >
                  View on NEAR Intents explorer <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                On-chain attestation (receipt)
              </div>
              {displayReceiptHash ? (
                <p className="mt-2 text-sm text-gray-600">
                  A hash commitment for this payment was recorded on NEAR. The receipt contract stores only a commitment (no amounts or recipient on-chain).
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-gray-600">
                    Receipt not yet recorded on-chain. Deal payments need the backend receipt logger configured (PAYROLL_RECEIPT_LOGGER_*). You can retry below; if it still fails, check that the receipt logger contract and keys are set for the same network as your payment.
                  </p>
                  {userId && orgId && payment.id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={retryReceiptLoading}
                      onClick={async () => {
                        if (!userId || !orgId || !payment.id) return;
                        setRetryReceiptLoading(true);
                        try {
                          const r = await dealsApi.payments.retryReceipt(orgId, payment.id, userId);
                          if (r.receiptPosted && r.receiptOnChainTxHash) {
                            const hash = r.receiptOnChainTxHash ?? undefined;
                            usePayrollPayStore.getState().setReceiptOnChainTxHash(paymentId, hash ?? null);
                            setPayment((prev) => (prev ? { ...prev, receipt_on_chain_tx_hash: hash } : null));
                            toast({ title: "Receipt recorded", description: "On-chain receipt was posted." });
                          } else {
                            const updated = await dealsApi.payments.get(orgId, payment.id, userId);
                            if (updated) setPayment(updated);
                            const errMsg = r.error;
                            const hint = errMsg?.toLowerCase().includes("allowed caller")
                              ? " Set the contract allowed_caller to your backend account (e.g. loofta-backend.lisabey.near) via set_allowed_caller."
                              : "";
                            toast({
                              variant: "destructive",
                              title: "Receipt not posted",
                              description: errMsg ? `${errMsg}${hint}` : "Receipt may require PAYROLL_RECEIPT_LOGGER_* in backend.",
                            });
                          }
                        } catch {
                          toast({ variant: "destructive", title: "Retry failed", description: "Could not post receipt." });
                        } finally {
                          setRetryReceiptLoading(false);
                        }
                      }}
                    >
                      {retryReceiptLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Retry receipt
                    </Button>
                  )}
                </>
              )}
              {displayReceiptHash && !displayReceiptHash.startsWith("on-chain:") && displayReceiptHash.length > 20 && (
                <a
                  href={getExplorerTxUrl("near", displayReceiptHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700"
                >
                  View receipt on NEAR <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ) : !showDepositUI ? (
          <>
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium text-gray-700">Pay with</div>
              <TokenCombobox
                tokens={payWithTokens as NearToken[]}
                value={payWithToken}
                onChange={setPayWithToken}
                placeholder="Select token (USDC, USDT, DAI)"
                onQuery={async (q) => {
                  const qq = (q || "").toLowerCase();
                  return payWithTokens.filter(
                    (t) =>
                      (t.symbol || "").toLowerCase().includes(qq) ||
                      (t.name || "").toLowerCase().includes(qq)
                  ) as NearToken[];
                }}
                defaultShowAllChains={true}
                className="h-12 w-full rounded-lg border border-gray-200 bg-white text-base hover:bg-gray-50 focus:border-orange-400 focus:ring-2 focus:ring-orange-400"
              />
            </div>
            {payWithToken && (
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Refund address (optional)
                </label>
                <Input
                  placeholder={`Where to refund if payment fails (${payWithToken.chain} address)`}
                  value={refundAddress}
                  onChange={(e) => {
                    setRefundAddress(e.target.value);
                    if (refundAddressError) setRefundAddressError(null);
                  }}
                  className={`h-11 rounded-lg border bg-white font-mono text-sm placeholder:text-gray-400 ${refundAddressError ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-gray-200 focus:border-orange-400 focus:ring-orange-400"
                    }`}
                />
                {refundAddressError && (
                  <p className="mt-1 text-xs text-red-600">{refundAddressError}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  If the payment cannot be completed, funds will be sent back to this address on {payWithToken.chain}.
                </p>
              </div>
            )}
            {payWithToken && (quoteLoading || quote?.amountInFormatted) && (
              <p className="mt-2 text-sm text-gray-600">
                Send approx:{" "}
                <span className="font-medium">
                  {quoteLoading
                    ? "…"
                    : quote?.amountInFormatted
                      ? `${roundUpDecimals(quote.amountInFormatted, 6)} ${payWithToken.symbol}`
                      : "—"}
                </span>
              </p>
            )}
            <div className="mt-6">
              <Button
                size="lg"
                className="w-full bg-orange-500 text-white hover:bg-orange-600"
                onClick={handlePrepare}
                disabled={!payWithToken?.symbol || preparing}
              >
                {preparing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Get deposit address
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Toggle: Details (amount + address) or Scan QR */}
            <div className="mb-4 mt-6 flex rounded-lg border border-gray-200 bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setDepositView("details")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors ${depositView === "details"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                  }`}
              >
                <FileText className="h-4 w-4" />
                Details
              </button>
              <button
                type="button"
                onClick={() => setDepositView("qr")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors ${depositView === "qr"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                  }`}
              >
                <QrCode className="h-4 w-4" />
                Scan QR code
              </button>
            </div>

            {depositView === "details" && (
              <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="space-y-2 text-base text-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Amount to pay</span>
                    <span className="inline-flex items-center gap-2 text-lg font-medium text-gray-900">
                      <TokenIcon
                        token={payWithToken as { symbol?: string; chain?: string }}
                        chain={payWithToken?.chain}
                        size={24}
                      />
                      <span>
                        {displayAmount && payWithToken
                          ? `${roundUpDecimals(displayAmount, 6)} ${payWithToken.symbol}`
                          : payWithToken
                            ? "—"
                            : payment
                              ? `${payment.amount} ${payment.amount_currency}`
                              : "—"}
                      </span>
                      <button
                        type="button"
                        className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        onClick={async () => {
                          try {
                            const v =
                              displayAmount && payWithToken
                                ? roundUpDecimals(displayAmount, 6)
                                : "";
                            if (v) await navigator.clipboard.writeText(v);
                            toast({ title: "Copied", description: "Amount copied." });
                          } catch {
                            toast({
                              variant: "destructive",
                              title: "Copy failed",
                              description: "Could not copy amount.",
                            });
                          }
                        }}
                        title="Copy amount"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                        </svg>
                      </button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Deposit address</span>
                    <span className="inline-flex max-w-[70%] items-center gap-2 break-all text-sm font-medium text-gray-900">
                      {depositAddress}
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        onClick={async () => {
                          try {
                            if (depositAddress)
                              await navigator.clipboard.writeText(depositAddress);
                            toast({ title: "Copied", description: "Address copied." });
                          } catch {
                            toast({
                              variant: "destructive",
                              title: "Copy failed",
                              description: "Could not copy address.",
                            });
                          }
                        }}
                        title="Copy address"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                        </svg>
                      </button>
                    </span>
                  </div>
                  {(depositAddress && (payment?.preferred_network?.toLowerCase() === "near" || payWithToken?.chain?.toLowerCase() === "near")) && (
                    <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
                      <span className="text-gray-600">Transaction</span>
                      <a
                        href={`https://explorer.near-intents.org/transactions/${depositAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700"
                      >
                        View in explorer <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {depositView === "qr" && (
              <div className="mb-6 flex justify-center">
                <QRCodeSVG
                  value={depositAddress || ""}
                  size={220}
                  level="M"
                  includeMargin
                  fgColor="#000000"
                  bgColor="#ffffff"
                  className="rounded-xl border-2 border-gray-200 bg-white p-4 shadow-sm"
                />
              </div>
            )}

            {memo ? (
              <div className="mb-4 border-t border-gray-200 pt-2 text-sm text-gray-600">
                <span className="font-medium text-gray-700">Memo:</span>{" "}
                <span className="font-mono">{memo}</span>
              </div>
            ) : null}

            <div className="mb-6 text-center">
              <div className="mb-4 flex justify-center">
                {isSuccess ? (
                  <span className="text-6xl">🎉</span>
                ) : isProcessing ? (
                  <span className="text-6xl">⚡</span>
                ) : (
                  <span className="text-6xl">💳</span>
                )}
              </div>
              <h3 className="mb-2 text-2xl font-semibold text-gray-900">
                {isSuccess
                  ? "Payment Complete! 🎉"
                  : isProcessing
                    ? "Processing Your Payment"
                    : "Waiting for Deposit"}
              </h3>
              <p className="text-base text-gray-600">
                {isSuccess
                  ? "Your funds have been successfully sent to the recipient."
                  : isProcessing
                    ? "Finding the best route and preparing transfer"
                    : "Send the exact amount to the deposit address above."}
              </p>
            </div>

            <div className="mb-6">
              <PaymentStatusTracker
                status={status || "PENDING_DEPOSIT"}
                statusData={statusData}
                depositReceivedAt={statusData?.updatedAt as string | undefined}
                startedAt={deadline}
                fromChain={payWithToken?.chain}
                toChain={payment.preferred_network}
                depositAddress={depositAddress}
                timeEstimate={timeEstimate}
                paymentType="near-intent"
              />
            </div>

            {deadline ? (
              <div className="mt-3 text-sm text-gray-700">
                Deadline:{" "}
                <span className="font-medium">{formatUTCTimestamp(deadline)}</span>
              </div>
            ) : null}

            {!depositReceived && (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    usePayrollPayStore.getState().clearDeposit(paymentId);
                    setDepositFromPrepare(null);
                    setStatus(null);
                    setStatusData(null);
                  }}
                >
                  Cancel and choose another token
                </Button>
              </div>
            )}

            {depositAddress && (
              <div className="mt-6 border-t border-gray-200 pt-4">
                <a
                  href={`https://explorer.near-intents.org/transactions/${depositAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700"
                >
                  View on NEAR Intents explorer <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
