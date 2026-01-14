"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Edit, Trash2, Upload, Building2, Copy, CheckCircle2, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { TokenCombobox } from "@/components/TokenCombobox";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import type { TokenSelection } from "@/app/utils/types";

type Organization = {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: "active" | "inactive";
  org_referral: string;
  recipient_wallet: string | null;
  token_symbol: string | null;
  token_chain: string | null;
  bg_color: string | null;
  created_at: string;
  updated_at: string;
};

export function OrganizationsManager() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [], isLoading: tokensLoading } = useTokensQuery();
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
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Payment config state for editing
  const [editingPaymentConfig, setEditingPaymentConfig] = useState<{
    orgId: string;
    recipientWallet: string;
    tokenSelection: TokenSelection | null;
  } | null>(null);

  // Background color editing state
  const [editingBgColor, setEditingBgColor] = useState<{
    orgId: string;
    bgColor: string;
  } | null>(null);

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

  const handleUpdatePaymentConfig = async () => {
    if (!editingPaymentConfig) return;

    try {
      const { orgId, recipientWallet, tokenSelection } = editingPaymentConfig;

      if (!recipientWallet || !recipientWallet.trim()) {
        toast({
          variant: "destructive",
          title: "Validation error",
          description: "Recipient wallet address is required.",
        });
        return;
      }

      if (!tokenSelection) {
        toast({
          variant: "destructive",
          title: "Validation error",
          description: "Please select a token and network.",
        });
        return;
      }

      const response = await fetch("/api/organizations", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-privy-user-id": userId || "",
        },
        body: JSON.stringify({
          id: orgId,
          recipient_wallet: recipientWallet.trim(),
          token_symbol: tokenSelection.symbol,
          token_chain: tokenSelection.chain,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update payment config");
      }

      toast({
        title: "Payment config updated",
        description: "Recipient wallet and token settings have been saved.",
      });

      setEditingPaymentConfig(null);
      loadOrganizations();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to update payment config",
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to upload logo");
      }

      const result = await response.json();

      toast({
        title: "Logo uploaded",
        description: "Organization logo has been updated.",
      });

      // Reload organizations to show the new logo
      await loadOrganizations();
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

  const handleUpdateBgColor = async () => {
    if (!editingBgColor) return;

    try {
      const { orgId, bgColor } = editingBgColor;

      // Validate hex color if provided (allow empty string to clear)
      if (bgColor && bgColor.trim() && !/^#[0-9A-Fa-f]{6}$/.test(bgColor.trim())) {
        toast({
          variant: "destructive",
          title: "Validation error",
          description: "Background color must be a valid hex color (e.g., #FFFFFF) or empty.",
        });
        return;
      }

      const response = await fetch("/api/organizations", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-privy-user-id": userId || "",
        },
        body: JSON.stringify({
          id: orgId,
          bg_color: bgColor && bgColor.trim() ? bgColor.trim() : null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update background color");
      }

      toast({
        title: "Background color updated",
        description: "Checkout background color has been saved.",
      });

      setEditingBgColor(null);
      loadOrganizations();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to update background color",
        description: error?.message || "An error occurred.",
      });
    }
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
                <div>
                  <Label className="text-xs text-gray-500 mb-2 block">Logo</Label>
                  {org.logo_url ? (
                    <div className="flex items-center justify-center p-4 bg-gray-50 rounded-lg mb-2">
                      <img
                        src={org.logo_url}
                        alt={org.name}
                        className="max-h-20 max-w-full object-contain"
                        onError={(e) => {
                          console.error("Failed to load logo:", org.logo_url);
                          e.currentTarget.style.display = 'none';
                        }}
                        key={org.logo_url} // Force re-render when URL changes
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-4 bg-gray-50 rounded-lg mb-2 border-2 border-dashed border-gray-300">
                      <div className="text-center">
                        <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                        <p className="text-xs text-gray-500">No logo uploaded</p>
                      </div>
                    </div>
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={uploadingLogo}
                      onClick={() => {
                        const input = fileInputRefs.current[org.id];
                        if (input) {
                          input.click();
                        }
                      }}
                    >
                      {uploadingLogo ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          {org.logo_url ? "Change Logo" : "Upload Logo"}
                        </>
                      )}
                    </Button>
                    <input
                      ref={(el) => {
                        fileInputRefs.current[org.id] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(org, file);
                      }}
                      disabled={uploadingLogo}
                    />
                  </div>
                </div>

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

                <div className="pt-2 border-t">
                  <Label className="text-xs text-gray-500 mb-2 block">Payment Configuration</Label>
                  {org.recipient_wallet && org.token_symbol && org.token_chain ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">Wallet:</span>
                        <code className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs font-mono truncate">
                          {org.recipient_wallet.slice(0, 10)}...{org.recipient_wallet.slice(-8)}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Token:</span>
                        <span className="font-medium">{org.token_symbol}</span>
                        <span className="text-xs text-gray-500">({org.token_chain})</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No payment config set</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => {
                      setEditingPaymentConfig({
                        orgId: org.id,
                        recipientWallet: org.recipient_wallet || "",
                        tokenSelection: org.token_symbol && org.token_chain
                          ? { symbol: org.token_symbol, chain: org.token_chain }
                          : null,
                      });
                    }}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    {org.recipient_wallet ? "Edit Payment Config" : "Set Payment Config"}
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <Label className="text-xs text-gray-500 mb-2 block">Checkout Background Color</Label>
                  {org.bg_color ? (
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-8 h-8 rounded border border-gray-300"
                        style={{ backgroundColor: org.bg_color }}
                      />
                      <code className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                        {org.bg_color}
                      </code>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic mb-2">Default: White (#FFFFFF)</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setEditingBgColor({
                        orgId: org.id,
                        bgColor: org.bg_color || "",
                      });
                    }}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    {org.bg_color ? "Edit Background Color" : "Set Background Color"}
                  </Button>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(org)}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
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

      {/* Payment Config Edit Dialog */}
      <Dialog open={editingPaymentConfig !== null} onOpenChange={(open) => !open && setEditingPaymentConfig(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment Configuration</DialogTitle>
            <DialogDescription>
              Set the recipient wallet address and token for receiving payments
            </DialogDescription>
          </DialogHeader>
          {editingPaymentConfig && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="recipient_wallet">Recipient Wallet Address</Label>
                <Input
                  id="recipient_wallet"
                  value={editingPaymentConfig.recipientWallet}
                  onChange={(e) =>
                    setEditingPaymentConfig({
                      ...editingPaymentConfig,
                      recipientWallet: e.target.value,
                    })
                  }
                  placeholder="0x..."
                  className="font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Wallet address where payments will be received
                </p>
              </div>
              <div>
                <Label>Token & Network</Label>
                {tokensLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : (
                  <TokenCombobox
                    tokens={tokens}
                    value={editingPaymentConfig.tokenSelection || undefined}
                    onChange={(selection) =>
                      setEditingPaymentConfig({
                        ...editingPaymentConfig,
                        tokenSelection: selection,
                      })
                    }
                    placeholder="Select token and network..."
                  />
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Token and network for receiving payments
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingPaymentConfig(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button onClick={handleUpdatePaymentConfig} className="flex-1">
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Background Color Edit Dialog */}
      <Dialog open={editingBgColor !== null} onOpenChange={(open) => !open && setEditingBgColor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Checkout Background Color</DialogTitle>
            <DialogDescription>
              Set the background color for the checkout page (optional)
            </DialogDescription>
          </DialogHeader>
          {editingBgColor && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="bg_color">Background Color (Optional)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    id="bg_color"
                    type="color"
                    value={editingBgColor.bgColor || "#FFFFFF"}
                    onChange={(e) =>
                      setEditingBgColor({
                        ...editingBgColor,
                        bgColor: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-12 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={editingBgColor.bgColor}
                    onChange={(e) =>
                      setEditingBgColor({
                        ...editingBgColor,
                        bgColor: e.target.value.toUpperCase() || "",
                      })
                    }
                    placeholder="#FFFFFF (default: white)"
                    className="flex-1 font-mono"
                    pattern="^#?[0-9A-Fa-f]{0,6}$"
                  />
                  {editingBgColor.bgColor && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditingBgColor({
                          ...editingBgColor,
                          bgColor: "",
                        })
                      }
                      className="text-xs"
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Optional: Background color for checkout page. Leave empty to use default white (#FFFFFF).
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingBgColor(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button onClick={handleUpdateBgColor} className="flex-1">
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

