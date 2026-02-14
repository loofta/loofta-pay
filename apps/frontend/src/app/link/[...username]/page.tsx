'use client'

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageInput } from "@/components/MessageInput";
import { useToast } from "@/components/ui/use-toast";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { PRIVATE_PAYMENT_COMING_SOON } from "@/services/privacyCash";
import { usePrivy } from "@privy-io/react-auth";
import { isDemoMode } from "@/config/demoMode";
import { useRouter } from "next/navigation";
// Check demo mode at module level for consistent behavior
const DEMO_MODE = isDemoMode();

async function fetchUserByUsername(username: string) {
  // Decode URL-encoded username first, then remove @ prefix if present
  const decoded = decodeURIComponent(username);
  const cleanUsername = decoded.replace(/^@/, "").toLowerCase();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const r = await fetch(`${backendUrl}/users/by-username?username=${encodeURIComponent(cleanUsername)}`);
  if (!r.ok) {
    const errorData = await r.json().catch(() => ({}));
    throw new Error(errorData?.message || errorData?.error || "User not found");
  }
  return await r.json();
}

async function createClaimFromUsername(input: {
  username: string;
  amount: string;
  userId?: string;
  userEmail?: string;
  isPrivate?: boolean;
  description?: string;
}) {
  // This endpoint fetches wallet address server-side (never exposed to frontend)
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const r = await fetch(`${backendUrl}/claims/create-from-username`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      amount: Number(input.amount), // Backend expects number
      userId: input.userId,
      userEmail: input.userEmail,
      isPrivate: input.isPrivate || false,
      description: input.description || undefined,
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    let errData: any = {};
    try {
      errData = JSON.parse(errText);
    } catch {
      errData = { message: errText || "Failed to create claim" };
    }
    throw new Error(errData?.message || errData?.error || "Failed to create claim");
  }

  const responseText = await r.text();
  console.log('[createClaimFromUsername] Response text:', responseText);

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error('[createClaimFromUsername] Failed to parse JSON:', e, responseText);
    throw new Error("Invalid JSON response from server");
  }

  console.log('[createClaimFromUsername] Parsed data:', data);

  if (!data?.id) {
    console.error('[createClaimFromUsername] Missing id in response:', data);
    throw new Error("Server response missing claim ID");
  }

  return data;
}



