"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { fetchClaim, claimAsRecipient, type ClaimSummary } from "@/lib/api";

type LinkedAccount = { type?: string; chainType?: string; address?: string };

function findLinkedSolanaWallet(linkedAccounts: LinkedAccount[]): string | null {
  // type === 'wallet' only (not 'solana_embedded_wallet') — this app never creates embedded
  // wallets, but a user could still have one from a DIFFERENT Loofta login; only ever prefill an
  // external wallet they actually connected themselves.
  const found = linkedAccounts.find(
    (a) => a.type === "wallet" && (a.chainType === "solana" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.address || "")),
  );
  return found?.address || null;
}

export default function ClaimPage() {
  const params = useParams<{ id: string }>();
  const claimId = params.id;
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();

  const [claim, setClaim] = useState<ClaimSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [claimPrivately, setClaimPrivately] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ claimed: boolean; sweptAmount?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchClaim(claimId)
      .then(setClaim)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "This link isn't valid or has expired."));
  }, [claimId]);

  const rememberedWallet = useMemo(
    () => (user ? findLinkedSolanaWallet((user.linkedAccounts || []) as LinkedAccount[]) : null),
    [user],
  );

  useEffect(() => {
    if (rememberedWallet && !destinationAddress) setDestinationAddress(rememberedWallet);
  }, [rememberedWallet, destinationAddress]);

  const TERMINAL_STATUSES = new Set(["SUCCESS", "CANCELLED", "REFUNDED", "EXPIRED", "DELETED"]);
  const alreadyClaimed = claim && TERMINAL_STATUSES.has(claim.status);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!destinationAddress.trim()) {
      setSubmitError("Enter the Solana wallet address you want to receive USDC at.");
      return;
    }
    setSubmitting(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Could not get a session token — try again in a moment.");
      const res = await claimAsRecipient(claimId, accessToken, {
        destinationAddress: destinationAddress.trim(),
        claimPrivately,
      });
      setResult(res);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Centered>
        <p className="text-sm text-red-400 max-w-sm text-center">{loadError}</p>
      </Centered>
    );
  }

  if (!claim) {
    return (
      <Centered>
        <p className="text-sm text-slate-400">Loading…</p>
      </Centered>
    );
  }

  if (result?.claimed) {
    return (
      <Centered>
        <div className="max-w-sm text-center space-y-2">
          <h1 className="text-lg font-semibold">Claimed!</h1>
          <p className="text-sm text-slate-400">
            {result.sweptAmount ? `${result.sweptAmount} USDC` : "Your payment"} is on its way to your wallet.
          </p>
        </div>
      </Centered>
    );
  }

  if (alreadyClaimed) {
    return (
      <Centered>
        <p className="text-sm text-slate-400 max-w-sm text-center">This payment has already been claimed.</p>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">${claim.amount}</h1>
          {claim.description && <p className="text-sm text-slate-400">{claim.description}</p>}
        </div>

        {!ready ? (
          <p className="text-sm text-slate-400 text-center">Loading…</p>
        ) : !authenticated ? (
          <button
            type="button"
            onClick={() => login()}
            className="w-full rounded-xl bg-white text-black font-semibold py-3 hover:opacity-90"
          >
            Verify it&apos;s you to claim
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="destination" className="text-sm text-slate-400">
                Receive USDC at
              </label>
              <input
                id="destination"
                type="text"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Paste your Solana wallet address"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30"
              />
              {rememberedWallet && (
                <p className="text-xs text-slate-500">Pre-filled from your connected wallet.</p>
              )}
            </div>

            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setClaimPrivately(true)}
                className={`flex-1 rounded-lg py-2 border ${claimPrivately ? "border-white bg-white/10" : "border-white/10 text-slate-400"}`}
              >
                Private
              </button>
              <button
                type="button"
                onClick={() => setClaimPrivately(false)}
                className={`flex-1 rounded-lg py-2 border ${!claimPrivately ? "border-white bg-white/10" : "border-white/10 text-slate-400"}`}
              >
                Public
              </button>
            </div>

            {submitError && <p className="text-sm text-red-400">{submitError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-white text-black font-semibold py-3 hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Claiming…" : "Claim"}
            </button>
          </form>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4 px-6">{children}</div>;
}
