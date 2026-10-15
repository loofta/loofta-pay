"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** Returns USDC stuck in the user's own Base wallet (e.g. after a cancelled cash out) to their balance. */
export default function BaseRescuePage() {
  const { toast } = useToast();
  const { ready, authenticated, login, getAccessToken, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const [baseAddress, setBaseAddress] = useState<string | null>(null);
  const [raw, setRaw] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const refresh = useCallback(async () => {
    const linked = ((user?.linkedAccounts ?? []) as Array<{ address?: string; type?: string; chainType?: string }>)
      .filter((a) => !(a.type || "").toLowerCase().includes("solana") && (a.chainType || "").toLowerCase() !== "solana")
      .map((a) => a.address?.trim() ?? "")
      .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
    const addr = wallets.find((w) => linked.some((a) => a.toLowerCase() === w.address.toLowerCase()))?.address ?? linked[0];
    if (!addr) return;
    setBaseAddress(addr);
    const { base } = await import("viem/chains");
    const { createPublicClient, erc20Abi, http } = await import("viem");
    const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
    const bal = await client.readContract({
      address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [addr as `0x${string}`],
    }) as bigint;
    setRaw(bal);
  }, [user, wallets]);

  useEffect(() => {
    if (ready && authenticated) void refresh();
  }, [ready, authenticated, refresh]);

  const rescue = async () => {
    if (!baseAddress || !raw || raw === 0n || busy) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in first");
      const res = await fetch("/api/offramp/rescue", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseWalletAddress: baseAddress, amountUsdc: Number(raw) / 1_000_000 }),
      });
      const data = await res.json() as { depositAddress?: string; message?: string };
      if (!res.ok || !data.depositAddress) throw new Error(data.message || "Could not start the transfer");
      const { base } = await import("viem/chains");
      const { encodeFunctionData, erc20Abi } = await import("viem");
      await sendTransaction({
        to: BASE_USDC_ADDRESS,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [data.depositAddress as `0x${string}`, raw] }),
        chainId: base.id,
      }, { sponsor: true });
      setDone(true);
      toast({ title: "On its way", description: "Your USDC is being bridged back. It can take a few minutes." });
    } catch (err) {
      toast({ variant: "destructive", title: "Could not return the USDC", description: err instanceof Error ? err.message : "Try again" });
    } finally {
      setBusy(false);
    }
  };

  const amount = raw !== null ? (Number(raw) / 1_000_000).toFixed(2) : null;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center text-white">
      <p className="text-lg font-semibold">Rescue USDC stuck on Base</p>
      {!ready ? (
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      ) : !authenticated ? (
        <Button onClick={() => login()}>Sign in</Button>
      ) : raw === null ? (
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      ) : done ? (
        <p className="text-base text-slate-300">Sent. It will show up in your balance in a few minutes.</p>
      ) : raw === 0n ? (
        <p className="text-base text-slate-400">Nothing to return. Your Base wallet has no USDC.</p>
      ) : (
        <>
          <p className="text-base text-slate-300">
            You have <span className="font-semibold text-white">${amount}</span> USDC left in your Base wallet. This sends it back to your balance.
          </p>
          <Button onClick={rescue} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Return $${amount} to my balance`}
          </Button>
        </>
      )}
    </div>
  );
}
