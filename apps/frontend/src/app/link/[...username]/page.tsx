'use client'

import React, { useEffect, useMemo, useState } from "react";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { roundUpDecimals } from "@/lib/format";
import { findTokenBySelection } from "@/lib/tokens";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { TokenIcon } from "@/components/TokenIcon";
import { useQuery } from "@tanstack/react-query";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { isDemoMode } from "@/config/demoMode";
import {
  isRhinestoneChainSupported,
  getSupportedTokensForChain,
  getRhinestoneChainId,
} from "@/config/rhinestoneChains";
import { useRouter } from "next/navigation";

// Check demo mode at module level for consistent behavior
const DEMO_MODE = isDemoMode();

async function fetchUserByUsername(username: string) {
  // Decode URL-encoded username first, then remove @ prefix if present
  const decoded = decodeURIComponent(username);
  const cleanUsername = decoded.replace(/^@/, "").toLowerCase();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const r = await fetch(`${backendUrl}/users/by-username?username=${encodeURIComponent(cleanUsername)}`);
  if (!r.ok) {
    const errorData = await r.json().catch(() => ({}));
    throw new Error(errorData?.message || errorData?.error || "User not found");
  }
  return await r.json();
}

async function createClaimFromUsername(input: {
  username: string;
  amount: string;
  userId?: string;
  userEmail?: string;
}) {
  // This endpoint fetches wallet address server-side (never exposed to frontend)
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const r = await fetch(`${backendUrl}/claims/create-from-username`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      amount: Number(input.amount), // Backend expects number
      userId: input.userId,
      userEmail: input.userEmail,
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    let errData: any = {};
    try {
      errData = JSON.parse(errText);
    } catch {
      errData = { message: errText || "Failed to create claim" };
    }
    throw new Error(errData?.message || errData?.error || "Failed to create claim");
  }

  const responseText = await r.text();
  console.log('[createClaimFromUsername] Response text:', responseText);

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error('[createClaimFromUsername] Failed to parse JSON:', e, responseText);
    throw new Error("Invalid JSON response from server");
  }

  console.log('[createClaimFromUsername] Parsed data:', data);

  if (!data?.id) {
    console.error('[createClaimFromUsername] Missing id in response:', data);
    throw new Error("Server response missing claim ID");
  }

  return data;
}

