"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { dealsApi, type DealInvoiceResponse } from "@/services/api/deals";

/** Invoices: auto-generated when org accepts delivery; list and link to deal. */
export default function PayrollInvoicesPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { authenticated, ready, userId } = useAuth();

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["payroll-invoices", orgId, userId],
    queryFn: () => dealsApi.invoices.list(orgId, userId ?? undefined),
    enabled: Boolean(ready && authenticated && orgId && userId),
  });

  if (!ready || !authenticated) {
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
          <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">
            One invoice per deal: prepared when the deal is created, sent when the freelancer confirms delivery, paid when you complete payment (attested on-chain).
          </p>
        </div>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoices
          </CardTitle>
          <CardDescription>
            Prepared → Sent (after freelancer confirms delivery) → Paid (after payment + on-chain attestation).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !invoices?.length ? (
            <p className="text-sm text-gray-500 py-4">No invoices yet. Accept delivery on a deal to generate one.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {(invoices as DealInvoiceResponse[]).map((inv) => (
                <li key={inv.id} className="py-3 first:pt-0 flex items-center justify-between gap-4">
                  <div>
                    <span className="font-medium">{inv.amount} {inv.amount_currency}</span>
                    {inv.recipient_email && (
                      <span className="text-gray-500 text-sm block">{inv.recipient_email}</span>
                    )}
                    <span className="text-gray-400 text-xs block">{new Date(inv.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded capitalize ${
                      inv.status === "paid" ? "bg-green-100 text-green-800" :
                      inv.status === "sent" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"
                    }`}>
                      {inv.status}
                    </span>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/payroll/${orgId}/invoices/${inv.id}`}>
                        View
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/payroll/${orgId}/deals/${inv.deal_id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
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
