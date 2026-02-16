"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi, type DealResponse, type DealInviteResponse, type DealInvoiceResponse } from "@/services/api/deals";
import { DealContributorView } from "@/components/DealContributorView";
import { ArrowLeft, Loader2, Clock, User, Mail, FileText, Send, Check, AlertTriangle, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContributorEmailInput } from "@/components/ContributorEmailInput";
import { InviteLinkShare } from "@/components/InviteLinkShare";
import { DealComments } from "@/components/DealComments";

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  invited: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  funded: "bg-sky-100 text-sky-800",
  delivered: "bg-violet-100 text-violet-800",
  released: "bg-green-100 text-green-800",
  disputed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
  request_changes: "bg-orange-100 text-orange-800",
};

export default function DealDetailPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const dealId = params?.dealId as string;
  const router = useRouter();
  const { authenticated, userId, ready, email } = useAuth();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [deal, setDeal] = useState<DealResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [contributorInviteData, setContributorInviteData] = useState<{
    invite: DealInviteResponse;
    deal: DealResponse;
    contributor_payout?: { network: string; token_symbol: string };
  } | null>(null);
  const [contributorViewResolved, setContributorViewResolved] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [acceptDeliverySubmitting, setAcceptDeliverySubmitting] = useState(false);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [showDisputeConfirm, setShowDisputeConfirm] = useState(false);
  const [linkedInvoice, setLinkedInvoice] = useState<(DealInvoiceResponse & { deal_title?: string; org_name?: string }) | null>(null);

  const loadData = useCallback(async () => {
    if (!userId || !orgId || !dealId) return;
    try {
      setLoading(true);
      const [org, d, inv] = await Promise.all([
        payrollApi.organizations.get(orgId, userId),
        dealsApi.deals.get(orgId, dealId, userId),
        dealsApi.invoices.getByDeal(orgId, dealId, userId).catch(() => null),
      ]);
      setOrganization(org);
      setDeal(d);
      setLinkedInvoice(inv?.id ? inv : null);
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Failed to load deal" });
    } finally {
      setLoading(false);
    }
  }, [orgId, dealId, userId, toast]);

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace("/payroll");
      return;
    }
    loadData();
  }, [ready, authenticated, loadData, router]);

  // When we have deal + org, detect if current user is a contributor with an invite → show same view as deal-invite
  useEffect(() => {
    if (!deal || !organization || !userId || !email || contributorViewResolved) return;
    let cancelled = false;
    payrollApi.organizations
      .getMyRole(orgId, userId)
      .then(({ role }) => {
        if (cancelled) return;
        if (role !== "contributor") {
          setContributorViewResolved(true);
          return;
        }
        const myInvite = deal.invites?.find((inv) => inv.invitee_email?.toLowerCase() === email?.toLowerCase());
        if (!myInvite) {
          setContributorViewResolved(true);
          return;
        }
        return dealsApi.invite.get(myInvite.id, userId).then((data) => {
          if (!cancelled) {
            setContributorInviteData({
              invite: data.invite,
              deal: data.deal,
              contributor_payout: data.contributor_payout ?? undefined,
            });
            setContributorViewResolved(true);
          }
        });
      })
      .catch(() => {
        if (!cancelled) setContributorViewResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deal, organization, orgId, userId, email, contributorViewResolved]);

  const handleContributorDataChange = useCallback(() => {
    const inviteId = contributorInviteData?.invite.id;
    if (!userId || !inviteId) return;
    loadData().then(() => {
      dealsApi.invite.get(inviteId, userId).then((data) => {
        setContributorInviteData({
          invite: data.invite,
          deal: data.deal,
          contributor_payout: data.contributor_payout ?? undefined,
        });
      }).catch(() => { });
    });
  }, [loadData, userId, contributorInviteData?.invite.id]);

  const handleInvite = async () => {
    if (!userId || !orgId || !dealId || !inviteEmail.trim()) return;
    setInviteSubmitting(true);
    try {
      const inv = await dealsApi.deals.invite(orgId, dealId, { invitee_email: inviteEmail.trim() }, userId);
      const base = typeof window !== "undefined" ? window.location.origin : "";
      setInviteLink(`${base}/payroll/deal-invite/${inv.id}`);
      toast({ title: "Invite sent", description: `Invitation sent to ${inviteEmail}. Copy the link below to send them.` });
      loadData();
      setInviteEmail("");
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Invite failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleAcceptDelivery = async () => {
    if (!userId || !orgId || !dealId) return;
    setAcceptDeliverySubmitting(true);
    try {
      await dealsApi.deals.acceptDelivery(orgId, dealId, userId);
      toast({ title: "Delivery accepted", description: "A pending payment was created. You can pay it from the Payments page." });
      loadData();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setAcceptDeliverySubmitting(false);
    }
  };

  const handleDispute = async () => {
    if (!userId || !orgId || !dealId) return;
    setDisputeSubmitting(true);
    try {
      await dealsApi.deals.createDispute(orgId, dealId, userId);
      toast({ title: "Dispute created", description: "The deal has been marked as disputed." });
      setShowDisputeConfirm(false);
      loadData();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const copyInviteLink = (inviteId: string) => {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/payroll/deal-invite/${inviteId}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Copied", description: "Invite link copied to clipboard." });
  };

  if (loading || !organization || !deal) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading deal…</p>
        </div>
      </div>
    );
  }

  // Resolving whether to show contributor view (same as deal-invite)
  if (userId && email && !contributorViewResolved) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      </div>
    );
  }

  // Contributor with an invite for this deal → same view as deal-invite page
  if (contributorInviteData) {
    return (
      <DealContributorView
        inviteId={contributorInviteData.invite.id}
        invite={contributorInviteData.invite}
        deal={contributorInviteData.deal}
        contributorPayout={contributorInviteData.contributor_payout}
        backHref={`/payroll/${orgId}/deals`}
        backLabel="Back to Deals"
        onDataChange={handleContributorDataChange}
      />
    );
  }

  const requestChangesInvite = deal.invites?.find((i) => i.status === "request_changes");
  const isDelivered = deal.status === "delivered";
  const canEdit = deal.status === "draft" || deal.status === "invited";
  const statusLabel = deal.status.replace(/_/g, " ");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Breadcrumb + header */}
      <div className="space-y-3">
        <Link
          href={`/payroll/${orgId}/deals`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Deals
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              {deal.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                className={`text-xs font-medium capitalize ${STATUS_COLOR[deal.status] || "bg-gray-100 text-gray-700"}`}
              >
                {statusLabel}
              </Badge>
              <span className="text-sm text-gray-500">
                {deal.amount} {deal.amount_currency}
              </span>
              {deal.deadline && (
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock className="h-3.5 w-3.5" />
                  Due {new Date(deal.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* Main content */}
        <div className="space-y-6">
          <Card className="border-gray-200/80 shadow-sm p-6">
            <CardHeader className="px-0 pb-2 pt-0">
              <CardTitle className="text-lg font-medium text-gray-900">Deal details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 px-0 pb-0 pt-4">
              {deal.description ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Description</p>
                  <p className="mt-1.5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {deal.description}
                  </p>
                </div>
              ) : null}
              {deal.instructions ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Instructions</p>
                  <p className="mt-1.5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {deal.instructions}
                  </p>
                </div>
              ) : null}
              {deal.contract_attachment_url ? (
                <div>
                  <a
                    href={deal.contract_attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <FileText className="h-4 w-4 text-gray-500" />
                    View contract
                  </a>
                </div>
              ) : null}
              {!deal.description && !deal.instructions && !deal.contract_attachment_url && (
                <p className="text-sm text-gray-500">No additional details.</p>
              )}
            </CardContent>
          </Card>

          {/* Delivery actions (main column so they’re prominent) */}
          {isDelivered && (
            <Card className="border-violet-200/60 bg-violet-50/30 shadow-sm p-6">
              <CardHeader className="px-0 pb-2 pt-0">
                <CardTitle className="text-lg font-medium text-gray-900">Delivery confirmed</CardTitle>
                <CardDescription>Accept to create a pending payment, or open a dispute.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3 px-0 pb-0 pt-4">
                <Button onClick={handleAcceptDelivery} disabled={acceptDeliverySubmitting}>
                  {acceptDeliverySubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Accept delivery & create payment
                </Button>
                <Button
                  variant="outline"
                  className="border-gray-300 hover:bg-gray-50"
                  onClick={() => setShowDisputeConfirm(true)}
                  disabled={disputeSubmitting}
                >
                  {disputeSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mr-2" />
                  )}
                  Create dispute
                </Button>
              </CardContent>
            </Card>
          )}

          {deal.status === "released" && (
            <Card className="border-green-200/60 bg-green-50/30 p-6">
              <CardContent className="flex items-center gap-3 p-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <Check className="h-5 w-5 text-green-700" />
                </div>
                <div>
                  <p className="font-medium text-green-900">Payment created</p>
                  <p className="text-sm text-green-700">View it under Pay.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments — anyone with access can add and view */}
          <Card className="border-gray-200/80 shadow-sm p-6">
            <CardContent className="px-0 pb-0 pt-0">
              <DealComments orgId={orgId} dealId={dealId} />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: summary + freelancer */}
        <div className="space-y-6 lg:sticky lg:top-20">
          <Card className="border-gray-200/80 shadow-sm p-6">
            <CardHeader className="px-0 pb-2 pt-0">
              <CardTitle className="text-sm font-medium text-gray-500">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-0 pb-0 pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Amount</span>
                <span className="font-medium text-gray-900">
                  {deal.amount} {deal.amount_currency}
                </span>
              </div>
              {deal.deadline && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Deadline</span>
                  <span className="font-medium text-gray-900">
                    {new Date(deal.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Status</span>
                <Badge className={`capitalize ${STATUS_COLOR[deal.status] || "bg-gray-100"}`}>
                  {statusLabel}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {linkedInvoice?.id && !contributorInviteData && (
            <Card className="border-gray-200/80 shadow-sm p-6">
              <CardHeader className="px-0 pb-2 pt-0">
                <CardTitle className="text-sm font-medium text-gray-500">Linked invoice</CardTitle>
                <CardDescription>Invoice for this deal (from freelancer to org)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-0 pb-0 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-medium text-gray-900">
                    {linkedInvoice.amount} {linkedInvoice.amount_currency}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Status</span>
                  <Badge variant="outline" className="capitalize">
                    {linkedInvoice.status}
                  </Badge>
                </div>
                <Link href={`/payroll/${orgId}/invoices/${linkedInvoice.id}`}>
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    <FileText className="h-4 w-4 mr-2" />
                    View invoice
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <Card className="border-gray-200/80 shadow-sm p-6">
            <CardHeader className="px-0 pb-2 pt-0">
              <CardTitle className="text-base font-medium text-gray-900">Freelancer</CardTitle>
              <CardDescription>Invite by email. They can accept, decline, or request changes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-0 pb-0 pt-4">
              {requestChangesInvite && (
                <div className="rounded-lg bg-amber-50 border border-amber-200/80 p-3">
                  <p className="text-xs font-medium text-amber-800">Requested changes</p>
                  <p className="mt-1 text-sm text-amber-700">{requestChangesInvite.request_changes_message}</p>
                  <p className="mt-1.5 text-xs text-amber-600">
                    Edit the deal and resend; they can accept the updated terms.
                  </p>
                </div>
              )}
              {deal.invites?.length ? (
                <ul className="space-y-2">
                  {deal.invites.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-600">
                          <Mail className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{inv.invitee_email}</p>
                          <Badge className={`mt-0.5 text-xs capitalize ${STATUS_COLOR[inv.status] || "bg-gray-100"}`}>
                            {inv.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-gray-500 hover:text-gray-900"
                        onClick={() => copyInviteLink(inv.id)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                  onClick={() => setShowInviteDialog(true)}
                >
                  <User className="h-4 w-4 mr-2" />
                  Invite freelancer
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showInviteDialog} onOpenChange={(open) => { setShowInviteDialog(open); if (!open) setInviteLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite freelancer</DialogTitle>
            <DialogDescription>They will receive a link to view the deal and accept, decline, or request changes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Email</Label>
            <ContributorEmailInput
              orgId={orgId}
              userId={userId}
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="freelancer@example.com"
              disabled={!!inviteLink}
            />
            <p className="text-xs text-muted-foreground">Start typing to pick a current contributor, or enter any email.</p>
          </div>
          {inviteLink && (
            <InviteLinkShare
              inviteLink={inviteLink}
              onCopy={() => toast({ title: "Copied to clipboard" })}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowInviteDialog(false); setInviteLink(null); }}>Cancel</Button>
            {!inviteLink ? (
              <Button onClick={handleInvite} disabled={inviteSubmitting || !inviteEmail.trim()}>
                {inviteSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Send invite
              </Button>
            ) : (
              <Button onClick={() => setShowInviteDialog(false)}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDisputeConfirm} onOpenChange={setShowDisputeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create dispute?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the deal as disputed. The freelancer will not receive payment until the dispute is resolved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDispute} className="bg-red-600 hover:bg-red-700">
              Create dispute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
