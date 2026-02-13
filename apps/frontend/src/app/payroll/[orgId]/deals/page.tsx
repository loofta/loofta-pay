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
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-8 py-10 text-center">
              <Handshake className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">No deals yet</p>
              <p className="mt-1.5 text-xs text-gray-500">Create a deal to invite a freelancer.</p>
              <Button onClick={() => setNewDealModalOpen(true)} className="mt-4">Create your first deal</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deals.map((deal) => {
                const acceptedInvite = deal.invites?.find((i) => i.status === "accepted");
                const dateLabel = deal.deadline
                  ? `Deadline ${new Date(deal.deadline).toLocaleDateString()}`
                  : `Created ${new Date(deal.created_at).toLocaleDateString()}`;
                return (
                  <Link key={deal.id} href={`/payroll/${orgId}/deals/${deal.id}`} className="block h-full group">
                    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-md flex flex-col gap-4 h-full transition-all duration-200 group-hover:shadow-lg">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-bold text-gray-900 truncate pr-2">{deal.title}</h3>
                        <Badge className={`${STATUS_COLOR[deal.status] || "bg-gray-100"} shrink-0 text-xs font-medium`}>{deal.status}</Badge>
                      </div>
                      <p className="text-base font-medium text-gray-700">
                        {deal.amount} <span className="text-gray-500 font-normal">{deal.amount_currency}</span>
                      </p>
                      {acceptedInvite && (
                        <p className="text-sm text-gray-500 truncate">{acceptedInvite.invitee_email}</p>
                      )}
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{dateLabel}</p>
                      <div className="mt-auto pt-2 flex items-center justify-end">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-shadow group-hover:shadow-md">
                          Open <ChevronRight className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
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
