"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, AlertCircle, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import type { TokenSelection } from "@/app/utils/types";
import { useQuery } from "@tanstack/react-query";
import { PaymentDepositView } from "@/components/PaymentDepositView";
import { findTokenBySelection } from "@/lib/tokens";
import { roundUpDecimals } from "@/lib/format";
import { TokenIcon } from "@/components/TokenIcon";
import { motion, AnimatePresence } from "framer-motion";

type Organization = {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: "active" | "inactive" | "pending";
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
  const bgColorParam = searchParams.get("bgColor");
  const deserializedAmount = useMemo(() => deserializeAmount(amountParam), [amountParam]);

  // Decode bgColor if URL encoded
  const decodedBgColor = useMemo(() => {
    if (!bgColorParam) return null;
    try {
      return decodeURIComponent(bgColorParam);
    } catch {
      return bgColorParam;
    }
  }, [bgColorParam]);

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
      if (!organization || !tokenSelection || !amount || parseFloat(amount) <= 0) {
        setQuoteLoading(false);
        return;
      }

      // Wait for tokens to load and selectedFrom to be found
      if (!selectedFrom) {
        // Token might not be in the list yet, wait a bit
        if (tokens.length > 0) {
          // Tokens are loaded but token not found - don't show loading
          setQuoteLoading(false);
        } else {
          // Still loading tokens
          setQuoteLoading(true);
        }
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
          if (data?.amountInFormatted) {
            setQuote({ amountInFormatted: data.amountInFormatted });
          } else {
            const usd = typeof data?.amountInUSD === "number" ? data.amountInUSD : undefined;
            const est = typeof data?.amountInEst === "number" ? data.amountInEst : undefined;
            setQuote({ usd, est });
          }
        } else {
          // API returned error
          console.warn("[Checkout] Quote API error:", data);
          // Try fallback calculation
          throw new Error(data?.error || `Quote API returned ${r.status}`);
        }
      } catch (e) {
        console.error("[Checkout] Failed to fetch quote:", e);
        // Fallback: try simple calculation if we have token price
        if (selectedFrom.price && selectedFrom.price > 0) {
          const amountUsd = parseFloat(amount);
          const tokenPrice = selectedFrom.price;
          const tokenAmount = amountUsd / tokenPrice;
          console.log("[Checkout] Using fallback calculation:", { amountUsd, tokenPrice, tokenAmount });
          setQuote({ amountInFormatted: tokenAmount.toFixed(6) });
        } else {
          // No price available, clear quote
          setQuote(null);
        }
      } finally {
        setQuoteLoading(false);
      }
    })();
  }, [organization, selectedFrom, destToken, amount, sameTokenAndChain, tokens, tokenSelection]);

  async function prepareDeposit() {
    if (!organization) {
      toast({ variant: "destructive", title: "Error", description: "Organization not found. Please check the organization ID." });
      return;
    }
    if (!selectedFrom) {
      toast({ variant: "destructive", title: "Error", description: "Selected token not found. Please select a different token." });
      return;
    }
    if (!amount) {
      toast({ variant: "destructive", title: "Error", description: "Please enter an amount." });
      return;
    }

    setPreparing(true);
    setDeposit(null);
    try {
      const payload = {
        organizationId: organization.organization_id,
        fromToken: {
          tokenId: selectedFrom.tokenId || selectedFrom.address,
          decimals: selectedFrom.decimals,
          chain: selectedFrom.chain,
          symbol: selectedFrom.symbol,
        },
        amount: amount,
        orgReferral: organization.org_referral,
      };

      console.log("[Checkout] Preparing deposit with:", {
        organizationId: payload.organizationId,
        organizationFull: organization,
        token: `${payload.fromToken.symbol} on ${payload.fromToken.chain}`,
        amount: payload.amount,
        payload: JSON.stringify(payload, null, 2),
      });

      const res = await fetch("/api/organizations/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errorMsg = errData?.error || `Failed to prepare deposit (${res.status})`;
        console.error("[Checkout] Deposit error:", errorMsg, errData);
        throw new Error(errorMsg);
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
      console.error("[Checkout] Failed to prepare deposit:", e);
      toast({
        variant: "destructive",
        title: "Failed to prepare",
        description: e?.message || "Could not obtain deposit info. Please try again."
      });
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

      // When payment is successful, notify parent window (for popup mode)
      if (String(s).toUpperCase() === 'SUCCESS' && typeof window !== 'undefined' && window.opener) {
        window.opener.postMessage({
          type: 'loofta-payment-success',
          paymentId: depositAddress || statusQuery.data?.paymentId || 'unknown',
          status: s,
        }, '*');
      }
    }
  }, [statusQuery.data, depositAddress]);

  const loadOrganization = async () => {
    try {
      setLoading(true);

      console.log("[Checkout] Loading organization with ID:", organizationId);

      // Use new backend API
      const { organizationsApi } = await import("@/services/api/organizations");
      const data = await organizationsApi.getByOrganizationId(organizationId!);

      console.log("[Checkout] Organization loaded:", {
        found: !!data.organization,
        organization_id: data.organization?.organization_id,
        id: data.organization?.id,
        name: data.organization?.name,
      });

      if (!data.organization) {
        throw new Error("Organization not found");
      }

      if (data.organization.checkout_status !== "active") {
        setError("This organization's checkout is currently inactive");
        setLoading(false);
        return;
      }

      setOrganization(data.organization);
      console.log("[Checkout] Organization set in state:", {
        organization_id: data.organization.organization_id,
        id: data.organization.id,
      });
    } catch (error: any) {
      console.error("[Checkout] Failed to load organization:", error);
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

  // Get background color: URL param > organization setting > white
  const contentBgColor = decodedBgColor || organization.bg_color || "#FFFFFF";

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ backgroundColor: contentBgColor }}>
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8">
        {/* Organization Logo - Top Left */}
        {organization.logo_url && (
          <div className="mb-4">
            <div className="relative w-16 h-16">
              <Image
                src={organization.logo_url}
                alt={organization.name}
                fill
                className="object-contain"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full items-start">
          {/* Left Side - Amount Card */}
          <div className="flex flex-col">
            {/* Amount Card */}
            <div className="bg-white rounded-2xl p-8 shadow-lg w-full">
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
            <div className="bg-gray-50 rounded-2xl shadow-lg p-8 space-y-6 w-full">
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
                      {tokenSelection && amount && parseFloat(amount) > 0 && (
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
                          ) : quote && selectedFrom ? (
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
                          ) : !selectedFrom ? (
                            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                              <p className="text-sm text-amber-700 text-center">
                                Token not found. Please select a different token.
                              </p>
                            </div>
                          ) : (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <p className="text-sm text-gray-600 text-center">
                                Calculating conversion rate...
                              </p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Proceed to Payment Button */}
                    <Button
                      onClick={prepareDeposit}
                      disabled={!tokenSelection || !selectedFrom || preparing || !amount || parseFloat(amount) <= 0 || !organization}
                      className="w-full h-12 text-base font-semibold"
                    >
                      {preparing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Preparing…
                        </>
                      ) : !selectedFrom ? (
                        <>
                          Token not found
                        </>
                      ) : !organization ? (
                        <>
                          Organization not found
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
                  <PaymentDepositView
                    deposit={deposit}
                    status={status}
                    statusData={statusData}
                    selectedFrom={selectedFrom}
                    destToken={destToken}
                    amount={amount}
                    quote={quote}
                    onCancel={() => setDeposit(null)}
                    paymentType={
                      deposit?.isDirect ? 'direct' :
                        deposit?.isCompanionSwap ? 'companion-swap' :
                          'near-intent'
                    }
                  />
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
