"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Loader2, ArrowLeft, ExternalLink, DollarSign, Receipt, Clock } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { payrollApi } from "@/services/api/payroll";
import { dealsApi, type DealInvoiceResponse } from "@/services/api/deals";

type InvoiceWithMeta = DealInvoiceResponse & { invite_id?: string };

/** Invoices: list with stats. Org sees paid/pending; freelancer sees received amount, count, pending. */
export default function PayrollInvoicesPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { authenticated, ready, userId } = useAuth();

  const { data: roleData } = useQuery({
    queryKey: ["payroll-org-role", orgId, userId],
    queryFn: () => payrollApi.organizations.getMyRole(orgId, userId ?? ""),
    enabled: Boolean(ready && authenticated && orgId && userId),
  });
  const isContributor = roleData?.role === "contributor";

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["payroll-invoices", orgId, userId, isContributor],
    queryFn: () =>
      isContributor
        ? dealsApi.invoices.listMine(orgId, userId ?? undefined)
        : dealsApi.invoices.list(orgId, userId ?? undefined),
    enabled: Boolean(ready && authenticated && orgId && userId && roleData !== undefined),
  });

  const list = (invoices ?? []) as InvoiceWithMeta[];

  const paidCount = list.filter((inv) => inv.status === "paid").length;
  const pendingCount = list.filter((inv) => inv.status === "sent").length;
  const preparedCount = list.filter((inv) => inv.status === "prepared").length;

  const receivedAmountByCurrency: Record<string, number> = {};
  list.filter((inv) => inv.status === "paid").forEach((inv) => {
    const cur = inv.amount_currency || "USD";
    receivedAmountByCurrency[cur] = (receivedAmountByCurrency[cur] || 0) + Number(inv.amount);
  });
  const receivedSummary = Object.entries(receivedAmountByCurrency)
    .map(([cur, sum]) => `${sum.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${cur}`)
    .join(", ") || "—";

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/payroll/${orgId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
            <p className="text-sm text-gray-500">
              {isContributor
                ? "Your invoices for deals with this organization."
                : "One invoice per deal: prepared when the deal is created, sent when the freelancer confirms delivery, paid when you complete payment (attested on-chain)."}
            </p>
          </div>
        </div>
        {!isContributor && (
          <Button asChild className="shrink-0 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-white hover:opacity-90">
            <Link href={`/payroll/${orgId}/deals/new`}>
              <FileText className="h-4 w-4 mr-2" />
              New deal
            </Link>
          </Button>
        )}
      </div>

      {/* Stats */}
      {!isLoading && list.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {isContributor ? (
            <>
              <Card className="border-gray-200 bg-white">
                <CardContent className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-500">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-sm font-medium">Received</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{receivedSummary}</p>
                </CardContent>
              </Card>
              <Card className="border-gray-200 bg-white">
                <CardContent className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Receipt className="h-4 w-4" />
                    <span className="text-sm font-medium">Invoices</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{list.length}</p>
                </CardContent>
              </Card>
              <Card className="border-gray-200 bg-white">
                <CardContent className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm font-medium">Pending</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{pendingCount}</p>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card className="border-gray-200 bg-white">
                <CardContent className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-500">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-sm font-medium">Paid</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-green-700">{paidCount}</p>
                </CardContent>
              </Card>
              <Card className="border-gray-200 bg-white">
                <CardContent className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm font-medium">To be paid</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{pendingCount}</p>
                </CardContent>
              </Card>
              <Card className="border-gray-200 bg-white">
                <CardContent className="px-6 py-4">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Receipt className="h-4 w-4" />
                    <span className="text-sm font-medium">Prepared</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{preparedCount}</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      <Card className="border-gray-200 bg-white">
        <CardHeader className="px-6 pt-6 pb-2 md:px-8">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoices
          </CardTitle>
          <CardDescription>
            {isContributor
              ? "Your invoices for this organization."
              : "Prepared → Sent (after freelancer confirms delivery) → Paid (after payment + on-chain attestation)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4 md:px-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !list.length ? (
            <EmptyState
              icon={FileText}
              message="You have no invoices"
              description={
                isContributor
                  ? "Complete a deal and confirm delivery to generate an invoice."
                  : "Accept delivery on a deal to generate an invoice."
              }
              action={
                !isContributor ? (
                  <Button asChild>
                    <Link href={`/payroll/${orgId}/deals`}>View deals</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-medium text-gray-700">Amount</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">{isContributor ? "Deal" : "Recipient / Deal"}</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">Created</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">Status</th>
                    <th className="pb-3 pl-4 font-medium text-gray-700 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-gray-50/80">
                      <td className="py-4 pr-4">
                        <span className="font-semibold text-gray-900">{inv.amount}</span>
                        <span className="text-gray-500 ml-1">{inv.amount_currency}</span>
                      </td>
                      <td className="py-4 pr-4">
                        {(inv as InvoiceWithMeta).deal_title && (
                          <p className="font-medium text-gray-700">{(inv as InvoiceWithMeta).deal_title}</p>
                        )}
                        {!isContributor && inv.recipient_email && (
                          <p className="text-sm text-gray-500 truncate max-w-[200px]">{inv.recipient_email}</p>
                        )}
                      </td>
                      <td className="py-4 pr-4 text-sm text-gray-500">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-4 pr-4">
                        <span
                          className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${inv.status === "paid"
                            ? "bg-emerald-50 text-emerald-800"
                            : inv.status === "sent"
                              ? "bg-blue-50 text-blue-800"
                              : "bg-gray-100 text-gray-700"
                            }`}
                        >
                          {inv.status === "sent" && !isContributor ? "To be paid" : inv.status}
                        </span>
                      </td>
                      <td className="py-4 pl-4 text-right">
                        <Button asChild size="sm" className="rounded-lg bg-orange-500 font-semibold text-white">
                          <Link
                            href={
                              isContributor && (inv as InvoiceWithMeta).invite_id
                                ? `/payroll/deal-invite/${(inv as InvoiceWithMeta).invite_id}/invoice`
                                : `/payroll/${orgId}/invoices/${inv.id}`
                            }
                          >
                            View
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
