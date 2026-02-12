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
import { payrollApi, type PayrollOrganization, type PayrollContributor } from "@/services/api/payroll";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import {
  Send,
  Loader2,
  ArrowLeft,
  Plus,
  User,
  Users,
  FileText,
  FilePlus,
  Upload,
  Wallet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type PaymentMode = "individual" | "bulk";
type InvoiceOption = "attach" | "create" | "upload";

/** Pay: create payments (individual or bulk), with optional invoice (attach / create / upload coming soon). */
export default function PayrollPayPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();

  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [contributors, setContributors] = useState<PayrollContributor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPaymentDialog, setShowNewPaymentDialog] = useState(false);

  // New payment form
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("individual");
  const [selectedContributorId, setSelectedContributorId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState<string | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);
  const [invoiceOption, setInvoiceOption] = useState<InvoiceOption>("attach");
  const [attachInvoiceId, setAttachInvoiceId] = useState<string | null>(null);
  const [newInvoiceRef, setNewInvoiceRef] = useState("");
  const [newInvoiceAmount, setNewInvoiceAmount] = useState("");
  const [newInvoiceNote, setNewInvoiceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      payrollApi.organizations.get(orgId, userId),
      payrollApi.contributors.list(orgId, userId),
    ])
      .then(([org, contribs]) => {
        if (!cancelled) {
          setOrganization(org);
          setContributors(contribs);
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
  }, [userId, orgId]);

  const payables = contributors.filter((c) => c.status === "joined" && c.wallet_address && c.network && c.token_symbol);
  const canPayIndividual = payables.length > 0;
  const canPayBulk = payables.length > 1;

  const toggleBulkContributor = (id: string) => {
    setSelectedBulkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectAllBulk = () => {
    if (selectedBulkIds.size === payables.length) setSelectedBulkIds(new Set());
    else setSelectedBulkIds(new Set(payables.map((c) => c.id)));
  };

  const handleCreatePayment = async () => {
    const num = paymentMode === "individual" ? (selectedContributorId ? 1 : 0) : selectedBulkIds.size;
    if (num === 0) {
      toast({
        variant: "destructive",
        title: "Select recipient(s)",
        description: paymentMode === "individual" ? "Choose one contributor." : "Select at least one contributor.",
      });
      return;
    }
    const amt = amount.trim();
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Enter a positive amount." });
      return;
    }
    if (!network || !tokenSymbol) {
      toast({ variant: "destructive", title: "Select token", description: "Choose network and token." });
      return;
    }
    setSubmitting(true);
    try {
      // MVP: no backend payment execution yet
      toast({
        title: "Payment created (MVP)",
        description: `${num} recipient(s), ${amt} ${tokenSymbol} on ${network}. Execution coming soon.`,
      });
      setShowNewPaymentDialog(false);
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed";
      toast({ variant: "destructive", title: "Error", description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setPaymentMode("individual");
    setSelectedContributorId(null);
    setSelectedBulkIds(new Set());
    setAmount("");
    setNetwork(null);
    setTokenSymbol(null);
    setInvoiceOption("attach");
    setAttachInvoiceId(null);
    setNewInvoiceRef("");
    setNewInvoiceAmount("");
    setNewInvoiceNote("");
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/payroll/${orgId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Pay</h1>
            <p className="text-sm text-gray-500">
              Pay one person or run a bulk payment. Attach or create an invoice per payment.
            </p>
          </div>
        </div>
        <GradientActionButton
          className="w-auto px-5"
          onClick={() => {
            resetForm();
            setShowNewPaymentDialog(true);
          }}
          disabled={!canPayIndividual}
        >
          <Plus className="h-4 w-4 mr-2" />
          New payment
        </GradientActionButton>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader className="px-6 pt-6 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Payments
          </CardTitle>
          <CardDescription className="mt-1.5">
            Individual and bulk payments. Gas abstracted via NEAR Intents when execution is wired.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4">
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-8 py-14 text-center">
            <Send className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-600">No payments yet</p>
            <p className="mt-1.5 text-xs text-gray-500">Create a payment to send to one or more contributors.</p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => setShowNewPaymentDialog(true)}
              disabled={!canPayIndividual}
            >
              <Plus className="h-4 w-4 mr-2" />
              New payment
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* New payment dialog */}
      <Dialog open={showNewPaymentDialog} onOpenChange={setShowNewPaymentDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8">
          <DialogHeader className="space-y-2">
            <DialogTitle>New payment</DialogTitle>
            <DialogDescription>
              Pay individual or bulk. Optionally attach an invoice, create one, or upload (coming soon).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Payment type */}
            <div className="space-y-2">
              <Label>Payment type</Label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={paymentMode === "individual" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPaymentMode("individual")}
                  className="flex-1"
                >
                  <User className="h-4 w-4 mr-2" />
                  Individual
                </Button>
                <Button
                  type="button"
                  variant={paymentMode === "bulk" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPaymentMode("bulk")}
                  className="flex-1"
                  disabled={!canPayBulk}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Bulk
                </Button>
              </div>
            </div>

            {/* Recipients */}
            <div className="space-y-2">
              <Label>{paymentMode === "individual" ? "Recipient" : "Recipients"}</Label>
              {paymentMode === "individual" ? (
                <Select value={selectedContributorId ?? ""} onValueChange={(v) => setSelectedContributorId(v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select contributor" />
                  </SelectTrigger>
                  <SelectContent>
                    {payables.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          {c.first_name || c.last_name ? [c.first_name, c.last_name].filter(Boolean).join(" ") : c.email}
                          <span className="text-gray-500 font-normal">
                            ({c.token_symbol} on {c.network})
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 max-h-44 overflow-y-auto space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all-bulk"
                      checked={selectedBulkIds.size === payables.length && payables.length > 0}
                      onCheckedChange={selectAllBulk}
                    />
                    <label htmlFor="select-all-bulk" className="text-sm font-medium cursor-pointer">
                      Select all ({payables.length})
                    </label>
                  </div>
                  {payables.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`cb-${c.id}`}
                        checked={selectedBulkIds.has(c.id)}
                        onCheckedChange={() => toggleBulkContributor(c.id)}
                      />
                      <label htmlFor={`cb-${c.id}`} className="text-sm cursor-pointer flex-1">
                        {c.first_name || c.last_name ? [c.first_name, c.last_name].filter(Boolean).join(" ") : c.email}
                        <span className="text-gray-500 ml-1">
                          {c.token_symbol} · {c.network}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Amount & token */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pay-amount">Amount</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Token</Label>
                <TokenCombobox
                  tokens={tokens}
                  value={network && tokenSymbol ? { symbol: tokenSymbol, chain: network } : undefined}
                  onChange={(sel) => {
                    setNetwork(sel?.chain ?? null);
                    setTokenSymbol(sel?.symbol ?? null);
                  }}
                  placeholder="Select token"
                />
              </div>
            </div>

            {/* Invoice */}
            <div className="space-y-3">
              <Label>Invoice</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={invoiceOption === "attach" ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={() => setInvoiceOption("attach")}
                >
                  <FileText className="h-4 w-4" />
                  <span className="text-xs">Attach existing</span>
                </Button>
                <Button
                  type="button"
                  variant={invoiceOption === "create" ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={() => setInvoiceOption("create")}
                >
                  <FilePlus className="h-4 w-4" />
                  <span className="text-xs">Create new</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-3 opacity-70"
                  disabled
                >
                  <Upload className="h-4 w-4" />
                  <span className="text-xs flex items-center gap-1">
                    Upload
                    <Badge variant="secondary" className="text-[10px] px-1">Soon</Badge>
                  </span>
                </Button>
              </div>
              {invoiceOption === "attach" && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3.5 text-sm text-gray-500">
                  No invoices yet. Create one below or from Invoices tab.
                </div>
              )}
              {invoiceOption === "create" && (
                <div className="space-y-3 rounded-lg border border-gray-200 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="inv-ref" className="text-xs">Reference</Label>
                      <Input
                        id="inv-ref"
                        placeholder="INV-001"
                        value={newInvoiceRef}
                        onChange={(e) => setNewInvoiceRef(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="inv-amount" className="text-xs">Amount</Label>
                      <Input
                        id="inv-amount"
                        type="number"
                        placeholder="0.00"
                        value={newInvoiceAmount}
                        onChange={(e) => setNewInvoiceAmount(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="inv-note" className="text-xs">Note (optional)</Label>
                    <Input
                      id="inv-note"
                      placeholder="Description"
                      value={newInvoiceNote}
                      onChange={(e) => setNewInvoiceNote(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-4 sm:pt-6">
            <Button variant="outline" onClick={() => setShowNewPaymentDialog(false)} disabled={submitting}>
              Cancel
            </Button>
            <GradientActionButton onClick={handleCreatePayment} disabled={submitting} loading={submitting} loadingText="Creating...">
              Create payment
            </GradientActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
