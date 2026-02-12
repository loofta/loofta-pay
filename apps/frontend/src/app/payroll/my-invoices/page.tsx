"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Loader2, ArrowLeft, DollarSign, Receipt, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dealsApi, type DealInvoiceResponse } from "@/services/api/deals";

type InvoiceRow = DealInvoiceResponse & { deal_title?: string; org_name?: string; invite_id?: string };

/** All my invoices as freelancer, across all organizations. */
export default function MyInvoicesPage() {
  const { authenticated, ready, userId } = useAuth();

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["payroll-my-invoices", userId],
    queryFn: () => dealsApi.invoices.listAllMine(userId ?? undefined),
    enabled: Boolean(ready && authenticated && userId),
  });

  const list = (invoices ?? []) as InvoiceRow[];

  const paidCount = list.filter((inv) => inv.status === "paid").length;
  const pendingCount = list.filter((inv) => inv.status === "sent").length;
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
          <Link href="/payroll">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My invoices</h1>
          <p className="text-sm text-gray-500">
            All your invoices from deals you’ve accepted, across every organization.
          </p>
        </div>
      </div>

      {!isLoading && list.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
        </div>
      )}

      <Card className="border-gray-200 bg-white">
        <CardHeader className="px-6 pt-6 pb-2 md:px-8">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoices
          </CardTitle>
          <CardDescription>
            One row per deal. View or download as PDF from each row.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4 md:px-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !list.length ? (
            <p className="py-6 text-sm text-gray-500">
              No invoices yet. Accept a deal and confirm delivery to generate an invoice.
            </p>
          ) : (
            <ul className="space-y-3">
              {list.map((inv) => (
                <li key={inv.id}>
                  <Card className="border-gray-200 bg-gray-50/50">
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 md:px-8 md:py-5">
                      <div>
                        <span className="font-medium text-gray-900">
                          {inv.amount} {inv.amount_currency}
                        </span>
                        {inv.deal_title && (
                          <span className="block text-sm text-gray-500">{inv.deal_title}</span>
                        )}
                        {inv.org_name && (
                          <span className="block text-xs text-gray-400">{inv.org_name}</span>
                        )}
                        <span className="block text-xs text-gray-400">
                          {new Date(inv.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-1 text-xs capitalize ${
                            inv.status === "paid"
                              ? "bg-green-100 text-green-800"
                              : inv.status === "sent"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {inv.status}
                        </span>
                        {inv.invite_id && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/payroll/deal-invite/${inv.invite_id}/invoice`}>
                              View
                            </Link>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
