"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, AlertCircle, Lock, Shield, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
};

// Deserialize amount from URL parameter
function deserializeAmount(amountParam: string | null): string {
  if (!amountParam) return "";
  try {
    // Try to decode if it's URL encoded
    const decoded = decodeURIComponent(amountParam);
    // Parse as float to validate
    const parsed = parseFloat(decoded);
    if (isNaN(parsed) || parsed <= 0) return "";
    return decoded;
  } catch {
    // If decoding fails, try direct parse
    const parsed = parseFloat(amountParam);
    if (isNaN(parsed) || parsed <= 0) return "";
    return amountParam;
  }
}

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { data: tokens = [], isLoading: tokensLoading } = useTokensQuery();

  const organizationId = searchParams.get("organizationId");
  const amountParam = searchParams.get("amount");
  const deserializedAmount = useMemo(() => deserializeAmount(amountParam), [amountParam]);

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(deserializedAmount);
  const [tokenSelection, setTokenSelection] = useState<TokenSelection | null>(null);
  const [isPrivatePayment, setIsPrivatePayment] = useState(false);
  const [isAmountEditable, setIsAmountEditable] = useState(!deserializedAmount);

  useEffect(() => {
    if (!organizationId) {
      setError("Missing organizationId parameter");
      setLoading(false);
      return;
    }

    loadOrganization();
  }, [organizationId]);

  useEffect(() => {
    // Set default token from organization if available
    if (organization?.token_symbol && organization?.token_chain && !tokenSelection) {
      setTokenSelection({
        symbol: organization.token_symbol,
        chain: organization.token_chain,
      });
    }
  }, [organization, tokenSelection]);

  const loadOrganization = async () => {
    try {
      setLoading(true);
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

  const handlePay = () => {
    if (!organization) return;

    if (!amount || parseFloat(amount) <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid amount",
        description: "Please enter a valid amount.",
      });
      return;
    }

    if (!tokenSelection) {
      toast({
        variant: "destructive",
        title: "Token required",
        description: "Please select a token and network.",
      });
      return;
    }

    // Use organization's recipient wallet if available, otherwise show error
    const recipientWallet = organization.recipient_wallet;
    if (!recipientWallet) {
      toast({
        variant: "destructive",
        title: "Configuration error",
        description: "This organization hasn't configured a recipient wallet. Please contact support.",
      });
      return;
    }

    // Redirect to payment flow
    const params = new URLSearchParams({
      organizationId: organization.organization_id,
      orgReferral: organization.org_referral,
      amount,
      walletAddress: recipientWallet,
      tokenSymbol: tokenSelection.symbol,
      tokenChain: tokenSelection.chain,
      private: isPrivatePayment ? "true" : "false",
    });

    window.location.href = `/lottery?${params.toString()}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Checkout Unavailable</h1>
          <p className="text-gray-600">{error || "Organization not found"}</p>
        </div>
      </div>
    );
  }

  // Get background color from organization, default to white
  const contentBgColor = organization.bg_color || "#FFFFFF";

  return (
    <div className="min-h-screen" style={{ backgroundColor: contentBgColor }}>
      {/* Minimal Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            {/* Loofta Logo - Centered */}
            <div className="flex-1"></div>
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/loofta.svg"
                alt="Loofta Pay"
                width={100}
                height={36}
                className="h-8 w-auto"
              />
            </Link>
            {/* Security Badge */}
            <div className="flex-1 flex justify-end">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Shield className="w-4 h-4 text-green-600" />
                <span className="font-medium">Secure Checkout</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left Side - Organization Logo & Amount Card */}
          <div className="flex flex-col gap-6">
            {/* Organization Logo - Above the card */}
            {organization.logo_url && (
              <div className="flex items-center justify-center mb-4">
                <div className="relative w-24 h-24 sm:w-32 sm:h-32">
                  <Image
                    src={organization.logo_url}
                    alt={organization.name}
                    fill
                    className="object-contain drop-shadow-sm"
                  />
                </div>
              </div>
            )}

            {/* Amount Card */}
            <div className="bg-white rounded-2xl p-8 shadow-sm">
              <div className="space-y-6">
                {/* Organization Name & Payment Request Label */}
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{organization.name}</h2>
                  <p className="text-sm text-gray-500">Payment Request</p>
                </div>
                {/* Amount */}
                <div className="space-y-2">
                  <Label htmlFor="amount" className="text-sm font-medium text-gray-700">
                    Amount
                  </Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-gray-400">
                      $
                    </span>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setIsAmountEditable(true);
                      }}
                      disabled={!isAmountEditable}
                      placeholder="0.00"
                      className="pl-8 text-3xl font-semibold h-16 border-2 border-gray-200 focus:border-blue-500 bg-white"
                    />
                  </div>
                  {!isAmountEditable && (
                    <p className="text-xs text-gray-500">
                      Amount is set by the organization. Contact them to change it.
                    </p>
                  )}
                </div>

                {/* Payment Summary */}
                <div className="pt-6 border-t border-gray-200">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="font-medium text-gray-900">
                        ${amount || "0.00"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Processing fee</span>
                      <span className="font-medium text-gray-900">$0.00</span>
                    </div>
                    <div className="flex justify-between text-lg font-semibold pt-3 border-t border-gray-200">
                      <span className="text-gray-900">Total</span>
                      <span className="text-gray-900">${amount || "0.00"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Payment Options */}
          <div className="flex flex-col">
            {/* Spacer to align with logo on left side */}
            {organization.logo_url && <div className="h-[128px] sm:h-[144px]"></div>}
            <div className="bg-gray-50 rounded-2xl p-8 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Payment Details</h3>

                {/* Token Selection */}
                <div className="space-y-2 mb-6">
                  <Label className="text-sm font-medium text-gray-700">
                    Pay with
                  </Label>
                  {tokensLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                  ) : (
                    <TokenCombobox
                      tokens={tokens}
                      value={tokenSelection || undefined}
                      onChange={setTokenSelection}
                      placeholder="Select token and network..."
                      className="w-full"
                    />
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Choose the token and network you want to pay with
                  </p>
                </div>

                {/* Private Payment Switch */}
                <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <Lock className="w-5 h-5 text-gray-400" />
                    <div>
                      <Label htmlFor="private" className="text-sm font-medium text-gray-900 cursor-pointer">
                        Private Payment
                      </Label>
                      <p className="text-xs text-gray-500">Pay privately using shielded addresses</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="private"
                      checked={isPrivatePayment}
                      onCheckedChange={setIsPrivatePayment}
                      disabled={true}
                    />
                    <span className="text-xs text-gray-400 font-medium">Coming Soon</span>
                  </div>
                </div>

                {/* Pay Button */}
                <Button
                  onClick={handlePay}
                  className="w-full h-12 text-base font-semibold mt-6"
                  disabled={!amount || !tokenSelection || parseFloat(amount) <= 0}
                >
                  Pay ${amount || "0.00"}
                </Button>

                {/* Security Notice */}
                <div className="pt-4 border-t border-gray-200">
                  <p className="text-xs text-gray-500 text-center">
                    🔒 Secured by Loofta Pay • Multi-chain payments
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
