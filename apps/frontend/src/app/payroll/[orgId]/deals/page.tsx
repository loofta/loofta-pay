"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi, type DealResponse } from "@/services/api/deals";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { NewDealModal } from "@/components/NewDealModal";
import { ContributorEmailInput } from "@/components/ContributorEmailInput";
import { InviteLinkShare } from "@/components/InviteLinkShare";
import { Handshake, Plus, Loader2, ArrowLeft, ChevronRight, ChevronDown, Clock, User, ExternalLink, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [inviteDealId, setInviteDealId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<{
    dealId: string;
    title: string;
    description: string;
    instructions: string;
    amount: string;
    amount_currency: string;
    deadline: string;
  } | null>(null);

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

  const handleUpdateDeal = async (
    dealId: string,
    data: { title: string; description: string; instructions: string; amount: string; amount_currency: string; deadline: string }
  ) => {
    if (!userId || !orgId) return;
    setEditSubmitting(true);
    try {
      await dealsApi.deals.update(orgId, dealId, data, userId);
      toast({ title: "Deal updated" });
      loadData();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Update failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleInvite = async () => {
    if (!userId || !orgId || !inviteDealId || !inviteEmail.trim()) return;
    setInviteSubmitting(true);
    try {
      const inv = await dealsApi.deals.invite(orgId, inviteDealId, { invitee_email: inviteEmail.trim() }, userId);
      const base = typeof window !== "undefined" ? window.location.origin : "";
      setInviteLink(`${base}/payroll/deal-invite/${inv.id}`);
      toast({ title: "Invite sent", description: `Link created for ${inviteEmail}. Copy and share it.` });
      loadData();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Invite failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setInviteSubmitting(false);
    }
  };

  const closeInviteDialog = () => {
    setInviteDealId(null);
    setInviteEmail("");
    setInviteLink(null);
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href={`/payroll/${orgId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to {organization.name}
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Deals</h1>
          <p className="text-sm text-gray-500 mt-1">Create deals, invite freelancers, and release payment after delivery.</p>
        </div>
        <GradientActionButton
          className="gap-2"
          onClick={() => setNewDealModalOpen(true)}
        >
          <Plus className="h-4 w-4" /> New deal
        </GradientActionButton>
      </div>

      {deals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Handshake className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 text-center mb-4">No deals yet. Create a deal to invite a freelancer.</p>
            <Button onClick={() => setNewDealModalOpen(true)}>Create your first deal</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {deals.map((deal) => {
            const acceptedInvite = deal.invites?.find((i) => i.status === "accepted");
            const isExpanded = expandedDealId === deal.id;
            const canEdit = deal.status === "draft" || deal.status === "invited";
            const form = isExpanded && editingForm?.dealId === deal.id ? editingForm : null;

            const toggleExpand = () => {
              if (isExpanded) {
                setExpandedDealId(null);
                setEditingForm(null);
              } else {
                setExpandedDealId(deal.id);
                setEditingForm({
                  dealId: deal.id,
                  title: deal.title,
                  description: deal.description ?? "",
                  instructions: deal.instructions ?? "",
                  amount: deal.amount,
                  amount_currency: deal.amount_currency,
                  deadline: deal.deadline ?? "",
                });
              }
            };

            const setForm = (updates: Partial<NonNullable<typeof editingForm>>) => {
              if (editingForm?.dealId === deal.id) setEditingForm({ ...editingForm, ...updates });
            };

            const handleSave = () => {
              if (!form) return;
              handleUpdateDeal(deal.id, {
                title: form.title,
                description: form.description,
                instructions: form.instructions,
                amount: form.amount,
                amount_currency: form.amount_currency,
                deadline: form.deadline,
              });
            };

            return (
              <Card key={deal.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={toggleExpand}
                    className="w-full flex flex-wrap items-center justify-between gap-3 p-6 text-left hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 truncate">{deal.title}</span>
                        <Badge className={STATUS_COLOR[deal.status] || "bg-gray-100"}>{deal.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span>{deal.amount} {deal.amount_currency}</span>
                        {deal.deadline && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {new Date(deal.deadline).toLocaleDateString()}
                          </span>
                        )}
                        {acceptedInvite && (
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" /> {acceptedInvite.invitee_email}
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-gray-400 shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t bg-gray-50/50 px-6 pb-6 pt-4 space-y-4">
                      {canEdit && form ? (
                        <>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <Label>Title *</Label>
                              <Input value={form.title} onChange={(e) => setForm({ title: e.target.value })} className="mt-1" />
                            </div>
                            <div className="sm:col-span-2">
                              <Label>Description</Label>
                              <textarea value={form.description} onChange={(e) => setForm({ description: e.target.value })} className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" />
                            </div>
                            <div className="sm:col-span-2">
                              <Label>Instructions for freelancer</Label>
                              <textarea value={form.instructions} onChange={(e) => setForm({ instructions: e.target.value })} className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" />
                            </div>
                            <div>
                              <Label>Amount *</Label>
                              <Input value={form.amount} onChange={(e) => setForm({ amount: e.target.value })} className="mt-1" />
                            </div>
                            <div>
                              <Label>Currency</Label>
                              <Input value={form.amount_currency} onChange={(e) => setForm({ amount_currency: e.target.value })} className="mt-1" />
                            </div>
                            <div className="sm:col-span-2">
                              <Label>Deadline</Label>
                              <Input type="date" value={form.deadline} onChange={(e) => setForm({ deadline: e.target.value })} className="mt-1" />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <GradientActionButton onClick={handleSave} disabled={editSubmitting}>
                              {editSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                              Save changes
                            </GradientActionButton>
                            <Button variant="outline" size="sm" onClick={() => setInviteDealId(deal.id)}>
                              <User className="h-4 w-4 mr-2" /> Invite freelancer
                            </Button>
                            <Link href={`/payroll/${orgId}/deals/${deal.id}`}>
                              <Button variant="outline" size="sm">
                                <ExternalLink className="h-4 w-4 mr-2" /> Open full page
                              </Button>
                            </Link>
                          </div>
                        </>
                      ) : (
                        <>
                          {deal.description && (
                            <div>
                              <p className="text-sm font-medium text-gray-700">Description</p>
                              <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{deal.description}</p>
                            </div>
                          )}
                          {deal.instructions && (
                            <div>
                              <p className="text-sm font-medium text-gray-700">Instructions</p>
                              <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{deal.instructions}</p>
                            </div>
                          )}
                          <Link href={`/payroll/${orgId}/deals/${deal.id}`}>
                            <Button variant="outline" size="sm">
                              <ExternalLink className="h-4 w-4 mr-2" /> Open full page
                            </Button>
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!inviteDealId} onOpenChange={(open) => !open && closeInviteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite freelancer</DialogTitle>
            <DialogDescription>They will get a link to view the deal and accept, decline, or request changes.</DialogDescription>
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
            <Button variant="outline" onClick={closeInviteDialog}>Cancel</Button>
            {!inviteLink ? (
              <Button onClick={handleInvite} disabled={inviteSubmitting || !inviteEmail.trim()}>
                {inviteSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Send invite
              </Button>
            ) : (
              <Button onClick={closeInviteDialog}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
