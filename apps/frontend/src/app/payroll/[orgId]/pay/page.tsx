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
  FileSpreadsheet,
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
import { EmptyState } from "@/components/ui/EmptyState";

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
  const [completedPayments, setCompletedPayments] = useState<DealPaymentResponse[]>([]);
  const [dealSelectedIds, setDealSelectedIds] = useState<Set<string>>(new Set());
  const [dealDeleteTarget, setDealDeleteTarget] = useState<DealPaymentResponse | null>(null);
  const [dealDeleting, setDealDeleting] = useState(false);
  const [payTab, setPayTab] = useState<"deal-payments" | "bulk-payment">("deal-payments");

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      payrollApi.organizations.get(orgId, userId),
      dealsApi.payments.listOutstanding(orgId, userId),
      dealsApi.payments.listCompleted(orgId, userId),
    ])
      .then(([org, outstanding, completed]) => {
        if (!cancelled) {
          setOrganization(org);
          setDealPayments(outstanding || []);
          setCompletedPayments(completed || []);
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

  // On load and when we have processing payments, run checkComplete once immediately so we sync if intent finished
  useEffect(() => {
    if (dealProcessing.length === 0 || !userId || !orgId) return;
    Promise.all(
      dealProcessing.map((p) =>
        dealsApi.payments.checkComplete(orgId, p.id, userId).then((r) => ({ id: p.id, ...r }))
      )
    ).then((results) => {
      if (results.some((r) => r.completed)) {
        loadDealPayments();
        toast({ title: "Payment completed", description: "Invoice marked paid." });
      }
    }).catch(() => {});
  }, [processingIdsKey, userId, orgId]);

  useEffect(() => {
    if (dealProcessing.length === 0 || !userId || !orgId) return;
    const toPoll = [...dealProcessing];
    const interval = setInterval(async () => {
      for (const p of toPoll) {
        try {
          const result = await dealsApi.payments.checkComplete(orgId, p.id, userId);
          if (result.completed) {
            loadDealPayments();
            toast({ title: "Payment completed", description: "Invoice marked paid." });
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
    Promise.all([
      dealsApi.payments.listOutstanding(orgId, userId),
      dealsApi.payments.listCompleted(orgId, userId),
    ]).then(([outstanding, completed]) => {
      setDealPayments(outstanding || []);
      setCompletedPayments(completed || []);
    }).catch(() => {
      setDealPayments([]);
      setCompletedPayments([]);
    });
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
            Deal payments from accepted deliveries, or bulk pay from CSV (coming soon).
          </p>
        </div>
      </div>

      <div className="mb-4 flex rounded-lg border border-gray-200 bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setPayTab("deal-payments")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors ${
            payTab === "deal-payments" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <Wallet className="h-4 w-4" />
          Deal payments
        </button>
        <button
          type="button"
          onClick={() => setPayTab("bulk-payment")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors ${
            payTab === "bulk-payment" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Bulk payment
        </button>
      </div>

      {payTab === "bulk-payment" ? (
        <Card className="border-gray-200 bg-white">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileSpreadsheet className="h-12 w-12 text-gray-400" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">Pay from CSV</h2>
            <p className="mt-2 max-w-sm text-sm text-gray-500">
              Upload a CSV with wallet, network, token and amount to pay multiple recipients in one go.
            </p>
            <span className="mt-4 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
              Coming soon
            </span>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-gray-200 bg-white">
          <CardHeader className="px-6 pt-6 pb-2 md:px-8">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Deal payments
            </CardTitle>
            <CardDescription className="mt-1.5">
              Amount and recipient. Select multiple rows and use &quot;Pay selected&quot; for bulk payment, or click Pay per row. Payments complete via NEAR Intents.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4 md:px-8">
            {dealPayments.length === 0 && completedPayments.length === 0 ? (
              <EmptyState
                icon={Wallet}
                message="You have no deal payments"
                description="Accept delivery on a deal to create a payment, then return here to pay."
                action={
                  <Button asChild variant="outline">
                    <Link href={`/payroll/${orgId}/deals`}>View deals</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {dealPayments.length > 0 ? (
                  <>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-3 pr-2 w-10 font-medium text-gray-700"></th>
                            <th className="pb-3 pr-4 font-medium text-gray-700">Amount</th>
                            <th className="pb-3 pr-4 font-medium text-gray-700">Recipient</th>
                            <th className="pb-3 pr-4 font-medium text-gray-700">Created</th>
                            <th className="pb-3 pr-4 font-medium text-gray-700">Status</th>
                            <th className="pb-3 pl-4 font-medium text-gray-700 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dealPayments.map((p) => (
                            <tr
                              key={p.id}
                              id={paymentIdFromQuery === p.id ? "highlight" : undefined}
                              className="border-b last:border-0 hover:bg-gray-50/80"
                            >
                              <td className="py-4 pr-2 w-10 align-top pt-5">
                                {p.status === "pending" && (
                                  <Checkbox
                                    checked={dealSelectedIds.has(p.id)}
                                    onCheckedChange={() => dealToggle(p.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="shrink-0"
                                  />
                                )}
                              </td>
                              <td className="py-4 pr-4">
                                <span className="font-semibold text-gray-900">{p.amount}</span>
                                <span className="text-gray-500 ml-1">{p.amount_currency}</span>
                              </td>
                              <td className="py-4 pr-4">
                                <p className="text-sm text-gray-700 truncate max-w-[200px]" title={p.recipient_email || p.recipient_wallet || "—"}>
                                  {p.recipient_email || p.recipient_wallet || "—"}
                                </p>
                                {p.invoice_id && (
                                  <Link
                                    href={`/payroll/${orgId}/invoices/${p.invoice_id}`}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 mt-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3 w-3 shrink-0" /> Invoice
                                  </Link>
                                )}
                              </td>
                              <td className="py-4 pr-4 text-sm text-gray-500">
                                {p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-4 pr-4">
                                <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${p.status === "processing" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}>
                                  {p.status}
                                </span>
                              </td>
                              <td className="py-4 pl-4 text-right">
                                <div className="flex items-center justify-end gap-1 flex-wrap">
                                  {p.deposit_address && (p.preferred_network?.toLowerCase() === "near") && (
                                    <a
                                      href={`https://explorer.near-intents.org/transactions/${p.deposit_address}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      View in explorer <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                  {p.status === "pending" && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); setDealDeleteTarget(p); }} title="Delete payment">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button asChild size="sm" className="rounded-lg bg-orange-500 font-semibold text-white">
                                    <Link href={`/payroll/${orgId}/pay/${p.id}`}>Pay</Link>
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">No outstanding payments.</p>
                )}
                {completedPayments.length > 0 && (
                  <div className={dealPayments.length > 0 ? "mt-8 pt-6 border-t border-gray-200" : ""}>
                    <p className="text-sm font-medium text-gray-700 mb-4">Paid ({completedPayments.length})</p>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-3 pr-4 font-medium text-gray-700">Amount</th>
                            <th className="pb-3 pr-4 font-medium text-gray-700">Recipient</th>
                            <th className="pb-3 pr-4 font-medium text-gray-700">Paid</th>
                            <th className="pb-3 pl-4 font-medium text-gray-700 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {completedPayments.map((p) => (
                            <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50/80">
                              <td className="py-4 pr-4">
                                <span className="font-semibold text-gray-900">{p.amount}</span>
                                <span className="text-gray-500 ml-1">{p.amount_currency}</span>
                              </td>
                              <td className="py-4 pr-4">
                                <p className="text-sm text-gray-700 truncate max-w-[200px]" title={p.recipient_email || "—"}>
                                  {p.recipient_email || "—"}
                                </p>
                                {p.invoice_id && (
                                  <Link
                                    href={`/payroll/${orgId}/invoices/${p.invoice_id}`}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 mt-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3 w-3 shrink-0" /> Invoice
                                  </Link>
                                )}
                              </td>
                              <td className="py-4 pr-4 text-sm text-gray-500">
                                {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-4 pl-4 text-right">
                                <Button asChild size="sm" variant="outline" className="rounded-lg">
                                  <Link href={`/payroll/${orgId}/pay/${p.id}`}>View</Link>
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
