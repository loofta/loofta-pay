"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Loader2, ArrowLeft, ExternalLink, DollarSign, Receipt, Clock } from "lucide-react";
import Link from "next/link";
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
            <p className="py-6 text-sm text-gray-500">
              {isContributor ? "No invoices yet. Complete a deal and confirm delivery to generate one." : "No invoices yet. Accept delivery on a deal to generate one."}
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0">
              {list.map((inv) => (
                <li key={inv.id}>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-md flex flex-col gap-4 h-full transition-all duration-200 hover:shadow-lg">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">
                        {inv.amount} <span className="text-gray-500 font-normal">{inv.amount_currency}</span>
                      </h3>
                      {(inv as InvoiceWithMeta).deal_title && (
                        <p className="mt-1.5 text-sm font-medium text-gray-600">{(inv as InvoiceWithMeta).deal_title}</p>
                      )}
                      {!isContributor && inv.recipient_email && (
                        <p className="mt-0.5 text-sm text-gray-500 truncate">{inv.recipient_email}</p>
                      )}
                      <p className="mt-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Created {new Date(inv.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="mt-auto pt-2 flex items-center justify-between w-full flex-wrap gap-2">
                      <span
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${inv.status === "paid"
                            ? "bg-emerald-50 text-emerald-800"
                            : inv.status === "sent"
                              ? "bg-blue-50 text-blue-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                      >
                        {inv.status === "sent" && !isContributor ? "To be paid" : inv.status}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button asChild size="sm" className="rounded-lg bg-orange-500 font-semibold text-white shadow-sm hover:shadow-md">
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

                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
