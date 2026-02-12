"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi, type DealPaymentResponse } from "@/services/api/deals";
import {
  Send,
  Loader2,
  ArrowLeft,
  Wallet,
  Copy,
  Trash2,
  CheckCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

/** Pay: deal payments only (from accepted deliveries). Prepare pay or mark as paid. */
export default function PayrollPayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgId = params?.orgId as string;
  const paymentIdFromQuery = searchParams?.get("payment");
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();

  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  const [dealPayments, setDealPayments] = useState<DealPaymentResponse[]>([]);
  const [dealSelectedIds, setDealSelectedIds] = useState<Set<string>>(new Set());
  const [preparePayLoading, setPreparePayLoading] = useState(false);
  const [dealPrepared, setDealPrepared] = useState<DealPaymentResponse[]>([]);
  const [dealDeleteTarget, setDealDeleteTarget] = useState<DealPaymentResponse | null>(null);
  const [dealDeleting, setDealDeleting] = useState(false);
  const [markPaidTarget, setMarkPaidTarget] = useState<DealPaymentResponse | null>(null);
  const [txHash, setTxHash] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      payrollApi.organizations.get(orgId, userId),
      dealsApi.payments.listOutstanding(orgId, userId),
    ])
      .then(([org, outstanding]) => {
        if (!cancelled) {
          setOrganization(org);
          setDealPayments(outstanding || []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load";
          toast({ variant: "destructive", title: "Error", description: message });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, orgId, toast]);

  const dealPending = dealPayments.filter((p) => p.status === "pending");

  useEffect(() => {
    if (!paymentIdFromQuery || dealPayments.length === 0) return;
    const pending = dealPayments.filter((p) => p.status === "pending");
    const found = pending.some((p) => p.id === paymentIdFromQuery);
    if (found) setDealSelectedIds((prev) => new Set([...prev, paymentIdFromQuery]));
  }, [paymentIdFromQuery, dealPayments]);
  const dealProcessing = dealPayments.filter((p) => p.status === "processing");
  const dealToggle = (id: string) => {
    setDealSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const dealSelectAll = () => {
    if (dealSelectedIds.size === dealPending.length) setDealSelectedIds(new Set());
    else setDealSelectedIds(new Set(dealPending.map((p) => p.id)));
  };
  const loadDealPayments = () => {
    if (!userId || !orgId) return;
    dealsApi.payments.listOutstanding(orgId, userId).then(setDealPayments).catch(() => setDealPayments([]));
  };
  const handleDealPreparePay = async () => {
    if (!userId || !orgId || dealSelectedIds.size === 0) return;
    setPreparePayLoading(true);
    try {
      const result = await dealsApi.payments.preparePay(orgId, Array.from(dealSelectedIds), userId);
      setDealPrepared(result);
      toast({ title: "Deposit addresses ready", description: `${result.length} payment(s) prepared.` });
      loadDealPayments();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setPreparePayLoading(false);
    }
  };
  const handleDealMarkPaid = async () => {
    if (!markPaidTarget || !userId || !orgId || !txHash.trim()) return;
    setMarkingPaid(true);
    try {
      await dealsApi.payments.markCompleted(orgId, markPaidTarget.id, txHash.trim(), userId);
      toast({ title: "Payment marked completed", description: "Invoice marked paid and attested on-chain." });
      setMarkPaidTarget(null);
      setTxHash("");
      loadDealPayments();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setMarkingPaid(false);
    }
  };
  const handleDealDelete = async () => {
    if (!dealDeleteTarget || !userId || !orgId) return;
    setDealDeleting(true);
    try {
      await dealsApi.payments.delete(orgId, dealDeleteTarget.id, userId);
      toast({ title: "Payment deleted", description: "Invoice unlinked; deal reverted to delivered." });
      setDealDeleteTarget(null);
      loadDealPayments();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setDealDeleting(false);
    }
  };
  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast({ title: "Copied", description: "Address copied to clipboard." });
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (loading || !organization) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/payroll/${orgId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pay</h1>
          <p className="text-sm text-gray-500">
            Deal payments from accepted deliveries. Prepare pay or mark as paid.
          </p>
        </div>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader className="px-6 pt-6 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Deal payments
          </CardTitle>
          <CardDescription className="mt-1.5">
            Pending payments from accepted deliveries. Select and prepare pay (batch via NEAR intent), or mark as paid when done.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4">
          {dealPayments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-8 py-10 text-center">
              <Wallet className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">No deal payments yet</p>
              <p className="mt-1.5 text-xs text-gray-500">Accept delivery on a deal to create a payment, then return here to pay.</p>
              <Link href={`/payroll/${orgId}/deals`}>
                <Button variant="outline" className="mt-4">View Deals</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <span className="text-sm font-medium text-gray-700">Pending ({dealPending.length})</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={dealSelectAll}>
                    {dealSelectedIds.size === dealPending.length && dealPending.length > 0 ? "Deselect all" : "Select all"}
                  </Button>
                  <Button size="sm" onClick={handleDealPreparePay} disabled={dealSelectedIds.size === 0 || preparePayLoading}>
                    {preparePayLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Prepare pay ({dealSelectedIds.size})
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {dealPending.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                    <Checkbox checked={dealSelectedIds.has(p.id)} onCheckedChange={() => dealToggle(p.id)} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{p.amount} {p.amount_currency}</span>
                      <span className="text-gray-500 text-sm ml-2">→ {p.preferred_network} / {p.preferred_token_symbol}</span>
                    </div>
                    <span className="text-xs text-gray-400 truncate max-w-[120px]">{p.recipient_wallet}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDealDeleteTarget(p)} title="Delete payment">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {dealProcessing.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm font-medium text-gray-700 mb-2">Awaiting payment ({dealProcessing.length})</p>
                  {dealProcessing.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{p.amount} {p.amount_currency}</span>
                        <span className="text-gray-500 text-sm ml-2">→ {p.preferred_network} / {p.preferred_token_symbol}</span>
                      </div>
                      {p.deposit_address && (
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-gray-100 px-2 py-1 rounded truncate max-w-[140px]">{p.deposit_address}</code>
                          <Button variant="ghost" size="sm" onClick={() => copyAddr(p.deposit_address!)}><Copy className="h-4 w-4" /></Button>
                        </div>
                      )}
                      <Button variant="outline" size="sm" onClick={() => { setMarkPaidTarget(p); setTxHash(""); }}>
                        <CheckCircle className="h-4 w-4 mr-1" /> Mark as paid
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {dealPrepared.length > 0 && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <p className="text-sm font-medium text-gray-700">Send to these addresses</p>
                  {dealPrepared.map((p) => (
                    <div key={p.id} className="rounded-lg border p-3 space-y-1">
                      <p className="text-sm font-medium">{p.amount} {p.preferred_token_symbol} on {p.preferred_network}</p>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">{p.deposit_address}</code>
                        <Button variant="ghost" size="sm" onClick={() => copyAddr(p.deposit_address!)}><Copy className="h-4 w-4" /></Button>
                      </div>
                      {p.intent_deadline && <p className="text-xs text-gray-500">Deadline: {new Date(p.intent_deadline).toLocaleString()}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!dealDeleteTarget} onOpenChange={(open) => !open && setDealDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payment?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the pending payment, unlink the invoice, and revert the deal to delivered. You can accept delivery again to create a new payment.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dealDeleting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDealDelete} disabled={dealDeleting}>
              {dealDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!markPaidTarget} onOpenChange={(open) => !open && (setMarkPaidTarget(null), setTxHash(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark payment as paid</DialogTitle>
            <DialogDescription>Enter the transaction hash from the NEAR intent execution. The linked invoice will be marked paid and attested on-chain.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="pay-txHash">Transaction hash</Label>
            <Input id="pay-txHash" placeholder="0x... or tx hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} className="mt-1 font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMarkPaidTarget(null); setTxHash(""); }}>Cancel</Button>
            <Button onClick={handleDealMarkPaid} disabled={!txHash.trim() || markingPaid}>
              {markingPaid ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
