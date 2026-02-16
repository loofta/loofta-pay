"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useToast } from "@/components/ui/use-toast";
import { dealsApi, type DealPaymentResponse } from "@/services/api/deals";
import { tokensApi, type Token } from "@/services/api/tokens";
import type { TokenSelection } from "@/app/utils/types";
import type { NearToken } from "@/services/nearIntents";
import { Loader2, ArrowLeft, Send } from "lucide-react";

/** Batch pay: select token once and get deposit addresses for multiple payments. */
export default function PayrollPayBatchPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = params?.orgId as string;
  const idsParam = searchParams?.get("ids") || "";
  const paymentIds = idsParam.split(",").filter(Boolean);
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();

  const [payments, setPayments] = useState<DealPaymentResponse[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [payWithToken, setPayWithToken] = useState<TokenSelection | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!userId || !orgId || paymentIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      dealsApi.payments.listOutstanding(orgId, userId),
      tokensApi.list().then((r) => r.tokens || []),
    ])
      .then(([allPayments, tokenList]) => {
        if (cancelled) return;
        const idSet = new Set(paymentIds);
        const pending = (allPayments || []).filter((p) => idSet.has(p.id) && p.status === "pending");
        setPayments(pending);
        setTokens(tokenList);
      })
      .catch(() => {
        if (!cancelled) setPayments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, orgId, idsParam]);

  const handleGetDepositAddress = async () => {
    if (!userId || !orgId || payments.length === 0 || !payWithToken?.symbol || !payWithToken?.chain) {
      toast({ variant: "destructive", title: "Choose a token", description: "Select a token to pay with." });
      return;
    }
    setPreparing(true);
    try {
      const result = await dealsApi.payments.preparePay(
        orgId,
        payments.map((p) => p.id),
        userId,
        payWithToken,
      );
      if (result.length === 0) {
        toast({
          variant: "destructive",
          title: "Could not prepare",
          description: "This token may not be supported for one or more payments. Try another.",
        });
        return;
      }
      toast({
        title: "Deposit addresses ready",
        description: result.length < payments.length ? `${result.length} of ${payments.length} prepared.` : "Send the amounts to the addresses below.",
      });
      router.push(`/payroll/${orgId}/pay/send`);
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setPreparing(false);
    }
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (paymentIds.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-gray-600">No payments selected.</p>
        <Link href={`/payroll/${orgId}/pay`}>
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Pay
          </Button>
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-gray-600">Selected payments not found or already in progress.</p>
        <Link href={`/payroll/${orgId}/pay`}>
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Pay
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/payroll/${orgId}/pay`}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Pay
          </Link>
        </Button>
      </div>

      <div className="rounded-xl border-2 border-gray-200 bg-white p-6 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Pay {payments.length} payment{payments.length !== 1 ? "s" : ""}</h2>
          <p className="text-sm text-gray-500 mt-0.5">Choose one token to pay all selected. You’ll get a deposit address per payment.</p>
        </div>

        <div className="space-y-3">
          {payments.map((p) => (
            <div key={p.id} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xl font-semibold text-gray-900">{p.amount}</span>
                <span className="text-gray-500">{p.amount_currency}</span>
              </div>
              <p className="text-sm text-gray-600 mt-1">{p.recipient_email || p.recipient_wallet || "—"}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Pay with</div>
          <TokenCombobox
            tokens={tokens.filter((t) =>
              ["USDC", "USDT", "DAI"].includes((t.symbol || "").toUpperCase())
            ) as NearToken[]}
            value={payWithToken}
            onChange={setPayWithToken}
            placeholder="Select token (USDC, USDT, DAI)"
            onQuery={async (q) => {
              const qq = (q || "").toLowerCase();
              return tokens.filter(
                (t) =>
                  ["USDC", "USDT", "DAI"].includes((t.symbol || "").toUpperCase()) &&
                  ((t.symbol || "").toLowerCase().includes(qq) || (t.name || "").toLowerCase().includes(qq))
              ) as NearToken[];
            }}
            defaultShowAllChains={true}
            className="bg-white border border-gray-200 w-full h-12 text-base rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
          />
        </div>

        <Button
          size="lg"
          className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          onClick={handleGetDepositAddress}
          disabled={!payWithToken?.symbol || preparing}
        >
          {preparing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Get deposit addresses
        </Button>
      </div>
    </div>
  );
}
