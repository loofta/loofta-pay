"use client";

import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { getPaymentHistory } from "@/services/companionApi";
import type { PaymentLog } from "@/services/companionApi";
import { Loader2, Shield, Users, DollarSign, CheckCircle, XCircle, Clock, Building2, Receipt } from "lucide-react";
import { OrganizationsManager } from "./organizations";
import { ClaimsManager } from "./claims";

export default function AdminPage() {
  const { authenticated, userId, login, ready } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [payments, setPayments] = useState<PaymentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check admin status from server
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!ready || !authenticated || !userId) {
        setCheckingAuth(false);
        setIsAuthorized(false);
        return;
      }

      try {
        const response = await fetch("/api/admin/check", {
          headers: {
            "x-privy-user-id": userId,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setIsAuthorized(data.isAdmin || false);
        } else {
          setIsAuthorized(false);
        }
      } catch (error) {
        console.error("Failed to check admin status:", error);
        setIsAuthorized(false);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAdminStatus();
  }, [ready, authenticated, userId]);

  const loadPayments = useCallback(async () => {
    if (!userId) {
      console.warn("Cannot load payments: userId not available");
      return;
    }

    try {
      setLoading(true);
      const data = await getPaymentHistory(userId);
      setPayments(data.payments || []);
    } catch (error: any) {
      console.error("Failed to load payments:", error);
      toast({
        variant: "destructive",
        title: "Failed to load payments",
        description: error?.message || "An error occurred while loading payment history.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, userId]);

  useEffect(() => {
    if (ready && !authenticated) {
      toast({
        title: "Authentication required",
        description: "Please log in to access the admin panel.",
      });
      login();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated]); // Remove login and toast from deps to prevent infinite loop

  useEffect(() => {
    if (ready && authenticated && isAuthorized && userId) {
      loadPayments();
    }
  }, [ready, authenticated, isAuthorized, userId, loadPayments]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPayments();
    setRefreshing(false);
    toast({
      title: "Refreshed",
      description: "Payment history has been updated.",
    });
  };

  // Show loading state while:
  // 1. Auth system is not ready
  // 2. We're still checking admin status
  // 3. User is authenticated but userId hasn't loaded yet
  if (!ready || checkingAuth || (authenticated && !userId)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Only show access denied after we've properly loaded the user and checked auth
  // At this point: ready is true, checkingAuth is false, and user state is fully loaded
  if (!authenticated || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <div className="flex items-center justify-center mb-4">
              <Shield className="w-12 h-12 text-red-500" />
            </div>
            <CardTitle className="text-center">Access Denied</CardTitle>
            <CardDescription className="text-center">
              You do not have permission to access this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!authenticated ? (
              <Button onClick={login} className="w-full">
                Log In
              </Button>
            ) : (
              <div className="text-center text-sm text-gray-500">
                <p>Your user ID: {userId || "Unknown"}</p>
                <p className="mt-2">Admin access is restricted to authorized users only.</p>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="w-full"
            >
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate statistics
  const stats = {
    total: payments.length,
    executed: payments.filter((p) => p.status === "executed").length,
    refunded: payments.filter((p) => p.status === "refunded").length,
    pending: payments.filter((p) => p.status === "pending" || p.status === "funded").length,
    failed: payments.filter((p) => p.status === "failed").length,
  };

  const getStatusIcon = (status: PaymentLog["status"]) => {
    switch (status) {
      case "executed":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "refunded":
        return <XCircle className="w-4 h-4 text-orange-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: PaymentLog["status"]) => {
    switch (status) {
      case "executed":
        return "bg-green-100 text-green-800";
      case "refunded":
        return "bg-orange-100 text-orange-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <Shield className="w-8 h-8 text-blue-600" />
                Admin Dashboard
              </h1>
              <p className="mt-2 text-gray-600">Manage organizations, checkout, and monitor payments</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="claims" className="space-y-6">
          <TabsList>
            <TabsTrigger value="claims">
              <Receipt className="w-4 h-4 mr-2" />
              Claims
            </TabsTrigger>
            <TabsTrigger value="organizations">
              <Building2 className="w-4 h-4 mr-2" />
              Organizations
            </TabsTrigger>
            <TabsTrigger value="payments">
              <Users className="w-4 h-4 mr-2" />
              Payments
            </TabsTrigger>
          </TabsList>

          <TabsContent value="organizations">
            <OrganizationsManager />
          </TabsContent>

          <TabsContent value="claims">
            {/* Wallet Info Card */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Privy Backend Wallet
                </CardTitle>
                <CardDescription>
                  Wallet address where private cross-chain payments arrive before Privacy Cash execution
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-gray-500">Address:</span>
                    <span className="ml-2 font-mono text-sm">C5H7TyU6fBdvrzYnwME1RUD9tZACuGPw83Kh1TwDWMWb</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    💡 When claims show "PRIVATE_TRANSFER_PENDING", check this wallet for USDC. Execute Privacy Cash manually, then update claim status to SUCCESS.
                  </div>
                </div>
              </CardContent>
            </Card>
            <ClaimsManager />
          </TabsContent>

          <TabsContent value="payments">
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Payment History</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Monitor all lottery purchase transactions
                  </p>
                </div>
                <Button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  variant="outline"
                >
                  {refreshing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    "Refresh"
                  )}
                </Button>
              </div>

              {/* Statistics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <Card className="p-4">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.total}</div>
                  </CardContent>
                </Card>

                <Card className="p-4">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Executed</CardTitle>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">{stats.executed}</div>
                  </CardContent>
                </Card>

                <Card className="p-4">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Refunded</CardTitle>
                    <XCircle className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">{stats.refunded}</div>
                  </CardContent>
                </Card>

                <Card className="p-4">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pending</CardTitle>
                    <Clock className="h-4 w-4 text-yellow-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Payments Table */}
              <Card className="p-6">
                <CardHeader>
                  <CardTitle>Payment History</CardTitle>
                  <CardDescription>
                    Recent lottery purchase transactions and their status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                  ) : payments.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <p>No payments found.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-4 font-medium text-gray-700">ID</th>
                            <th className="text-left p-4 font-medium text-gray-700">Recipient</th>
                            <th className="text-left p-4 font-medium text-gray-700">Companion</th>
                            <th className="text-left p-4 font-medium text-gray-700">Status</th>
                            <th className="text-left p-4 font-medium text-gray-700">Amount</th>
                            <th className="text-left p-4 font-medium text-gray-700">TX Hash</th>
                            <th className="text-left p-4 font-medium text-gray-700">Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((payment) => (
                            <tr key={payment.id} className="border-b hover:bg-gray-50">
                              <td className="p-4 text-sm font-mono">{payment.id.slice(0, 8)}...</td>
                              <td className="p-4 text-sm font-mono">
                                {payment.recipientAddress.slice(0, 6)}...{payment.recipientAddress.slice(-4)}
                              </td>
                              <td className="p-4 text-sm font-mono">
                                {payment.companionAddress.slice(0, 6)}...{payment.companionAddress.slice(-4)}
                              </td>
                              <td className="p-4">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                                    payment.status
                                  )}`}
                                >
                                  {getStatusIcon(payment.status)}
                                  {payment.status}
                                </span>
                              </td>
                              <td className="p-4 text-sm">
                                {payment.amountReceived ? `${payment.amountReceived} ETH` : "-"}
                              </td>
                              <td className="p-4">
                                {payment.txHash ? (
                                  <a
                                    href={`https://basescan.org/tx/${payment.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline font-mono text-sm"
                                  >
                                    {payment.txHash.slice(0, 10)}...
                                  </a>
                                ) : payment.refundTxHash ? (
                                  <a
                                    href={`https://basescan.org/tx/${payment.refundTxHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-orange-600 hover:underline font-mono text-sm"
                                  >
                                    Refund: {payment.refundTxHash.slice(0, 10)}...
                                  </a>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="p-4 text-sm text-gray-500">
                                {new Date(payment.createdAt).toLocaleString()}
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

