"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, FileDown } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { dealsApi, type DealInvoiceResponse } from "@/services/api/deals";
import { getExplorerTxUrl, getExplorerName } from "@/lib/getExplorerTxUrl";

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

  const inv = invoice as DealInvoiceResponse;
  const from = inv.from_freelancer;
  const to = inv.to_org;
  const fromName = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || null;
  const fromEmail = from?.email ?? inv.recipient_email;

  const formatAddress = (parts: (string | null | undefined)[]) =>
    parts.filter((p): p is string => Boolean(p?.trim())).join(", ") || null;
  const hasStructuredAddress =
    from &&
    [from.address_line1, from.address_line2, from.city, from.state, from.postal_code, from.country].some(
      (p) => p != null && String(p).trim() !== ""
    );
  const fromAddressBlock = hasStructuredAddress ? (
    <>
      {formatAddress([from?.address_line1, from?.address_line2]) && (
        <p className="text-gray-600">{formatAddress([from?.address_line1, from?.address_line2])}</p>
      )}
      {formatAddress([from?.city, from?.state, from?.postal_code, from?.country]) && (
        <p className="text-gray-600">{formatAddress([from?.city, from?.state, from?.postal_code, from?.country])}</p>
      )}
    </>
  ) : from?.billing_address ? (
    <p className="text-gray-600 whitespace-pre-line">{from.billing_address}</p>
  ) : null;
  const hasFromDetails = fromName || fromEmail || fromAddressBlock || from?.business_name || from?.business_registration_number || from?.tva_number;

  return (
    <div className="space-y-6 print:space-y-4 p-4 md:p-6">
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
        <CardHeader className="pb-2 px-6 pt-6 md:px-8 md:pt-8">
          <CardTitle className="text-xl">Invoice</CardTitle>
          <p className="text-sm text-gray-500">
            {inv.invoice_number || `INV-${inv.id.slice(0, 8).toUpperCase()}`} · {new Date(inv.created_at).toLocaleDateString()}
          </p>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6 md:px-8 md:pb-8">
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div className="space-y-1">
              <p className="font-medium text-gray-500 uppercase tracking-wide">From</p>
              {fromName ? <p className="font-medium text-gray-900">{fromName}</p> : null}
              {fromEmail && <p className="text-gray-700">{fromEmail}</p>}
              {fromAddressBlock}
              {from?.business_name && <p className="text-gray-600">{from.business_name}</p>}
              {(from?.business_registration_number || from?.tva_number) && (
                <p className="text-gray-600">
                  VAT / Reg: {from?.business_registration_number || from?.tva_number}
                </p>
              )}
              {!hasFromDetails && <p className="text-gray-500">—</p>}
            </div>
            <div className="space-y-1">
              <p className="font-medium text-gray-500 uppercase tracking-wide">To (Organisation)</p>
              <p className="font-medium">{to?.company_legal_name || to?.name || inv.org_name || "—"}</p>
              {to?.name && to?.company_legal_name && to.name !== to.company_legal_name && <p className="text-gray-600">{to.name}</p>}
              {formatAddress([to?.address_line1, to?.address_line2]) && <p className="text-gray-600">{formatAddress([to?.address_line1, to?.address_line2])}</p>}
              {formatAddress([to?.city, to?.state, to?.postal_code, to?.country]) && <p className="text-gray-600">{formatAddress([to?.city, to?.state, to?.postal_code, to?.country])}</p>}
              {to?.company_registration_number && <p className="text-gray-600">VAT / Reg: {to.company_registration_number}</p>}
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
          {inv.receipt_on_chain_tx_hash && (
            <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-100">
              <span className="text-gray-500">Receipt on NEAR</span>
              {inv.receipt_on_chain_tx_hash.startsWith("on-chain:") ? (
                <span className="text-gray-700 font-medium">Recorded</span>
              ) : (
                <a
                  href={getExplorerTxUrl("near", inv.receipt_on_chain_tx_hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  View on {getExplorerName("near")}
                </a>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
