"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { payrollApi, type PayrollInviteInfo } from "@/services/api/payroll";
import { TokenCombobox } from "@/components/TokenCombobox";
import { Button } from "@/components/ui/button";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Building2, Wallet, Loader2, Check, ArrowRight } from "lucide-react";

export default function PayrollInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token as string;
  const { ready, authenticated, login } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();

  const [invite, setInvite] = useState<PayrollInviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const [walletAddress, setWalletAddress] = useState("");
  const [network, setNetwork] = useState<string | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !authenticated) return;
    payrollApi.invite
      .getByToken(token)
      .then(setInvite)
      .catch(() => setInvite(null))
      .finally(() => setLoading(false));
  }, [token, authenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !walletAddress.trim() || !network || !tokenSymbol) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Please set wallet, network, and token.",
      });
      return;
    }
    setSubmitting(true);
    try {
      await payrollApi.invite.onboard(token, {
        walletAddress: walletAddress.trim(),
        network,
        tokenSymbol,
      });
      setDone(true);
      toast({ title: "You're all set", description: "You can now receive payments from this organization." });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Failed to save",
        description: err?.message || "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Wait for auth to be ready
  if (!ready) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Require Privy (email) login before viewing invite
  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <Building2 className="h-7 w-7 text-gray-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Log in to accept your invite</h2>
        <p className="mt-2 text-sm text-gray-500">
          Sign in with your email to set up how you’ll receive payments from this organization.
        </p>
        <GradientActionButton className="mt-6 w-full" onClick={() => login()}>
          Log in with email
        </GradientActionButton>
        <Button variant="ghost" className="mt-3 text-gray-500" asChild>
          <Link href="/payroll">Back to Payroll</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-600">Invalid or expired invite link.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/payroll">Go to Payroll</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <Check className="h-7 w-7 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">You're all set</h2>
        <p className="mt-2 text-sm text-gray-500">
          You can now receive payments from <strong>{invite.organizationName}</strong> on Loofta.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <GradientActionButton className="w-full" onClick={() => router.push("/payroll")}>
            Go to Payroll
            <ArrowRight className="ml-2 h-4 w-4" />
          </GradientActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
            <Building2 className="h-6 w-6 text-gray-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Set up payments</h1>
            <p className="text-sm text-gray-500">
              {invite.organizationName} invited you to receive payments
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>Network & token</Label>
            <TokenCombobox
              tokens={tokens}
              value={network && tokenSymbol ? { symbol: tokenSymbol, chain: network } : undefined}
              onChange={(sel) => {
                setNetwork(sel?.chain || null);
                setTokenSymbol(sel?.symbol || null);
              }}
              placeholder="Select chain and token to receive"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wallet">Destination wallet address</Label>
            <Input
              id="wallet"
              placeholder={network ? `Your ${network} address` : "Select network first"}
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              disabled={!network}
              className="font-mono text-sm"
            />
          </div>

          <GradientActionButton type="submit" className="w-full" disabled={submitting} loading={submitting} loadingText="Saving...">
            <Wallet className="mr-2 h-4 w-4" />
            Save & start receiving
          </GradientActionButton>
        </form>
      </div>
    </div>
  );
}
