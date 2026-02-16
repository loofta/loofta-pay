"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi, type DealResponse } from "@/services/api/deals";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { NewDealModal } from "@/components/NewDealModal";
import { Handshake, Plus, Loader2, ArrowLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  invited: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  funded: "bg-sky-100 text-sky-800",
  delivered: "bg-violet-100 text-violet-800",
  released: "bg-green-100 text-green-800",
  disputed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

export default function DealsListPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const router = useRouter();
  const { authenticated, userId, ready } = useAuth();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [deals, setDeals] = useState<DealResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDealModalOpen, setNewDealModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId || !orgId) return;
    try {
      setLoading(true);
      const [org, list] = await Promise.all([
        payrollApi.organizations.get(orgId, userId),
        dealsApi.deals.list(orgId, userId),
      ]);
      setOrganization(org);
      setDeals(list || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load deals";
      toast({ variant: "destructive", title: "Error", description: message });
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

  if (loading || !organization) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
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
          <h1 className="text-2xl font-semibold text-gray-900">Deals</h1>
          <p className="text-sm text-gray-500 mt-1">Create deals, invite freelancers, and release payment after delivery.</p>
        </div>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader className="px-6 pt-6 pb-2 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Handshake className="h-5 w-5" />
                Deals
              </CardTitle>
              <CardDescription className="mt-1.5">
                Invite freelancers and release payment after delivery.
              </CardDescription>
            </div>
            <GradientActionButton className="gap-2 shrink-0" onClick={() => setNewDealModalOpen(true)}>
              <Plus className="h-4 w-4" /> New deal
            </GradientActionButton>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-4 md:px-8">
          {deals.length === 0 ? (
            <EmptyState
              icon={Handshake}
              message="You have no deals"
              description="Create a deal to invite a freelancer and release payment after delivery."
              action={
                <GradientActionButton onClick={() => setNewDealModalOpen(true)} className="px-5">
                  <Plus className="h-4 w-4 mr-2" />
                  New deal
                </GradientActionButton>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-medium text-gray-700">Deal</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">Amount</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">Freelancer</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">Date</th>
                    <th className="pb-3 pr-4 font-medium text-gray-700">Status</th>
                    <th className="pb-3 pl-4 font-medium text-gray-700 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((deal) => {
                    const acceptedInvite = deal.invites?.find((i) => i.status === "accepted");
                    const dateLabel = deal.deadline
                      ? new Date(deal.deadline).toLocaleDateString()
                      : new Date(deal.created_at).toLocaleDateString();
                    return (
                      <tr key={deal.id} className="border-b last:border-0 hover:bg-gray-50/80">
                        <td className="py-4 pr-4 font-medium text-gray-900">{deal.title}</td>
                        <td className="py-4 pr-4">
                          <span className="font-semibold text-gray-900">{deal.amount}</span>
                          <span className="text-gray-500 ml-1">{deal.amount_currency}</span>
                        </td>
                        <td className="py-4 pr-4 text-sm text-gray-600 truncate max-w-[180px]">
                          {acceptedInvite?.invitee_email ?? "—"}
                        </td>
                        <td className="py-4 pr-4 text-sm text-gray-500">{dateLabel}</td>
                        <td className="py-4 pr-4">
                          <Badge className={`${STATUS_COLOR[deal.status] || "bg-gray-100"} text-xs font-medium`}>
                            {deal.status}
                          </Badge>
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <Button asChild size="sm" className="rounded-lg bg-orange-500 font-semibold text-white">
                            <Link href={`/payroll/${orgId}/deals/${deal.id}`}>
                              Open <ChevronRight className="h-4 w-4 inline ml-0.5" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewDealModal
        open={newDealModalOpen}
        onOpenChange={setNewDealModalOpen}
        orgId={orgId}
        userId={userId}
        onSuccess={loadData}
      />
    </div>
  );
}
