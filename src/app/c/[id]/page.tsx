'use client'

import { useEffect, useMemo, useState } from "react";
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

async function fetchClaim(id: string) {
  const r = await fetch(`/api/claims/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Claim not found");
  return (await r.json()).claim as { id: string; amount: string; to_symbol: string; to_chain: string; status: string };
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

export default function ClaimPayPage({ params }: { params: { id: string } }) {
  const { id } = params;
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
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [deposit, setDeposit] = useState<any>(null);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string; usd?: number; est?: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<any>(null);
  const [speedUpOpen, setSpeedUpOpen] = useState<boolean>(false);
  const [txInput, setTxInput] = useState<string>("");
  const [submittingTx, setSubmittingTx] = useState<boolean>(false);

  const selectedFrom = findTokenBySelection(tokens, fromSel || null);
  const destToken = useMemo(() => tokens.find(t => t.symbol === claim?.to_symbol && t.chain === claim?.to_chain), [tokens, claim?.to_symbol, claim?.to_chain]);
  const destUSD = useMemo(() => {
    const p = typeof destToken?.price === "number" ? destToken.price : null;
    const amt = Number(claim?.amount || 0);
    if (!p || !Number.isFinite(amt)) return null;
    return amt * p;
  }, [destToken?.price, claim?.amount]);

  // Hydrate UI state from persisted zustand on mount
  useEffect(() => {
    const entry = useClaimPayStore.getState().byId[id];
    if (entry?.fromSel) setFromSel(entry.fromSel as any);
    if (entry?.deposit) setDeposit(entry.deposit);
    if (entry?.status) setStatus(entry.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  useEffect(() => {
    let timer: any = null;
    async function tick(addr: string) {
      try {
        const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(addr)}`, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        const s = data?.status || data?.executionStatus || null;
        if (s) {
          setStatus(s);
          useClaimPayStore.getState().setStatus(id, s);
          setStatusData(data || null);
        }
        if (s && ["SUCCESS", "REFUNDED", "EXPIRED", "FAILED"].includes(String(s).toUpperCase())) {
          if (timer) clearInterval(timer);
        }
      } catch { }
    }
    if (deposit?.depositAddress) {
      // initial tick and then poll every 6s
      tick(deposit.depositAddress);
      timer = setInterval(() => tick(deposit.depositAddress), 15000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [deposit?.depositAddress]);

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
    <div className="min-h-screen bg-[#18181F] text-white pt-28">
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
                <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
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
                <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="text-gray-300 text-xl">Choose which token you want to pay with</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
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
                  <div className="mb-3 flex items-start justify-between">
                    <div className="text-sm font-medium text-gray-700">Payment request</div>
                    <StatusBadge status={status || "PENDING_DEPOSIT"} />
                  </div>
                  <div className="text-sm text-gray-700">Amount requested</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <div className="text-3xl md:text-4xl font-semibold text-gray-900 leading-none">
                      {destUSD != null ? `$${destUSD.toFixed(2)}` : `${claim.amount} ${claim.to_symbol}`}
                    </div>
                    <div className="text-sm text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <TokenIcon token={destToken ?? undefined} chain={destToken?.chain} size={16} />
                        {claim.amount} {claim.to_symbol}
                      </span>
                    </div>
                  </div>

                  {!deposit ? (
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
                        <div className="mt-4">
                          <GradientActionButton
                            onClick={onPrepare}
                            disabled={!selectedFrom || preparing}
                            loading={preparing}
                            loadingText="Preparing…"
                          >
                            Get deposit address
                          </GradientActionButton>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const s = String(status || "").toUpperCase();
                        const isTerminal = s === "FAILED" || s === "REFUNDED";
                        if (isTerminal) {
                          return (
                            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3">
                              <div className="text-sm font-semibold text-red-700">
                                {s === "FAILED" ? "Deposit failed." : "Deposit was refunded."}
                              </div>
                              <div className="text-xs text-red-700/80 mt-1">
                                Please try again with a different token or network.
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
                            </div>
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
                              {selectedFrom?.chain && ["eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism", "bsc", "polygon", "avax", "gnosis", "fantom"].includes(selectedFrom.chain.toLowerCase()) ? (
                                <Button disabled variant="outline">Pay now (coming soon)</Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              ) : (
                <div className="text-red-600">Claim not found.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
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


