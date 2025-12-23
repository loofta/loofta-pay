'use client'

import React, { useEffect, useMemo, useState, type SVGProps } from "react";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { trimDecimals, roundUpDecimals } from "@/lib/format";
import { findTokenBySelection } from "@/lib/tokens";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { useClaimPayStore } from "@/store/claimPay";
import { TokenIcon } from "@/components/TokenIcon";
import Image from "next/image";
import { getChainIcon } from "@/lib/chains";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { isEvmChainId } from "@/config/biconomy";
import { createSwapTransaction, getSwapStatus, checkSwapEligibility } from "@/services/swapProvider";
import { ACTIVE_SWAP_PROVIDER, getProviderDisplayName, type SwapProvider } from "@/config/swapProvider";
import { ethers } from "ethers";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { isDemoMode } from "@/config/demoMode";
import {
  isRhinestoneChainSupported,
  getSupportedTokensForChain,
  getRhinestoneChainId,
} from "@/config/rhinestoneChains";

// Check demo mode at module level for consistent behavior
const DEMO_MODE = isDemoMode();

async function fetchClaim(id: string) {
  const r = await fetch(`/api/claims/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Claim not found");
  return (await r.json()).claim as { id: string; amount: string; to_symbol: string; to_chain: string; status: string; recipient_address?: string; created_at?: string; paid_at?: string };
}

async function prepareDeposit(input: {
  claimId: string;
  fromToken: { tokenId: string; decimals: number; chain: string; symbol?: string };
  amount: string;
  userAddress?: string;
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

async function updateClaimStatus(claimId: string, status: string, extra?: { txHash?: string; paidWith?: string }) {
  try {
    const r = await fetch(`/api/claims/${claimId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...extra }),
    });
    if (!r.ok) {
      console.error("[updateClaimStatus] Failed:", await r.text());
    }
  } catch (e) {
    console.error("[updateClaimStatus] Error:", e);
  }
}

