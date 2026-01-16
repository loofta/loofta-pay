"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, AlertCircle, Lock, Shield, CheckCircle2, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import type { TokenSelection } from "@/app/utils/types";
import { useQuery } from "@tanstack/react-query";
import { PaymentStatusTracker } from "@/components/PaymentStatusTracker";
import { QRCodeSVG } from "qrcode.react";
import { findTokenBySelection } from "@/lib/tokens";
import { roundUpDecimals } from "@/lib/format";
import { TokenIcon } from "@/components/TokenIcon";
import { motion, AnimatePresence } from "framer-motion";

type Organization = {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: "active" | "inactive";
  org_referral: string;
  recipient_wallet: string | null;
  token_symbol: string | null;
  token_chain: string | null;
  bg_color: string | null;
};

// Deserialize amount from URL parameter
function deserializeAmount(amountParam: string | null): string {
  if (!amountParam) return "";
  try {
    // Try to decode if it's URL encoded
    const decoded = decodeURIComponent(amountParam);
    // Parse as float to validate
    const parsed = parseFloat(decoded);
    if (isNaN(parsed) || parsed <= 0) return "";
    return decoded;
  } catch {
    // If decoding fails, try direct parse
    const parsed = parseFloat(amountParam);
    if (isNaN(parsed) || parsed <= 0) return "";
    return amountParam;
  }
}

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { data: tokens = [], isLoading: tokensLoading } = useTokensQuery();

  const organizationId = searchParams.get("organizationId");
  const amountParam = searchParams.get("amount");
  const deserializedAmount = useMemo(() => deserializeAmount(amountParam), [amountParam]);

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(deserializedAmount);
  const [tokenSelection, setTokenSelection] = useState<TokenSelection | null>(null);
  const [isPrivatePayment, setIsPrivatePayment] = useState(false);
  const [isAmountEditable, setIsAmountEditable] = useState(!deserializedAmount);
  const [deposit, setDeposit] = useState<any>(null);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string; usd?: number; est?: number } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<any>(null);

  const selectedFrom = findTokenBySelection(tokens, tokenSelection || null);
  const destToken = useMemo(() => {
    if (!organization?.token_symbol || !organization?.token_chain) return null;
    return tokens.find(t => t.symbol === organization.token_symbol && t.chain === organization.token_chain);
  }, [tokens, organization?.token_symbol, organization?.token_chain]);

  // Check if same token and same chain (direct transfer, no swap needed)
  const sameTokenAndChain = useMemo(() => {
    if (!selectedFrom || !destToken) return false;
    const sameChain = String(selectedFrom.chain || "").toLowerCase() === String(destToken.chain || "").toLowerCase();
    const sameToken = String(selectedFrom.symbol || "").toUpperCase() === String(destToken.symbol || "").toUpperCase();
    return sameChain && sameToken;
  }, [selectedFrom, destToken]);

  useEffect(() => {
    if (!organizationId) {
      setError("Missing organizationId parameter");
      setLoading(false);
      return;
    }

    loadOrganization();
  }, [organizationId]);

  useEffect(() => {
    // Set default token from organization if available
    if (organization?.token_symbol && organization?.token_chain && !tokenSelection) {
      setTokenSelection({
        symbol: organization.token_symbol,
        chain: organization.token_chain,
      });
    }
  }, [organization, tokenSelection]);

  // Fetch quote when token selection or amount changes
  useEffect(() => {
    (async () => {
      setQuote(null);
      if (!organization || !selectedFrom || !amount || parseFloat(amount) <= 0) {
        setQuoteLoading(false);
        return;
      }

      // If same token and same chain, calculate directly without API call
      if (sameTokenAndChain && selectedFrom.price) {
        const amountUsd = parseFloat(amount);
        const tokenPrice = selectedFrom.price;
        if (tokenPrice > 0) {
          const tokenAmount = amountUsd / tokenPrice;
          setQuote({ amountInFormatted: tokenAmount.toFixed(6) });
          setQuoteLoading(false);
          return;
        }
      }

      setQuoteLoading(true);
      try {
        const r = await fetch(`/api/organizations/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: organization.organization_id,
            fromToken: {
              tokenId: selectedFrom.tokenId || selectedFrom.address,
              decimals: selectedFrom.decimals,
              chain: selectedFrom.chain,
              price: selectedFrom.price
            },
            destToken: destToken ? {
              tokenId: destToken.tokenId || destToken.address,
              decimals: destToken.decimals,
              chain: destToken.chain,
              price: destToken.price,
            } : null,
            amount: amount,
          }),
        });
        const data = await r.json();
        if (r.ok) {
          if (data?.amountInFormatted) setQuote({ amountInFormatted: data.amountInFormatted });
          else {
            const usd = typeof data?.amountInUSD === "number" ? data.amountInUSD : undefined;
            const est = typeof data?.amountInEst === "number" ? data.amountInEst : undefined;
            setQuote({ usd, est });
          }
        }
      } catch (e) {
        console.error("Failed to fetch quote:", e);
        // Fallback: try simple calculation if we have token price
        if (selectedFrom.price) {
          const amountUsd = parseFloat(amount);
          const tokenPrice = selectedFrom.price;
          if (tokenPrice > 0) {
            const tokenAmount = amountUsd / tokenPrice;
            setQuote({ amountInFormatted: tokenAmount.toFixed(6) });
          }
        }
      } finally {
        setQuoteLoading(false);
      }
    })();
  }, [organization, selectedFrom, destToken, amount, sameTokenAndChain]);

  async function prepareDeposit() {
    if (!organization || !selectedFrom || !amount) return;
    setPreparing(true);
    setDeposit(null);
    try {
      const res = await fetch("/api/organizations/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organization.organization_id,
          fromToken: {
            tokenId: selectedFrom.tokenId || selectedFrom.address,
            decimals: selectedFrom.decimals,
            chain: selectedFrom.chain,
            symbol: selectedFrom.symbol,
          },
          amount: amount,
          orgReferral: organization.org_referral,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to prepare deposit");
      }

      const data = await res.json();

      if (data.directTransfer) {
        setDeposit({
          ...data,
          isDirect: true,
          minAmountInFormatted: data.amount,
        });
        toast({ title: "Direct transfer", description: "Same token & chain - send directly to recipient" });
      } else {
        setDeposit(data);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to prepare", description: e?.message || "Could not obtain deposit info" });
    } finally {
      setPreparing(false);
    }
  }

  // Get deposit address from multiple sources
  const depositAddress: string | undefined = deposit?.depositAddress
    || statusData?.quoteResponse?.quote?.depositAddress
    || statusData?.depositAddress
    || undefined;

  // For direct deposits, we need the token symbol and chain from deposit data
  const depositToken = deposit?.depositToken || deposit?.tokenSymbol;
  const depositChain = deposit?.depositChain || deposit?.chain;

  // Poll status via TanStack Query
  // For direct deposits, use a different endpoint that checks the blockchain
  const isDirectDeposit = deposit?.isDirect || deposit?.directTransfer;

  const statusQuery = useQuery({
    queryKey: ["status", depositAddress, isDirectDeposit, depositToken, depositChain, deposit?.minAmountInFormatted],
    enabled: !!depositAddress,
    queryFn: async ({ queryKey }) => {
      const addr = queryKey[1] as string;
      const isDirect = queryKey[2] as boolean;
      const tokenSymbol = queryKey[3] as string;
      const chain = queryKey[4] as string;
      const expectedAmount = queryKey[5] as string;

      if (!addr) throw new Error("No deposit address");

      // For direct deposits, use the direct-status endpoint
      if (isDirect && tokenSymbol && chain) {
        let directAmount = (parseFloat(amount) / (selectedFrom?.price || 0)).toFixed(6);
        console.log('directAmount', directAmount);
        const params = new URLSearchParams({
          recipientAddress: addr,
          expectedAmount: directAmount,
          tokenSymbol: tokenSymbol,
          chain: chain,
        });
        if (organizationId) {
          params.append("organizationId", organizationId);
        }
        const r = await fetch(`/api/organizations/direct-status?${params.toString()}`, { cache: "no-store" });
        if (!r.ok) {
          const errorData = await r.json().catch(() => ({}));
          throw new Error(errorData?.error || "Failed to load direct deposit status");
        }
        return await r.json();
      }

      // For other deposits, use the regular status endpoint
      const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(addr)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load status");
      return await r.json();
    },
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const s = query?.state?.data?.status;
      const terminal = s && ["SUCCESS", "FAILED", "REFUNDED", "EXPIRED"].includes(String(s).toUpperCase());
      return terminal ? false : 15000;
    },
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    const s = statusQuery.data?.status || statusQuery.data?.executionStatus || null;
    if (s) {
      setStatus(s);
      setStatusData(statusQuery.data || null);
    }
  }, [statusQuery.data]);

  const loadOrganization = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/organizations/public?organizationId=${organizationId}`);

      if (!response.ok) {
        throw new Error("Failed to load organization");
      }

      const data = await response.json();

      if (!data.organization) {
        throw new Error("Organization not found");
      }

      if (data.organization.checkout_status !== "active") {
        setError("This organization's checkout is currently inactive");
        setLoading(false);
        return;
      }

      setOrganization(data.organization);
    } catch (error: any) {
      console.error("Failed to load organization:", error);
      setError(error?.message || "Failed to load organization");
    } finally {
      setLoading(false);
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Checkout Unavailable</h1>
          <p className="text-gray-600">{error || "Organization not found"}</p>
        </div>
      </div>
    );
  }

  // Get background color from organization, default to white
  const contentBgColor = organization.bg_color || "#FFFFFF";

  return (
    <div className="min-h-screen" style={{ backgroundColor: contentBgColor }}>
      {/* Organization Logo Header - Centered */}
      {organization.logo_url && (
        <header className="pt-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-center">
              <div className="relative w-32 h-32 sm:w-40 sm:h-40">
                <Image
                  src={organization.logo_url}
                  alt={organization.name}
                  fill
                  className="object-contain drop-shadow-sm"
                />
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full items-start">
          {/* Left Side - Amount Card */}
          <div className="flex flex-col">
            {/* Amount Card */}
            <div className="bg-white rounded-2xl p-8 shadow-sm w-full">
              <div className="space-y-6">
                {/* Organization Name & Payment Request Label */}
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{organization.name}</h2>
                  <p className="text-sm text-gray-500">Payment Request</p>
                </div>
                {/* Amount */}
                <div className="space-y-2">
                  <Label htmlFor="amount" className="text-sm font-medium text-gray-700">
                    Amount
                  </Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-gray-400">
                      $
                    </span>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setIsAmountEditable(true);
                      }}
                      disabled={!isAmountEditable}
                      placeholder="0.00"
                      className="pl-8 text-3xl font-semibold h-16 border-2 border-gray-200 focus:border-blue-500 bg-white"
                    />
                  </div>
                  {!isAmountEditable && (
                    <p className="text-sm text-gray-500">
                      Amount is set by the organization. Contact them to change it.
                    </p>
                  )}
                </div>

                {/* Payment Summary */}
                <div className="pt-6 border-t border-gray-200">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="font-medium text-gray-900">
                        ${amount || "0.00"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Processing fee</span>
                      <span className="font-medium text-gray-900 flex items-center gap-2">
                        <span className="text-gray-400" style={{ textDecoration: 'line-through' }}>$0.50</span>
                        <span className="text-gray-900 font-semibold">FREE</span>
                      </span>
                    </div>
                    <div className="flex justify-between text-lg font-semibold pt-3 border-t border-gray-200">
                      <span className="text-gray-900">Total</span>
                      <span className="text-gray-900">${amount || "0.00"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Payment Options */}
          <div className="flex flex-col">
            <div className="bg-gray-50 rounded-2xl p-8 space-y-6 w-full">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Payment Details</h3>

                {!deposit ? (
                  <>
                    {/* Token Selection */}
                    <div className="space-y-2 mb-6">
                      <Label className="text-sm font-medium text-gray-700">
                        Pay with
                      </Label>
                      {tokensLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                        </div>
                      ) : (
                        <TokenCombobox
                          tokens={tokens}
                          value={tokenSelection || undefined}
                          onChange={setTokenSelection}
                          placeholder="Select token and network..."
                          className="w-full"
                        />
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        Choose the token and network you want to pay with
                      </p>
                    </div>

                    {/* Quote Display */}
                    <AnimatePresence mode="wait">
                      {selectedFrom && amount && parseFloat(amount) > 0 && (
                        <motion.div
                          key={quote ? "quote" : quoteLoading ? "loading" : "empty"}
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="mb-4"
                        >
                          {quoteLoading ? (
                            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                              <div className="flex items-center gap-3">
                                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                                <p className="text-sm font-medium text-blue-900">Calculating conversion...</p>
                              </div>
                            </div>
                          ) : quote ? (
                            <div className="p-4 bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl border border-emerald-200 shadow-sm">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                    <TokenIcon token={selectedFrom} chain={selectedFrom.chain} size={24} />
                                  </div>
                                  <div>
                                    <p className="text-xs text-emerald-700 font-medium mb-0.5">You'll send</p>
                                    <p className="text-lg font-bold text-emerald-900">
                                      {quote.amountInFormatted
                                        ? `${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                                        : quote.est
                                          ? `${roundUpDecimals(String(quote.est), 6)} ${selectedFrom.symbol}`
                                          : quote.usd
                                            ? `≈ $${quote.usd.toFixed(2)}`
                                            : ""}
                                    </p>
                                  </div>
                                </div>
                                <ArrowRight className="w-5 h-5 text-emerald-600" />
                              </div>
                            </div>
                          ) : (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <p className="text-sm text-gray-600 text-center">
                                Select a token to see conversion rate
                              </p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Proceed to Payment Button */}
                    <Button
                      onClick={prepareDeposit}
                      disabled={!selectedFrom || preparing || !amount || parseFloat(amount) <= 0}
                      className="w-full h-12 text-base font-semibold"
                    >
                      {preparing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Preparing…
                        </>
                      ) : (
                        <>
                          Proceed to payment
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    {(() => {
                      const s = String(status || "").toUpperCase();
                      const isTerminal = s === "FAILED" || s === "REFUNDED";
                      const isExpired = (s === "PENDING_DEPOSIT" || s === "INCOMPLETE_DEPOSIT") && deposit?.deadline
                        ? new Date(deposit.deadline).getTime() < Date.now()
                        : false;

                      if (isExpired) {
                        return (
                          <div className="text-center py-12">
                            <div className="mb-4 text-6xl">🔗</div>
                            <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                              Payment Link Expired
                            </h3>
                            <p className="text-gray-600 text-base mb-4">
                              This payment link has expired. Please request a new one.
                            </p>
                            <Button onClick={() => setDeposit(null)} className="mt-4">
                              Start New Payment
                            </Button>
                          </div>
                        );
                      }

                      const depositAddr = deposit?.depositAddress
                        || statusData?.quoteResponse?.quote?.depositAddress
                        || statusData?.depositAddress;

                      // Calculate amount to send - prioritize deposit response, then quote, then calculate
                      let amountToSend: string | undefined = undefined;

                      // First, try to get from deposit response (most accurate)
                      if (deposit?.minAmountInFormatted) {
                        amountToSend = deposit.minAmountInFormatted;
                      } else if (statusData?.quoteResponse?.quote?.amountInFormatted) {
                        amountToSend = statusData.quoteResponse.quote.amountInFormatted;
                      } else if (quote?.amountInFormatted) {
                        amountToSend = quote.amountInFormatted;
                      }

                      // If we still don't have an amount and have token price, calculate it
                      if ((!amountToSend || amountToSend === '0') && selectedFrom?.price && amount) {
                        const amountUsd = parseFloat(amount);
                        const tokenPrice = selectedFrom.price;
                        if (tokenPrice > 0 && amountUsd > 0) {
                          if (deposit?.isCompanionSwap) {
                            console.log('companion swap', amountUsd);
                            // For companion swaps, add 3% buffer
                            const baseAmount = amountUsd / tokenPrice;
                            amountToSend = (baseAmount * 1.03).toFixed(6);
                          } else {
                            console.log('amountUsd', amountUsd);
                            console.log('tokenPrice', tokenPrice);
                            // For direct transfers, no buffer needed
                            amountToSend = (amountUsd / tokenPrice).toFixed(6);
                          }
                        }
                      }

                      // Show status tracker for PROCESSING/KNOWN_DEPOSIT_TX
                      if (s === "PROCESSING" || s === "KNOWN_DEPOSIT_TX") {
                        return (
                          <>
                            <PaymentStatusTracker
                              status={status}
                              statusData={statusData}
                              depositReceivedAt={statusData?.updatedAt}
                              startedAt={deposit?.deadline ? new Date(deposit.deadline).toISOString() : undefined}
                              fromChain={selectedFrom?.chain}
                              toChain={destToken?.chain}
                              depositAddress={depositAddr}
                              timeEstimate={statusData?.quoteResponse?.quote?.timeEstimate || deposit?.timeEstimate}
                              paymentType={
                                deposit?.isDirect ? 'direct' :
                                  deposit?.isCompanionSwap ? 'companion-swap' :
                                    'near-intent'
                              }
                            />
                            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
                              <div className="text-lg font-semibold text-gray-900 mb-2">Payment summary</div>
                              <div className="text-base text-gray-700 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600">Amount requested</span>
                                  <span className="text-lg font-semibold text-gray-900">
                                    ${amount || "0.00"}
                                  </span>
                                </div>
                                {selectedFrom && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-600">Paid with</span>
                                    <span className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                                      <TokenIcon token={selectedFrom} chain={selectedFrom.chain} size={24} />
                                      <span>
                                        {statusData?.swapDetails?.depositedAmountFormatted
                                          ? `${roundUpDecimals(statusData.swapDetails.depositedAmountFormatted, 6)} ${selectedFrom.symbol}`
                                          : `— ${selectedFrom.symbol}`}
                                      </span>
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        );
                      }

                      if (s === "SUCCESS") {
                        return (
                          <div className="text-center py-12">
                            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                            <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                              Payment Complete! 🎉
                            </h3>
                            <p className="text-gray-600 text-base">
                              Your payment has been successfully processed.
                            </p>
                          </div>
                        );
                      }

                      if (isTerminal) {
                        return (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                            <div className="text-sm font-semibold text-red-700">
                              {s === "FAILED" ? "Deposit failed." : "Deposit was refunded."}
                            </div>
                            <div className="text-sm text-red-700/80 mt-1">
                              Please try again with a different token or network.
                            </div>
                            <Button onClick={() => setDeposit(null)} className="mt-4 w-full">
                              Try Again
                            </Button>
                          </div>
                        );
                      }

                      // PENDING_DEPOSIT or INCOMPLETE_DEPOSIT - show deposit info
                      return (
                        <div className="space-y-6">
                          {/* Amount to Pay */}
                          <div className="rounded-xl border border-gray-200 bg-white p-4">
                            <div className="text-base text-gray-700 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">Amount to pay</span>
                                <span className="text-lg font-medium text-gray-900 inline-flex items-center gap-2">
                                  {selectedFrom && (
                                    <>
                                      <TokenIcon token={selectedFrom} chain={selectedFrom.chain} size={24} />
                                      <span>
                                        {amountToSend && selectedFrom
                                          ? `${roundUpDecimals(amountToSend, 6)} ${selectedFrom.symbol}`
                                          : quote?.amountInFormatted && selectedFrom
                                            ? `${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                                            : `$${amount || "0.00"}`}
                                      </span>
                                    </>
                                  )}
                                </span>
                              </div>
                              {depositAddr && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-gray-600">Deposit address</span>
                                  <div className="flex items-center gap-2 flex-1 justify-end">
                                    <span className="text-sm font-mono text-gray-900">
                                      {depositAddr.length > 20
                                        ? `${depositAddr.slice(0, 6)}...${depositAddr.slice(-4)}`
                                        : depositAddr}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await navigator.clipboard.writeText(depositAddr);
                                          toast({ title: "Copied", description: "Deposit address copied to clipboard." });
                                        } catch {
                                          toast({ variant: "destructive", title: "Copy failed", description: "Could not copy address." });
                                        }
                                      }}
                                      className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
                                      title="Copy address"
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                                        <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                              {deposit?.memo && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600">Memo</span>
                                  <span className="text-sm font-mono text-gray-900">
                                    {deposit.memo}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* QR Code */}
                          {depositAddr && (
                            <div className="flex justify-center">
                              <div className="bg-white p-4 rounded-lg border border-gray-200">
                                <QRCodeSVG value={depositAddr} size={200} />
                              </div>
                            </div>
                          )}

                          {/* Status Message */}
                          {s === "INCOMPLETE_DEPOSIT" && (
                            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                              <div className="text-sm font-semibold text-orange-700">
                                Incomplete Deposit
                              </div>
                              <div className="text-sm text-orange-700/80 mt-1">
                                Please send the remaining amount to complete your payment.
                              </div>
                            </div>
                          )}

                          {/* Payment Status Tracker */}
                          <PaymentStatusTracker
                            status={status}
                            statusData={statusData}
                            depositReceivedAt={statusData?.updatedAt}
                            startedAt={deposit?.deadline ? new Date(deposit.deadline).toISOString() : undefined}
                            fromChain={selectedFrom?.chain}
                            toChain={destToken?.chain}
                            depositAddress={depositAddr}
                            timeEstimate={statusData?.quoteResponse?.quote?.timeEstimate || deposit?.timeEstimate}
                            paymentType={
                              deposit?.isDirect ? 'direct' :
                                deposit?.isCompanionSwap ? 'companion-swap' :
                                  'near-intent'
                            }
                          />
                        </div>
                      );
                    })()}
                  </>
                )}

                {/* Security Notice */}
                <div className="pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-500 text-center mb-3">
                    🔒 Secured by Loofta Pay • Multi-chain payments
                  </p>
                  {/* Small Loofta Logo */}
                  <div className="flex justify-center">
                    <Link href="/" className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                      <Image
                        src="/loofta.svg"
                        alt="Loofta Pay"
                        width={60}
                        height={22}
                        className="h-4 w-auto"
                      />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
