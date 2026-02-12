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
import { payrollApi, type PayrollOrganization, type PayrollContributor, type PayrollRunListItem, type PayrollRunResponse } from "@/services/api/payroll";
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
  Copy,
  ChevronRight,
  Check,
  Clock,
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
  const [runs, setRuns] = useState<PayrollRunListItem[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayrollRunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewPaymentDialog, setShowNewPaymentDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      payrollApi.runs.list(orgId, userId),
    ])
      .then(([org, contribs, runsList]) => {
        if (!cancelled) {
          setOrganization(org);
          setContributors(contribs);
          setRuns(runsList || []);
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

  const loadRunDetail = (runId: string) => {
    if (!userId || !orgId) return;
    payrollApi.runs.get(orgId, runId, userId).then(setSelectedRun).catch((err: unknown) => {
      toast({ variant: "destructive", title: "Failed to load run", description: err instanceof Error ? err.message : "Error" });
    });
  };

  const copyDepositAddress = (addr: string, id: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedId(id);
    toast({ title: "Copied", description: "Deposit address copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

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
    const entries =
      paymentMode === "individual" && selectedContributorId
        ? [{ contributorId: selectedContributorId, amount: amt }]
        : Array.from(selectedBulkIds).map((id) => ({ contributorId: id, amount: amt }));

    setSubmitting(true);
    try {
      const run = await payrollApi.runs.create(
        orgId,
        { entries, tokenSymbol, network },
        userId,
      );
      setRuns((prev) => [{ id: run.id, organization_id: run.organization_id, created_by: run.created_by, status: run.status, total_entries: run.total_entries, completed_entries: run.completed_entries, created_at: run.created_at, updated_at: run.updated_at }, ...prev]);
      setSelectedRun(run);
      setShowNewPaymentDialog(false);
      resetForm();
      toast({
        title: "Payment run created",
        description: run.entries.some((e) => e.deposit_address) ? "Send funds to the deposit addresses below. Status will update automatically." : "Run created; some entries may need manual payment.",
      });
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Payments
              </CardTitle>
              <CardDescription className="mt-1.5">
                Individual and bulk payments via NEAR Intents. Send to deposit addresses; status updates automatically.
              </CardDescription>
            </div>
            {selectedRun && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedRun(null)}>
                Back to list
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4">
          {selectedRun ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={selectedRun.status === "completed" ? "default" : selectedRun.status === "failed" ? "destructive" : "secondary"}>
                  {selectedRun.status}
                </Badge>
                <span className="text-sm text-gray-500">
                  {selectedRun.completed_entries}/{selectedRun.total_entries} completed
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(selectedRun.created_at).toLocaleString()}
                </span>
              </div>
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3 font-medium">Recipient</th>
                      <th className="text-left p-3 font-medium">Amount</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRun.entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="p-3">{e.recipient_address.slice(0, 8)}...{e.recipient_address.slice(-6)}</td>
                        <td className="p-3">{e.amount} {e.token_symbol}</td>
                        <td className="p-3">
                          <Badge variant={e.status === "completed" ? "default" : e.status === "failed" || e.status === "expired" ? "destructive" : "outline"}>
                            {e.status}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {e.deposit_address ? (
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-gray-100 px-2 py-1 rounded truncate max-w-[180px]">{e.deposit_address}</code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => copyDepositAddress(e.deposit_address!, e.id)}
                              >
                                {copiedId === e.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">No deposit address</span>
                          )}
                          {e.deadline && e.status !== "completed" && e.status !== "failed" && e.status !== "expired" && (
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Deadline: {new Date(e.deadline).toLocaleString()}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-4 hover:bg-gray-50/50"
                >
                  <div className="flex items-center gap-3">
                    <Send className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900">
                        {run.completed_entries}/{run.total_entries} entries
                      </p>
                      <p className="text-xs text-gray-500">{new Date(run.created_at).toLocaleString()}</p>
                    </div>
                    <Badge variant={run.status === "completed" ? "default" : run.status === "failed" ? "destructive" : "secondary"}>{run.status}</Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => loadRunDetail(run.id)}>
                    View <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="w-full mt-4" onClick={() => setShowNewPaymentDialog(true)} disabled={!canPayIndividual}>
                <Plus className="h-4 w-4 mr-2" />
                New payment
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-8 py-14 text-center">
              <Send className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">No payments yet</p>
              <p className="mt-1.5 text-xs text-gray-500">Create a payment run to get deposit addresses for each recipient.</p>
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
          )}
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
