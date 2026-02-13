"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi, type DealPaymentResponse } from "@/services/api/deals";
import {
  Loader2,
  ArrowLeft,
  Wallet,
  Trash2,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
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
  const router = useRouter();
  const orgId = params?.orgId as string;
  const paymentIdFromQuery = searchParams?.get("payment");
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();

  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  const [dealPayments, setDealPayments] = useState<DealPaymentResponse[]>([]);
  const [dealSelectedIds, setDealSelectedIds] = useState<Set<string>>(new Set());
  const [dealDeleteTarget, setDealDeleteTarget] = useState<DealPaymentResponse | null>(null);
  const [dealDeleting, setDealDeleting] = useState(false);

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
    if (pending.some((p) => p.id === paymentIdFromQuery)) {
      setDealSelectedIds((prev) => new Set([...prev, paymentIdFromQuery]));
    }
  }, [paymentIdFromQuery, dealPayments]);

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
  const handlePaySelected = () => {
    const ids = Array.from(dealSelectedIds);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      router.push(`/payroll/${orgId}/pay/${ids[0]}`);
      return;
    }
    router.push(`/payroll/${orgId}/pay/batch?ids=${ids.join(",")}`);
  };

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
            loadDealPayments();
            toast({ title: "Payment completed", description: "Invoice marked paid and attested on-chain." });
            return;
          }
        } catch {
          // ignore per-payment errors
        }
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [processingIdsKey, userId, orgId]);

  const loadDealPayments = () => {
    if (!userId || !orgId) return;
    dealsApi.payments.listOutstanding(orgId, userId).then(setDealPayments).catch(() => setDealPayments([]));
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
        <CardHeader className="px-6 pt-6 pb-2 md:px-8">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Deal payments
          </CardTitle>
          <CardDescription className="mt-1.5">
            Amount and recipient only. Click Pay to choose network and complete payment via NEAR Intents.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4 md:px-8">
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
            <div className="space-y-4">
              {dealPending.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <p className="text-sm font-medium text-gray-700">Outstanding ({dealPayments.length})</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={dealSelectAll}>
                      {dealSelectedIds.size === dealPending.length && dealPending.length > 0 ? "Deselect all" : "Select all"}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white"
                      onClick={handlePaySelected}
                      disabled={dealSelectedIds.size === 0}
                    >
                      Pay selected ({dealSelectedIds.size}) <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dealPayments.map((p) => (
                  <div
                    key={p.id}
                    id={paymentIdFromQuery === p.id ? "highlight" : undefined}
                    className="rounded-2xl border border-gray-200 bg-white p-6 shadow-md flex flex-col gap-4 h-full transition-all duration-200 hover:shadow-lg"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {p.status === "pending" && (
                        <Checkbox
                          checked={dealSelectedIds.has(p.id)}
                          onCheckedChange={() => dealToggle(p.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 mt-0.5"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="text-xl font-bold text-gray-900">
                          {p.amount} <span className="text-gray-500 font-normal">{p.amount_currency}</span>
                        </h3>
                        <p className="mt-1 text-sm text-gray-600 truncate" title={p.recipient_email || p.recipient_wallet || "—"}>{p.recipient_email || p.recipient_wallet || "—"}</p>
                        {p.invoice_id && (
                          <Link
                            href={`/payroll/${orgId}/invoices/${p.invoice_id}`}
                            className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Invoice
                          </Link>
                        )}
                        <p className="mt-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
                          {p.created_at ? `Created ${new Date(p.created_at).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="mt-auto pt-2 flex items-center justify-between w-full flex-wrap gap-2">
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${p.status === "processing" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}>
                        {p.status}
                      </span>
                      <div className="flex items-center gap-2">
                        {p.status === "pending" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); setDealDeleteTarget(p); }} title="Delete payment">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button asChild size="sm" className="rounded-lg bg-orange-500 font-semibold text-white shadow-sm hover:shadow-md">
                          <Link href={`/payroll/${orgId}/pay/${p.id}`}>Pay</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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

    </div>
  );
}