export default function LinkPayPage({ params }: { params: Promise<{ username: string[] }> }) {
  const { username: usernameArray } = React.use(params);
  // Join array and decode URL-encoded characters (like %40 for @)
  const username = decodeURIComponent(usernameArray.join("/"));
  const router = useRouter();
  const { toast } = useToast();

  // No longer checking URL params - privacy is controlled by user's requirePrivatePayments setting

  // Fetch user by username
  const userQuery = useQuery({
    queryKey: ["user", username],
    queryFn: () => fetchUserByUsername(username),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const userData = userQuery.data as any;
  const loadingUser = userQuery.isLoading;
  const requiresPrivatePayments = userData?.user?.requirePrivatePayments || false;

  // State for editable amount
  const [amountUSD, setAmountUSD] = useState<string>("100");
  const [description, setDescription] = useState<string>("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Initialize isPrivate based on user's requirePrivatePayments setting
  const [isPrivate, setIsPrivate] = useState<boolean>(requiresPrivatePayments);
  const { user } = usePrivy();

  // Update isPrivate when user requirement changes
  React.useEffect(() => {
    setIsPrivate(requiresPrivatePayments);
  }, [requiresPrivatePayments]);


  // Handle "Create payment link" button click
  const handleCreatePaymentLink = async () => {
    // Validate amount
    if (!amountUSD || Number(amountUSD) <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Please enter a valid amount." });
      return;
    }

    // Validate minimum amount for private payments (when available)
    if (isPrivate && Number(amountUSD) < 3) {
      toast({
        variant: "destructive",
        title: "Minimum amount required",
        description: "Private payments require a minimum of $3.00."
      });
      return;
    }

    setPreparing(true);
    try {
      // Create claim from username (wallet address fetched server-side, never exposed)
      const cleanUsername = username.replace(/^@/, "").toLowerCase();
      // Combine description text and GIF URL
      const fullDescription = [description.trim(), gifUrl].filter(Boolean).join(' ').trim();

      const claimResult = await createClaimFromUsername({
        username: cleanUsername,
        amount: amountUSD,
        userId: user?.id,
        isPrivate: isPrivate,
        description: fullDescription || undefined,
      });

      if (!claimResult?.id) {
        throw new Error("Failed to create claim: No ID returned from server");
      }

      // Small delay to ensure claim is fully persisted, then redirect
      await new Promise(resolve => setTimeout(resolve, 500));

      // Redirect to claim page
      router.push(`/c/${claimResult.id}`);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error?.message || "Failed to create payment link" });
    } finally {
      setPreparing(false);
    }
  };





  // Rest of the component logic will be similar to claim page...
  // For now, let me create the basic structure and continue in next part

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <div className="flex items-center justify-center min-h-[calc(100vh-7rem)]">
            <div className="w-full max-w-2xl">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-gray-900">
                {DEMO_MODE && (
                  <div className="mb-4 -mx-6 -mt-6 px-4 py-3 bg-amber-50 border-b border-amber-200 rounded-t-2xl">
                    <div className="flex items-center gap-2 text-amber-800">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="text-sm font-medium">Demo Mode - Payments are disabled</span>
                    </div>
                  </div>
                )}

                {loadingUser ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !userData?.user ? (
                  <div className="text-red-600">User not found.</div>
                ) : (
                  <>

                    <div className="mb-6">
                      <div className="text-2xl font-semibold text-gray-900 mb-2">
                        💸 Pay {requiresPrivatePayments ? "privately" : ""} to @{userData?.user?.username || username}
                      </div>
                      <p className="text-base text-gray-600">
                        {requiresPrivatePayments
                          ? "Choose the amount you want to pay privately. Payment will be processed through privacy pools. Both addresses remain hidden."
                          : "Choose the amount you want to pay, you'll be redirected to settle it in any token on any chain you want"
                        }
                      </p>
                    </div>
                    <div className="text-base text-gray-700 mb-2">Amount (USD)</div>
                    <Input
                      type="number"
                      value={amountUSD}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "" || (!isNaN(Number(value)) && Number(value) >= 0)) {
                          setAmountUSD(value);
                        }
                      }}
                      placeholder="100"
                      className="text-3xl md:text-4xl font-semibold text-gray-900 h-16"
                      min={isPrivate ? "2" : "0.01"}
                    />

                    <div className="mt-2 text-sm text-gray-500">
                      Minimum amount: $3.00
                    </div>

                    {/* Payment Type — Private coming soon (disabled) */}
                    {!requiresPrivatePayments && (
                      <div className="mt-6 p-4 rounded-xl border border-gray-200 bg-gray-50">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg font-semibold text-gray-900">
                              🔒 Private payment
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                              Coming soon
                            </span>
                          </div>
                          <Switch
                            checked={false}
                            onCheckedChange={() => { }}
                            disabled={PRIVATE_PAYMENT_COMING_SOON}
                            aria-label="Private payment — coming soon"
                          />
                        </div>
                        <p className="text-base text-gray-600 mt-3 w-full block">
                          When available, payment will be processed through privacy pools for complete privacy (+0.35% + $0.74).
                        </p>
                      </div>
                    )}



                    <div className="mt-6">
                      <div className="text-base text-gray-700 mb-2">
                        Message <span className="text-sm text-gray-500 font-normal">(optional)</span>
                      </div>
                      <MessageInput
                        value={description}
                        onChange={setDescription}
                        placeholder="Type a message..."
                        maxLength={500}
                        gifUrl={gifUrl}
                        onGifChange={setGifUrl}
                        className="[&_input]:h-16"
                      />
                    </div>

                    <div className="mt-6">
                      {DEMO_MODE ? (
                        <Button
                          disabled
                          className="w-full rounded-xl"
                          style={{ background: '#9CA3AF' }}
                        >
                          Demo Mode - Payments Disabled
                        </Button>
                      ) : (
                        <GradientActionButton
                          onClick={handleCreatePaymentLink}
                          disabled={
                            preparing ||
                            !amountUSD ||
                            Number(amountUSD) <= 0 ||
                            (requiresPrivatePayments && Number(amountUSD) < 3)
                          }
                          loading={preparing}
                          loadingText="Creating payment link…"
                          className="w-full"
                        >
                          {requiresPrivatePayments ? "Create Private Payment Link" : "Create payment link"}
                        </GradientActionButton>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
