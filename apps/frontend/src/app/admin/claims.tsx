"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { adminClaimsApi } from "@/services/api/adminClaims";
import type { Claim, ClaimIntent } from "@/services/api/claims";
import {
  Loader2,
  Trash2,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Checkbox } from "@/components/ui/checkbox";

const CLAIM_STATUSES = [
  'OPEN',
  'PENDING_DEPOSIT',
  'IN_FLIGHT',
  'PRIVATE_TRANSFER_PENDING',
  'SUCCESS',
  'REFUNDED',
  'EXPIRED',
  'CANCELLED',
] as const;

const PAGE_SIZE = 20;

export function ClaimsManager() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const [claims, setClaims] = useState<Claim[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<Claim['status'] | 'all'>('all');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail modal
  const [detailClaim, setDetailClaim] = useState<Claim | null>(null);
  const [detailIntents, setDetailIntents] = useState<ClaimIntent[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const loadClaims = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const response = await adminClaimsApi.list(
        {
          status: statusFilter === 'all' ? undefined : statusFilter,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
        userId,
      );
      setClaims(response.claims);
      setTotal(response.total);
    } catch (error: any) {
      console.error("Failed to load claims:", error);
      toast({
        variant: "destructive",
        title: "Failed to load claims",
        description: error?.message || "An error occurred",
      });
    } finally {
      setLoading(false);
    }
  }, [userId, statusFilter, page, toast]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadClaims();
    setRefreshing(false);
    toast({ title: "Refreshed", description: "Claims list updated" });
  };

  const handleViewDetails = async (claim: Claim) => {
    if (!userId) return;

    setDetailClaim(claim);
    setLoadingDetail(true);
    try {
      const response = await adminClaimsApi.getWithIntents(claim.id, userId);
      setDetailIntents(response.intents);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to load details",
        description: error?.message,
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDelete = async () => {
    if (!userId || !deleteTarget) return;

    setDeleting(true);
    try {
      if (Array.isArray(deleteTarget)) {
        const result = await adminClaimsApi.deleteMany(deleteTarget, userId);
        toast({ title: "Deleted", description: `${result.deleted} claims deleted` });
        setSelectedIds(new Set());
      } else {
        await adminClaimsApi.delete(deleteTarget, userId);
        toast({ title: "Deleted", description: "Claim deleted successfully" });
      }
      setDeleteTarget(null);
      loadClaims();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error?.message,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (claimId: string, newStatus: Claim['status']) => {
    if (!userId) return;

    setUpdatingStatus(claimId);
    try {
      await adminClaimsApi.updateStatus(claimId, newStatus, userId);
      toast({ title: "Updated", description: `Status changed to ${newStatus}` });
      loadClaims();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: error?.message,
      });
    } finally {
      setUpdatingStatus(null);
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === claims.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(claims.map(c => c.id)));
    }
  };

  const getStatusIcon = (status: Claim['status'] | string) => {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'REFUNDED':
        return <XCircle className="w-4 h-4 text-orange-500" />;
      case 'EXPIRED':
      case 'CANCELLED':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'PRIVATE_TRANSFER_PENDING':
        return <AlertCircle className="w-4 h-4 text-purple-500" />;
      case 'IN_FLIGHT':
      case 'PENDING_DEPOSIT':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: Claim['status'] | string) => {
    switch (status) {
      case 'SUCCESS':
        return 'bg-green-100 text-green-800';
      case 'REFUNDED':
        return 'bg-orange-100 text-orange-800';
      case 'EXPIRED':
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      case 'PRIVATE_TRANSFER_PENDING':
        return 'bg-purple-100 text-purple-800';
      case 'IN_FLIGHT':
      case 'PENDING_DEPOSIT':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Statistics
  const stats = {
    total,
    success: claims.filter(c => c.status === 'SUCCESS').length,
    pending: claims.filter(c => ['OPEN', 'PENDING_DEPOSIT', 'IN_FLIGHT'].includes(c.status)).length,
    privateTransferPending: claims.filter(c => (c.status as string) === 'PRIVATE_TRANSFER_PENDING').length,
    failed: claims.filter(c => ['REFUNDED', 'EXPIRED', 'CANCELLED'].includes(c.status)).length,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Claims Management</h2>
          <p className="mt-1 text-sm text-gray-600">
            View, manage, and delete payment claims. Private cross-chain payments show as "PRIVATE_TRANSFER_PENDING" - execute Privacy Cash manually and update status to SUCCESS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteTarget(Array.from(selectedIds))}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete {selectedIds.size} selected
            </Button>
          )}
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
            size="sm"
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card className="p-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-0">
            <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-2">
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-0">
            <CardTitle className="text-sm font-medium">Successful</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent className="p-0 pt-2">
            <div className="text-2xl font-bold text-green-600">{stats.success}</div>
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-0">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent className="p-0 pt-2">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-0">
            <CardTitle className="text-sm font-medium">Private Transfer</CardTitle>
            <AlertCircle className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent className="p-0 pt-2">
            <div className="text-2xl font-bold text-purple-600">{stats.privateTransferPending}</div>
            <p className="text-xs text-gray-500 mt-1">Waiting for Privacy Cash</p>
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-0">
            <CardTitle className="text-sm font-medium">Failed/Refunded</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent className="p-0 pt-2">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Status:</span>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value as any);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {CLAIM_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Claims Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : claims.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No claims found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="p-4 text-left">
                      <Checkbox
                        checked={selectedIds.size === claims.length && claims.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="p-4 text-left font-medium text-gray-700">ID</th>
                    <th className="p-4 text-left font-medium text-gray-700">Amount</th>
                    <th className="p-4 text-left font-medium text-gray-700">Token</th>
                    <th className="p-4 text-left font-medium text-gray-700">Recipient</th>
                    <th className="p-4 text-left font-medium text-gray-700">Status</th>
                    <th className="p-4 text-left font-medium text-gray-700">Created</th>
                    <th className="p-4 text-left font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id} className="border-b hover:bg-gray-50">
                      <td className="p-4">
                        <Checkbox
                          checked={selectedIds.has(claim.id)}
                          onCheckedChange={() => toggleSelect(claim.id)}
                        />
                      </td>
                      <td className="p-4 text-sm font-mono">
                        {claim.id.slice(0, 8)}...
                      </td>
                      <td className="p-4 text-sm font-semibold">
                        ${claim.amount}
                      </td>
                      <td className="p-4 text-sm">
                        {claim.to_symbol} / {claim.to_chain}
                      </td>
                      <td className="p-4 text-sm font-mono">
                        {claim.recipient_address.slice(0, 6)}...{claim.recipient_address.slice(-4)}
                      </td>
                      <td className="p-4">
                        <Select
                          value={claim.status}
                          onValueChange={(value) => handleStatusChange(claim.id, value as Claim['status'])}
                          disabled={updatingStatus === claim.id}
                        >
                          <SelectTrigger className={`w-[140px] h-8 text-xs ${getStatusColor(claim.status)}`}>
                            <div className="flex items-center gap-1">
                              {updatingStatus === claim.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                getStatusIcon(claim.status)
                              )}
                              <span>{claim.status}</span>
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {CLAIM_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-4 text-sm text-gray-500">
                        {new Date(claim.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetails(claim)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(claim.id)}
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <div className="text-sm text-gray-500">
              Showing {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!detailClaim} onOpenChange={() => setDetailClaim(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Claim Details</DialogTitle>
            <DialogDescription>
              ID: {detailClaim?.id}
            </DialogDescription>
          </DialogHeader>

          {detailClaim && (
            <div className="space-y-4">
              {/* Claim Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Amount:</span>
                  <span className="ml-2 font-semibold">${detailClaim.amount}</span>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>
                  <span className={`ml-2 px-2 py-1 rounded text-xs ${getStatusColor(detailClaim.status)}`}>
                    {detailClaim.status}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Token:</span>
                  <span className="ml-2">{detailClaim.to_symbol} / {detailClaim.to_chain}</span>
                </div>
                <div>
                  <span className="text-gray-500">Created:</span>
                  <span className="ml-2">{new Date(detailClaim.created_at).toLocaleString()}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Recipient:</span>
                  <span className="ml-2 font-mono text-xs">{detailClaim.recipient_address}</span>
                </div>
                {(detailClaim.creator_username ?? detailClaim.creator_email) ? (
                  <div className="col-span-2">
                    <span className="text-gray-500">Creator:</span>
                    <span className="ml-2">{detailClaim.creator_username ? `@${detailClaim.creator_username}` : detailClaim.creator_email}</span>
                  </div>
                ) : detailClaim.created_by ? (
                  <div className="col-span-2">
                    <span className="text-gray-500">Creator:</span>
                    <span className="ml-2 text-gray-500">User (privy)</span>
                  </div>
                ) : (
                  <div className="col-span-2">
                    <span className="text-gray-500">Creator:</span>
                    <span className="ml-2 text-gray-500">Anonymous</span>
                  </div>
                )}
                {(detailClaim as any).is_private && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Private Payment:</span>
                    <span className="ml-2 text-purple-600 font-semibold">Yes</span>
                  </div>
                )}
                {(detailClaim as any).paid_with_token && (detailClaim as any).paid_with_chain && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Paid With:</span>
                    <span className="ml-2">{(detailClaim as any).paid_with_token} ({(detailClaim as any).paid_with_chain})</span>
                  </div>
                )}
              </div>

              {/* Intents */}
              <div>
                <h4 className="font-semibold mb-2">Intents ({detailIntents.length})</h4>
                {loadingDetail ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : detailIntents.length === 0 ? (
                  <p className="text-gray-500 text-sm">No intents found</p>
                ) : (
                  <div className="space-y-2">
                    {detailIntents.map((intent) => (
                      <div
                        key={intent.id}
                        className="p-3 bg-gray-50 rounded-lg text-sm space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs">{intent.id.slice(0, 12)}...</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${intent.status === 'SUCCESS' ? 'bg-green-100 text-green-800' :
                              intent.status === 'REFUNDED' ? 'bg-orange-100 text-orange-800' :
                                'bg-gray-100 text-gray-800'
                            }`}>
                            {intent.status}
                          </span>
                        </div>
                        {intent.deposit_address && (
                          <div>
                            <span className="text-gray-500">Deposit:</span>
                            <span className="ml-2 font-mono text-xs">{intent.deposit_address}</span>
                          </div>
                        )}
                        {intent.from_chain && (
                          <div>
                            <span className="text-gray-500">Route:</span>
                            <span className="ml-2">{intent.from_chain} → {intent.to_chain}</span>
                          </div>
                        )}
                        {intent.paid_amount && (
                          <div>
                            <span className="text-gray-500">Paid:</span>
                            <span className="ml-2">{intent.paid_amount}</span>
                          </div>
                        )}
                        <div className="text-gray-400 text-xs">
                          {new Date(intent.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailClaim(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Claim{Array.isArray(deleteTarget) && deleteTarget.length > 1 ? 's' : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {Array.isArray(deleteTarget)
                ? `Are you sure you want to delete ${deleteTarget.length} claims? This will also delete all associated intents.`
                : 'Are you sure you want to delete this claim? This will also delete all associated intents.'}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
