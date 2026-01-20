"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { payrollApi, type PayrollOrganization, type PayrollContributor } from "@/services/api/payroll";
import { TokenCombobox } from "@/components/TokenCombobox";
import {
  Loader2,
  Plus,
  ArrowLeft,
  Users,
  Trash2,
  Edit,
  Mail,
  Wallet,
  Check,
  Clock,
  X,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Image from "next/image";

// Network to chain mapping
const NETWORK_CHAINS: Record<string, string> = {
  ethereum: "eth",
  base: "base",
  optimism: "optimism",
  arbitrum: "arbitrum",
  polygon: "polygon",
};

export default function PayrollOrgPage() {
  const params = useParams();
  const orgId = params.orgId as string;
  const router = useRouter();
  const { authenticated, userId, login, ready } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();

  const [organization, setOrganization] = useState<PayrollOrganization | null>(null);
  const [contributors, setContributors] = useState<PayrollContributor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingContributor, setEditingContributor] = useState<PayrollContributor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollContributor | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formEmail, setFormEmail] = useState("");
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formWalletAddress, setFormWalletAddress] = useState("");
  const [formNetwork, setFormNetwork] = useState<string | null>(null);
  const [formTokenSymbol, setFormTokenSymbol] = useState<string | null>(null);
  const [formDepartment, setFormDepartment] = useState<string | null>(null);

  // Predefined departments
  const DEPARTMENTS = ["Engineering", "Marketing", "Finance", "Operations", "Design", "Sales", "HR", "Legal", "Other"];

  const loadData = useCallback(async () => {
    if (!userId || !orgId) return;
    try {
      setLoading(true);
      const [org, contribs] = await Promise.all([
        payrollApi.organizations.get(orgId, userId),
        payrollApi.contributors.list(orgId, userId),
      ]);
      setOrganization(org);
      setContributors(contribs);
    } catch (error: any) {
      console.error("Failed to load data:", error);
      toast({
        variant: "destructive",
        title: "Failed to load organization",
        description: error?.message || "Please try again",
      });
    } finally {
      setLoading(false);
    }
  }, [userId, orgId, toast]);

  useEffect(() => {
    if (ready && !authenticated) {
      login();
    }
  }, [ready, authenticated, login]);

  useEffect(() => {
    if (ready && authenticated && userId && orgId) {
      loadData();
    }
  }, [ready, authenticated, userId, orgId, loadData]);

  const resetForm = () => {
    setFormEmail("");
    setFormFirstName("");
    setFormLastName("");
    setFormWalletAddress("");
    setFormNetwork(null);
    setFormTokenSymbol(null);
    setFormDepartment(null);
  };

  const handleAddContributor = async () => {
    if (!formEmail.trim()) {
      toast({
        variant: "destructive",
        title: "Email required",
        description: "Please enter the contributor's email",
      });
      return;
    }

    // Validate wallet matches network if both provided
    if (formWalletAddress && formNetwork) {
      const isEvm = ["ethereum", "base", "optimism", "arbitrum", "polygon", "avalanche", "bsc"].includes(formNetwork);
      if (isEvm && !formWalletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        toast({
          variant: "destructive",
          title: "Invalid wallet address",
          description: `Wallet address must be a valid ${formNetwork} address`,
        });
        return;
      }
    }

    setSaving(true);
    try {
      await payrollApi.contributors.create(
        orgId,
        {
          email: formEmail.trim(),
          firstName: formFirstName.trim() || undefined,
          lastName: formLastName.trim() || undefined,
          walletAddress: formWalletAddress.trim() || undefined,
          network: formNetwork || undefined,
          tokenSymbol: formTokenSymbol || undefined,
          department: formDepartment || undefined,
        },
        userId,
      );

      toast({
        title: "Contributor added!",
        description: `${formEmail} has been invited.`,
      });

      setShowAddDialog(false);
      resetForm();
      loadData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to add contributor",
        description: error?.message || "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditContributor = async () => {
    if (!editingContributor) return;

    setSaving(true);
    try {
      await payrollApi.contributors.update(
        orgId,
        editingContributor.id,
        {
          firstName: formFirstName.trim() || undefined,
          lastName: formLastName.trim() || undefined,
          walletAddress: formWalletAddress.trim() || undefined,
          network: formNetwork || undefined,
          tokenSymbol: formTokenSymbol || undefined,
          department: formDepartment || undefined,
        },
        userId,
      );

      toast({
        title: "Contributor updated",
      });

      setShowEditDialog(false);
      setEditingContributor(null);
      resetForm();
      loadData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to update contributor",
        description: error?.message || "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContributor = async () => {
    if (!deleteTarget) return;

    try {
      await payrollApi.contributors.remove(orgId, deleteTarget.id, userId);
      toast({
        title: "Contributor removed",
      });
      setDeleteTarget(null);
      loadData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to remove contributor",
        description: error?.message,
      });
    }
  };

  const openEditDialog = (contrib: PayrollContributor) => {
    setEditingContributor(contrib);
    setFormEmail(contrib.email);
    setFormFirstName(contrib.first_name || "");
    setFormLastName(contrib.last_name || "");
    setFormWalletAddress(contrib.wallet_address || "");
    setFormNetwork(contrib.network || null);
    setFormTokenSymbol(contrib.token_symbol || null);
    setFormDepartment(contrib.department || null);
    setShowEditDialog(true);
  };

  const getStatusBadge = (status: PayrollContributor["status"]) => {
    switch (status) {
      case "joined":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            <Check className="w-3 h-3 mr-1" />
            Joined
          </Badge>
        );
      case "invited":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Invited
          </Badge>
        );
      case "removed":
        return (
          <Badge variant="destructive">
            <X className="w-3 h-3 mr-1" />
            Removed
          </Badge>
        );
    }
  };

  if (!ready || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Organization not found</h2>
          <Button onClick={() => router.push("/payroll")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Payroll
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.push("/payroll")}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organizations
          </Button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {organization.logo_url ? (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden">
                  <Image
                    src={organization.logo_url}
                    alt={organization.name}
                    fill
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="w-8 h-8 text-blue-600" />
                </div>
              )}
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{organization.name}</h1>
                <p className="text-gray-600">
                  {contributors.length} contributor{contributors.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Contributor
            </Button>
          </div>
        </div>

        {/* Contributors List */}
        <Card className="p-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Contributors
            </CardTitle>
            <CardDescription>
              Manage team members who will receive payments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contributors.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No contributors yet</p>
                <Button variant="outline" onClick={() => setShowAddDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add your first contributor
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-4 font-medium text-gray-700">Name</th>
                      <th className="p-4 font-medium text-gray-700">Email</th>
                      <th className="p-4 font-medium text-gray-700">Department</th>
                      <th className="p-4 font-medium text-gray-700">Wallet</th>
                      <th className="p-4 font-medium text-gray-700">Network / Token</th>
                      <th className="p-4 font-medium text-gray-700">Status</th>
                      <th className="p-4 font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributors.map((contrib) => (
                      <tr key={contrib.id} className="border-b hover:bg-gray-50">
                        <td className="p-4">
                          {contrib.first_name || contrib.last_name
                            ? `${contrib.first_name || ""} ${contrib.last_name || ""}`.trim()
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-gray-400" />
                            {contrib.email}
                          </div>
                        </td>
                        <td className="p-4">
                          {contrib.department ? (
                            <Badge variant="outline" className="text-xs">
                              {contrib.department}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-4 font-mono text-sm">
                          {contrib.wallet_address ? (
                            <div className="flex items-center gap-2">
                              <Wallet className="w-4 h-4 text-gray-400" />
                              {contrib.wallet_address.slice(0, 6)}...{contrib.wallet_address.slice(-4)}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          {contrib.network || contrib.token_symbol ? (
                            <span className="text-sm">
                              {contrib.network || "—"} / {contrib.token_symbol || "—"}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          {getStatusBadge(contrib.status)}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(contrib)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(contrib)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Contributor Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Contributor</DialogTitle>
            <DialogDescription>
              Invite a team member to receive payments
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="contributor@example.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={formFirstName}
                  onChange={(e) => setFormFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={formLastName}
                  onChange={(e) => setFormLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Network & Token</Label>
              <TokenCombobox
                tokens={tokens}
                value={formNetwork && formTokenSymbol ? { symbol: formTokenSymbol, chain: formNetwork } : undefined}
                onChange={(sel) => {
                  setFormNetwork(sel?.chain || null);
                  setFormTokenSymbol(sel?.symbol || null);
                }}
              />
              <p className="text-xs text-gray-500">
                Select the network and token this contributor wants to be paid with
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet">Wallet Address</Label>
              <Input
                id="wallet"
                placeholder={formNetwork ? `Enter ${formNetwork} wallet address` : "Select network first"}
                value={formWalletAddress}
                onChange={(e) => setFormWalletAddress(e.target.value)}
                disabled={!formNetwork}
              />
              {formNetwork && (
                <p className="text-xs text-gray-500">
                  Must be a valid {formNetwork} address
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Select value={formDepartment || ""} onValueChange={(v) => setFormDepartment(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((dept) => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Used for grouping expenses by department
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleAddContributor} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add Contributor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contributor Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => { setShowEditDialog(open); if (!open) { setEditingContributor(null); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Contributor</DialogTitle>
            <DialogDescription>
              Update contributor details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={formEmail} disabled className="bg-gray-50" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editFirstName">First Name</Label>
                <Input
                  id="editFirstName"
                  placeholder="John"
                  value={formFirstName}
                  onChange={(e) => setFormFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editLastName">Last Name</Label>
                <Input
                  id="editLastName"
                  placeholder="Doe"
                  value={formLastName}
                  onChange={(e) => setFormLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Network & Token</Label>
              <TokenCombobox
                tokens={tokens}
                value={formNetwork && formTokenSymbol ? { symbol: formTokenSymbol, chain: formNetwork } : undefined}
                onChange={(sel) => {
                  setFormNetwork(sel?.chain || null);
                  setFormTokenSymbol(sel?.symbol || null);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editWallet">Wallet Address</Label>
              <Input
                id="editWallet"
                placeholder={formNetwork ? `Enter ${formNetwork} wallet address` : "Select network first"}
                value={formWalletAddress}
                onChange={(e) => setFormWalletAddress(e.target.value)}
                disabled={!formNetwork}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editDepartment">Department</Label>
              <Select value={formDepartment || ""} onValueChange={(v) => setFormDepartment(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((dept) => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditDialog(false); setEditingContributor(null); resetForm(); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleEditContributor} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Contributor</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {deleteTarget?.email}? They will no longer receive payments from this organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteContributor}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
