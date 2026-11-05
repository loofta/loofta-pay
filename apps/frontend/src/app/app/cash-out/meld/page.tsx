"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Connection } from "@solana/web3.js";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useLooftaSigner } from "@/components/deposit/DepositSheet";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { MELD_SESSION_KEY } from "@/lib/meldOfframp";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";

type Transfer = {
  ready: boolean;
  sent?: boolean;
  state?: "paid" | "failed" | "pending";
  offrampId?: string;
  depositAddress?: string;
  amountUsdc?: number;
  receive?: number | null;
  currency?: string;
  provider?: string | null;
  error?: string;
};

const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="mx-auto max-w-lg px-4 py-8 pb-24">{children}</div>
    </div>
  );
}

function MeldReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, authenticated, login, getAccessToken, user } = usePrivy();
  const { wallet, signTransaction } = useLooftaSigner(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const sessionRef = useRef<string | null>(null);

  if (sessionRef.current === null && typeof window !== "undefined") {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(MELD_SESSION_KEY); } catch { /* storage blocked */ }
    sessionRef.current = params.get("sessionId") || stored || "";
  }
  const sessionId = sessionRef.current || "";

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/meld/offramp-transfer?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      const body = await res.json() as Transfer;
      if (!res.ok) { setError(body.error || "Could not load your cash-out."); return; }
      setTransfer(body);
    } catch {
      setError("Could not load your cash-out. Check your connection and try again.");
    }
  }, [getAccessToken, sessionId]);

  // Poll: first until the provider has a deposit address, then (after sending) until the payout lands
  useEffect(() => {
    if (!ready || !authenticated || !sessionId || error) return;
    if (transfer?.ready && !transfer.sent) return;
    if (transfer?.sent && transfer.state !== "pending") return;
    if (!transfer?.ready && Date.now() - startedAt.current > 90_000) { setTimedOut(true); return; }
    const t = setTimeout(() => { void load(); }, transfer ? 5_000 : 0);
    return () => clearTimeout(t);
  }, [ready, authenticated, sessionId, transfer, error, load]);

  const confirm = async () => {
    if (!transfer?.offrampId || !transfer.depositAddress || !transfer.amountUsdc || !wallet || !user?.id) return;
    setSending(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      const connection = new Connection(getRpcForMode("mainnet"), "confirmed");
      const signature = await sendUsdcWithBackendFeePayer({
        senderAddress: wallet.address,
        recipientAddress: transfer.depositAddress,
        amountUSDC: transfer.amountUsdc,
        connection,
        wallet,
        privyUserId: user.id,
        signTransaction,
        usdcMint: getUsdcMintForMode("mainnet"),
        chain: getPrivySolanaChainForMode("mainnet"),
        accessToken,
        network: "mainnet",
        offrampRequestId: transfer.offrampId,
      });
      await fetch("/api/meld/offramp-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ offrampId: transfer.offrampId, signature }),
      });
      try { window.localStorage.removeItem(MELD_SESSION_KEY); } catch { /* storage blocked */ }
      setTransfer({ ...transfer, sent: true, state: "pending" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The transfer didn't go through. Nothing was sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  if (!ready) return <Shell><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></Shell>;

  if (!authenticated) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Sign in to finish your cash-out</h1>
        <button type="button" onClick={() => login()} className="mt-5 w-full rounded-2xl bg-[#FF7A2A] px-5 py-3.5 text-base font-bold text-black">Sign in</button>
      </Shell>
    );
  }

  if (!sessionId) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">No cash-out in progress</h1>
        <p className="mt-2 text-base text-slate-300">Start a bank cash-out from your balance and you will come back here to finish it.</p>
        <button type="button" onClick={() => router.push("/")} className="mt-5 w-full rounded-2xl bg-white/10 px-5 py-3.5 text-base font-bold">Back to Loofta</button>
      </Shell>
    );
  }

  if (error && !transfer?.sent) {
    return (
      <Shell>
        <AlertTriangle className="h-8 w-8 text-[#FF7A2A]" />
        <h1 className="mt-3 text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-base text-slate-300">{error}</p>
        <button type="button" onClick={() => { setError(null); setTimedOut(false); startedAt.current = Date.now(); void load(); }} className="mt-5 w-full rounded-2xl bg-[#FF7A2A] px-5 py-3.5 text-base font-bold text-black">Try again</button>
      </Shell>
    );
  }

  if (!transfer?.ready) {
    return (
      <Shell>
        {timedOut ? (
          <>
            <h1 className="text-2xl font-bold">Still waiting on your bank provider</h1>
            <p className="mt-2 text-base text-slate-300">If you finished verification and confirmed the quote, give it a minute and check again. Nothing has been sent from your wallet.</p>
            <button type="button" onClick={() => { setTimedOut(false); startedAt.current = Date.now(); void load(); }} className="mt-5 w-full rounded-2xl bg-[#FF7A2A] px-5 py-3.5 text-base font-bold text-black">Check again</button>
          </>
        ) : (
          <div className="flex flex-col items-center py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            <p className="mt-4 text-lg font-semibold">Getting your cash-out ready</p>
            <p className="mt-1 text-base text-slate-400">This takes a few seconds.</p>
          </div>
        )}
      </Shell>
    );
  }

  if (transfer.sent) {
    const state = transfer.state ?? "pending";
    return (
      <Shell>
        {state === "paid" ? <CheckCircle2 className="h-9 w-9 text-emerald-400" /> : state === "failed" ? <AlertTriangle className="h-9 w-9 text-[#FF7A2A]" /> : <Loader2 className="h-9 w-9 animate-spin text-slate-400" />}
        <h1 className="mt-3 text-2xl font-bold">
          {state === "paid" ? "Paid out to your bank" : state === "failed" ? "The payout didn't complete" : "Your payout is on its way"}
        </h1>
        <p className="mt-2 text-base text-slate-300">
          {state === "paid"
            ? `${transfer.receive != null ? money(transfer.receive, transfer.currency) : "Your money"} is on its way to your bank account.`
            : state === "failed"
              ? "Your provider will return the USDC. Contact support if you don't see it within a day."
              : `${transfer.receive != null ? `${money(transfer.receive, transfer.currency)} ` : ""}will arrive in your bank account shortly. You can leave this page.`}
        </p>
        <button type="button" onClick={() => router.push("/")} className="mt-6 w-full rounded-2xl bg-white/10 px-5 py-3.5 text-base font-bold">Done</button>
      </Shell>
    );
  }

  if (transfer.state === "failed" || transfer.error) {
    return (
      <Shell>
        <AlertTriangle className="h-8 w-8 text-[#FF7A2A]" />
        <h1 className="mt-3 text-2xl font-bold">This cash-out was cancelled</h1>
        <p className="mt-2 text-base text-slate-300">{transfer.error || "Your provider cancelled it. Nothing was sent from your wallet."}</p>
        <button type="button" onClick={() => router.push("/")} className="mt-5 w-full rounded-2xl bg-white/10 px-5 py-3.5 text-base font-bold">Back to Loofta</button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold">Confirm your cash-out</h1>
      <div className="mt-5 rounded-3xl border border-white/10 bg-[#1A1A20] p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-base text-slate-400">You send</span>
          <span className="text-2xl font-bold">{(transfer.amountUsdc ?? 0).toFixed(2)} USDC</span>
        </div>
        <div className="my-4 h-px bg-white/10" />
        <div className="flex items-baseline justify-between">
          <span className="text-base text-slate-400">You get</span>
          <span className="text-2xl font-bold">{transfer.receive != null ? money(transfer.receive, transfer.currency) : "Your quoted amount"}</span>
        </div>
        <p className="mt-4 text-base text-slate-400">Paid to the bank account you just added. Loofta covers the network fee.</p>
      </div>
      <button
        type="button"
        disabled={sending || !wallet}
        onClick={() => { void confirm(); }}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF7A2A] px-5 py-3.5 text-base font-bold text-black disabled:opacity-60"
      >
        {sending ? <><Loader2 className="h-5 w-5 animate-spin" /> Sending</> : `Send ${(transfer.amountUsdc ?? 0).toFixed(2)} USDC`}
      </button>
      {error && <p className="mt-3 text-base text-[#FF7A2A]">{error}</p>}
      <button type="button" disabled={sending} onClick={() => router.push("/")} className="mt-3 w-full rounded-2xl px-5 py-3 text-base font-semibold text-slate-400">Cancel</button>
    </Shell>
  );
}

export default function MeldReturnPage() {
  return (
    <Suspense fallback={<Shell><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></Shell>}>
      <MeldReturn />
    </Suspense>
  );
}