export default function ClaimPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const { toast } = useToast();
  const { data: tokens = [], isLoading } = useTokensQuery();
  const claimQuery = useQuery({
    queryKey: ["claim", id],
    queryFn: () => fetchClaim(id),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
  const claim = claimQuery.data as any;
  const loadingClaim = claimQuery.isLoading;
  // Cache latest intent for initial status/deposit hydration
  const latestIntentQuery = useQuery({
    queryKey: ["latest-intent", id],
    queryFn: async () => {
      const r = await fetch(`/api/claims/${id}/latest-intent`, { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    },
    enabled: !!id,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [deposit, setDeposit] = useState<any>(null);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string; usd?: number; est?: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<any>(null);
  const [speedUpOpen, setSpeedUpOpen] = useState<boolean>(false);
  const [txInput, setTxInput] = useState<string>("");
  const [submittingTx, setSubmittingTx] = useState<boolean>(false);
  const [isPrivateMode, setIsPrivateMode] = useState<boolean>(false);
  const [showPrivacyTutorial, setShowPrivacyTutorial] = useState<boolean>(false);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const hasUpdatedClaimStatus = React.useRef<string | null>(null); // Track if we've already updated DB for this status
  const userCancelled = React.useRef<boolean>(false); // Track if user manually cancelled to prevent re-hydration
  const { logout, login, authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  const selectedFrom = findTokenBySelection(tokens, fromSel || null);
  const destToken = useMemo(() => tokens.find(t => t.symbol === claim?.to_symbol && t.chain === claim?.to_chain), [tokens, claim?.to_symbol, claim?.to_chain]);
  const destUSD = useMemo(() => {
    const amt = Number(claim?.amount || 0);
    return Number.isFinite(amt) ? amt : null;
  }, [claim?.amount]);
  const destTokenAmount = useMemo(() => {
    const usd = Number(claim?.amount || 0);
    const p = typeof destToken?.price === "number" ? destToken.price : null;
    if (!Number.isFinite(usd) || !p || p <= 0) return null;
    return usd / p;
  }, [claim?.amount, destToken?.price]);
  const sameChain = useMemo(() => {
    if (!selectedFrom || !destToken) return false;
    return String(selectedFrom.chain || "").toLowerCase() === String(destToken.chain || "").toLowerCase();
  }, [selectedFrom, destToken]);
  // Check if same token AND same chain (direct transfer, no swap needed)
  const sameTokenAndChain = useMemo(() => {
    if (!selectedFrom || !destToken || !sameChain) return false;
    return String(selectedFrom.symbol || "").toLowerCase() === String(destToken.symbol || "").toLowerCase();
  }, [selectedFrom, destToken, sameChain]);

  // Check if destination chain supports Rhinestone companion swaps
  const destChainSupportsSwap = useMemo(() => {
    if (!destToken?.chain) return false;
    return isRhinestoneChainSupported(destToken.chain);
  }, [destToken?.chain]);

  // Get supported tokens for same-chain swaps on destination chain
  const supportedSwapTokens = useMemo(() => {
    if (!destToken?.chain) return [];
    return getSupportedTokensForChain(destToken.chain);
  }, [destToken?.chain]);

  // Filter tokens to show: 
  // - For same-chain EVM: only show supported tokens (ETH, WETH, USDC, USDT)
  // - For non-EVM same-chain: only show the destination token (same token required)
  // - For cross-chain: show all tokens
  const filteredTokens = useMemo(() => {
    if (!destToken?.chain || !destToken?.symbol) return tokens;

    const destChainLower = String(destToken.chain).toLowerCase();
    const isNonEvmDest = ['sol', 'solana', 'btc', 'bitcoin', 'zec', 'zcash', 'xrp', 'xlm', 'ton', 'sui'].includes(destChainLower);

    return tokens.map(t => {
      const tokenChainLower = String(t.chain || "").toLowerCase();
      const isSameChain = tokenChainLower === destChainLower;

      if (isSameChain) {
        // Same chain scenario
        if (isNonEvmDest) {
          // Non-EVM: Must use same token
          const isSameToken = String(t.symbol || "").toUpperCase() === String(destToken.symbol || "").toUpperCase();
          if (!isSameToken) {
            // Mark as unsupported but keep in list with warning
            return { ...t, _unsupported: true, _reason: `Only ${destToken.symbol} accepted on ${destToken.chain}` };
          }
        } else if (destChainSupportsSwap) {
          // EVM with swap support: only supported tokens
          const isSupported = supportedSwapTokens.includes(String(t.symbol || "").toUpperCase());
          if (!isSupported) {
            return { ...t, _unsupported: true, _reason: `${t.symbol} not supported for swap. Use ETH, WETH, USDC, or USDT.` };
          }
        }
      }

      return t;
    });
  }, [tokens, destToken, destChainSupportsSwap, supportedSwapTokens]);

  // Find ZEC token for private mode
  const zecToken = useMemo(() => {
    return tokens.find(t => t.symbol.toUpperCase() === 'ZEC');
  }, [tokens]);

  // Auto-select ZEC when private mode is enabled
  useEffect(() => {
    if (isPrivateMode && zecToken) {
      setFromSel({ symbol: zecToken.symbol, chain: zecToken.chain });
    }
  }, [isPrivateMode, zecToken]);
  // Check if direct pay via swap provider is available
  const swapEligibility = useMemo(() => {
    if (!selectedFrom || !destToken) return { eligible: false, provider: null as SwapProvider | null };
    if (!sameChain) return { eligible: false, provider: null as SwapProvider | null };
    if (!isEvmChainId(selectedFrom.chain)) return { eligible: false, provider: null as SwapProvider | null };
    return checkSwapEligibility({ fromToken: selectedFrom, toToken: destToken });
  }, [selectedFrom, destToken, sameChain]);
  const swapProviderEligible = swapEligibility.eligible;
  const activeProvider = swapEligibility.provider;
  // Derive payer token from status originAsset if available
  const paidToken = useMemo(() => {
    const assetId = statusData?.originAsset as string | undefined;
    if (!assetId || !Array.isArray(tokens) || !tokens.length) return null;
    const t = tokens.find(tk => {
      const id = tk.tokenId || tk.address;
      return String(id || "").toLowerCase() === String(assetId || "").toLowerCase();
    });
    return t || null;
  }, [statusData?.originAsset, tokens]);

  // Hydrate UI state from persisted zustand on mount
  useEffect(() => {
    const entry = useClaimPayStore.getState().byId[id];
    if (entry?.fromSel) setFromSel(entry.fromSel as any);
    if (entry?.deposit) setDeposit(entry.deposit);
    if (entry?.status) setStatus(entry.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);


  // Hydrate from latest-intent cache (skip if user manually cancelled)
  useEffect(() => {
    // Don't re-hydrate if user cancelled
    if (userCancelled.current) return;

    const d: any = latestIntentQuery.data;
    if (!d) return;
    // Set deposit if we have a depositAddress and haven't set it yet
    if (d?.depositAddress && !deposit) {
      const dep = {
        depositAddress: d.depositAddress,
        memo: d.memo ?? null,
        deadline: d.deadline,
        quoteId: d.quoteId,
        minDepositFormatted: d.minDepositFormatted,
      };
      setDeposit(dep);
      useClaimPayStore.getState().setDeposit(id, dep as any);
    }
    // Set status if we have one and haven't set it yet
    if (d?.status && !status) {
      const s = String(d.status);
      setStatus(s);
      useClaimPayStore.getState().setStatus(id, s);
    }
  }, [latestIntentQuery.data, deposit, status, id]);

  // Hydrate status from claim data (for cross-device support)
  useEffect(() => {
    if (!claim?.status) return;
    const claimStatus = String(claim.status).toUpperCase();
    // Only hydrate if we don't have a status yet and claim has a meaningful status
    if (!status && claimStatus && claimStatus !== "PENDING" && claimStatus !== "CREATED") {
      setStatus(claimStatus);
      useClaimPayStore.getState().setStatus(id, claimStatus);
    }
  }, [claim?.status, status, id]);

  useEffect(() => {
    (async () => {
      setQuote(null);
      if (!claim || !selectedFrom) return;
      try {
        const r = await fetch(`/api/claims/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId: id,
            fromToken: { tokenId: selectedFrom.tokenId || selectedFrom.address, decimals: selectedFrom.decimals, chain: selectedFrom.chain, price: selectedFrom.price },
            destToken: { tokenId: destToken?.tokenId || destToken?.address, decimals: destToken?.decimals, chain: destToken?.chain, price: destToken?.price },
            fromTokenPriceUSD: selectedFrom?.price,
            destTokenPriceUSD: destToken?.price,
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
      } catch { }
    })();
  }, [id, claim, selectedFrom, destToken?.tokenId, destToken?.price, destToken?.decimals]);

  async function onPrepare() {
    if (!claim || !selectedFrom) return;
    // Reset cancelled flag when starting new deposit
    userCancelled.current = false;
    setPreparing(true);
    setDeposit(null);
    try {
      useClaimPayStore.getState().setFromSel(id, { symbol: selectedFrom.symbol, chain: selectedFrom.chain } as any);

      // If same token AND same chain, use recipient address directly (no swap needed)
      if (sameTokenAndChain && claim.recipient_address) {
        const directDeposit = {
          depositAddress: claim.recipient_address,
          memo: undefined,
          deadline: undefined,
          quoteId: undefined,
          minDepositFormatted: destTokenAmount ? String(destTokenAmount) : claim.amount,
        };
        setDeposit({ ...directDeposit, isDirect: true });
        useClaimPayStore.getState().setDeposit(id, directDeposit);
        toast({ title: "Direct transfer", description: "Same token & chain - send directly to recipient" });
        return;
      }

      // Get user's wallet address for intents mode
      const userWalletAddress = wallets[0]?.address;

      const res = await prepareDeposit({
        claimId: id,
        fromToken: { tokenId: selectedFrom.tokenId || selectedFrom.address, decimals: selectedFrom.decimals, chain: selectedFrom.chain, symbol: selectedFrom.symbol },
        amount: claim.amount,
        userAddress: userWalletAddress,
      });

      // Handle different response types
      if (res.directTransfer) {
        // Same chain, same token - direct to recipient
        setDeposit({
          ...res,
          isDirect: true,
          minAmountInFormatted: res.amount,
        });
        toast({ title: "Direct transfer", description: "Same token & chain - send directly to recipient" });
      } else if (res.sameChainSwap) {
        // Same chain, different token - companion wallet swap
        setDeposit({
          ...res,
          isCompanionSwap: true,
          minAmountInFormatted: res.estimatedTotal,
        });
        toast({ title: "Swap enabled", description: `Send ${res.depositToken} to companion wallet. We'll swap to ${claim.to_symbol} for you.` });
      } else {
        // Cross-chain via NEAR Intents
        setDeposit(res);
      }

      useClaimPayStore.getState().setDeposit(id, {
        depositAddress: res.depositAddress,
        memo: res.memo ?? null,
        deadline: res.deadline,
        quoteId: res.quoteId,
        minDepositFormatted: res.minDepositFormatted,
        minAmountInFormatted: res.minAmountInFormatted, // Add the actual amount to send
      });
    } catch (e: any) {
      // Handle specific error codes with better messages
      const errorCode = e?.code || "";
      let errorMessage = e?.message || "Could not obtain deposit info";

      if (errorCode === "NON_EVM_SAME_TOKEN_REQUIRED") {
        errorMessage = `For this network, you must pay with ${claim?.to_symbol}. Cross-token swaps are only available on EVM chains.`;
      } else if (errorCode === "TOKENS_NOT_SUPPORTED") {
        errorMessage = "This token pair is not supported for swaps. Try ETH, WETH, USDC, or USDT.";
      } else if (errorCode === "CHAIN_NOT_SUPPORTED") {
        errorMessage = "This chain is not supported for swaps. Supported: Ethereum, Base, Optimism, Arbitrum, Polygon, zkSync.";
      } else if (errorCode === "ROUTE_NOT_AVAILABLE") {
        errorMessage = "Route not available. Please try another token or network.";
      }

      toast({ variant: "destructive", title: "Failed to prepare", description: errorMessage });
    } finally {
      setPreparing(false);
    }
  }

  async function onPayNow() {
    if (!claim || !selectedFrom || !destToken) return;
    if (!swapProviderEligible || !activeProvider) {
      toast({ variant: "destructive", title: "Not supported", description: "This network is not supported for direct pay." });
      return;
    }
    try {
      const wallet = wallets[0];
      if (!wallet) {
        toast({ variant: "destructive", title: "No wallet", description: "Please connect a wallet to continue." });
        login(); // Trigger login if no wallet
        return;
      }

      console.log("🔐 [Wallet] Using wallet from Privy:", {
        walletAddress: wallet.address,
        walletType: wallet.walletClientType,
        chainId: wallet.chainId,
      });

      const ethereumProvider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(ethereumProvider);
      const signer = await provider.getSigner();
      const ownerAddress = await signer.getAddress();

      console.log("🔐 [Wallet] Signer address:", ownerAddress);

      // Verify wallet address matches
      if (wallet.address?.toLowerCase() !== ownerAddress.toLowerCase()) {
        console.warn("⚠️ [Wallet] Address mismatch!", {
          privyWallet: wallet.address,
          signerAddress: ownerAddress,
        });
      }

      const recipient = String(claim?.recipient_address || "").trim();
      if (!recipient) {
        toast({ variant: "destructive", title: "Missing recipient", description: "Recipient address is not available for this claim." });
        return;
      }

      // Calculate amount to send (use quote if available, else estimate from prices)
      const amountHuman = quote?.amountInFormatted
        ? roundUpDecimals(String(quote.amountInFormatted), selectedFrom.decimals > 6 ? 6 : selectedFrom.decimals)
        : destTokenAmount != null
          ? roundUpDecimals(String(destTokenAmount), 6)
          : null;

      if (!amountHuman || parseFloat(amountHuman) === 0) {
        toast({ variant: "destructive", title: "Quote failed", description: "Could not determine payment amount." });
        return;
      }

      setPreparing(true);
      setStatus("PROCESSING");
      useClaimPayStore.getState().setStatus(id, "PROCESSING");
      updateClaimStatus(id, "PROCESSING", { paidWith: `${selectedFrom.symbol} on ${selectedFrom.chain}` });

      const providerName = getProviderDisplayName(activeProvider);
      console.log(`[${providerName}] Starting payment:`, {
        from: selectedFrom.symbol,
        to: destToken.symbol,
        amount: amountHuman,
        recipient,
        provider: activeProvider,
      });

      // Calculate destination amount (what recipient should receive)
      const destinationAmount = destTokenAmount != null
        ? String(destTokenAmount)
        : undefined;

      // Create swap transaction via unified provider
      const payload = await createSwapTransaction({
        fromToken: {
          tokenId: selectedFrom.tokenId || selectedFrom.address,
          address: selectedFrom.address,
          decimals: selectedFrom.decimals,
          chain: selectedFrom.chain,
          symbol: selectedFrom.symbol,
          name: selectedFrom.name || selectedFrom.symbol,
          price: selectedFrom.price,
        },
        toToken: {
          tokenId: destToken.tokenId || destToken.address,
          address: destToken.address,
          decimals: destToken.decimals,
          chain: destToken.chain,
          symbol: destToken.symbol,
          name: destToken.name || destToken.symbol,
          price: destToken.price,
        },
        amountHuman,
        destinationAmountHuman: destinationAmount, // Amount recipient should receive
        recipient,
        userAddress: ownerAddress,
        forceProvider: activeProvider,
        ethereumProvider, // Pass provider for Rhinestone signing
      });

      const { to, data, value, chainId, id: intentId, provider: usedProvider, meta } = payload || {};
      if (!to) {
        throw new Error("Invalid transaction payload");
      }

      // Switch chain if needed
      if (chainId) {
        try {
          await wallet.switchChain(Number(chainId));
        } catch { }
      }

      // For Rhinestone 1-click deposit: check if we can skip funding
      if (meta?.type === "1-click-deposit" && meta?.companionAddress && meta?.signerPk) {

        // If skip-funding, companion already has enough - go directly to intent execution
        if (meta?.step === "skip-funding") {
          console.log("[Rhinestone] Companion already funded, executing intent directly...");
          toast({ title: "Companion funded", description: "Executing swap + transfer..." });
        } else {
          // Need to fund the companion first
          console.log("[Rhinestone] Funding companion account...");
          toast({ title: "Funding companion", description: "Please approve the transfer..." });

          const tx = await signer.sendTransaction({
            to,
            data: data || "0x",
            value: value && value !== "0" ? BigInt(value) : undefined
          });

          await tx.wait();
          console.log("[Rhinestone] Funding transaction confirmed on-chain");
          toast({ title: "Funding confirmed ✓", description: "Waiting for balance to sync..." });

          // Wait for balance to be indexed (Rhinestone needs this)
          // Per docs: "You might need to wait a few seconds between funding and executing"
          console.log("[Rhinestone] Waiting 5 seconds for balance sync...");
          await new Promise(resolve => setTimeout(resolve, 5000));

          toast({ title: "Balance synced ✓", description: "Executing swap + transfer..." });
        }

        // Execute the intent
        console.log("[Rhinestone] Starting intent execution...");
        const { executeRhinestoneIntent } = await import("@/services/rhinestone");

        const result = await executeRhinestoneIntent({
          companionAddress: meta.companionAddress,
          signerPk: meta.signerPk,
        });

        console.log("[Rhinestone] Intent executed:", result);
        setStatus("SUCCESS");
        useClaimPayStore.getState().setStatus(id, "SUCCESS");
        updateClaimStatus(id, "SUCCESS", { paidWith: `${selectedFrom.symbol} on ${selectedFrom.chain}` });

        // Update statusData with the paid amount for display
        // Use totalSourceAmount which represents the actual ETH used for the swap
        const paidAmount = (payload as any)?.totalSourceAmount || amountHuman;
        console.log("[Rhinestone] Payment summary:", { paidAmount, token: selectedFrom?.symbol });

        setStatusData((prev: any) => ({
          ...prev,
          swapDetails: {
            ...(prev?.swapDetails || {}),
            depositedAmountFormatted: paidAmount,
            amountInFormatted: paidAmount,
          },
        }));

        toast({ title: "Payment complete!", description: `Swap + transfer successful via Rhinestone.` });
      } else {
        // Non-Rhinestone flow (Biconomy or others)
        const tx = await signer.sendTransaction({
          to,
          data: data || "0x",
          value: value ? BigInt(value) : undefined
        });

        await tx.wait();
        setStatus("SUCCESS");
        useClaimPayStore.getState().setStatus(id, "SUCCESS");
        updateClaimStatus(id, "SUCCESS", { txHash: tx.hash, paidWith: `${selectedFrom.symbol} on ${selectedFrom.chain}` });
        toast({ title: "Transaction confirmed", description: `Payment successful via ${getProviderDisplayName(usedProvider)}.` });
      }

      // Optional: Poll status in background
      if (intentId) {
        const iv = setInterval(async () => {
          try {
            const s = await getSwapStatus(intentId, usedProvider);
            const st = String(s?.status || "").toUpperCase();
            if (st === "SUCCESS" || st === "FAILED") {
              if (st === "FAILED") {
                setStatus("FAILED");
                useClaimPayStore.getState().setStatus(id, "FAILED");
                updateClaimStatus(id, "FAILED");
              }
              clearInterval(iv);
            }
          } catch { clearInterval(iv); }
        }, 5000);
        setTimeout(() => clearInterval(iv), 120000);
      }
    } catch (e: any) {
      setStatus("FAILED");
      useClaimPayStore.getState().setStatus(id, "FAILED");
      updateClaimStatus(id, "FAILED");
      toast({ variant: "destructive", title: "Payment failed", description: e?.message || "Could not complete payment" });
    } finally {
      setPreparing(false);
    }
  }

  // Cache and refresh status via TanStack Query
  const depositAddress = deposit?.depositAddress as string | undefined;
  const statusQuery = useQuery({
    queryKey: ["status", depositAddress],
    enabled: !!depositAddress,
    queryFn: async ({ queryKey }) => {
      // Use depositAddress from queryKey to avoid stale closure
      const addr = queryKey[1] as string;
      if (!addr) throw new Error("No deposit address");
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
      const upperStatus = String(s).toUpperCase();
      setStatus(s);
      useClaimPayStore.getState().setStatus(id, s);
      setStatusData(statusQuery.data || null);

      // When status becomes terminal, update the claim in DB (only once per status)
      const isTerminalStatus = ["SUCCESS", "FAILED", "REFUNDED"].includes(upperStatus);
      if (isTerminalStatus && hasUpdatedClaimStatus.current !== upperStatus) {
        hasUpdatedClaimStatus.current = upperStatus; // Mark as updated to prevent duplicates

        // Update claim in DB then refresh cache
        (async () => {
          if (upperStatus === "SUCCESS") {
            await updateClaimStatus(id, "SUCCESS", {
              paidWith: paidToken?.symbol
                ? `${paidToken.symbol} on ${paidToken.chain || selectedFrom?.chain}`
                : selectedFrom?.symbol
                  ? `${selectedFrom.symbol} on ${selectedFrom.chain}`
                  : undefined,
            });
          } else {
            await updateClaimStatus(id, upperStatus);
          }
          // Refetch claim after DB is updated
          claimQuery.refetch();
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data]);

  function extractTxHash(raw: string): string | null {
    const v = String(raw || "").trim();
    if (!v) return null;
    // If it's a URL, try to get query param 'hash' or last path segment
    try {
      if (v.startsWith("http")) {
        const u = new URL(v);
        const q = u.searchParams.get("hash") || u.searchParams.get("tx") || u.searchParams.get("transactionHash");
        if (q && q.length > 10) return q;
        const segs = (u.pathname || "").split("/").filter(Boolean);
        const last = segs[segs.length - 1];
        if (last && last.length > 10) return last;
      }
    } catch { }
    // EVM-like 0x... hash
    const evm = v.match(/0x[0-9a-fA-F]{10,}/);
    if (evm) return evm[0];
    // Fallback: long base58/hex-ish token
    const longToken = v.match(/[A-Za-z0-9]{20,}/);
    if (longToken) return longToken[0];
    return null;
  }

  async function onSubmitTxHash() {
    if (!deposit?.depositAddress) {
      toast({ variant: "destructive", title: "No deposit", description: "Prepare a deposit address first." });
      return;
    }
    const hash = extractTxHash(txInput);
    if (!hash) {
      toast({ variant: "destructive", title: "Invalid hash", description: "Paste a valid transaction hash or explorer link." });
      return;
    }

    // Optimistic UI: immediately set status to PROCESSING
    setStatus("PROCESSING");
    useClaimPayStore.getState().setStatus(id, "PROCESSING");

    // Update claim status in database
    updateClaimStatus(id, "PROCESSING", { txHash: hash }).catch((e) => {
      console.error("[onSubmitTxHash] Failed to update claim status:", e);
    });

    setSubmittingTx(true);
    try {
      const token = (process as any)?.env?.NEXT_PUBLIC_ONECLICK_JWT;
      const r = await fetch("https://1click.chaindefuser.com/v0/deposit/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "*/*",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          txHash: hash,
          depositAddress: deposit.depositAddress,
          memo: deposit.memo || undefined,
          // nearSenderAccount optional; omit unless you want to expose a user field
        }),
      });
      if (!r.ok) {
        let msg = "Failed to submit transaction";
        try { msg = (await r.json())?.error || msg; } catch { }
        throw new Error(msg);
      }
      toast({ title: "Submitted", description: "Transaction submitted for faster processing." });
      setSpeedUpOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Submit failed", description: e?.message || "Could not submit tx hash" });
      // Note: We keep the PROCESSING status even on error for optimistic UI
      // The status query will eventually sync with the actual status
    } finally {
      setSubmittingTx(false);
    }
  }

  return (
    <>
      {/* Privacy Tutorial Modal */}
      {showPrivacyTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setShowPrivacyTutorial(false); setTutorialStep(0); }}>
          <div
            className="bg-white rounded-[20px] w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="flex gap-1.5 p-4 pb-0">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                  <div className={`h-full transition-all duration-300 ${tutorialStep >= i ? 'w-full' : 'w-0'}`} style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }} />
                </div>
              ))}
            </div>

            {/* Content - fixed height */}
            <div className="relative h-[360px] overflow-hidden">
              {/* Step 0: Intro */}
              <div className={`absolute inset-0 p-6 flex flex-col items-center justify-center text-center transition-all duration-300 ${tutorialStep === 0 ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <Image src="/images/icons/shield-icon.png" alt="" width={64} height={64} className="mb-5" />
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-3">Private Settlement</h3>
                <p className="text-slate-500">Convert your payment to ZEC for complete privacy</p>
              </div>

              {/* Step 1: Get Wallet */}
              <div className={`absolute inset-0 p-6 flex flex-col items-center justify-center text-center transition-all duration-300 ${tutorialStep === 1 ? 'opacity-100 translate-x-0' : tutorialStep < 1 ? 'opacity-0 translate-x-full pointer-events-none' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <Image src="/images/icons/wallet.png" alt="" width={128} height={128} className="mb-5" />
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-3">Get a Wallet</h3>
                <p className="text-slate-500 mb-5">Download Zashi to get your shielded address</p>
                <a
                  href="https://zashi.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white font-medium hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                >
                  Get Zashi →
                </a>
              </div>

              {/* Step 2: How it works */}
              <div className={`absolute inset-0 p-6 flex flex-col transition-all duration-300 ${tutorialStep === 2 ? 'opacity-100 translate-x-0' : tutorialStep < 2 ? 'opacity-0 translate-x-full pointer-events-none' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-6 text-center">How it works</h3>
                <div className="flex-1 flex flex-col justify-center space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>1.</span>
                    <span className="text-slate-700 pt-1">Enter your Zcash shielded address</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>2.</span>
                    <span className="text-slate-700 pt-1">We swap your funds to ZEC</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>3.</span>
                    <span className="text-slate-700 pt-1">Receive ZEC privately in your wallet</span>
                  </div>
                </div>
              </div>

              {/* Step 3: Benefits */}
              <div className={`absolute inset-0 p-6 flex flex-col transition-all duration-300 ${tutorialStep === 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}>
                <h3 className="text-2xl font-sans font-medium text-slate-900 mb-6 text-center">Why private?</h3>
                <div className="flex-1 flex flex-col justify-center space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>
                    <span className="text-slate-700 pt-1">No one can see your balance</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>
                    <span className="text-slate-700 pt-1">Transaction history is hidden</span>
                  </div>
                  <div className="flex items-start gap-4 p-4 rounded-[16px] bg-[#F6F6F8]">
                    <span className="text-3xl font-bold" style={{ backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✓</span>
                    <span className="text-slate-700 pt-1">Swap back to 120+ tokens anytime</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="p-4 border-t border-gray-100">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (tutorialStep === 0) {
                      setShowPrivacyTutorial(false);
                      setTutorialStep(0);
                    } else {
                      setTutorialStep(s => s - 1);
                    }
                  }}
                  className="flex-1 py-3 rounded-[12px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  {tutorialStep === 0 ? 'Skip' : 'Back'}
                </button>
                <button
                  onClick={() => tutorialStep < 3 ? setTutorialStep(s => s + 1) : (setShowPrivacyTutorial(false), setTutorialStep(0))}
                  className="flex-1 py-3 rounded-[12px] font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                >
                  {tutorialStep === 3 ? 'Get Started' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <div className="flex flex-col md:flex-row items-center justify-center gap-32 min-h-[calc(100vh-7rem)]">
            {/* Left column - text/summary */}
            <div className="w-full md:w-1/2">
              {String(status || "").toUpperCase() === "SUCCESS" ? (
                <>
                  <h1 className="text-5xl md:text-6xl font-medium font-sans text-white leading-tight mb-8">
                    Want to request <span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>payment?</span>
                  </h1>
                  <p className="text-gray-300 text-xl mb-8">Create your own payment link and get paid in any token you want.</p>
                  <a
                    href="/claim"
                    className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity"
                    style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                  >
                    Create your pay link
                  </a>
                </>
              ) : (
                <>
                  <h1 className="text-5xl md:text-6xl font-medium font-sans text-white leading-tight mb-8">
                    Complete your <span style={{ backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>payment</span>
                  </h1>
                  <p className="text-gray-300 text-xl mb-8">Loofta ensures your funds are securely deposited and your payment is completed. Send exactly the amount shown to the deposit address. </p>
                  <ul className="mt-6 space-y-4">
                    <li className="flex items-start gap-3">
                      <MoneyIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                      <span className="text-gray-300 text-xl">
                        Amount due:{" "}
                        {(loadingClaim || !claim) ? (
                          <span className="align-middle inline-block">
                            <Skeleton className="h-5 w-28 rounded-md" />
                          </span>
                        ) : (
                          <span className="text-white font-semibold">
                            {destUSD != null ? `$${destUSD.toFixed(2)}` : `${claim.amount} ${claim.to_symbol}`}
                          </span>
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <ChainIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                      <span className="text-gray-300 text-xl">Choose which token you want to pay with</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <ShareIcon className="mt-0.5 h-6 w-6 text-amber-400" />
                      <span className="text-gray-300 text-xl">Send exactly the amount shown to the deposit address</span>
                    </li>
                  </ul>
                </>
              )}
            </div>

            {/* Right column - card */}
            <div className="w-full md:w-1/2">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-gray-900">
                {/* Demo Mode Banner */}
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
                {loadingClaim ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : claim ? (
                  <>
                    {String(status || "").toUpperCase() === "SUCCESS" ? (
                      <>
                        <div className="flex justify-center">
                          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-400/30 shadow">
                            <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                        <div className="mt-4 text-center">
                          <h2 className="text-2xl md:text-3xl text-gray-900 font-semibold">Payment completed</h2>
                          <p className="mt-1 text-lg md:text-xl text-gray-700 font-medium">Funds were paid successfully.</p>
                        </div>
                        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div className="text-base font-medium text-gray-800 mb-2">Payment summary</div>
                          <div className="text-base text-gray-700 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Amount requested</span>
                              <span className="text-lg font-semibold text-gray-900">

                                <span className="inline-flex items-center gap-1">
                                  <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={18} />
                                  {destTokenAmount != null ? roundUpDecimals(String(destTokenAmount), 6) : "—"} {claim.to_symbol}
                                </span>
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Paid with</span>
                              <span className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                                {(() => {
                                  const paid = statusData?.swapDetails?.depositedAmountFormatted ?? statusData?.swapDetails?.amountInFormatted ?? null;
                                  const sym = paidToken?.symbol || selectedFrom?.symbol;
                                  const chain = paidToken?.chain || selectedFrom?.chain;
                                  return (
                                    <>
                                      <TokenIcon token={(paidToken as any) ?? (selectedFrom as any)} chain={(paidToken?.chain as any) ?? (selectedFrom?.chain as any)} size={18} />
                                      <span>{paid != null ? roundUpDecimals(String(paid), 6) : "—"} {sym || ""}</span>
                                    </>
                                  );
                                })()}
                              </span>
                            </div>
                            {claim.created_at && (
                              <div className="flex items-center justify-between pt-2 border-t border-gray-200 mt-2">
                                <span className="text-gray-600">Created</span>
                                <span className="text-sm text-gray-700">
                                  {new Date(claim.created_at).toLocaleString()}
                                </span>
                              </div>
                            )}
                            {claim.paid_at && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">Paid</span>
                                <span className="text-sm text-gray-700">
                                  {new Date(claim.paid_at).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                      </>
                    ) : (
                      <>
                        <div className="mb-3 flex items-start justify-between">
                          <div className="text-base font-medium text-gray-700">Payment request</div>
                          {deposit?.depositAddress ? <StatusBadge status={status || "PENDING_DEPOSIT"} /> : null}
                        </div>
                        <div className="text-base text-gray-700">Amount requested</div>
                        <div className="mt-1 flex items-baseline justify-between">
                          <div className="text-3xl md:text-4xl font-semibold text-gray-900 leading-none">
                            {destUSD != null ? `$${destUSD.toFixed(2)}` : `—`}
                          </div>
                          <div className="text-base text-gray-500">
                            <span className="inline-flex items-center gap-1">
                              <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                              {destTokenAmount != null ? roundUpDecimals(String(destTokenAmount), 6) : "—"} {claim.to_symbol}
                            </span>
                          </div>
                        </div>
                      </>
                    )}

                    {String(status || "").toUpperCase() !== "SUCCESS" && (!deposit ? (
                      <>
                        {/* Standard/Private Toggle */}
                        <div className="mt-5">
                          <div className="flex gap-2 rounded-xl bg-gray-100 p-1.5">
                            <button
                              type="button"
                              onClick={() => setIsPrivateMode(false)}
                              className="flex-1 py-2.5 px-4 rounded-lg font-semibold transition-all bg-orange-500 text-white"
                            >
                              Standard
                            </button>
                            <button
                              type="button"
                              disabled
                              className="flex-1 py-2.5 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 bg-transparent text-gray-400 cursor-not-allowed opacity-60"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="opacity-80">
                                <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" fill="currentColor" />
                              </svg>
                              Private
                              <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded ml-1">Soon</span>
                            </button>
                          </div>
                        </div>

                        {/* Pay with section */}
                        <div className="mt-5">
                          <div className="text-base font-medium text-gray-700 mb-2">Pay with</div>

                          {isPrivateMode ? (
                            /* Private mode - fixed to ZEC */
                            <>
                              <div className="flex items-center gap-3 p-3 h-14 rounded-lg border border-amber-300 bg-amber-50">
                                <Image src="/images/tokens/zec.png" alt="ZEC" width={28} height={28} className="rounded-full" />
                                <span className="text-lg font-semibold text-gray-900">ZEC</span>
                                <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-200 text-amber-800 text-xs font-medium">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" fill="currentColor" />
                                  </svg>
                                  Private
                                </span>
                              </div>
                              <div className="mt-2 text-sm text-amber-700">
                                Your payment is shielded and untraceable
                              </div>
                            </>
                          ) : (
                            /* Standard mode - token selector */
                            <TokenCombobox
                              tokens={filteredTokens as any}
                              value={fromSel}
                              onChange={(sel) => {
                                // Check if token is unsupported
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
                          )}

                          {selectedFrom ? (
                            <div className="mt-2 text-sm text-gray-700">
                              {quote?.amountInFormatted
                                ? `Estimated to send: ${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                                : quote?.est
                                  ? `Estimated to send: ${roundUpDecimals(String(quote.est), 6)} ${selectedFrom.symbol}`
                                  : quote?.usd
                                    ? `Estimated cost ≈ $${quote.usd.toFixed(2)}`
                                    : ""}
                            </div>
                          ) : null}
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
                                onClick={onPrepare}
                                disabled={!selectedFrom || preparing}
                                loading={preparing}
                                loadingText="Preparing…"
                              >
                                {isPrivateMode ? "Get private deposit address" : "Get deposit address"}
                              </GradientActionButton>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {(() => {
                          const s = String(status || "").toUpperCase();
                          const isTerminal = s === "FAILED" || s === "REFUNDED";
                          if (s === "PROCESSING") {
                            return (
                              <>
                                <div className="mt-6 flex flex-col items-center justify-center py-6">
                                  <div className="relative h-10 w-10">
                                    <span className="absolute inset-0 rounded-full border-2 border-gray-300" />
                                    <span className="absolute inset-1 rounded-full border-t-2 border-blue-500 animate-spin" />
                                  </div>
                                  <div className="mt-4 text-base text-gray-700">Payment is processing…</div>
                                </div>
                                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                  <div className="text-lg font-semibold text-gray-900 mb-2">Payment summary</div>
                                  <div className="text-base text-gray-700 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-600">Amount requested</span>
                                      <span className="text-lg font-semibold text-gray-900">
                                        <span className="inline-flex items-center gap-1">
                                          <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={24} />
                                          {destTokenAmount != null ? roundUpDecimals(String(destTokenAmount), 6) : "—"} {claim.to_symbol}

                                        </span>
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-600">Paid with</span>
                                      <span className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                                        {(() => {
                                          const paid = statusData?.swapDetails?.depositedAmountFormatted ?? null;
                                          const sym = paidToken?.symbol || selectedFrom?.symbol;
                                          return (
                                            <>
                                              <TokenIcon token={(paidToken as any) ?? (selectedFrom as any)} chain={(paidToken?.chain as any) ?? (selectedFrom?.chain as any)} size={24} />
                                              <span>{paid != null ? roundUpDecimals(String(paid), 6) : "—"} {sym || ""}</span>
                                            </>
                                          );
                                        })()}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </>
                            );
                          }
                          if (s === "SUCCESS") return null;
                          if (isTerminal) {
                            return (
                              <>
                                <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3">
                                  <div className="text-sm font-semibold text-red-700">
                                    {s === "FAILED" ? "Deposit failed." : "Deposit was refunded."}
                                  </div>
                                  <div className="text-sm  text-red-700/80 mt-1">
                                    Please try again with a different token or network.
                                  </div>
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      // Set flag to prevent re-hydration from cache
                                      userCancelled.current = true;
                                      setDeposit(null);
                                      setStatus(null);
                                      setFromSel(undefined);
                                      useClaimPayStore.getState().setDeposit(id, null);
                                      useClaimPayStore.getState().setStatus(id, null);
                                      useClaimPayStore.getState().setFromSel(id, null as any);
                                    }}
                                    className="ml-auto"
                                  >
                                    Retry with another token/chain
                                  </Button>
                                </div>
                              </>
                            );
                          }
                          return (
                            <div className="mt-6">
                              <div className="text-base text-gray-700">Send exactly</div>
                              <div className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                                <TokenIcon
                                  token={(selectedFrom as any) ?? (destToken as any) ?? undefined}
                                  chain={(selectedFrom?.chain as any) ?? (destToken?.chain as any)}
                                  size={18}
                                />
                                <span>
                                  {/* Use deposit.minAmountInFormatted (from /api/claims/deposit) as it's the actual required amount */}
                                  {deposit?.minAmountInFormatted && selectedFrom
                                    ? `${deposit.minAmountInFormatted} ${selectedFrom.symbol}`
                                    : quote?.amountInFormatted && selectedFrom
                                      ? `${roundUpDecimals(quote.amountInFormatted, 6)} ${selectedFrom.symbol}`
                                      : `${roundUpDecimals(claim.amount, 6)} ${claim.to_symbol}`}
                                </span>
                                <span className="mx-1 text-gray-400">•</span>
                                <span className="inline-flex items-center gap-1 uppercase text-sm font-medium text-gray-700">
                                  {(() => {
                                    const chain = (selectedFrom?.chain || destToken?.chain) as string | undefined;
                                    const src = getChainIcon(chain);
                                    return src ? (
                                      <Image src={src} alt="chain" width={14} height={14} sizes="14px" unoptimized={/^https?:\/\//.test(src)} />
                                    ) : null;
                                  })()}
                                  {String((selectedFrom?.chain || destToken?.chain) || "")}
                                </span>
                              </div>
                              <div className="mt-3 text-sm text-gray-700">Deposit address</div>
                              <div className="mt-1 relative">
                                <div className="rounded-lg border border-gray-200 bg-gray-50 pl-3 pr-16 py-2 font-mono text-base break-all text-gray-900">
                                  {(() => {
                                    const addr = deposit.depositAddress || "";
                                    return addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "—";
                                  })()}
                                </div>
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(deposit.depositAddress || "");
                                      toast({ title: "Copied", description: "Deposit address copied to clipboard." });
                                    } catch {
                                      toast({ variant: "destructive", title: "Copy failed", description: "Could not copy address. Please try again." });
                                    }
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-gray-600">
                                    <path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                                  </svg>
                                  Copy
                                </button>
                              </div>
                              {deposit?.isCompanionSwap ? (
                                <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 text-blue-800 text-sm px-3 py-2">
                                  <div className="flex items-center gap-2 font-medium">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Same-chain swap enabled
                                  </div>
                                  <div className="mt-1">
                                    Send {selectedFrom?.symbol} to this address. We'll automatically swap to {claim?.to_symbol} and send to the recipient.
                                    {deposit?.fee && <span className="ml-1">({deposit.fee} service fee)</span>}
                                  </div>
                                </div>
                              ) : deposit?.isDirect ? (
                                <div className="mt-3 rounded-md border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">
                                  <div className="flex items-center gap-2 font-medium">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Direct transfer
                                  </div>
                                  <div className="mt-1">
                                    Send {selectedFrom?.symbol} directly to the recipient's wallet. Same token, same chain - no swap needed.
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 text-orange-800 text-sm px-3 py-2">
                                  Only deposit {selectedFrom?.symbol} from the {String(selectedFrom?.chain || "").toUpperCase()} network. Using another token or network may result in loss of funds.
                                </div>
                              )}
                              {String(status || "").toUpperCase() === "INCOMPLETE_DEPOSIT" ? (
                                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-sm  px-3 py-2">
                                  <div className="text-sm font-semibold">Partial deposit detected</div>
                                  <div className="mt-1">
                                    {(() => {
                                      const depStr = String(statusData?.swapDetails?.depositedAmountFormatted ?? "");
                                      const minStr = String(deposit?.minDepositFormatted ?? "");
                                      const dep = parseFloat(depStr);
                                      const min = parseFloat(minStr);
                                      const sym = selectedFrom?.symbol || claim?.to_symbol || "";
                                      if (Number.isFinite(min) && Number.isFinite(dep)) {
                                        const remaining = Math.max(min - dep, 0);
                                        const topUp = roundUpDecimals(remaining, 6);
                                        return (
                                          <>
                                            Deposited: {roundUpDecimals(dep, 6)} {sym} • Minimum required: {roundUpDecimals(min, 6)} {sym} •
                                            <span className="font-semibold"> Top‑up needed: {topUp} {sym}</span>
                                          </>
                                        );
                                      }
                                      return <>Top up the difference to reach the minimum required amount.</>;
                                    })()}
                                  </div>
                                  <div className="mt-1">Send the additional amount to the same deposit address before the deadline.</div>
                                </div>
                              ) : null}
                              <div className="mt-3">
                                {!speedUpOpen ? (
                                  <button
                                    type="button"
                                    className="text-sm text-orange-600 hover:text-orange-500 underline"
                                    onClick={() => setSpeedUpOpen(true)}
                                  >
                                    Already deposited? Speed up processing
                                  </button>
                                ) : (
                                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <div className="text-sm font-medium text-gray-800">Submit your transaction hash</div>
                                    <div className="text-sm  text-gray-600">Paste a hash or an explorer link — we’ll extract the hash automatically.</div>
                                    <div className="mt-2 flex items-center gap-2">
                                      <Input
                                        value={txInput}
                                        onChange={(e) => setTxInput(e.target.value)}
                                        placeholder="0x... or explorer link"
                                        className="flex-1"
                                      />
                                      <Button
                                        onClick={onSubmitTxHash}
                                        disabled={submittingTx || !txInput}
                                        className="rounded-xl"
                                        style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                                      >
                                        {submittingTx ? "Submitting…" : "Submit"}
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              {deposit.memo ? (
                                <>
                                  <div className="mt-3 text-sm text-gray-700">Memo</div>
                                  <div className="mt-1 font-mono text-sm break-all text-gray-900">{deposit.memo}</div>
                                </>
                              ) : null}
                              {deposit.deadline ? (
                                <div className="mt-3 text-sm text-gray-700">Deadline: <span className="font-medium">{new Date(deposit.deadline).toLocaleString()}</span></div>
                              ) : null}
                              <div className="mt-4 flex gap-2">
                                <Button variant="outline" onClick={() => {
                                  // Set flag to prevent re-hydration from cache
                                  userCancelled.current = true;
                                  setDeposit(null);
                                  setStatus(null);
                                  setFromSel(undefined); // Also clear token selection
                                  useClaimPayStore.getState().setDeposit(id, null);
                                  useClaimPayStore.getState().setStatus(id, null);
                                  useClaimPayStore.getState().setFromSel(id, null as any);
                                }} className="ml-auto">Cancel & choose another token</Button>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    ))}
                  </>
                ) : (
                  <div className="text-red-600">Claim not found.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Debug Section - Rhinestone Companion Account Recovery */}
      {process.env.NODE_ENV === "development" && (
        <CompanionDebugSection wallets={wallets} />
      )}
    </>
  );
}

function CompanionDebugSection({ wallets }: { wallets: any[] }) {
  const [companionAddress, setCompanionAddress] = useState("");
  const [companionBalance, setCompanionBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasStoredKey, setHasStoredKey] = useState<boolean | null>(null);
  const { toast } = useToast();

  // Check for stored signer key on mount
  useEffect(() => {
    if (wallets[0]?.address) {
      try {
        const stored = localStorage.getItem("rhinestone_signer_keys");
        const keys = stored ? JSON.parse(stored) : {};
        setHasStoredKey(!!keys[wallets[0].address.toLowerCase()]);
      } catch {
        setHasStoredKey(false);
      }
    }
  }, [wallets]);

  const checkBalance = async () => {
    if (!companionAddress) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const { getCompanionBalance } = await import("@/services/rhinestone");
      const balance = await getCompanionBalance(companionAddress, 8453);
      setCompanionBalance(balance.eth);
      setMessage({ type: "success", text: `Balance: ${balance.eth} ETH` });
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message || "Failed to check balance" });
    } finally {
      setIsLoading(false);
    }
  };

  const withdrawFunds = async () => {
    if (!companionAddress || !wallets[0]) {
      toast({ variant: "destructive", title: "Error", description: "Connect wallet and enter companion address" });
      return;
    }

    setWithdrawing(true);
    setMessage(null);
    try {
      const ethereumProvider = await wallets[0].getEthereumProvider();
      const { withdrawFromCompanion } = await import("@/services/rhinestone");

      const result = await withdrawFromCompanion({
        companionAddress,
        userAddress: wallets[0].address,
        ethereumProvider,
        recipient: wallets[0].address,
        chainId: 8453,
      });

      setMessage({ type: "success", text: `Withdrawal successful! TX: ${result.txHash.slice(0, 10)}...` });
      toast({ title: "Withdrawal successful!", description: "Funds sent to your wallet" });

      // Refresh balance
      await checkBalance();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message || "Withdrawal failed" });
      toast({ variant: "destructive", title: "Withdrawal failed", description: e?.message });
    } finally {
      setWithdrawing(false);
    }
  };

  const getCurrentCompanion = async () => {
    if (!wallets[0]) return;
    try {
      const { getCompanionAddress } = await import("@/services/rhinestone");
      const addr = await getCompanionAddress(wallets[0].address);
      setCompanionAddress(addr);
      toast({ title: "Current Companion", description: addr });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message });
    }
  };

  return (
    <div className="mt-8 mb-24 mx-auto max-w-xl p-4 border-2 border-dashed border-red-300 rounded-lg bg-red-50">
      <h3 className="text-lg font-bold text-red-800 mb-2">🔧 Debug: Companion Account Recovery</h3>
      <p className="text-sm text-red-600 mb-4">
        Use this to withdraw funds from any Rhinestone companion account you own.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700">Companion Address</label>
          <div className="flex gap-2 mt-1">
            <Input
              value={companionAddress}
              onChange={(e) => setCompanionAddress(e.target.value)}
              placeholder="0x7f86c6D89D..."
              className="flex-1 font-mono text-sm"
            />
            <Button variant="outline" size="sm" onClick={getCurrentCompanion}>
              Get Current
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={checkBalance}
            disabled={isLoading || !companionAddress}
            className="flex-1"
          >
            {isLoading ? "Checking..." : "Check Balance"}
          </Button>
          <Button
            onClick={withdrawFunds}
            disabled={withdrawing || !companionAddress}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          >
            {withdrawing ? "Withdrawing..." : "Withdraw All ETH"}
          </Button>
        </div>

        {message && (
          <div className={`p-2 rounded text-sm ${message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
            {message.text}
          </div>
        )}

        {hasStoredKey !== null && (
          <div className={`text-sm  mt-2 p-2 rounded border ${hasStoredKey ? "bg-green-50 border-green-200 text-green-800" : "bg-yellow-50 border-yellow-200 text-yellow-800"}`}>
            <strong>{hasStoredKey ? "✅ Signer Key Found" : "⚠️ No Signer Key Found"}</strong><br />
            {hasStoredKey
              ? "You can withdraw from companions created in this browser session."
              : "Companions created in previous sessions may not be recoverable."
            }
          </div>
        )}

        <div className="text-sm  text-gray-500 mt-2 p-2 bg-gray-100 rounded">
          <strong>Known stuck companions (keys lost):</strong><br />
          • 0x7f86c6D89D715082Ca64bbA78eF9d7421052F641<br />
          • 0x9353C0f04F8B4781ed2a8F67FC5037e51738B855<br /><br />
          <strong>To recover:</strong> Contact <a href="https://t.me/kurt_larsen" className="underline text-blue-600">Rhinestone support</a>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  const map: Record<string, { label: string; classes: string; icon: React.ReactNode }> = {
    INCOMPLETE_DEPOSIT: {
      label: "Incomplete deposit",
      classes: "bg-amber-50 text-amber-800 border-amber-200",
      icon: (
        <svg className="h-4 w-4 text-amber-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 7v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1" fill="currentColor" />
        </svg>
      ),
    },
    PENDING_DEPOSIT: {
      label: "Waiting for deposit",
      classes: "bg-amber-50 text-amber-800 border-amber-200",
      icon: (
        <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    PENDING: {
      label: "Pending",
      classes: "bg-amber-50 text-amber-800 border-amber-200",
      icon: (
        <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    PROCESSING: {
      label: "Processing",
      classes: "bg-blue-50 text-blue-800 border-blue-200",
      icon: <Loader2 className="h-4 w-4 text-blue-500" />,
    },
    SUCCESS: {
      label: "Completed",
      classes: "bg-emerald-50 text-emerald-800 border-emerald-200",
      icon: (
        <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    REFUNDED: {
      label: "Refunded",
      classes: "bg-sky-50 text-sky-800 border-sky-200",
      icon: (
        <svg className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 7H4V4M4 7a9 9 0 1 1-2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    EXPIRED: {
      label: "Expired",
      classes: "bg-gray-100 text-gray-700 border-gray-200",
      icon: (
        <svg className="h-4 w-4 text-gray-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 7v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M12 12l3 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      ),
    },
    FAILED: {
      label: "Failed",
      classes: "bg-red-50 text-red-800 border-red-200",
      icon: (
        <svg className="h-4 w-4 text-red-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ),
    },
  };
  const cfg = map[s] || map.PENDING_DEPOSIT;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${cfg.classes}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function MoneyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M6 9h0M18 15h0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChainIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M10 14l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="3" y="9" width="8" height="6" rx="3" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="9" width="8" height="6" rx="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ShareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 8l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


