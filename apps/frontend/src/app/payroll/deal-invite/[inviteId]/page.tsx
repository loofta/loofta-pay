"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { dealsApi } from "@/services/api/deals";
import { DealContributorView } from "@/components/DealContributorView";
import { Loader2 } from "lucide-react";

export default function DealInvitePage() {
  const params = useParams();
  const inviteId = params?.inviteId as string;
  const { userId } = useAuth();
  const { toast } = useToast();
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof dealsApi.invite.get>>["invite"] | null>(null);
  const [deal, setDeal] = useState<Awaited<ReturnType<typeof dealsApi.invite.get>>["deal"] | null>(null);
  const [contributorPayout, setContributorPayout] = useState<Awaited<ReturnType<typeof dealsApi.invite.get>>["contributor_payout"] | null>(null);
  const [loading, setLoading] = useState(true);

  const loadInvite = useCallback(() => {
    if (!inviteId) return;
    dealsApi.invite
      .get(inviteId, userId ?? undefined)
      .then(({ invite: i, deal: d, contributor_payout }) => {
        setInvite(i);
        setDeal(d);
        setContributorPayout(contributor_payout ?? null);
      })
      .catch(() => toast({ variant: "destructive", title: "Invite not found" }))
      .finally(() => setLoading(false));
  }, [inviteId, userId, toast]);

  useEffect(() => {
    loadInvite();
  }, [loadInvite]);

  if (loading || !invite || !deal) {
    return (
      <div className="flex min-h-[280px] items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading invite…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafbfc] py-8 px-4 sm:px-6">
      <DealContributorView
        inviteId={inviteId}
        invite={invite}
        deal={deal}
        contributorPayout={contributorPayout ?? undefined}
        backHref="/payroll"
        backLabel="Back"
        onDataChange={loadInvite}
      />
    </div>
  );
}
