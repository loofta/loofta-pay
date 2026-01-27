'use client'

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getSolanaBalanceUSD } from "@/services/solanaBalance";
import { useWallets } from "@privy-io/react-auth";

const PRIVACY_CASH_FEES = {
  withdraw_fee_rate: 0.0035, // 0.35%
  withdraw_rent_fee: 0.744548676, // USDC rent fee
};

async function getUserPreferences(getAccessToken: () => Promise<string>, userId: string) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const token = await getAccessToken();
  
  const r = await fetch(`${backendUrl}/users/me/preferences`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-privy-user-id': userId,
    },
  });
  
  if (!r.ok) {
    throw new Error('Failed to fetch preferences');
  }
  
  return await r.json();
}

async function updateUserPreferences(getAccessToken: () => Promise<string>, userId: string, requirePrivatePayments: boolean) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const token = await getAccessToken();
  
  const r = await fetch(`${backendUrl}/users/me/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-privy-user-id': userId,
    },
    body: JSON.stringify({ requirePrivatePayments }),
  });
  
  if (!r.ok) {
    const error = await r.json().catch(() => ({ message: 'Failed to update preferences' }));
    throw new Error(error.message || 'Failed to update preferences');
  }
  
  return await r.json();
}

async function getWalletBalance(getAccessToken: () => Promise<string>, userId: string) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const token = await getAccessToken();
  
  const r = await fetch(`${backendUrl}/users/me/wallet/balance`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-privy-user-id': userId,
    },
  });
  
  if (!r.ok) {
    throw new Error('Failed to fetch balance');
  }
  
  return await r.json();
}

async function generateNewWallet(getAccessToken: () => Promise<string>, userId: string) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const token = await getAccessToken();
  
  const r = await fetch(`${backendUrl}/users/me/wallet/generate-new`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-privy-user-id': userId,
    },
  });
  
  if (!r.ok) {
    const error = await r.json().catch(() => ({ message: 'Failed to generate new wallet' }));
    throw new Error(error.message || 'Failed to generate new wallet');
  }
  
  return await r.json();
}

export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { authenticated, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  // Redirect if not authenticated
  useEffect(() => {
    if (authenticated === false) {
      router.push('/');
    }
  }, [authenticated, router]);

  // Fetch preferences
  const { data: preferences, isLoading: loadingPrefs } = useQuery({
    queryKey: ['userPreferences'],
    queryFn: () => getUserPreferences(getAccessToken, user?.id || ''),
    enabled: authenticated === true && !!getAccessToken && !!user?.id,
  });

  // Fetch balance
  const { data: balanceData, isLoading: loadingBalance } = useQuery({
    queryKey: ['walletBalance'],
    queryFn: () => getWalletBalance(getAccessToken, user?.id || ''),
    enabled: authenticated === true && !!getAccessToken && !!user?.id,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const balanceUSD = balanceData?.balanceUSD || 0;
  const canGenerateNewWallet = balanceUSD === 0;

  // Update preferences mutation
  const updatePrefsMutation = useMutation({
    mutationFn: (requirePrivatePayments: boolean) => updateUserPreferences(getAccessToken, user?.id || '', requirePrivatePayments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userPreferences'] });
      toast({
        title: "Settings updated",
        description: "Your privacy preferences have been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update preferences",
      });
    },
  });

  // Generate new wallet mutation
  const generateWalletMutation = useMutation({
    mutationFn: () => generateNewWallet(getAccessToken, user?.id || ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['walletBalance'] });
      toast({
        title: "New wallet generated",
        description: "Your new embedded wallet has been created.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to generate new wallet",
      });
    },
  });

  const requirePrivatePayments = preferences?.requirePrivatePayments || false;

  if (!authenticated) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <div className="min-h-screen text-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
            <p className="text-gray-400">Manage your account preferences and privacy settings</p>
          </div>

          <div className="space-y-6">
            {/* Privacy Settings */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Privacy Settings</h2>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-base font-medium text-gray-900">
                        Require Private Payments Only
                      </label>
                      {loadingPrefs ? (
                        <Skeleton className="h-5 w-5 rounded" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={requirePrivatePayments}
                          onChange={(e) => {
                            updatePrefsMutation.mutate(e.target.checked);
                          }}
                          className="h-5 w-5 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                        />
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      When enabled, all payments to your username link (@{user?.id?.slice(0, 8)}...) must use Privacy Cash for complete privacy.
                    </p>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="text-sm text-amber-800">
                        <div className="font-semibold mb-1">Benefits:</div>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                          <li>Your wallet address stays hidden</li>
                          <li>Payer wallet address stays hidden</li>
                          <li>No on-chain linkability between payer and payee</li>
                        </ul>
                        <div className="mt-2 pt-2 border-t border-amber-200">
                          <div className="font-semibold">Additional fees:</div>
                          <div className="text-xs">
                            {PRIVACY_CASH_FEES.withdraw_fee_rate * 100}% + ${PRIVACY_CASH_FEES.withdraw_rent_fee.toFixed(2)} per payment
                          </div>
                          <div className="text-xs mt-1 text-amber-700">
                            Note: You will be charged these fees on private payments
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Wallet Settings */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Wallet Settings</h2>
              
              <div className="space-y-4">
                {/* Current Balance */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">
                    Current Balance
                  </label>
                  {loadingBalance ? (
                    <Skeleton className="h-8 w-32" />
                  ) : (
                    <div className="text-2xl font-semibold text-gray-900">
                      ${balanceUSD.toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Generate New Wallet */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Generate New Embedded Wallet
                  </label>
                  <p className="text-sm text-gray-600 mb-4">
                    Create a new embedded wallet address. This can only be done when your current wallet balance is $0.
                  </p>
                  
                  {!canGenerateNewWallet && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                      <div className="text-sm text-red-800">
                        <div className="font-semibold mb-1">⚠️ Cannot generate new wallet</div>
                        <div className="text-xs">
                          Your current wallet has a balance of ${balanceUSD.toFixed(2)}. Please withdraw all funds first before generating a new wallet address.
                        </div>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={() => {
                      if (!canGenerateNewWallet) {
                        toast({
                          variant: "destructive",
                          title: "Cannot generate new wallet",
                          description: "Please withdraw all funds first.",
                        });
                        return;
                      }
                      if (confirm('Are you sure you want to generate a new wallet? This action cannot be undone.')) {
                        generateWalletMutation.mutate(undefined);
                      }
                    }}
                    disabled={!canGenerateNewWallet || generateWalletMutation.isPending}
                    className="bg-gray-900 text-white hover:bg-gray-800"
                  >
                    {generateWalletMutation.isPending ? 'Generating...' : 'Generate New Wallet'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
