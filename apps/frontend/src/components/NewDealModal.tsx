"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ContributorEmailInput } from "@/components/ContributorEmailInput";
import { dealsApi } from "@/services/api/deals";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, User, ChevronRight, Building2 } from "lucide-react";

type Step = 0 | 1 | 2;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, deal is created for this org. When unset, use clientOrgs to show a client picker step. */
  orgId?: string;
  /** When orgId is not set, show "Choose client" step with these organizations (e.g. owned + contributor orgs). */
  clientOrgs?: { id: string; name: string }[];
  userId: string | undefined;
  onSuccess?: () => void;
};

export function NewDealModal({
  open,
  onOpenChange,
  orgId: orgIdProp,
  clientOrgs,
  userId,
  onSuccess,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const hasClientPicker = !orgIdProp && clientOrgs && clientOrgs.length > 0;
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const orgId = orgIdProp ?? selectedOrgId ?? "";
  const [step, setStep] = useState<Step>(hasClientPicker ? 0 : 1);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [amount, setAmount] = useState("");
  const [amountCurrency, setAmountCurrency] = useState("USD");
  const [deadline, setDeadline] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const resetForm = () => {
    setStep(hasClientPicker ? 0 : 1);
    setSelectedOrgId(null);
    setTitle("");
    setDescription("");
    setInstructions("");
    setAmount("");
    setAmountCurrency("USD");
    setDeadline("");
    setInviteEmail("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const canNext =
    !!title.trim() && !!amount.trim();

  const handleNext = () => {
    if (step === 0 && selectedOrgId) {
      setStep(1);
      return;
    }
    if (step === 1 && canNext) setStep(2);
  };

  const handleCreateDeal = async () => {
    if (!userId || !orgId || !title.trim() || !amount.trim()) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Title and amount are required.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const deal = await dealsApi.deals.create(
        orgId,
        {
          title: title.trim(),
          description: description.trim() || undefined,
          instructions: instructions.trim() || undefined,
          amount: amount.trim(),
          amount_currency: amountCurrency,
          deadline: deadline.trim() || undefined,
        },
        userId
      );

      let inviteLink: string | null = null;
      if (inviteEmail.trim()) {
        try {
          const inv = await dealsApi.deals.invite(
            orgId,
            deal.id,
            { invitee_email: inviteEmail.trim() },
            userId
          );
          const base =
            typeof window !== "undefined" ? window.location.origin : "";
          inviteLink = `${base}/payroll/deal-invite/${inv.id}`;
          toast({
            title: "Deal created & invite sent",
            description: `Invitation sent to ${inviteEmail}. You can copy the link from the deal page.`,
          });
        } catch (inviteErr) {
          toast({
            variant: "destructive",
            title: "Deal created, invite failed",
            description:
              inviteErr instanceof Error ? inviteErr.message : "Could not send invite.",
          });
        }
      } else {
        toast({
          title: "Deal created",
          description: "You can invite a freelancer from the deal page.",
        });
      }

      handleOpenChange(false);
      onSuccess?.();
      if (orgId) router.push(`/payroll/${orgId}/deals/${deal.id}`);
      else router.push("/payroll");
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to create deal",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg p-6 sm:p-8">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1 flex-wrap">
            {hasClientPicker && (
              <>
                <span className={step >= 0 ? "text-foreground" : ""}>Client</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
            <span className={step >= 1 ? "text-foreground" : ""}>Deal</span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className={step >= 2 ? "text-foreground" : ""}>Invite</span>
          </div>
          <DialogTitle>
            {step === 0 ? "Choose client (organization)" : step === 1 ? "New deal" : "Invite freelancer"}
          </DialogTitle>
          <DialogDescription>
            {step === 0
              ? "Select the organization that will be the client for this deal."
              : step === 1
                ? "Add title, amount, and optional details. You can invite someone in the next step."
                : "Optionally enter the freelancer's email to send an invite now."}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && hasClientPicker && clientOrgs && (
          <div className="space-y-4 py-2">
            <div>
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Organization
              </Label>
              <Select value={selectedOrgId ?? ""} onValueChange={(v) => setSelectedOrgId(v || null)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select client organization..." />
                </SelectTrigger>
                <SelectContent>
                  {clientOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button type="button" variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <GradientActionButton
                type="button"
                className="w-full min-w-0"
                onClick={handleNext}
                disabled={!selectedOrgId}
              >
                Next: Deal details
                <ChevronRight className="h-4 w-4 ml-1" />
              </GradientActionButton>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="modal-title">Title *</Label>
              <Input
                id="modal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Logo design"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="modal-description">Description</Label>
              <textarea
                id="modal-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Scope of work..."
                className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <Label htmlFor="modal-instructions">Instructions for freelancer</Label>
              <textarea
                id="modal-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Deliverables, format..."
                className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="modal-amount">Amount *</Label>
                <Input
                  id="modal-amount"
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="modal-currency">Currency</Label>
                <Input
                  id="modal-currency"
                  value={amountCurrency}
                  onChange={(e) => setAmountCurrency(e.target.value)}
                  placeholder="USD"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="modal-deadline">Deadline (optional)</Label>
              <Input
                id="modal-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex flex-col gap-2 pt-2">
              {hasClientPicker ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setStep(0)}
                >
                  Back
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <GradientActionButton
                type="button"
                className="w-full min-w-0"
                onClick={handleNext}
                disabled={!canNext}
              >
                Next: Invite freelancer
                <ChevronRight className="h-4 w-4 ml-1" />
              </GradientActionButton>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">{title || "Untitled"}</p>
              <p className="text-muted-foreground mt-0.5">
                {amount} {amountCurrency}
                {deadline && ` · ${new Date(deadline).toLocaleDateString()}`}
              </p>
            </div>
            <div>
              <Label htmlFor="modal-invite-email" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Freelancer email (optional)
              </Label>
              <ContributorEmailInput
                orgId={orgId}
                userId={userId}
                value={inviteEmail}
                onChange={setInviteEmail}
                placeholder="freelancer@example.com"
                id="modal-invite-email"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Start typing to pick a current contributor, or leave blank to invite later from the deal page.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Back
              </Button>
              <GradientActionButton
                type="button"
                className="w-full min-w-0"
                onClick={handleCreateDeal}
                disabled={submitting}
                loading={submitting}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Create deal
              </GradientActionButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
