"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, FileDown } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { dealsApi, type DealInvoiceResponse } from "@/services/api/deals";

/** Invoice view for freelancer: template from freelancer to organisation; view or download as PDF (print). */
export default function DealInviteInvoicePage() {
  const params = useParams();
  const inviteId = params?.inviteId as string;
  const { authenticated, ready, userId } = useAuth();

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["deal-invite-invoice", inviteId, userId],
    queryFn: () => dealsApi.invite.getInvoice(inviteId, userId ?? undefined),
    enabled: Boolean(ready && authenticated && inviteId && userId),
  });

  const handlePrintPdf = () => {
    window.print();
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">No invoice found for this deal.</p>
        <Button variant="outline" asChild>
          <Link href={`/payroll/deal-invite/${inviteId}`}>Back to deal</Link>
        </Button>
      </div>
    );
  }

  const inv = invoice as DealInvoiceResponse & { deal_title?: string; org_name?: string };

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex items-center justify-between gap-4 no-print">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/payroll/deal-invite/${inviteId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Button variant="outline" onClick={handlePrintPdf}>
          <FileDown className="h-4 w-4 mr-2" />
          Download PDF
        </Button>
      </div>

      <Card id="invoice-template" className="max-w-2xl mx-auto print:shadow-none print:border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Invoice</CardTitle>
          <p className="text-sm text-gray-500">
            {inv.invoice_number || `INV-${inv.id.slice(0, 8).toUpperCase()}`} · {new Date(inv.created_at).toLocaleDateString()}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="font-medium text-gray-500 uppercase tracking-wide">From (Freelancer)</p>
              <p className="mt-1">{inv.recipient_email || "—"}</p>
            </div>
            <div>
              <p className="font-medium text-gray-500 uppercase tracking-wide">To (Organisation)</p>
              <p className="mt-1">{inv.org_name || "—"}</p>
            </div>
          </div>
          {inv.deal_title && (
            <div>
              <p className="font-medium text-gray-500 uppercase tracking-wide text-sm">Description</p>
              <p className="mt-1">{inv.deal_title}</p>
            </div>
          )}
          <div className="border-t pt-4 flex justify-between items-baseline">
            <span className="font-medium text-gray-700">Amount</span>
            <span className="text-xl font-semibold">
              {inv.amount} {inv.amount_currency}
            </span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Status</span>
            <span className="capitalize font-medium">{inv.status}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
