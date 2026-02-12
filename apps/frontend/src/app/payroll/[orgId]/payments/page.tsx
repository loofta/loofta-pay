"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi, type DealPaymentResponse } from "@/services/api/deals";
import { ArrowLeft, Loader2, Wallet, Copy, Send } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export default function PaymentsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const router = useRouter();
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [payments, setPayments] = useState<DealPaymentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prepareLoading, setPrepareLoading] = useState(false);
  const [prepared, setPrepared] = useState<DealPaymentResponse[]>([]);

  const loadData = useCallback(async () => {
    if (!userId || !orgId) return;
    try {
      setLoading(true);
      const [org, list] = await Promise.all([
        payrollApi.organizations.get(orgId, userId),
        dealsApi.payments.listPending(orgId, userId),
      ]);
      setOrganization(org);
      setPayments(list || []);
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Failed to load payments" });
    } finally {
      setLoading(false);
    }
  }, [orgId, userId, toast]);

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace("/payroll");
      return;
    }
    loadData();
  }, [ready, authenticated, loadData, router]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === payments.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(payments.map((p) => p.id)));
  };

  const handlePreparePay = async () => {
    if (!userId || !orgId || selectedIds.size === 0) return;
    setPrepareLoading(true);
    try {
      const result = await dealsApi.payments.preparePay(orgId, Array.from(selectedIds), userId);
      setPrepared(result);
      toast({ title: "Deposit addresses ready", description: `Send the amounts to the addresses below. ${result.length} payment(s) prepared.` });
      loadData();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setPrepareLoading(false);
    }
  };

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast({ title: "Copied", description: "Address copied to clipboard." });
  };

  if (loading || !organization) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/payroll/${orgId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeft className="h-4 w-4" /> Back to {organization.name}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Payments</h1>
        <p className="text-sm text-gray-500 mt-1">Pending payments from accepted deliveries. Select and pay in bulk.</p>
      </div>

      {payments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wallet className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 text-center">No pending payments. Accept delivery on a deal to create a payment.</p>
            <Link href={`/payroll/${orgId}/deals`} className="mt-4">
              <Button variant="outline">View Deals</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Pending ({payments.length})</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    {selectedIds.size === payments.length ? "Deselect all" : "Select all"}
                  </Button>
                  <Button size="sm" onClick={handlePreparePay} disabled={selectedIds.size === 0 || prepareLoading}>
                    {prepareLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Prepare pay ({selectedIds.size})
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                    <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{p.amount} {p.amount_currency}</span>
                      <span className="text-gray-500 text-sm ml-2">→ {p.preferred_network} / {p.preferred_token_symbol}</span>
                    </div>
                    <span className="text-xs text-gray-400 truncate max-w-[120px]">{p.recipient_wallet}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {prepared.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Send to these addresses</CardTitle>
                <CardDescription>Send the exact amount in the specified token to each deposit address before the deadline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {prepared.map((p) => (
                  <div key={p.id} className="rounded-lg border p-3 space-y-1">
                    <p className="text-sm font-medium">{p.amount} {p.preferred_token_symbol} on {p.preferred_network}</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">{p.deposit_address}</code>
                      <Button variant="ghost" size="sm" onClick={() => copyAddr(p.deposit_address!)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {p.intent_deadline && (
                      <p className="text-xs text-gray-500">Deadline: {new Date(p.intent_deadline).toLocaleString()}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
