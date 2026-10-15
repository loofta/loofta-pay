"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
import { usePrivy, useSendTransaction, useUser, useWallets } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShareLinkMenu } from "@/components/ShareLinkMenu";
import { useToast } from "@/components/ui/use-toast";
import { sora } from "@/components/home-v4/fonts";
import { getPlatform } from "@/lib/peerPlatforms";
import { cashoutPayoutUsdc } from "@/services/peerCash";
import { useResumePeerCashout } from "@/hooks/useResumePeerCashout";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

type PayShare = {
  id: string;
  platform: string;
  platformName: string;
  identifier: string;
  currency: string;
  amountUsdc: number;
  status: string;
  etaLabel: string | null;
  peerDepositUrl: string | null;
};

function isPaid(status: string) {
  const s = status.toUpperCase();
  return s === "COMPLETE" || s === "SUCCESS";
}

function isCancelled(status: string) {
  return status.toUpperCase() === "CANCELLED";
}

export default function PaySharePage() {
  const params = useParams<{ shortId: string }>();
  const router = useRouter();
  const shortId = params.shortId;
  const { toast } = useToast();
  const { ready, authenticated, login, getAccessToken, user } = usePrivy();
  const { refreshUser } = useUser();
  const { wallets: evmWallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const [payment, setPayment] = useState<PayShare | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveEta, setLiveEta] = useState<string | null>(null);
  const [depositId, setDepositId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The email for a stuck payment lands here. If it bridged but was never finished, finish it silently.
  useResumePeerCashout(authenticated, () => router.push("/?balance=withdraw&method=peer"));

  useEffect(() => {
    if (!shortId) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/offramp/public/${encodeURIComponent(shortId)}`);
      if (!res.ok) {
        if (!cancelled) setMissing(true);
        return;
      }
      const data = await res.json() as PayShare;
      if (!cancelled) {
        setMissing(false);
        setPayment(data);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [shortId]);

  const etaKey = payment ? `${payment.platform}:${payment.currency}:${payment.amountUsdc}:${payment.etaLabel ?? ""}` : "";
  useEffect(() => {
    if (!payment || payment.etaLabel) return;
    let cancelled = false;
    (async () => {
      try {
        const { getPeerEstimate, usdc } = await import("@/services/peerCash");
        const est = await getPeerEstimate(usdc(payment.amountUsdc), payment.currency, payment.platform, true);
        if (!cancelled && est.eta?.label) setLiveEta(est.eta.label);
      } catch {
        if (!cancelled) setLiveEta(null);
      }
    })();
    return () => { cancelled = true; };
    // etaKey is stable across the status poll, so a refresh does not restart the estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaKey]);

  useEffect(() => {
    if (!ready || !authenticated || !payment?.id) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken().catch(() => null);
      if (!token || cancelled) return;
      const res = await fetch(`/api/offramp/${payment.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || cancelled) return;
      const row = await res.json() as { zkp2p_deposit_id?: string | null };
      if (!cancelled) setDepositId(row.zkp2p_deposit_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [ready, authenticated, payment?.id, getAccessToken]);

  const deletePayment = async () => {
    if (!payment?.id || deleting) return;
    setDeleting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to delete this payment");
      const res = await fetch(`/api/offramp/${payment.id}?action=delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { message?: string };
      if (!res.ok) throw new Error(data.message || "Could not delete");
      router.push("/history");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not delete";
      toast({ variant: "destructive", title: "Delete failed", description: msg });
      setDeleting(false);
    }
  };

  const cancelPayment = async () => {
    if (!payment?.id || cancelling) return;
    setCancelling(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to cancel this payment");
      const res = await fetch(`/api/offramp/${payment.id}?action=cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { status?: string; message?: string; zkp2pDepositId?: string | null };
      if (!res.ok) throw new Error(data.message || "Could not cancel");

      const peerDepositId = data.zkp2pDepositId || depositId;
      if (data.status === "CANCELLING" && peerDepositId) {
        await withdrawPeerDeposit(peerDepositId, token);
      }
      setPayment((prev) => prev ? { ...prev, status: "CANCELLED" } : prev);
      toast({ title: "Cancelled", description: "This payment is cancelled." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not cancel";
      toast({ variant: "destructive", title: "Cancel failed", description: msg });
    } finally {
      setCancelling(false);
    }
  };

  const withdrawPeerDeposit = async (peerDepositId: string, token: string) => {
    const accounts = (user?.linkedAccounts ?? []) as Array<{ address?: string; type?: string; chainType?: string }>;
    const linked = accounts
      .filter((a) => !(a.type || "").toLowerCase().includes("solana") && (a.chainType || "").toLowerCase() !== "solana")
      .map((a) => a.address?.trim() ?? "")
      .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
    let baseWallet = evmWallets.find(
      (w) => typeof (w as { getEthereumProvider?: unknown }).getEthereumProvider === "function"
        && linked.some((a) => a.toLowerCase() === w.address.toLowerCase()),
    );
    if (!baseWallet) {
      const refreshed = await refreshUser().catch(() => user);
      const again = ((refreshed?.linkedAccounts ?? []) as Array<{ address?: string }>)
        .map((a) => a.address?.trim() ?? "")
        .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
      baseWallet = evmWallets.find(
        (w) => typeof (w as { getEthereumProvider?: unknown }).getEthereumProvider === "function"
          && again.some((a) => a.toLowerCase() === w.address.toLowerCase()),
      );
    }
    if (!baseWallet) throw new Error("Could not load your Base wallet");

    const { base } = await import("viem/chains");
    const { createWalletClient, createPublicClient, custom, encodeFunctionData, erc20Abi, http } = await import("viem");
    const rawProvider = await (baseWallet as { getEthereumProvider: () => Promise<{ request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }> }).getEthereumProvider();
    const walletClient = createWalletClient({
      chain: base,
      account: baseWallet.address as `0x${string}`,
      transport: custom({
        async request({ method, params }) {
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_sendTransaction") {
            const tx = (params as Array<{ to: string; data?: string; value?: string }>)[0];
            const result = await sendTransaction({
              to: tx.to,
              data: tx.data,
              ...(tx.value ? { value: BigInt(tx.value) } : {}),
              chainId: base.id,
            }, { sponsor: true });
            return result.hash;
          }
          return rawProvider.request({ method, params });
        },
      }),
    });

    const { peerWithdraw } = await import("@/services/peerCash");
    await peerWithdraw(peerDepositId, walletClient as never);
    const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
    const rawBalance = await publicClient.readContract({
      address: BASE_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [baseWallet.address as `0x${string}`],
    }) as bigint;
    if (rawBalance === 0n) {
      await fetch(`/api/offramp/${payment!.id}?action=mark-cancelled`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      return;
    }
    const amountUsdc = Number(rawBalance) / 1_000_000;
    const bbRes = await fetch(`/api/offramp/${payment!.id}?action=bridge-back`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ baseWalletAddress: baseWallet.address, amountUsdc }),
    });
    const bb = await bbRes.json() as { depositAddress?: string; message?: string };
    if (!bbRes.ok || !bb.depositAddress) throw new Error(bb.message || "Could not start the refund");
    await sendTransaction({
      to: BASE_USDC_ADDRESS,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [bb.depositAddress as `0x${string}`, rawBalance],
      }),
      chainId: base.id,
    }, { sponsor: true });
    await fetch(`/api/offramp/${payment!.id}?action=mark-cancelled`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  if (missing) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-3 px-6 text-center text-white">
        <p className="text-lg font-semibold">Link not found</p>
        <p className="text-base text-slate-400">This payment link may have expired or been cancelled.</p>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    );
  }

  const arrived = isPaid(payment.status);
  const cancelled = isCancelled(payment.status);
  const amount = cashoutPayoutUsdc(payment.amountUsdc).toFixed(2);
  const handle = payment.identifier.replace(/^[@$]/, "");
  const recipientLabel = `${handle} on ${payment.platformName}`;
  const logo = getPlatform(payment.platform)?.logo;
  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/share/${shortId}`
    : `https://pay.loofta.xyz/share/${shortId}`;
  const shareText = `$${amount} sent to ${recipientLabel} via Loofta.`;
  const etaLabel = payment.etaLabel || liveEta;

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: "Link copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#0f0f12] text-white">
      <div className="mx-auto max-w-lg px-4 py-6 pb-24">
        <Link
          href="/history"
          className="mb-4 inline-flex items-center gap-2 text-base font-medium text-slate-400 transition-colors hover:text-white"
        >
          ← Back to History
        </Link>
        <div
          className={`${sora.variable} rounded-[30px] border border-white/[0.07] bg-[#141419] p-7 text-white [&_.text-gray-900]:!text-white [&_.text-gray-700]:!text-slate-200 [&_.text-gray-500]:!text-slate-400 [&_.bg-gray-50]:!bg-white/5 [&_.border-gray-200]:!border-white/10 [&_input]:!border-white/20 [&_input]:!bg-white/10 [&_input]:!text-white`}
        >
          <div className="mt-4 space-y-3 py-8 text-center">
            {logo ? (
              <img src={logo} alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl object-cover" />
            ) : (
              <div className="mb-3 select-none text-5xl sm:text-6xl">{arrived ? "🎉" : "💸"}</div>
            )}
            <div className="mb-3 font-sans text-5xl font-semibold text-gray-900 sm:text-6xl">
              ${amount}
            </div>
            <p className="mb-5 mt-1 text-xl text-gray-500">
              sent to <span className="font-medium text-gray-700">{recipientLabel}</span>
            </p>
            {cancelled ? (
              <p className="text-base text-gray-500">This payment was cancelled.</p>
            ) : arrived ? (
              <p className="text-base text-gray-500">{payment.currency} is in their {payment.platformName}.</p>
            ) : payment.status.toUpperCase() === "BRIDGING" ? (
              authenticated ? (
                <p className="text-base text-gray-500">Finishing your payment. Keep this page open for a moment.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-base text-gray-500">This payment needs one more step. Log in to finish it.</p>
                  <Button onClick={() => login()} className="bg-gradient-to-r from-orange-500 to-red-500 text-white hover:opacity-90">Log in to finish</Button>
                </div>
              )
            ) : etaLabel ? (
              <p className="text-base text-gray-500">{etaLabel}</p>
            ) : null}
            <div className="flex gap-2 pt-2">
              <div className="flex flex-1 gap-2">
                <Input readOnly value={shareUrl} aria-label="Share link" className="flex-1 bg-gray-50 font-mono text-sm" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyShareLink}
                  aria-label={copied ? "Copied" : "Copy link"}
                  className="shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <ShareLinkMenu url={shareUrl} title="Payment sent" text={shareText} triggerClassName="px-5 py-2" />
            </div>
            <p className="text-base text-gray-500">Share this link. They can follow the payment without an account.</p>
          </div>
          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-base text-gray-500">Recipient receives</span>
              <span className="text-base font-semibold text-gray-900">${cashoutPayoutUsdc(payment.amountUsdc).toFixed(2)} {payment.currency}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-2">
              <span className="text-base text-gray-500">Sent to</span>
              <span className="text-base font-medium text-gray-900">{recipientLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-base text-gray-500">Status</span>
              <span className="text-base text-gray-700">{cancelled ? "Cancelled" : arrived ? "Paid" : "In progress"}</span>
            </div>
            {payment.peerDepositUrl && !arrived && !cancelled && (
              <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                <span className="text-base text-gray-500">Fill tracker</span>
                <a
                  href={payment.peerDepositUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-base font-medium text-gray-900 underline-offset-2 hover:underline"
                >
                  View on Peer
                </a>
              </div>
            )}
          </div>
          {cancelled && ready && (
            authenticated ? (
              <button
                type="button"
                onClick={() => void deletePayment()}
                disabled={deleting}
                className="mt-4 flex h-12 w-full items-center justify-center rounded-xl border border-white/10 text-base font-medium text-slate-300 transition-colors hover:bg-white/[0.06] disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete payment"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => login()}
                className="mt-4 flex h-12 w-full items-center justify-center rounded-xl border border-white/10 text-base font-medium text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                Sign in to delete
              </button>
            )
          )}
          {!cancelled && !arrived && ready && (
            authenticated ? (
              <>
                <button
                  type="button"
                  onClick={() => void cancelPayment()}
                  disabled={cancelling}
                  className="mt-4 flex h-12 w-full items-center justify-center rounded-xl border border-white/10 text-base font-medium text-slate-300 transition-colors hover:bg-white/[0.06] disabled:opacity-60"
                >
                  {cancelling ? "Cancelling…" : "Cancel and get USDC back"}
                </button>
                <p className="mt-2 text-center text-sm text-slate-500">Getting your USDC back costs a bridge fee.</p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => login()}
                className="mt-4 flex h-12 w-full items-center justify-center rounded-xl border border-white/10 text-base font-medium text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                Sign in to cancel
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