async function prepareDeposit(input: {
  claimId: string;
  claim: { id: string; amount: string; to_symbol: string; to_chain: string; recipient_address?: string };
  fromToken: { tokenId: string; decimals: number; chain: string; symbol?: string };
  amount: string;
  userAddress?: string;
  refundAddress?: string;
}) {
  const r = await fetch(`/api/claims/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const errData = await r.json().catch(() => ({}));
    const err = new Error(errData?.error || "Failed to prepare deposit") as any;
    err.code = errData?.code;
    throw err;
  }
  return await r.json();
}


export default function LinkPayPage({ params }: { params: Promise<{ username: string[] }> }) {
  const { username: usernameArray } = React.use(params);
  // Join array and decode URL-encoded characters (like %40 for @)
  const username = decodeURIComponent(usernameArray.join("/"));
  const router = useRouter();
  const { toast } = useToast();
  const { data: tokens = [], isLoading } = useTokensQuery();

  // Fetch user by username
  const userQuery = useQuery({
    queryKey: ["user", username],
    queryFn: () => fetchUserByUsername(username),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const userData = userQuery.data as any;
  const loadingUser = userQuery.isLoading;

  // State for editable amount
  const [amountUSD, setAmountUSD] = useState<string>("100");
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string; usd?: number; est?: number } | null>(null);
  const [refundAddress, setRefundAddress] = useState<string>("");
  const [refundAddressError, setRefundAddressError] = useState<string | null>(null);
  const { logout, login, authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  // Fixed destination: USDC on Solana
  const destToken = useMemo(() => {
    return tokens.find(t => t.symbol === "USDC" && t.chain === "sol");
  }, [tokens]);

  const selectedFrom = findTokenBySelection(tokens, fromSel || null);

  // Handle "Get deposit address" button click
  const handleGetDepositAddress = async () => {
    // Validate inputs
    if (!amountUSD || Number(amountUSD) <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Please enter a valid amount." });
      return;
    }
    if (!selectedFrom) {
      toast({ variant: "destructive", title: "Select token", description: "Please select a token to pay with." });
      return;
    }
    if (!refundAddress.trim()) {
      toast({ variant: "destructive", title: "Refund address required", description: "Please enter a refund address." });
      return;
    }
    if (!validateRefundAddress(refundAddress, selectedFrom.chain)) {
      setRefundAddressError("Invalid address format for this network");
      return;
    }

    setPreparing(true);
    try {
      // Step 1: Create claim from username (wallet address fetched server-side, never exposed)
      const cleanUsername = username.replace(/^@/, "").toLowerCase();
      const claimResult = await createClaimFromUsername({
        username: cleanUsername,
        amount: amountUSD,
        userId: user?.id,
        userEmail: user?.email?.address,
      });

      console.log('[handleGetDepositAddress] Claim result:', claimResult);

      if (!claimResult?.id) {
        throw new Error("Failed to create claim: No ID returned from server");
      }

      // Step 2: Fetch claim details to pass to deposit route
      // We need the full claim data (to_symbol, to_chain, recipient_address) for deposit preparation
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const claimDetailsResponse = await fetch(`${backendUrl}/claims/${claimResult.id}/latest-intent`);
      if (!claimDetailsResponse.ok) {
        throw new Error("Failed to fetch claim details");
      }
      const claimDetailsData = await claimDetailsResponse.json();
      const fullClaim = claimDetailsData?.claim;
      
      if (!fullClaim) {
        throw new Error("Claim details not found");
      }

      // Step 3: Save token selection and refund address to store before preparing deposit
      const { useClaimPayStore } = await import("@/store/claimPay");
      useClaimPayStore.getState().setFromSel(claimResult.id, { symbol: selectedFrom.symbol, chain: selectedFrom.chain });
      useClaimPayStore.getState().setRefundAddress(claimResult.id, refundAddress.trim());

      // Step 4: Prepare deposit (creates intent with deposit address)
      const userWalletAddress = wallets[0]?.address;
      const depositResult = await prepareDeposit({
        claimId: claimResult.id,
        claim: {
          id: fullClaim.id,
          amount: fullClaim.amount,
          to_symbol: fullClaim.to_symbol,
          to_chain: fullClaim.to_chain,
          recipient_address: fullClaim.recipient_address,
        },
        fromToken: {
          tokenId: selectedFrom.tokenId || selectedFrom.address || "",
          decimals: selectedFrom.decimals,
          chain: selectedFrom.chain,
          symbol: selectedFrom.symbol,
        },
        amount: amountUSD,
        userAddress: userWalletAddress,
        refundAddress: refundAddress.trim(),
      });

      // Step 5: Save deposit result to store so claim page can immediately show it
      const depositToStore = {
        depositAddress: depositResult.depositAddress,
        memo: depositResult.memo ?? null,
        deadline: depositResult.deadline,
        quoteId: depositResult.quoteId,
        minDepositFormatted: depositResult.minDepositFormatted,
        minAmountInFormatted: depositResult.minAmountInFormatted,
        isDirect: depositResult.directTransfer || false,
        isCompanionSwap: depositResult.sameChainSwap || false,
      };
      useClaimPayStore.getState().setDeposit(claimResult.id, depositToStore);
      
      // Set status to PENDING_DEPOSIT
      useClaimPayStore.getState().setStatus(claimResult.id, "PENDING_DEPOSIT");

      // Step 6: Small delay to ensure claim is fully persisted, then redirect
      // This helps avoid race conditions where the claim page tries to fetch before DB is ready
      await new Promise(resolve => setTimeout(resolve, 500));

      // Redirect to claim page - it will show the deposit address immediately
      router.push(`/c/${claimResult.id}`);
    } catch (error: any) {
      const errorCode = error?.code || "";
      let errorMessage = error?.message || "Failed to create payment link";
      if (errorCode === "NON_EVM_SAME_TOKEN_REQUIRED") {
        errorMessage = `For this network, you must pay with USDC. Cross-token swaps are only available on EVM chains.`;
      } else if (errorCode === "TOKENS_NOT_SUPPORTED") {
        errorMessage = "This token pair is not supported for swaps. Try ETH, WETH, USDC, or USDT.";
      } else if (errorCode === "CHAIN_NOT_SUPPORTED") {
        errorMessage = "This chain is not supported for swaps. Supported: Ethereum, Base, Optimism, Arbitrum, Polygon, zkSync.";
      } else if (errorCode === "ROUTE_NOT_AVAILABLE") {
        errorMessage = "Route not available. Please try another token or network.";
      }
      toast({ variant: "destructive", title: "Error", description: errorMessage });
      setPreparing(false);
    }
  };

  // Validate refund address based on selected token's chain
  const validateRefundAddress = (address: string, chain: string): boolean => {
    if (!address.trim()) return false;
    const chainLower = chain.toLowerCase();
    const evmChains = ['eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism', 'polygon', 'pol', 'bsc', 'avax', 'avalanche'];
    if (evmChains.includes(chainLower)) {
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
    if (chainLower === 'sol' || chainLower === 'solana') {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }
    if (chainLower === 'near') {
      return /^[a-z0-9_-]+\.near$|^[a-f0-9]{64}$/i.test(address);
    }
    if (chainLower === 'btc' || chainLower === 'bitcoin') {
      return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address);
    }
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const destUSD = useMemo(() => {
    const amt = Number(amountUSD || 0);
    return Number.isFinite(amt) ? amt : null;
  }, [amountUSD]);

  const destTokenAmount = useMemo(() => {
    const usd = destUSD;
    const p = typeof destToken?.price === "number" ? destToken.price : null;
    if (!Number.isFinite(usd) || usd === null || !p || p <= 0) return null;
    return usd / p;
  }, [destUSD, destToken?.price]);

  const sameChain = useMemo(() => {
    if (!selectedFrom || !destToken) return false;
    return String(selectedFrom.chain || "").toLowerCase() === String(destToken.chain || "").toLowerCase();
  }, [selectedFrom, destToken]);

  const sameTokenAndChain = useMemo(() => {
    if (!selectedFrom || !destToken || !sameChain) return false;
    return String(selectedFrom.symbol || "").toLowerCase() === String(destToken.symbol || "").toLowerCase();
  }, [selectedFrom, destToken, sameChain]);

  const destChainSupportsSwap = useMemo(() => {
    if (!destToken?.chain) return false;
    return isRhinestoneChainSupported(destToken.chain);
  }, [destToken?.chain]);

  const supportedSwapTokens = useMemo(() => {
    if (!destToken?.chain) return [];
    return getSupportedTokensForChain(destToken.chain);
  }, [destToken?.chain]);

  // Filter tokens to show
  const filteredTokens = useMemo(() => {
    if (!destToken?.chain || !destToken?.symbol) return tokens;
    const destChainLower = String(destToken.chain).toLowerCase();
    const isNonEvmDest = ['sol', 'solana', 'btc', 'bitcoin', 'zec', 'zcash', 'xrp', 'xlm', 'ton', 'sui'].includes(destChainLower);
    return tokens.map(t => {
      const tokenChainLower = String(t.chain || "").toLowerCase();
      const isSameChain = tokenChainLower === destChainLower;
      if (isNonEvmDest && isSameChain) {
        if (String(t.symbol || "").toLowerCase() === String(destToken.symbol).toLowerCase()) {
          return t;
        }
        return { ...t, _unsupported: true, _reason: `Only ${destToken.symbol} is supported on ${destToken.chain}` };
      }
      if (isSameChain && destChainSupportsSwap) {
        const isSupported = supportedSwapTokens.some((st: any) =>
          String((st?.symbol || st) || "").toLowerCase() === String(t.symbol || "").toLowerCase()
        );
        if (isSupported) {
          return t;
        }
        return { ...t, _unsupported: true, _reason: `${t.symbol} is not supported for same-chain swaps on ${destToken.chain}` };
      }
      return t;
    }).filter((t: any) => !t._unsupported || t.symbol === destToken.symbol);
  }, [tokens, destToken, destChainSupportsSwap, supportedSwapTokens]);

  // Fetch quote when selectedFrom changes (for display only, before claim creation)
  useEffect(() => {
    (async () => {
      setQuote(null);
      if (!selectedFrom || !destToken) return;
      try {
        // Estimate quote based on token prices (no claim ID needed yet)
        if (selectedFrom.price && destToken.price && amountUSD) {
          const usdAmount = Number(amountUSD);
          const destTokenAmount = usdAmount / destToken.price;
          const fromTokenAmount = destTokenAmount * (destToken.price / selectedFrom.price);
          setQuote({
            amountInFormatted: String(fromTokenAmount),
            usd: fromTokenAmount * selectedFrom.price,
          });
        }
      } catch { }
    })();
  }, [selectedFrom, destToken, amountUSD]);




  // Rest of the component logic will be similar to claim page...
  // For now, let me create the basic structure and continue in next part

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <div className="flex items-center justify-center min-h-[calc(100vh-7rem)]">
            <div className="w-full max-w-2xl">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-gray-900">
                {DEMO_MODE && (
                  <div className="mb-4 -mx-6 -mt-6 px-4 py-3 bg-amber-50 border-b border-amber-200 rounded-t-2xl">
                    <div className="flex items-center gap-2 text-amber-800">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="text-sm font-medium">Demo Mode - Payments are disabled</span>
                    </div>
                  </div>
                )}

                {loadingUser ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !userData?.user ? (
                  <div className="text-red-600">User not found.</div>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between">
                      <div className="text-base font-medium text-gray-700">Pay to @{userData?.user?.username || username}</div>
                    </div>
                    <div className="text-base text-gray-700 mb-2">Amount (USD)</div>
                    <Input
                      type="number"
                      value={amountUSD}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "" || (!isNaN(Number(value)) && Number(value) >= 0)) {
                          setAmountUSD(value);
                        }
                      }}
                      placeholder="100"
                      className="text-3xl md:text-4xl font-semibold text-gray-900 h-16"
                    />
                    <div className="mt-2 text-base text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                        {destTokenAmount != null ? roundUpDecimals(String(destTokenAmount), 6) : "—"} USDC on Solana
                      </span>
                    </div>

                    {/* Pay with section */}
                    <div className="mt-5">
                      <div className="text-base font-medium text-gray-700 mb-2">Pay with</div>
                      <TokenCombobox
                        tokens={filteredTokens as any}
                        value={fromSel}
                        onChange={(sel) => {
                          const selected = filteredTokens.find(t => t.symbol === sel.symbol && t.chain === sel.chain) as any;
                          if (selected?._unsupported) {
                            toast({
                              variant: "destructive",
                              title: "Token not supported",
                              description: selected._reason || "This token cannot be used for this payment."
                            });
                            return;
                          }
                          setFromSel(sel);
                        }}
                        placeholder="Select token to pay with"
                        onQuery={async (q) => filteredTokens.filter(t => t.symbol.toLowerCase().includes((q || '').toLowerCase()))}
                        className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50 w-full h-14 text-lg text-center focus:ring-0 focus-visible:ring-0 focus:outline-none focus:border-orange-400 transition-colors"
                      />

                      {selectedFrom && (
                        <div className="mt-2 text-sm text-gray-700">
                          {quote?.amountInFormatted
                            ? `Estimated to send: ${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                            : quote?.est
                              ? `Estimated to send: ${roundUpDecimals(String(quote.est), 6)} ${selectedFrom.symbol}`
                              : quote?.usd
                                ? `Estimated cost ≈ $${quote.usd.toFixed(2)}`
                                : ""}
                        </div>
                      )}

                      {selectedFrom && (
                        <div className="mt-4 space-y-2">
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
                            className={refundAddressError ? "border-red-500 focus:border-red-500" : ""}
                          />
                          {refundAddressError && (
                            <p className="text-sm text-red-600">{refundAddressError}</p>
                          )}
                          <p className="text-sm text-gray-500">
                            Funds will be refunded to this address if the payment fails or expires
                          </p>
                        </div>
                      )}

                      <div className="mt-4 flex gap-3">
                        {DEMO_MODE ? (
                          <Button
                            disabled
                            className="w-full rounded-xl"
                            style={{ background: '#9CA3AF' }}
                          >
                            Demo Mode - Payments Disabled
                          </Button>
                        ) : (
                          <GradientActionButton
                            onClick={handleGetDepositAddress}
                            disabled={!selectedFrom || preparing || !refundAddress.trim() || !amountUSD || Number(amountUSD) <= 0}
                            loading={preparing}
                            loadingText="Creating payment link…"
                          >
                            Create payment link
                          </GradientActionButton>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
