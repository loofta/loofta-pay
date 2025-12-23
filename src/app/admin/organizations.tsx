"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Edit, Trash2, Upload, Building2, Copy, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Organization = {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: "active" | "inactive";
  org_referral: string;
  created_at: string;
  updated_at: string;
};

export function OrganizationsManager() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    organization_id: "",
    checkout_status: "inactive" as "active" | "inactive",
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState<string | null>(null);

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/organizations", {
        headers: {
          "x-privy-user-id": userId || "",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to load organizations");
      }

      const data = await response.json();
      setOrganizations(data.organizations || []);
    } catch (error: any) {
      console.error("Failed to load organizations:", error);
      toast({
        variant: "destructive",
        title: "Failed to load organizations",
        description: error?.message || "An error occurred.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      if (!formData.name || !formData.organization_id) {
        toast({
          variant: "destructive",
          title: "Validation error",
          description: "Name and Organization ID are required.",
        });
        return;
      }

      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-privy-user-id": userId || "",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create organization");
      }

      toast({
        title: "Organization created",
        description: `${formData.name} has been created successfully.`,
      });

      setIsCreateDialogOpen(false);
      setFormData({ name: "", organization_id: "", checkout_status: "inactive" });
      loadOrganizations();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to create organization",
        description: error?.message || "An error occurred.",
      });
    }
  };

  const handleUpdate = async (org: Organization) => {
    try {
      const response = await fetch("/api/organizations", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-privy-user-id": userId || "",
        },
        body: JSON.stringify({
          id: org.id,
          checkout_status: org.checkout_status === "active" ? "inactive" : "active",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update organization");
      }

      toast({
        title: "Organization updated",
        description: `${org.name} status has been updated.`,
      });

      loadOrganizations();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to update organization",
        description: error?.message || "An error occurred.",
      });
    }
  };

  const handleDelete = async (org: Organization) => {
    if (!confirm(`Are you sure you want to delete ${org.name}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/organizations?id=${org.id}`, {
        method: "DELETE",
        headers: {
          "x-privy-user-id": userId || "",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete organization");
      }

      toast({
        title: "Organization deleted",
        description: `${org.name} has been deleted.`,
      });

      loadOrganizations();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to delete organization",
        description: error?.message || "An error occurred.",
      });
    }
  };

  const handleLogoUpload = async (org: Organization, file: File) => {
    try {
      setUploadingLogo(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("organizationId", org.organization_id);

      const response = await fetch("/api/organizations/upload", {
        method: "POST",
        headers: {
          "x-privy-user-id": userId || "",
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload logo");
      }

      toast({
        title: "Logo uploaded",
        description: "Organization logo has been updated.",
      });

      loadOrganizations();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to upload logo",
        description: error?.message || "An error occurred.",
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const copyReferral = (referral: string) => {
    navigator.clipboard.writeText(referral);
    setCopiedReferral(referral);
    toast({
      title: "Copied!",
      description: "Referral code copied to clipboard.",
    });
    setTimeout(() => setCopiedReferral(null), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6" />
            Organizations
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Manage organizations and their checkout settings
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Organization</DialogTitle>
              <DialogDescription>
                Create a new organization to enable multi-chain checkout
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Acme Inc."
                />
              </div>
              <div>
                <Label htmlFor="organization_id">Organization ID</Label>
                <Input
                  id="organization_id"
                  value={formData.organization_id}
                  onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
                  placeholder="acme-inc"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Unique identifier (used in checkout URL)
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="status"
                  checked={formData.checkout_status === "active"}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      checkout_status: checked ? "active" : "inactive",
                    })
                  }
                />
                <Label htmlFor="status">Active</Label>
              </div>
              <Button onClick={handleCreate} className="w-full">
                Create Organization
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : organizations.length === 0 ? (
        <Card className="p-6">
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-500">No organizations found.</p>
            <p className="text-sm text-gray-400 mt-2">
              Create your first organization to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {organizations.map((org) => (
            <Card key={org.id} className="p-4">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{org.name}</CardTitle>
                    <CardDescription className="mt-1">
                      ID: {org.organization_id}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${org.checkout_status === "active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                        }`}
                    >
                      {org.checkout_status}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {org.logo_url && (
                  <div className="flex items-center justify-center p-4 bg-gray-50 rounded-lg">
                    <img
                      src={org.logo_url}
                      alt={org.name}
                      className="max-h-16 max-w-full object-contain"
                    />
                  </div>
                )}

                <div>
                  <Label className="text-xs text-gray-500">Referral Code</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 px-2 py-1 bg-gray-100 rounded text-sm font-mono">
                      {org.org_referral}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyReferral(org.org_referral)}
                    >
                      {copiedReferral === org.org_referral ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={org.checkout_status === "active"}
                      onCheckedChange={() => handleUpdate(org)}
                    />
                    <Label className="text-sm">
                      {org.checkout_status === "active" ? "Active" : "Inactive"}
                    </Label>
                  </div>
                  <div className="flex gap-2">
                    <label className="cursor-pointer">
                      <Upload className="w-4 h-4 text-gray-600" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleLogoUpload(org, file);
                        }}
                        disabled={uploadingLogo}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(org)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <a
                    href={`/checkout?organizationId=${org.organization_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View Checkout →
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

