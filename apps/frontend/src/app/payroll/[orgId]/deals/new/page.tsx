"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi } from "@/services/api/deals";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function NewDealPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const router = useRouter();
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [amount, setAmount] = useState("");
  const [amountCurrency, setAmountCurrency] = useState("USD");
  const [deadline, setDeadline] = useState("");

  useEffect(() => {
    if (!userId || !orgId) return;
    payrollApi.organizations.get(orgId, userId).then(setOrganization).catch(() => {}).finally(() => setLoading(false));
  }, [orgId, userId]);

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace("/payroll");
    }
  }, [ready, authenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !orgId || !title.trim() || !amount.trim()) {
      toast({ variant: "destructive", title: "Missing fields", description: "Title and amount are required." });
      return;
    }
    setSubmitting(true);
    try {
      const deal = await dealsApi.deals.create(orgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        amount: amount.trim(),
        amount_currency: amountCurrency,
        deadline: deadline.trim() || undefined,
      }, userId);
      toast({ title: "Deal created", description: "You can now invite a freelancer and attach a contract." });
      router.push(`/payroll/${orgId}/deals/${deal.id}`);
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to create deal", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !organization) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link href={`/payroll/${orgId}/deals`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to Deals
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>New deal</CardTitle>
          <CardDescription>Description, amount, deadline. You can invite a contributor and attach a contract on the next step.</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-2">
          <form onSubmit={handleSubmit} className="space-y-6 py-2">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Logo design" className="mt-1" required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope of work..." className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <Label htmlFor="instructions">Instructions for freelancer</Label>
              <textarea id="instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Deliverables, format..." className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="amount">Amount *</Label>
                <Input id="amount" type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" className="mt-1" required />
              </div>
              <div>
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" value={amountCurrency} onChange={(e) => setAmountCurrency(e.target.value)} placeholder="USD" className="mt-1" />
              </div>
            </div>
            <div>
              <Label htmlFor="deadline">Deadline (optional)</Label>
              <Input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1" />
            </div>
            <div className="flex flex-col gap-3 pt-2">
              <Link href={`/payroll/${orgId}/deals`} className="w-full">
                <Button type="button" variant="outline" className="w-full">Cancel</Button>
              </Link>
              <GradientActionButton type="submit" disabled={submitting} className="w-full min-w-0" loading={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create deal
              </GradientActionButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
