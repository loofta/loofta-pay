"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { dealsApi, type DealPaymentResponse } from "@/services/api/deals";
import { TokenIcon } from "@/components/TokenIcon";
import {
  Loader2,
  ArrowLeft,
  Copy,
  CheckCircle,
  ExternalLink,
  Clock,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Dedicated screen to send payment: deposit address, open in wallet, deadline, mark as paid. */
export default function PayrollPaySendPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();

  const [dealPayments, setDealPayments] = useState<DealPaymentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [markPaidTarget, setMarkPaidTarget] = useState<DealPaymentResponse | null>(null);
  const [txHash, setTxHash] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const isPaymentExpired = (p: DealPaymentResponse) =>
    p.intent_deadline && new Date(p.intent_deadline).getTime() < Date.now();

  const walletExplorerUrl = (p: DealPaymentResponse) => {
    if (!p.deposit_address) return null;
    const chain = (p.preferred_network || "").toLowerCase();
    if (chain === "near") return "https://wallet.near.org/send-money";
    if (chain === "base") return `https://basescan.org/address/${p.deposit_address}`;
    if (chain === "ethereum" || chain === "eth") return `https://etherscan.io/address/${p.deposit_address}`;
    if (chain === "arbitrum" || chain === "arb") return `https://arbiscan.io/address/${p.deposit_address}`;
    if (chain === "optimism" || chain === "op") return `https://optimistic.etherscan.io/address/${p.deposit_address}`;
    if (chain === "polygon" || chain === "pol") return `https://polygonscan.com/address/${p.deposit_address}`;
    return null;
  };

  /** NEAR Intents explorer to view transaction by deposit address (like /swap page). */
  const nearExplorerTxUrl = (p: DealPaymentResponse) => {
    if (!p.deposit_address || (p.preferred_network || "").toLowerCase() !== "near") return null;
    return `https://explorer.near-intents.org/transactions/${p.deposit_address}`;
  };

  const loadPayments = () => {
    if (!userId || !orgId) return;
    setLoading(true);
    dealsApi.payments
      .listOutstanding(orgId, userId)
      .then(setDealPayments)
      .catch(() => setDealPayments([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!userId || !orgId) return;
    loadPayments();
  }, [userId, orgId]);

  const dealProcessing = dealPayments.filter((p) => p.status === "processing");
  const processingIdsKey = dealProcessing.map((p) => p.id).sort().join(",");
  useEffect(() => {
    if (dealProcessing.length === 0 || !userId || !orgId) return;
    const toPoll = [...dealProcessing];
    const interval = setInterval(async () => {
      for (const p of toPoll) {
        try {
          const result = await dealsApi.payments.checkComplete(orgId, p.id, userId);
          if (result.completed) {
            loadPayments();
            toast({ title: "Payment completed", description: "Invoice marked paid and attested on-chain." });
            return;
          }
        } catch {
          // ignore
        }
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [processingIdsKey, userId, orgId]);

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast({ title: "Copied", description: "Address copied to clipboard." });
  };

  const handleResetToPending = async (p: DealPaymentResponse) => {
    if (!userId || !orgId) return;
    setResettingId(p.id);
    try {
      await dealsApi.payments.resetToPending(orgId, p.id, userId);
      toast({ title: "Reset to pending", description: "You can Prepare pay again." });
      loadPayments();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setResettingId(null);
    }
  };

  const handleMarkPaid = async () => {
    if (!markPaidTarget || !userId || !orgId || !txHash.trim()) return;
    setMarkingPaid(true);
    try {
      await dealsApi.payments.markCompleted(orgId, markPaidTarget.id, txHash.trim(), userId);
      toast({ title: "Payment marked completed", description: "Invoice marked paid and attested on-chain." });
      setMarkPaidTarget(null);
      setTxHash("");
      loadPayments();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setMarkingPaid(false);
    }
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/payroll/${orgId}/pay`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Pay
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Send payment</CardTitle>
          <CardDescription>
            Send the amount to each deposit address below. We’ll detect completion and attest on-chain, or you can paste a tx hash to mark paid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : dealProcessing.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="font-medium text-gray-700">No payments ready to send</p>
              <p className="mt-1 text-sm">Go back and run Prepare pay to get deposit addresses.</p>
              <Link href={`/payroll/${orgId}/pay`}>
                <Button variant="outline" className="mt-4">
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back to Pay
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {dealProcessing.map((p) => {
                const expired = isPaymentExpired(p);
                const explorerUrl = walletExplorerUrl(p);
                const viewInExplorerUrl = nearExplorerTxUrl(p);
                const tokenForIcon = { symbol: p.preferred_token_symbol, chain: p.preferred_network };
                return (
                  <div key={p.id} className="rounded-xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-4">
                      <div className="text-base text-gray-600">Amount to pay</div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <TokenIcon token={tokenForIcon} chain={p.preferred_network} size={28} />
                        <span className="text-2xl font-semibold text-gray-900">{p.amount} {p.preferred_token_symbol}</span>
                        <span className="text-sm text-gray-500">on {p.preferred_network}</span>
                        {expired && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Expired</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-gray-600">Recipient: {p.recipient_email || "—"}</p>
                    </div>
                    {p.deposit_address && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Deposit address</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-sm bg-white border border-gray-200 px-3 py-2 rounded flex-1 min-w-0 font-mono truncate">
                            {p.deposit_address}
                          </code>
                          <Button variant="outline" size="sm" onClick={() => copyAddr(p.deposit_address!)}>
                            <Copy className="h-4 w-4 mr-1" /> Copy
                          </Button>
                          {explorerUrl && (
                            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" type="button">
                                <ExternalLink className="h-4 w-4 mr-1" />
                                {p.preferred_network?.toLowerCase() === "near" ? "Open NEAR Wallet" : "View on explorer"}
                              </Button>
                            </a>
                          )}
                          {viewInExplorerUrl && (
                            <a href={viewInExplorerUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" type="button">
                                <ExternalLink className="h-4 w-4 mr-1" />
                                View in explorer
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                    {p.intent_deadline && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-3">
                        <Clock className="h-3.5 w-3.5" />
                        Pay before: {new Date(p.intent_deadline).toLocaleString()}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-4">
                      <Button variant="outline" size="sm" onClick={() => { setMarkPaidTarget(p); setTxHash(""); }}>
                        <CheckCircle className="h-4 w-4 mr-1" /> Mark as paid (paste tx hash)
                      </Button>
                      {expired && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleResetToPending(p)}
                          disabled={resettingId === p.id}
                        >
                          {resettingId === p.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                          Prepare again
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!markPaidTarget} onOpenChange={(open) => !open && (setMarkPaidTarget(null), setTxHash(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark payment as paid</DialogTitle>
            <DialogDescription>Enter the transaction hash. The linked invoice will be marked paid and attested on-chain.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="send-txHash">Transaction hash</Label>
            <Input id="send-txHash" placeholder="0x... or tx hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} className="mt-1 font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMarkPaidTarget(null); setTxHash(""); }}>Cancel</Button>
            <Button onClick={handleMarkPaid} disabled={!txHash.trim() || markingPaid}>
              {markingPaid ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
