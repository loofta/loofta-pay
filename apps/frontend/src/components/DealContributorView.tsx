"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DealInvoiceResponse } from "@/services/api/deals";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { dealsApi, type DealResponse, type DealInviteResponse, type DealPaymentResponse } from "@/services/api/deals";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { TokenCombobox } from "@/components/TokenCombobox";
import {
  Loader2,
  ArrowLeft,
  Check,
  X,
  MessageSquare,
  Truck,
  FileText,
  Handshake,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

export type DealContributorViewProps = {
  inviteId: string;
  invite: DealInviteResponse;
  deal: DealResponse;
  contributorPayout?: { network: string; token_symbol: string } | null;
  backHref: string;
  backLabel: string;
  onDataChange?: () => void;
};

export function DealContributorView({
  inviteId,
  invite,
  deal,
  contributorPayout,
  backHref,
  backLabel,
  onDataChange,
}: DealContributorViewProps) {
  const { authenticated, userId, login } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();
  const [payments, setPayments] = useState<DealPaymentResponse[]>([]);
  const [preferredNetwork, setPreferredNetwork] = useState(
    contributorPayout?.network || invite.preferred_network || "base"
  );
  const [preferredToken, setPreferredToken] = useState(
    contributorPayout?.token_symbol || invite.preferred_token_symbol || "USDC"
  );
  const [requestMessage, setRequestMessage] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [invoice, setInvoice] = useState<(DealInvoiceResponse & { deal_title?: string; org_name?: string }) | null>(null);
  const fromContributorPayout = Boolean(contributorPayout?.network && contributorPayout?.token_symbol);

  useEffect(() => {
    if (!userId || !inviteId) return;
    dealsApi.invite.getInvoice(inviteId, userId).then(setInvoice).catch(() => setInvoice(null));
  }, [userId, inviteId]);

  useEffect(() => {
    if (!fromContributorPayout && userId && invite?.id) {
      dealsApi.freelancerProfile
        .get(userId)
        .then((profile) => {
          if (profile?.preferred_network) setPreferredNetwork(profile.preferred_network);
          if (profile?.preferred_token_symbol) setPreferredToken(profile.preferred_token_symbol);
        })
        .catch(() => {});
    }
  }, [userId, invite?.id, fromContributorPayout]);

  useEffect(() => {
    if (!userId || !inviteId || invite?.status !== "accepted") return;
    dealsApi.invite.listPayments(inviteId, userId).then(setPayments).catch(() => setPayments([]));
  }, [userId, inviteId, invite?.status]);

  const refresh = () => {
    onDataChange?.();
    if (invite?.status === "accepted") {
      dealsApi.invite.listPayments(inviteId, userId!).then(setPayments).catch(() => setPayments([]));
    }
  };

  const handleAccept = async () => {
    if (!userId) {
      login();
      return;
    }
    setActionLoading("accept");
    try {
      await dealsApi.invite.accept(
        inviteId,
        { preferred_network: preferredNetwork, preferred_token_symbol: preferredToken },
        userId
      );
      toast({ title: "Deal accepted", description: "You can confirm delivery when the work is done." });
      refresh();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async () => {
    if (!userId) {
      login();
      return;
    }
    setActionLoading("decline");
    try {
      await dealsApi.invite.decline(inviteId, userId);
      toast({ title: "Deal declined" });
      refresh();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRequestChanges = async () => {
    if (!userId || !requestMessage.trim()) return;
    setActionLoading("request");
    try {
      await dealsApi.invite.requestChanges(inviteId, { message: requestMessage.trim() }, userId);
      toast({ title: "Request sent", description: "The client can edit the deal and resend." });
      setShowRequestChanges(false);
      setRequestMessage("");
      refresh();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmDelivery = async () => {
    if (!userId) return;
    setActionLoading("delivery");
    try {
      await dealsApi.invite.confirmDelivery(inviteId, userId);
      toast({ title: "Delivery confirmed", description: "Waiting for the client to accept and release payment." });
      refresh();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Error" });
    } finally {
      setActionLoading(null);
    }
  };

  const isPending = invite.status === "invited";
  const isAccepted = invite.status === "accepted";
  const isRequestChanges = invite.status === "request_changes";
  const isDelivered = deal.status === "delivered";
  const isReleased = deal.status === "released";
  const canConfirmDelivery = isAccepted && (deal.status === "accepted" || deal.status === "funded");
  const isCompleted = isDelivered || isReleased;
  const inviteStatusLabel = invite.status.replace(/_/g, " ");
  const dealStatusLabel = deal.status.replace(/_/g, " ");
  const showDealStatusSeparately = deal.status !== invite.status;

  const viewTitle = isCompleted ? "Deal completed" : isAccepted ? "Deal in progress" : "Deal invite";
  const viewSubtitle = isCompleted
    ? "Delivery confirmed and payment released or pending."
    : isAccepted
      ? "Work on the deal and confirm delivery when done."
      : "You were invited to this deal. Accept to get paid, or request changes.";

  const headerIconBg = isCompleted ? "bg-green-100" : isAccepted ? "bg-blue-100" : "bg-amber-100";
  const headerIconColor = isCompleted ? "text-green-600" : isAccepted ? "text-blue-600" : "text-amber-600";

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      {/* Header: title reflects invite/deal status */}
      <div className="flex flex-col gap-4">
        <div className="flex justify-center">
          <div className={`flex h-14 w-14 items-center justify-center rounded-full ${headerIconBg}`}>
            <Handshake className={`h-7 w-7 ${headerIconColor}`} />
          </div>
        </div>
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{viewTitle}</h1>
          <p className="text-sm text-gray-500">{viewSubtitle}</p>
        </div>
      </div>

      {/* Single main card — same padding and structure as deal detail */}
      <Card className="border-gray-200/80 shadow-sm p-6">
        <CardHeader className="px-0 pb-2 pt-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-lg font-medium text-gray-900">{deal.title}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`capitalize ${STATUS_COLOR[invite.status] || "bg-gray-100"}`}>
                {inviteStatusLabel}
              </Badge>
              {showDealStatusSeparately && (
                <Badge variant="outline" className="text-gray-500 capitalize">{dealStatusLabel}</Badge>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="font-medium text-gray-900">
              {deal.amount} {deal.amount_currency}
            </span>
            {deal.deadline && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Due {new Date(deal.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5 px-0 pb-0 pt-4">
          {/* Description / Instructions — same section style as deal detail */}
          {deal.description && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Description</p>
              <p className="mt-1.5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {deal.description}
              </p>
            </div>
          )}
          {deal.instructions && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Instructions</p>
              <p className="mt-1.5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {deal.instructions}
              </p>
            </div>
          )}
          {deal.contract_attachment_url && (
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
          )}

          {/* How you get paid */}
          {(isPending || isRequestChanges) && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">How you get paid</p>
              {fromContributorPayout ? (
                <p className="text-xs text-emerald-600">Using your contributor payout settings for this organization.</p>
              ) : (
                <p className="text-xs text-gray-500">We use your freelancer profile when possible. Set wallet in your profile or as contributor.</p>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Network & token</Label>
                <TokenCombobox
                  tokens={tokens}
                  value={preferredNetwork && preferredToken ? { symbol: preferredToken, chain: preferredNetwork } : undefined}
                  onChange={(sel) => {
                    if (sel) {
                      setPreferredNetwork(sel.chain);
                      setPreferredToken(sel.symbol);
                    }
                  }}
                  placeholder="Select chain and token"
                />
              </div>
            </div>
          )}

          {/* Request changes message from client */}
          {invite.request_changes_message && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-800">Your request</p>
              <p className="mt-1 text-sm text-amber-900 whitespace-pre-wrap">{invite.request_changes_message}</p>
            </div>
          )}

          {showRequestChanges && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <Label className="text-sm">What should change?</Label>
              <textarea
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="e.g. Extend deadline, add milestones..."
              />
              <div className="flex gap-2">
                <Button onClick={handleRequestChanges} disabled={!requestMessage.trim() || !!actionLoading} className="flex-1">
                  {actionLoading === "request" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Send request
                </Button>
                <Button variant="outline" onClick={() => { setShowRequestChanges(false); setRequestMessage(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Invoice (from you to org) */}
          {invoice && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Invoice</p>
              <div className="flex justify-between items-center text-sm text-gray-700">
                <span>{invoice.amount} {invoice.amount_currency}</span>
                <Badge variant="outline" className="capitalize">{invoice.status}</Badge>
              </div>
              <Link href={`/payroll/deal-invite/${inviteId}/invoice`}>
                <Button variant="outline" size="sm" className="w-full mt-1">
                  <FileText className="h-4 w-4 mr-2" />
                  View invoice
                </Button>
              </Link>
            </div>
          )}

          {/* Payment status when accepted */}
          {payments.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Payment</p>
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm text-gray-700">
                    <span>{p.amount} {p.preferred_token_symbol} on {p.preferred_network}</span>
                    <Badge className={STATUS_COLOR[p.status] || "bg-gray-100"}>{p.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comments — client and freelancer can add anytime */}
      <Card className="border-gray-200/80 shadow-sm p-6">
        <CardContent className="px-0 pb-0 pt-0">
          <DealComments orgId={deal.organization_id} dealId={deal.id} />
        </CardContent>
      </Card>

      {/* CTAs — full width, stacked */}
      <div className="space-y-3">
        {isPending && (
          <>
            {!authenticated ? (
              <GradientActionButton onClick={() => login()} className="w-full">
                Log in to respond
              </GradientActionButton>
            ) : (
              <>
                <GradientActionButton onClick={handleAccept} disabled={!!actionLoading} className="w-full">
                  {actionLoading === "accept" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  Accept deal
                </GradientActionButton>
                <Button variant="outline" onClick={() => setShowRequestChanges(true)} disabled={!!actionLoading} className="w-full">
                  <MessageSquare className="h-4 w-4 mr-2" /> Request changes
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDecline}
                  disabled={!!actionLoading}
                  className="w-full border-red-200 text-red-700 hover:bg-red-50"
                >
                  {actionLoading === "decline" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <X className="h-4 w-4 mr-2" />}
                  Decline
                </Button>
              </>
            )}
          </>
        )}

        {canConfirmDelivery && (
          <GradientActionButton onClick={handleConfirmDelivery} disabled={!!actionLoading} className="w-full">
            {actionLoading === "delivery" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Truck className="h-4 w-4 mr-2" />}
            I have delivered the work
          </GradientActionButton>
        )}

        {isRequestChanges && !showRequestChanges && (
          <p className="text-center text-sm text-amber-700">You requested changes. The client may edit and resend. Refresh to see updates.</p>
        )}
        {isDelivered && (
          <p className="text-center text-sm text-violet-600">Delivery confirmed. Waiting for client to release payment.</p>
        )}
        {isReleased && (
          <p className="text-center text-sm text-green-600">Payment released. You will receive funds to your payout wallet.</p>
        )}
      </div>
    </div>
  );
}
