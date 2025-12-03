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
import { isBiconomySupportedChain, isEvmChainId } from "@/config/biconomy";
import { createSupertransaction, getBiconomyStatus } from "@/services/biconomy";
import { ethers } from "ethers";
import { usePrivy, useWallets } from "@privy-io/react-auth";

async function fetchClaim(id: string) {
  const r = await fetch(`/api/claims/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Claim not found");
  return (await r.json()).claim as { id: string; amount: string; to_symbol: string; to_chain: string; status: string; recipient_address?: string };
}

async function prepareDeposit(input: {
  claimId: string;
  fromToken: { tokenId: string; decimals: number; chain: string };
  amount: string;
}) {
  const r = await fetch(`/api/claims/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Failed to prepare deposit");
  return await r.json();
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
  const biconomyEligible = useMemo(() => {
    if (!selectedFrom || !destToken) return false;
    return sameChain && isEvmChainId(selectedFrom.chain) && isBiconomySupportedChain(selectedFrom.chain);
  }, [selectedFrom, destToken, sameChain]);
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

  // Hydrate from latest-intent cache
  useEffect(() => {
    const d: any = latestIntentQuery.data;
    if (!d) return;
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
    if (d?.status && !status) {
      const s = String(d.status);
      setStatus(s);
      useClaimPayStore.getState().setStatus(id, s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestIntentQuery.data]);

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

  // Try to hydrate deposit from backend so anyone opening the link sees status
  useEffect(() => {
    (async () => {
      if (deposit || !id) return;
      try {
        const r = await fetch(`/api/claims/${id}/latest-intent`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (d?.depositAddress) {
          setDeposit({ depositAddress: d.depositAddress, memo: d.memo ?? null, deadline: d.deadline, quoteId: d.quoteId, minDepositFormatted: d.minDepositFormatted });
          useClaimPayStore.getState().setDeposit(id, { depositAddress: d.depositAddress, memo: d.memo ?? null, deadline: d.deadline, quoteId: d.quoteId, minDepositFormatted: d.minDepositFormatted });
        }
        if (d?.status) {
          const s = String(d.status);
          setStatus(s);
          useClaimPayStore.getState().setStatus(id, s);
        }
      } catch { }
    })();
  }, [id, deposit]);
  async function onPrepare() {
    if (!claim || !selectedFrom) return;
    // If same-chain EVM and supported by Biconomy, skip deposit flow (use Pay now)
    if (biconomyEligible) {
      return;
    }
    setPreparing(true);
    setDeposit(null);
    try {
      useClaimPayStore.getState().setFromSel(id, { symbol: selectedFrom.symbol, chain: selectedFrom.chain } as any);
      const res = await prepareDeposit({
        claimId: id,
        fromToken: { tokenId: selectedFrom.tokenId || selectedFrom.address, decimals: selectedFrom.decimals, chain: selectedFrom.chain },
        amount: claim.amount,
      });
      setDeposit(res);
      useClaimPayStore.getState().setDeposit(id, {
        depositAddress: res.depositAddress,
        memo: res.memo ?? null,
        deadline: res.deadline,
        quoteId: res.quoteId,
        minDepositFormatted: res.minDepositFormatted,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to prepare", description: e?.message || "Could not obtain deposit info" });
    } finally {
      setPreparing(false);
    }
  }

  async function onPayNow() {
    if (!claim || !selectedFrom || !destToken) return;
    if (!biconomyEligible) {
      toast({ variant: "destructive", title: "Not supported", description: "This network is not supported for direct pay." });
      return;
    }
    try {
      const wallet = wallets[0];
      if (!wallet) {
        toast({ variant: "destructive", title: "No wallet", description: "Please connect a wallet to continue." });
        return;
      }

      const ethereumProvider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(ethereumProvider);
      const signer = await provider.getSigner();
      const ownerAddress = await signer.getAddress();

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

      console.log("[Biconomy] Starting payment:", {
        from: selectedFrom.symbol,
        to: destToken.symbol,
        amount: amountHuman,
        recipient
      });

      // Create Biconomy Supertransaction (sponsorship handles fees)
      const payload = await createSupertransaction({
        fromToken: {
          tokenId: selectedFrom.tokenId || selectedFrom.address,
          address: selectedFrom.address,
          decimals: selectedFrom.decimals,
          chain: selectedFrom.chain,
          symbol: selectedFrom.symbol,
          name: selectedFrom.name || selectedFrom.symbol
        },
        toToken: {
          tokenId: destToken.tokenId || destToken.address,
          address: destToken.address,
          decimals: destToken.decimals,
          chain: destToken.chain,
          symbol: destToken.symbol,
          name: destToken.name || destToken.symbol
        },
        amountHuman,
        recipient,
        userAddress: ownerAddress,
      });

      const { to, data, value, chainId, id: intentId } = payload || {};
      if (!to || !data) {
        throw new Error("Invalid transaction payload");
      }

      // Switch chain if needed
      if (chainId) {
        try {
          await wallet.switchChain(Number(chainId));
        } catch { }
      }

      // Send transaction
      const tx = await signer.sendTransaction({
        to,
        data,
        value: value ? BigInt(value) : undefined
      });

      // Wait for on-chain confirmation
      await tx.wait();
      setStatus("SUCCESS");
      toast({ title: "Transaction confirmed", description: "Payment successful." });

      // Optional: Poll Biconomy status in background
      if (intentId) {
        const iv = setInterval(async () => {
          try {
            const s = await getBiconomyStatus(intentId);
            const st = String(s?.status || "").toUpperCase();
            if (st === "SUCCESS" || st === "FAILED") {
              if (st === "FAILED") setStatus("FAILED");
              clearInterval(iv);
            }
          } catch { clearInterval(iv); }
        }, 5000);
        setTimeout(() => clearInterval(iv), 120000);
      }
    } catch (e: any) {
      setStatus("FAILED");
      toast({ variant: "destructive", title: "Payment failed", description: e?.message || "Could not complete payment" });
    } finally {
      setPreparing(false);
    }
  }

  // Cache and refresh status via TanStack Query
  const statusQuery = useQuery({
    queryKey: ["status", deposit?.depositAddress],
    enabled: !!deposit?.depositAddress,
    queryFn: async () => {
      const addr = deposit?.depositAddress as string;
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
      useClaimPayStore.getState().setStatus(id, s);
      setStatusData(statusQuery.data || null);
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
    } finally {
      setSubmittingTx(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <div className="flex flex-col md:flex-row items-center justify-center gap-32 min-h-[calc(100vh-7rem)]">
            {/* Left column - text/summary */}
            <div className="w-full md:w-1/2">
              <h1 className="text-5xl md:text-6xl font-medium font-display text-white leading-tight mb-8">
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
            </div>

            {/* Right column - card */}
            <div className="w-full md:w-1/2">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-gray-900">
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
                                  <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={14} />
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
                                      <TokenIcon token={(paidToken as any) ?? (selectedFrom as any)} chain={(paidToken?.chain as any) ?? (selectedFrom?.chain as any)} size={14} />
                                      <span>{paid != null ? roundUpDecimals(String(paid), 6) : "—"} {sym || ""}{chain ? ` on ${String(chain)}` : ""}</span>
                                    </>
                                  );
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mb-3 flex items-start justify-between">
                          <div className="text-sm font-medium text-gray-700">Payment request</div>
                          {deposit?.depositAddress ? <StatusBadge status={status || "PENDING_DEPOSIT"} /> : null}
                        </div>
                        <div className="text-sm text-gray-700">Amount requested</div>
                        <div className="mt-1 flex items-baseline justify-between">
                          <div className="text-3xl md:text-4xl font-semibold text-gray-900 leading-none">
                            {destUSD != null ? `$${destUSD.toFixed(2)}` : `—`}
                          </div>
                          <div className="text-sm text-gray-500">
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
                        <div className="mt-6">
                          <div className="text-sm font-medium text-gray-700 mb-2">Pay with</div>
                          <TokenCombobox
                            tokens={tokens}
                            value={fromSel}
                            onChange={setFromSel}
                            placeholder="Select token to pay with"
                            onQuery={async (q) => tokens.filter(t => t.symbol.toLowerCase().includes((q || '').toLowerCase()))}
                            className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50 w-full h-14 text-lg text-center focus:ring-0 focus-visible:ring-0 focus:outline-none focus:border-orange-400 transition-colors"
                          />
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

                            {biconomyEligible ? (
                              <div className="flex w-full gap-2">
                                {wallets.length === 0 ? (
                                  <Button
                                    onClick={login}
                                    className="rounded-xl w-full"
                                    style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                                  >
                                    Connect Wallet
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      onClick={onPayNow}
                                      disabled={preparing}
                                      className="rounded-xl flex-1"
                                      style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                                    >
                                      {preparing ? "Processing…" : "Pay now"}
                                    </Button>
                                    <Button variant="outline" onClick={logout} className="rounded-xl px-3" title="Disconnect Wallet">
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                        <polyline points="16 17 21 12 16 7" />
                                        <line x1="21" y1="12" x2="9" y2="12" />
                                      </svg>
                                    </Button>
                                  </>
                                )}
                              </div>
                            ) : <GradientActionButton
                              onClick={onPrepare}
                              disabled={!selectedFrom || preparing || biconomyEligible}
                              loading={preparing && !biconomyEligible}
                              loadingText="Preparing…"
                            >
                              Get deposit address
                            </GradientActionButton>}
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
                                        {destUSD != null ? `$${destUSD.toFixed(2)}` : "—"}
                                        <span className="mx-1 text-gray-400">•</span>
                                        <span className="inline-flex items-center gap-1">
                                          <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={24} />
                                          {destTokenAmount != null ? roundUpDecimals(String(destTokenAmount), 6) : "—"} {claim.to_symbol}
                                          <span className="mx-1 text-gray-400">•</span>
                                          {(() => {
                                            const chain = destToken?.chain;
                                            const src = getChainIcon(chain);
                                            return src ? <Image src={src} alt="chain" width={24} height={24} sizes="24px" unoptimized={/^https?:\/\//.test(src)} /> : null;
                                          })()}
                                          {String(destToken?.chain || "")}
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
                                  <div className="text-xs text-red-700/80 mt-1">
                                    Please try again with a different token or network.
                                  </div>
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setDeposit(null);
                                      setStatus(null);
                                      useClaimPayStore.getState().setDeposit(id, null);
                                      useClaimPayStore.getState().setStatus(id, null);
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
                              <div className="text-sm text-gray-700">Send exactly</div>
                              <div className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                                <TokenIcon
                                  token={(selectedFrom as any) ?? (destToken as any) ?? undefined}
                                  chain={(selectedFrom?.chain as any) ?? (destToken?.chain as any)}
                                  size={18}
                                />
                                <span>
                                  {quote?.amountInFormatted && selectedFrom
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
                                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
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
                              <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 text-orange-800 text-xs px-3 py-2">
                                Only deposit {selectedFrom?.symbol} from the {String(selectedFrom?.chain || "").toUpperCase()} network. Using another token or network may result in loss of funds.
                              </div>
                              {String(status || "").toUpperCase() === "INCOMPLETE_DEPOSIT" ? (
                                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs px-3 py-2">
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
                                    <div className="text-xs text-gray-600">Paste a hash or an explorer link — we’ll extract the hash automatically.</div>
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
                                  setDeposit(null);
                                  setStatus(null);
                                  useClaimPayStore.getState().setDeposit(id, null);
                                  useClaimPayStore.getState().setStatus(id, null);
                                }} className="ml-auto">Cancel & choose another token</Button>
                                {biconomyEligible ? (
                                  <Button onClick={onPayNow} disabled={preparing} className="rounded-xl" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}>
                                    {preparing ? "Processing…" : "Pay now"}
                                  </Button>
                                ) : null}
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
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  const map: Record<string, { label: string; classes: string; icon: JSX.Element }> = {
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


