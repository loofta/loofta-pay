"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { dealsApi } from "@/services/api/deals";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import {
  Loader2,
  Plus,
  Building2,
  Users,
  ArrowRight,
  Upload,
  Handshake,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NewDealModal } from "@/components/NewDealModal";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";

export default function PayrollPage() {
  const { authenticated, userId, login, ready } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [organizations, setOrganizations] = useState<PayrollOrganization[]>([]);
  const [contributorOrgs, setContributorOrgs] = useState<(PayrollOrganization & { role: string })[]>([]);
  const [contributorDealCounts, setContributorDealCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showNewDealModal, setShowNewDealModal] = useState(false);

  // Create form
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgLogo, setNewOrgLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const [orgs, asContributor] = await Promise.all([
        payrollApi.organizations.list(userId),
        payrollApi.organizations.listAsContributor(userId).catch(() => []),
      ]);
      setOrganizations(orgs);
      const contribList = asContributor || [];
      setContributorOrgs(contribList);
      if (contribList.length > 0) {
        const counts = await Promise.all(
          contribList.map(async (org) => {
            try {
              const invites = await dealsApi.deals.listMyInvites(org.id, userId);
              return { orgId: org.id, count: invites?.length ?? 0 };
            } catch {
              return { orgId: org.id, count: 0 };
            }
          })
        );
        setContributorDealCounts(Object.fromEntries(counts.map((c) => [c.orgId, c.count])));
      } else {
        setContributorDealCounts({});
      }
    } catch (error: any) {
      console.error("Failed to load organizations:", error);
      toast({
        variant: "destructive",
        title: "Failed to load organizations",
        description: error?.message || "Please try again",
      });
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  const loginRef = useRef(login);
  loginRef.current = login;
  useEffect(() => {
    if (ready && !authenticated) {
      loginRef.current();
    }
  }, [ready, authenticated]);

  useEffect(() => {
    if (ready && authenticated && userId) {
      loadOrganizations();
    }
  }, [ready, authenticated, userId, loadOrganizations]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewOrgLogo(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim()) {
      toast({
        variant: "destructive",
        title: "Name required",
        description: "Please enter an organization name",
      });
      return;
    }

    setCreating(true);
    try {
      // For now, just create without logo (logo upload can be added later)
      const org = await payrollApi.organizations.create(
        { name: newOrgName.trim() },
        userId,
      );

      toast({
        title: "Organization created!",
        description: `${org.name} has been created successfully.`,
      });

      setShowCreateDialog(false);
      setNewOrgName("");
      setNewOrgLogo(null);
      setLogoPreview(null);

      // Navigate to the new org
      router.push(`/payroll/${org.id}`);
    } catch (error: any) {
      console.error("Failed to create organization:", error);
      toast({
        variant: "destructive",
        title: "Failed to create organization",
        description: error?.message || "Please try again",
      });
    } finally {
      setCreating(false);
    }
  };

  if (!ready || (ready && !authenticated)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero + CTA — minimal clicks */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Organizations
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Create an org, invite contributors, and pay in one go. Gas abstracted via NEAR Intents.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {(organizations.length > 0 || contributorOrgs.length > 0) && (
            <Button
              variant="outline"
              className="shrink-0 w-auto gap-2"
              onClick={() => setShowNewDealModal(true)}
            >
              <Handshake className="h-4 w-4" />
              Create deal
            </Button>
          )}
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <GradientActionButton className="shrink-0 w-auto px-5">
                <Plus className="mr-2 h-4 w-4" />
                New organization
              </GradientActionButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Organization</DialogTitle>
                <DialogDescription>
                  Create a new organization to manage contributor payments.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    placeholder="Acme Inc."
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                  />
                </div>

                <div className="space-y-2 ">
                  <Label>Logo (optional)</Label>
                  <div className="flex items-center gap-4">
                    {logoPreview ? (
                      <div className="relative w-16 h-16 rounded-lg overflow-hidden border">
                        <Image
                          src={logoPreview}
                          alt="Logo preview"
                          fill
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                        <Building2 className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                    <label className="cursor-pointer">
                      <div className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50">
                        <Upload className="w-4 h-4" />
                        Upload
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoChange}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <DialogFooter className="flex flex-row justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <GradientActionButton onClick={handleCreateOrganization} disabled={creating} loading={creating} loadingText="Creating...">
                  Create
                </GradientActionButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Create deal with client picker (for contributors and org owners) */}
      {(organizations.length > 0 || contributorOrgs.length > 0) && (
        <NewDealModal
          open={showNewDealModal}
          onOpenChange={setShowNewDealModal}
          clientOrgs={Array.from(
            new Map(
              [
                ...organizations.map((o) => [o.id, { id: o.id, name: o.name }] as const),
                ...contributorOrgs.map((o) => [o.id, { id: o.id, name: o.name }] as const),
              ]
            ).values()
          )}
          userId={userId}
          onSuccess={() => loadOrganizations()}
        />
      )}

      {/* Organizations you own or manage */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Your organizations</h2>
            {organizations.length === 0 ? (
              <Card className="overflow-hidden border-gray-200 bg-white">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
                    <Building2 className="h-7 w-7 text-gray-400" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">No organizations yet</h3>
                  <p className="mt-1 max-w-sm text-sm text-gray-500">
                    Create your first organization to invite contributors and run payroll.
                  </p>
                  <GradientActionButton className="mt-6 w-auto px-6" onClick={() => setShowCreateDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create organization
                  </GradientActionButton>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {organizations.map((org) => (
                  <Card
                    key={org.id}
                    className="cursor-pointer border-gray-200 bg-white transition-shadow hover:shadow-md"
                    onClick={() => router.push(`/payroll/${org.id}`)}
                  >
                    <CardContent className="flex items-center gap-4 p-6">
                      {org.logo_url ? (
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                          <Image src={org.logo_url} alt={org.name} fill className="object-cover" />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100">
                          <Building2 className="h-6 w-6 text-gray-500" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <CardTitle className="truncate text-base font-semibold">{org.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {new Date(org.created_at).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <ArrowRight className="h-5 w-5 shrink-0 text-gray-400" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Organizations you contribute to */}
          {contributorOrgs.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Organizations you contribute to</h2>
              <p className="text-sm text-gray-500 mb-3">You are a contributor here. Open an org to view your deals or create one.</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {contributorOrgs.map((org) => {
                  const dealCount = contributorDealCounts[org.id] ?? 0;
                  return (
                    <Card
                      key={org.id}
                      className="border-gray-200 bg-white transition-shadow hover:shadow-md"
                    >
                      <CardContent className="p-6">
                        <div
                          className="flex items-center gap-4 cursor-pointer"
                          onClick={() => router.push(`/payroll/${org.id}`)}
                        >
                          {org.logo_url ? (
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                              <Image src={org.logo_url} alt={org.name} fill className="object-cover" />
                            </div>
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                              <Users className="h-6 w-6 text-amber-700" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <CardTitle className="truncate text-base font-semibold">{org.name}</CardTitle>
                            <Badge variant="secondary" className="text-xs mt-0.5">Contributor</Badge>
                          </div>
                          <ArrowRight className="h-5 w-5 shrink-0 text-gray-400" />
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                          <Link
                            href={`/payroll/${org.id}/deals`}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Handshake className="h-4 w-4" />
                            Deals
                            {dealCount >= 0 && (
                              <span className="text-gray-500 font-normal">({dealCount})</span>
                            )}
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/payroll/${org.id}`);
                            }}
                          >
                            View org
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
