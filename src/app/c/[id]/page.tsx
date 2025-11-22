'use client'

import { useEffect, useMemo, useState } from "react";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { trimDecimals } from "@/lib/format";
import { findTokenBySelection } from "@/lib/tokens";

async function fetchClaim(id: string) {
  const r = await fetch(`/api/claims/${id}`, { cache: "no-store" });
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
  const [claim, setClaim] = useState<any>(null);
  const [loadingClaim, setLoadingClaim] = useState(true);
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [deposit, setDeposit] = useState<any>(null);
  const [preparing, setPreparing] = useState(false);
  const [quote, setQuote] = useState<{ amountInFormatted?: string; usd?: number; est?: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const selectedFrom = findTokenBySelection(tokens, fromSel || null);
  const destToken = useMemo(() => tokens.find(t => t.symbol === claim?.to_symbol && t.chain === claim?.to_chain), [tokens, claim?.to_symbol, claim?.to_chain]);
  const destUSD = useMemo(() => {
    const p = typeof destToken?.price === "number" ? destToken.price : null;
    const amt = Number(claim?.amount || 0);
    if (!p || !Number.isFinite(amt)) return null;
    return amt * p;
  }, [destToken?.price, claim?.amount]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await fetchClaim(id);
        if (mounted) setClaim(c);
      } catch (e: any) {
        toast({ variant: "destructive", title: "Claim not found", description: e?.message || "Invalid claim id" });
      } finally {
        if (mounted) setLoadingClaim(false);
      }
    })();
    return () => { mounted = false; };
  }, [id, toast]);

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
      const res = await prepareDeposit({
        claimId: id,
        fromToken: { tokenId: selectedFrom.tokenId || selectedFrom.address, decimals: selectedFrom.decimals, chain: selectedFrom.chain },
        amount: claim.amount,
      });
      setDeposit(res);
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
        if (s) setStatus(s);
        if (s && ["SUCCESS", "REFUNDED", "EXPIRED", "FAILED"].includes(String(s).toUpperCase())) {
          if (timer) clearInterval(timer);
        }
      } catch { }
    }
    if (deposit?.depositAddress) {
      // initial tick and then poll every 6s
      tick(deposit.depositAddress);
      timer = setInterval(() => tick(deposit.depositAddress), 6000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [deposit?.depositAddress]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-bold">Pay claim</h1>
      {loadingClaim ? (
        <div className="mt-6"><Skeleton className="h-24 w-full" /></div>
      ) : claim ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border p-4 bg-white">
            <div className="text-gray-700 text-sm">Amount requested</div>
            <div className="text-xl font-semibold">{claim.amount} {claim.to_symbol} on {claim.to_chain.toUpperCase()}</div>
            <div className="text-sm text-gray-600">{destUSD != null ? `≈ $${destUSD.toFixed(2)}` : ""}</div>
          </div>
          <div className="rounded-xl border p-4 bg-white">
            <div className="text-gray-700 text-sm mb-2">Pay with</div>
            <TokenCombobox
              tokens={tokens}
              value={fromSel}
              onChange={setFromSel}
              placeholder="Select token to pay with"
              onQuery={async (q) => tokens.filter(t => t.symbol.toLowerCase().includes((q || '').toLowerCase()))}
              className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50 w-full"
            />
            {selectedFrom ? (
              <div className="mt-2 text-sm text-gray-700">
                {quote?.amountInFormatted
                  ? `Estimated to send: ${quote.amountInFormatted} ${selectedFrom.symbol}`
                  : quote?.est
                    ? `Estimated to send: ${trimDecimals(String(quote.est), 6)} ${selectedFrom.symbol}`
                    : quote?.usd
                      ? `Estimated cost ≈ $${quote.usd.toFixed(2)}`
                      : ""}
              </div>
            ) : null}
            <div className="mt-3">
              <Button disabled={!selectedFrom || preparing} onClick={onPrepare} className="rounded-xl" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}>
                {preparing ? "Preparing…" : "Get deposit address"}
              </Button>
            </div>
          </div>
          {deposit ? (
            <div className="rounded-xl border p-4 bg-white">
              <div className="text-sm text-gray-700">Send exactly</div>
              <div className="text-lg font-semibold">
                {quote?.amountInFormatted && selectedFrom
                  ? `${quote.amountInFormatted} ${selectedFrom.symbol}`
                  : `${claim.amount} ${claim.to_symbol}`}
              </div>
              <div className="mt-3 text-sm text-gray-700">Deposit address</div>
              <div className="mt-1 font-mono text-sm break-all">{deposit.depositAddress || "—"}</div>
              <div className="mt-3 text-sm text-gray-700">Status: <span className="font-medium">{status || "PENDING"}</span></div>
              {deposit.memo ? (
                <>
                  <div className="mt-3 text-sm text-gray-700">Memo</div>
                  <div className="mt-1 font-mono text-sm break-all">{deposit.memo}</div>
                </>
              ) : null}
              {deposit.deadline ? (
                <div className="mt-3 text-sm text-gray-700">Deadline: <span className="font-medium">{new Date(deposit.deadline).toLocaleString()}</span></div>
              ) : null}
              <div className="mt-4 flex gap-2">
                <Button variant="outline" onClick={() => {
                  // Manual deposit: just keep showing address
                  toast({ title: "Manual deposit", description: "Send funds to the address above from your wallet." });
                }}>Manual deposit</Button>
                {/* Placeholder for pay-now; real integration needs token transfer support */}
                {selectedFrom?.chain && ["eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism", "bsc", "polygon", "avax", "gnosis", "fantom"].includes(selectedFrom.chain.toLowerCase()) ? (
                  <Button disabled variant="outline">Pay now (coming soon)</Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 text-red-600">Claim not found.</div>
      )}
    </div>
  );
}


