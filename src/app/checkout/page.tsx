"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, AlertCircle, Building2 } from "lucide-react";
import Image from "next/image";
// Note: We use a public API route instead of direct Supabase access

type Organization = {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  checkout_status: "active" | "inactive";
  org_referral: string;
};

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const organizationId = searchParams.get("organizationId");
  const walletAddress = searchParams.get("walletAddress") || "";
  const amountParam = searchParams.get("amount") || "";
  const currencyParam = searchParams.get("currency") || "USD";

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(amountParam);
  const [currency, setCurrency] = useState(currencyParam);
  const [recipientWallet, setRecipientWallet] = useState(walletAddress);

  useEffect(() => {
    if (!organizationId) {
      setError("Missing organizationId parameter");
      setLoading(false);
      return;
    }

    loadOrganization();
  }, [organizationId]);

  const loadOrganization = async () => {
    try {
      setLoading(true);
      // For now, we'll fetch directly from Supabase
      // In production, create an API route that doesn't require admin auth
      const response = await fetch(`/api/organizations/public?organizationId=${organizationId}`);
      
      if (!response.ok) {
        throw new Error("Failed to load organization");
      }
      
      const data = await response.json();
      
      if (!data.organization) {
        throw new Error("Organization not found");
      }

      if (data.organization.checkout_status !== "active") {
        setError("This organization's checkout is currently inactive");
        setLoading(false);
        return;
      }

      setOrganization(data.organization);
    } catch (error: any) {
      console.error("Failed to load organization:", error);
      setError(error?.message || "Failed to load organization");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = () => {
    if (!organization) return;
    
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid amount",
        description: "Please enter a valid amount.",
      });
      return;
    }

    if (!recipientWallet || !/^0x[0-9a-fA-F]{40}$/i.test(recipientWallet)) {
      toast({
        variant: "destructive",
        title: "Invalid wallet address",
        description: "Please enter a valid EVM wallet address.",
      });
      return;
    }

    // Redirect to lottery page with organization context
    const params = new URLSearchParams({
      organizationId: organization.organization_id,
      orgReferral: organization.org_referral,
      amount,
      currency,
      walletAddress: recipientWallet,
    });

    window.location.href = `/lottery?${params.toString()}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center justify-center mb-4">
              <AlertCircle className="w-12 h-12 text-red-500" />
            </div>
            <CardTitle className="text-center">Checkout Unavailable</CardTitle>
            <CardDescription className="text-center">
              {error || "Organization not found"}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4 mb-4">
              {organization.logo_url && (
                <div className="relative w-16 h-16">
                  <Image
                    src={organization.logo_url}
                    alt={organization.name}
                    fill
                    className="object-contain"
                  />
                </div>
              )}
              <div>
                <CardTitle className="text-2xl">{organization.name}</CardTitle>
                <CardDescription>Multi-chain Checkout</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <div className="flex gap-2">
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1"
                />
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wallet">Recipient Wallet Address</Label>
              <Input
                id="wallet"
                value={recipientWallet}
                onChange={(e) => setRecipientWallet(e.target.value)}
                placeholder="0x..."
                className="font-mono"
              />
              <p className="text-xs text-gray-500">
                The address where the payment will be sent
              </p>
            </div>

            <div className="pt-4 border-t">
              <Button onClick={handleCheckout} className="w-full" size="lg">
                Continue to Checkout
              </Button>
            </div>

            <div className="pt-4 border-t text-xs text-gray-500 text-center">
              <p>Powered by Loofta Pay</p>
              <p className="mt-1">Organization ID: {organization.organization_id}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

