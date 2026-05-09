'use client'

import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageInput } from "@/components/MessageInput";
import { createClaimFromUsername } from "@/lib/createClaimFromUsername";
import { createClaimFromEmail } from "@/lib/createClaimFromEmail";
function looksLikeEmail(s: string): boolean {
  const t = (s || "").trim();
  return t.includes("@") && /.+@.+\..+/.test(t);
}

async function fetchUserByUsername(username: string) {
  const clean = username.replace(/^@/, "").toLowerCase();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const r = await fetch(`${backendUrl}/users/by-username?username=${encodeURIComponent(clean)}`);
  if (!r.ok) throw new Error("User not found");
  return r.json();
}

export interface SendFlowInAppProps {
  recipientUsername: string;
  initialAmount?: string;
  onBack: () => void;
  /** When set, claim ID is passed to parent instead of redirecting to /c/[id] (for in-app step 3 Pay) */
  onClaimCreated?: (claimId: string) => void;
}

export function SendFlowInApp({ recipientUsername, initialAmount = "", onBack, onClaimCreated }: SendFlowInAppProps) {
  const router = useRouter();
  const { user, getAccessToken, login, authenticated } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const apiCluster = networkMode === "mainnet" ? "mainnet" : "devnet";
  const { toast } = useToast();
  const [amount, setAmount] = useState(initialAmount || "100");
  const [description, setDescription] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const isEmail = looksLikeEmail(recipientUsername);
  const [loadingUser, setLoadingUser] = useState(!isEmail);
  const [userError, setUserError] = useState<string | null>(null);
  /** When username lookup fails we still allow creating a link (burner); they claim when they sign up. */
  const [usernameNotOnLoofta, setUsernameNotOnLoofta] = useState(false);

  const amountNum = Number(amount);
  const minAmountUsd = 5;
  const belowMinAmount = !!amount && Number.isFinite(amountNum) && amountNum > 0 && amountNum < minAmountUsd;

  useEffect(() => {
    if (isEmail) {
      setLoadingUser(false);
      setUsernameNotOnLoofta(false);
      if (initialAmount) setAmount(initialAmount);
      return;
    }
    let cancelled = false;
    setUsernameNotOnLoofta(false);
    fetchUserByUsername(recipientUsername)
      .then(() => {
        if (!cancelled) {
          setUsernameNotOnLoofta(false);
          if (initialAmount) setAmount(initialAmount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsernameNotOnLoofta(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingUser(false);
      });
    return () => { cancelled = true; };
  }, [recipientUsername, initialAmount, isEmail]);

  const handleCreate = async () => {
    if (!authenticated) {
      login({ loginMethods: ["email"], disableSignup: false });
      return;
    }
    if (!amount || Number(amount) <= 0 || Number(amount) < minAmountUsd) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Minimum payment amount is $5.00 USDC." });
      return;
    }
    setPreparing(true);
    const fullDescription = [description.trim(), gifUrl].filter(Boolean).join(" ").trim() || undefined;
    try {
      const accessToken = await getAccessToken();
      if (isEmail) {
        const result = await createClaimFromEmail({
          email: recipientUsername.trim().toLowerCase(),
          amount,
          userId: user?.id,
          accessToken,
          isPrivate: true,
          description: fullDescription,
          cluster: apiCluster,
        });
        await new Promise((r) => setTimeout(r, 300));
        if (onClaimCreated) onClaimCreated(result.id); else router.push(`/c/${result.id}`);
      } else {
        const cleanUsername = recipientUsername.replace(/^@/, "").toLowerCase();
        const result = await createClaimFromUsername({
          username: cleanUsername,
          amount,
          userId: user?.id,
          accessToken,
          isPrivate: true,
          description: fullDescription,
          cluster: apiCluster,
        });
        await new Promise((r) => setTimeout(r, 300));
        if (onClaimCreated) onClaimCreated(result.id); else router.push(`/c/${result.id}`);
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to create payment link",
      });
      setPreparing(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (userError) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <p className="text-red-400 text-sm">{userError}</p>
        <Button variant="outline" onClick={onBack} className="rounded-xl border-white/10 text-slate-300">
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-slate-300 text-xl font-sans font-medium ">
          {isEmail ? recipientUsername.trim() : `Pay @${recipientUsername.replace(/^@/, "")}`}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="text-slate-400 hover:text-white text-sm font-medium"
        >
          Change
        </button>
      </div>
      {isEmail && (
        <p className="text-slate-400 text-md">
          They&apos;ll claim by signing in with this email (account not required yet).
        </p>
      )}
      {!isEmail && usernameNotOnLoofta && (
        <p className="text-slate-400 text-md">
          This user isn&apos;t on Loofta yet. You can still create a link; they can claim it when they sign up with this username.
        </p>
      )}

      <div>
        <Label className="text-slate-400 text-sm">Amount (USD)</Label>
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0.01"
          step="0.01"
          placeholder="100"
          className="mt-1.5 h-12 bg-white/5 border-white/10 text-white placeholder:text-slate-500"
        />
        {belowMinAmount && (
          <p className="mt-1.5 text-xs text-amber-400">Min. amount is $5.00 USDC</p>
        )}
      </div>

      <div>
        <Label className="text-slate-400 text-sm">Message (optional)</Label>
        <MessageInput
          value={description}
          onChange={setDescription}
          placeholder="Add a message..."
          maxLength={500}
          gifUrl={gifUrl}
          onGifChange={setGifUrl}
          className="mt-1.5 [&_input]:h-11 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:placeholder:text-slate-500"
        />
      </div>

      <Button
        onClick={handleCreate}
        disabled={authenticated && (preparing || !amount || !Number.isFinite(amountNum) || amountNum <= 0 || belowMinAmount)}
        className="w-full h-12 rounded-xl font-semibold bg-gradient-to-r text-lg from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
      >
        {!authenticated
          ? "Sign in to continue"
          : preparing
            ? "Creating…"
            : onClaimCreated ? "Continue to pay" : "Create payment link"}
      </Button>
    </div>
  );
}
