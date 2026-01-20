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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 className="w-8 h-8 text-blue-600" />
              Payroll
            </h1>
            <p className="mt-2 text-gray-600">
              Manage your organizations and pay contributors
            </p>
          </div>

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Organization
              </Button>
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
                <Button onClick={handleCreateOrganization} disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Organizations List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : organizations.length === 0 ? (
          <Card className="p-12">
            <div className="text-center">
              <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No organizations yet
              </h3>
              <p className="text-gray-500 mb-6">
                Create your first organization to start managing contributor payments.
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Organization
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {organizations.map((org) => (
              <Card
                key={org.id}
                className="hover:shadow-md transition-shadow cursor-pointer p-4"
                onClick={() => router.push(`/payroll/${org.id}`)}
              >
                <CardHeader className="flex flex-row items-center gap-4">
                  {org.logo_url ? (
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden">
                      <Image
                        src={org.logo_url}
                        alt={org.name}
                        fill
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-blue-600" />
                    </div>
                  )}
                  <div className="flex-1">
                    <CardTitle className="text-lg">{org.name}</CardTitle>
                    <CardDescription>
                      Created {new Date(org.created_at).toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
