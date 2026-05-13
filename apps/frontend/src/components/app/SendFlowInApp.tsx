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
import { useSolanaPayment } from "@/hooks/useSolanaPayment";
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

  const solanaPayment = useSolanaPayment({ enabled: authenticated });

  const estimatedTotal = (() => {
    if (!Number.isFinite(amountNum) || amountNum <= 0) return amountNum;
    const net = Math.round(amountNum * 1_000_000);
    const mbGross = Math.ceil((net * 10_000) / (10_000 - 10));
    const fee = Math.ceil(((mbGross - net) / 1_000_000 + 0.20) * 100) / 100;
    return amountNum + fee;
  })();

  const insufficientBalance =
    authenticated &&
    !solanaPayment.isBalanceLoading &&
    Number.isFinite(amountNum) &&
    amountNum >= minAmountUsd &&
    !solanaPayment.hasEnoughBalance(estimatedTotal);

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
        const navId = result.short_id || result.id;
        if (onClaimCreated) onClaimCreated(navId); else router.push(`/c/${navId}`);
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
        const navId = result.short_id || result.id;
        if (onClaimCreated) onClaimCreated(navId); else router.push(`/c/${navId}`);
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
        <p className="text-slate-400 text-base">Loading…</p>
      </div>
    );
  }

  if (userError) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <p className="text-red-400 text-base">{userError}</p>
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
          className="text-slate-400 hover:text-white text-base font-medium"
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
        <Label className="text-slate-400 text-base">Amount (USD)</Label>
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
          <p className="mt-1.5 text-base md:text-sm text-amber-400">Min. amount is $5.00 USDC</p>
        )}
      </div>

      <div>
        <Label className="text-slate-400 text-base">Message (optional)</Label>
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

      {insufficientBalance && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5">
            <svg viewBox="0 0 56 57" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 shrink-0" aria-hidden>
              <path d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z" fill="#FF4A26" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white text-base">Loofta wallet</div>
              <div className="text-base md:text-sm text-amber-400 mt-0.5">
                ${solanaPayment.balanceUSD.toFixed(2)} available — ${estimatedTotal.toFixed(2)} needed (incl. fees)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("openBalanceModal"))}
            className="w-full h-12 rounded-xl font-semibold text-base border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
          >
            Add funds to your balance
          </button>
        </div>
      )}

      <Button
        onClick={handleCreate}
        disabled={authenticated && (preparing || !amount || !Number.isFinite(amountNum) || amountNum <= 0 || belowMinAmount || insufficientBalance)}
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
