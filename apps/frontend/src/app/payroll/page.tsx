"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization } from "@/services/api/payroll";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import {
  Loader2,
  Plus,
  Building2,
  Users,
  ArrowRight,
  Upload,
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
import Image from "next/image";

export default function PayrollPage() {
  const { authenticated, userId, login, ready } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [organizations, setOrganizations] = useState<PayrollOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Create form
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgLogo, setNewOrgLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const orgs = await payrollApi.organizations.list(userId);
      setOrganizations(orgs);
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

  useEffect(() => {
    if (ready && !authenticated) {
      login();
    }
  }, [ready, authenticated, login]);

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

              <DialogFooter>
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

      {/* Organizations List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : organizations.length === 0 ? (
        <Card className="overflow-hidden border-gray-200 bg-white">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <Building2 className="h-7 w-7 text-gray-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">No organizations yet</h2>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Create your first organization to invite contributors and run payroll. One payment, gas abstracted.
            </p>
            <GradientActionButton className="mt-6 w-auto px-6" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create organization
            </GradientActionButton>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {organizations.map((org) => (
            <Card
              key={org.id}
              className="cursor-pointer border-gray-200 bg-white transition-shadow hover:shadow-md"
              onClick={() => router.push(`/payroll/${org.id}`)}
            >
              <div className="flex items-center gap-4 p-4">
                {org.logo_url ? (
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                    <Image
                      src={org.logo_url}
                      alt={org.name}
                      fill
                      className="object-cover"
                    />
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
