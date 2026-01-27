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
  const [refundAddress, setRefundAddress] = useState<string>("");
  const [refundAddressError, setRefundAddressError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1); // 1: Token selection, 2: Refund address (skipped for direct), 3: Complete Payment (shows deposit when ready)
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState<string | null>(null);

  const selectedFrom = findTokenBySelection(tokens, tokenSelection || null);
  const destToken = useMemo(() => {
    if (!organization?.token_symbol || !organization?.token_chain) return null;
    return tokens.find(t => t.symbol === organization.token_symbol && t.chain === organization.token_chain);
  }, [tokens, organization?.token_symbol, organization?.token_chain]);

  // Validate refund address based on selected token's chain
  const validateRefundAddress = (address: string, chain: string): boolean => {
    if (!address.trim()) return false;
    const chainLower = chain.toLowerCase();

    // EVM chains
    const evmChains = ['eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism', 'polygon', 'pol', 'bsc', 'avax', 'avalanche'];
    if (evmChains.includes(chainLower)) {
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    // Solana
    if (chainLower === 'sol' || chainLower === 'solana') {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }

    // NEAR
    if (chainLower === 'near') {
      return /^[a-z0-9_-]+\.near$|^[a-f0-9]{64}$/i.test(address);
    }

    // Bitcoin
    if (chainLower === 'btc' || chainLower === 'bitcoin') {
      return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address);
    }

    // Default to EVM pattern for unknown chains
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  // Check if same token and same chain (direct transfer, no swap needed)
  const sameTokenAndChain = useMemo(() => {
    if (!selectedFrom || !destToken) return false;
    const sameChain = String(selectedFrom.chain || "").toLowerCase() === String(destToken.chain || "").toLowerCase();
    const sameToken = String(selectedFrom.symbol || "").toUpperCase() === String(destToken.symbol || "").toUpperCase();
    return sameChain && sameToken;
  }, [selectedFrom, destToken]);

  // Get display step number (for direct payments, complete payment is step 2)
  const getStepNumber = (step: number): number => {
    if (sameTokenAndChain) {
      // Direct payment: 1 -> Token, 2 -> Complete Payment
      if (step === 3) return 2; // Complete Payment
    }
    // Swap: 1 -> Token, 2 -> Refund, 3 -> Complete Payment
    return step;
  };

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
        // Call quote API - it will use default refund address if none provided
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
            // Pass refund address if available, otherwise API will use default
            ...(refundAddress.trim() ? { refundAddress: refundAddress.trim() } : {}),
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

  async function handleProceedToPayment() {
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
    // For direct payments (same token and chain), skip refund address step and prepare deposit
    if (sameTokenAndChain) {
      setCurrentStep(3);
      await prepareDeposit();
    } else {
      // Move to refund address step for swaps
      setCurrentStep(2);
    }
  }

  async function handleContinueToConfirmation() {
    if (!refundAddress.trim()) {
      setRefundAddressError("Please enter a refund address");
      toast({ variant: "destructive", title: "Error", description: "Please enter a refund address." });
      return;
    }
    if (!selectedFrom || !validateRefundAddress(refundAddress, selectedFrom.chain)) {
      setRefundAddressError(`Invalid ${selectedFrom?.chain || ''} address format`);
      toast({ variant: "destructive", title: "Error", description: `Invalid refund address format for ${selectedFrom?.chain.toUpperCase() || ''}.` });
      return;
    }
    setRefundAddressError(null);
    setCurrentStep(3);
    // Automatically prepare deposit after moving to confirmation step
    await prepareDeposit();
  }

  async function handleSpeedUp(txHash: string): Promise<void> {
    try {
      // Submit tx hash to Near Intents for faster processing
      const resp = await fetch("https://1click.chaindefuser.com/v0/submit-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          txHash: txHash.trim(),
          ...(deposit?.depositAddress ? { depositAddress: deposit.depositAddress } : {}),
          ...(deposit?.quoteId ? { quoteId: deposit.quoteId } : {}),
          ...(deposit?.memo ? { memo: deposit.memo } : {}),
        }),
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData?.error || errorData?.message || "Failed to submit transaction");
      }
      toast({
        title: "Transaction submitted",
        description: "Your deposit is being processed. Check the status in a few moments.",
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Speed up failed",
        description: e?.message || "Failed to submit transaction",
      });
      throw e; // Re-throw so PaymentDepositView can handle it
    }
  }

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
    // For non-direct payments, require refund address
    if (!sameTokenAndChain && !refundAddress.trim()) {
      setRefundAddressError("Please enter a refund address");
      toast({ variant: "destructive", title: "Error", description: "Please enter a refund address." });
      return;
    }
    // Validate refund address for non-direct payments
    if (!sameTokenAndChain && selectedFrom && !validateRefundAddress(refundAddress, selectedFrom.chain)) {
      setRefundAddressError(`Invalid ${selectedFrom?.chain || ''} address format`);
      toast({ variant: "destructive", title: "Error", description: `Invalid refund address format for ${selectedFrom?.chain.toUpperCase() || ''}.` });
      return;
    }
    setPreparing(true);
    setDeposit(null);
    setRefundAddressError(null);
    // Don't move to step 4 yet - wait for deposit data
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
        // Only include refundAddress for non-direct payments
        ...(sameTokenAndChain ? {} : { refundAddress: refundAddress.trim() }),
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
      // Deposit data is ready, it will be shown in step 3
      // Don't change step - stay on step 3 to show deposit view
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

      // For demo organization, override with localStorage wallet if available
      if (organizationId === 'demo' && typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('loofta_demo_wallet');
          if (stored) {
            const demoWallet = JSON.parse(stored);
            if (demoWallet.address && demoWallet.token && demoWallet.network) {
              console.log("[Checkout] Using localStorage demo wallet:", demoWallet);
              // Load uploaded logo from localStorage if available
              if (demoWallet.logoUrl) {
                setUploadedLogoUrl(demoWallet.logoUrl);
              }
              setOrganization({
                ...data.organization,
                recipient_wallet: demoWallet.address,
                token_symbol: demoWallet.token,
                token_chain: demoWallet.network,
                logo_url: data.organization.logo_url,
              });
              return;
            }
          }
        } catch (error) {
          console.warn("[Checkout] Failed to load demo wallet from localStorage:", error);
        }
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

  // Get background color: URL param > white (default)
  const contentBgColor = decodedBgColor || "#FFFFFF";

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ backgroundColor: contentBgColor }}>
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8">
        {/* Organization Logo - Top Left */}
        {(uploadedLogoUrl || organization.logo_url) && (
          <div className="mb-4">
            <div className="relative w-16 h-16">
              <Image
                src={uploadedLogoUrl || organization.logo_url || ""}
                alt={organization.name}
                fill
                className="object-contain"
                unoptimized={true}
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

          {/* Right Side - Payment Steps */}
          <div className="flex flex-col">
            <AnimatePresence mode="wait">
              {/* Step 1: Token Selection */}
              {currentStep === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="bg-gray-50 rounded-2xl shadow-lg p-8 space-y-6 w-full"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-sm font-semibold text-blue-600">1</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Select Payment Method</h3>
                  </div>

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
                  {tokenSelection && amount && parseFloat(amount) > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
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
                                <p className="text-xs text-emerald-700 font-medium mb-0.5">You'll send approximately</p>
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

                  {/* Proceed Button */}
                  <Button
                    onClick={handleProceedToPayment}
                    disabled={!tokenSelection || !selectedFrom || preparing || !amount || parseFloat(amount) <= 0 || !organization}
                    className="w-full h-12 text-base font-semibold"
                  >
                    {!selectedFrom ? (
                      "Select a token"
                    ) : !organization ? (
                      "Organization not found"
                    ) : (
                      <>
                        Proceed to payment
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </motion.div>
              )}

              {/* Step 2: Refund Address */}
              {currentStep === 2 && selectedFrom && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="bg-gray-50 rounded-2xl shadow-lg p-8 space-y-6 w-full"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-sm font-semibold text-blue-600">2</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Enter Refund Address</h3>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="refundAddress" className="text-sm font-medium text-gray-700">
                      Refund Address ({selectedFrom.chain.toUpperCase()})
                    </Label>
                    <Input
                      id="refundAddress"
                      type="text"
                      value={refundAddress}
                      onChange={(e) => {
                        setRefundAddress(e.target.value);
                        setRefundAddressError(null);
                      }}
                      placeholder={`Enter your ${selectedFrom.chain.toUpperCase()} address for refunds`}
                      className={`w-full ${refundAddressError ? "border-red-500 focus:border-red-500" : ""}`}
                      autoFocus
                    />
                    {refundAddressError && (
                      <p className="text-sm text-red-600">{refundAddressError}</p>
                    )}
                    <p className="text-sm text-gray-500">
                      Funds will be refunded to this address if the payment fails or expires
                    </p>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCurrentStep(1);
                        setRefundAddress("");
                        setRefundAddressError(null);
                      }}
                      className="flex-1"
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleContinueToConfirmation}
                      disabled={!refundAddress.trim()}
                      className="flex-1 h-12 text-base font-semibold"
                    >
                      Continue
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Step 3: Complete Payment (Step 2 for direct payments) */}
              {currentStep === 3 && selectedFrom && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="bg-gray-50 rounded-2xl shadow-lg p-8 space-y-6 w-full"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-sm font-semibold text-blue-600">{getStepNumber(3)}</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Complete Payment</h3>
                  </div>

                  {/* Show deposit view if deposit is ready, otherwise show payment summary */}
                  {deposit ? (
                    <PaymentDepositView
                      deposit={deposit}
                      status={status}
                      statusData={statusData}
                      selectedFrom={selectedFrom}
                      destToken={destToken}
                      amount={amount}
                      quote={quote}
                      depositAddress={depositAddress}
                      onCancel={() => {
                        setDeposit(null);
                        setCurrentStep(sameTokenAndChain ? 1 : 2);
                        setRefundAddress("");
                        setRefundAddressError(null);
                      }}
                      onSpeedUp={handleSpeedUp}
                      paymentType={
                        deposit?.isDirect ? 'direct' :
                          deposit?.isCompanionSwap ? 'companion-swap' :
                            'near-intent'
                      }
                    />
                  ) : (
                    <>
                      <div className="space-y-4">
                        <div className="p-4 bg-white rounded-lg border border-gray-200">
                          <div className="space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Amount</span>
                              <span className="text-base font-semibold text-gray-900">${amount || "0.00"}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Pay with</span>
                              <div className="flex items-center gap-2">
                                <TokenIcon token={selectedFrom} chain={selectedFrom.chain} size={20} />
                                <span className="text-base font-semibold text-gray-900">
                                  {quote?.amountInFormatted
                                    ? `${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                                    : selectedFrom.symbol}
                                </span>
                              </div>
                            </div>
                            {sameTokenAndChain && organization?.recipient_wallet && (
                              <>
                                <div className="pt-2 border-t border-gray-200 space-y-2">
                                  <div className="flex justify-between items-start gap-2">
                                    <span className="text-sm text-gray-600">Send to</span>
                                    <div className="flex items-center gap-2 max-w-[280px]">
                                      <span className="text-xs font-mono text-gray-900 break-all text-right">
                                        {organization.recipient_wallet}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(organization.recipient_wallet || "");
                                            toast({ title: "Copied", description: "Recipient address copied to clipboard." });
                                          } catch {
                                            toast({ variant: "destructive", title: "Copy failed", description: "Could not copy address." });
                                          }
                                        }}
                                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
                                        title="Copy address"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                          <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">Network</span>
                                    <span className="text-sm font-semibold text-gray-900 uppercase">
                                      {selectedFrom.chain || organization.token_chain || ""}
                                    </span>
                                  </div>
                                </div>
                              </>
                            )}
                            {!sameTokenAndChain && (
                              <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                                <span className="text-sm text-gray-600">Refund Address</span>
                                <span className="text-xs font-mono text-gray-700 break-all text-right max-w-[200px]">
                                  {refundAddress.slice(0, 6)}...{refundAddress.slice(-4)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Demo Message - Only show for direct payments (same token and chain) */}
                        {organizationId === 'demo' && sameTokenAndChain && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 shadow-sm"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <span className="text-blue-600 text-lg">💡</span>
                              </div>
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-blue-900 mb-1">
                                  Demo Mode
                                </h4>
                                <p className="text-sm text-blue-800 leading-relaxed">
                                  For this demo, please confirm that you've completed the payment. Wallet connect integration for direct payments is coming soon!
                                </p>
                              </div>
                            </div>
                          </motion.div>
                        )}

                        {/* Loading state while preparing deposit */}
                        {preparing && (
                          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <div className="flex items-center gap-3">
                              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                              <p className="text-sm font-medium text-blue-900">Preparing deposit address...</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3 pt-2">
                        <Button
                          variant="outline"
                          onClick={() => setCurrentStep(sameTokenAndChain ? 1 : 2)}
                          disabled={preparing}
                          className="flex-1"
                        >
                          Back
                        </Button>
                      </div>
                    </>
                  )}
                </motion.div>
              )}

            </AnimatePresence>

            {/* Security Notice - Show when deposit is not ready */}
            {!deposit && (
              <div className="pt-4 border-t border-gray-200 mt-6">
                <p className="text-sm text-gray-500 text-center mb-3">
                  🔒 Secured by Loofta Pay • Multi-chain payments
                </p>
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
