"use client";

import { useCallback } from "react";
import { usePrivy, useSendTransaction, useUser, useWallets } from "@privy-io/react-auth";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/**
 * Cancels a P2P cash-out from start to finish, so no one is sent to another screen. Before a buyer has paid the server
 * cancels on its own. After the deposit is made, the person's own Base wallet has to take it back, and the same call then
 * sends it home. This is the same sequence as the payment page's Cancel button, with the gas sponsored.
 *
 * Resolves when the cash-out is fully cancelled. Throws with a plain message when something stops it.
 */
export function usePeerCancel() {
  const { getAccessToken, user } = usePrivy();
  const { refreshUser } = useUser();
  const { wallets: evmWallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  const getBaseSigner = useCallback(async () => {
    const isEvm = (a: { address?: string; type?: string; chainType?: string }) =>
      !(a.type || "").toLowerCase().includes("solana") && (a.chainType || "").toLowerCase() !== "solana";
    const addressesOf = (u: typeof user) =>
      ((u?.linkedAccounts ?? []) as Array<{ address?: string; type?: string; chainType?: string }>)
        .filter(isEvm)
        .map((a) => a.address?.trim() ?? "")
        .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
    const find = (linked: string[]) =>
      evmWallets.find(
        (w) => typeof (w as { getEthereumProvider?: unknown }).getEthereumProvider === "function" && linked.some((a) => a.toLowerCase() === w.address.toLowerCase()),
      );
    let baseWallet = find(addressesOf(user));
    if (!baseWallet) {
      const refreshed = await refreshUser().catch(() => user);
      baseWallet = find(addressesOf(refreshed ?? user));
    }
    if (!baseWallet) throw new Error("Could not load your Base wallet. Open your Loofta wallet and try again.");

    const { base } = await import("viem/chains");
    const { createWalletClient, custom } = await import("viem");
    const rawProvider = await (baseWallet as { getEthereumProvider: () => Promise<{ request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }> }).getEthereumProvider();
    const walletClient = createWalletClient({
      chain: base,
      account: baseWallet.address as `0x${string}`,
      transport: custom({
        async request({ method, params }) {
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_sendTransaction") {
            const tx = (params as Array<{ to: string; data?: string; value?: string }>)[0];
            const result = await sendTransaction({ to: tx.to, data: tx.data, ...(tx.value ? { value: BigInt(tx.value) } : {}), chainId: base.id }, { sponsor: true });
            return result.hash;
          }
          return rawProvider.request({ method, params });
        },
      }),
    });
    return { walletClient, baseWallet };
  }, [evmWallets, refreshUser, sendTransaction, user]);

  const cancel = useCallback(
    async (offrampId: string, knownDepositId?: string | null): Promise<void> => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to cancel this cash-out.");
      const call = (action: string, body?: unknown) =>
        fetch(`/api/offramp/${encodeURIComponent(offrampId)}?action=${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });

      const res = await call("cancel");
      const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string; zkp2pDepositId?: string | null };
      if (!res.ok) throw new Error(data.message || "Could not cancel this cash-out.");
      // Nothing was deposited yet, so the server already cancelled it.
      const depositId = data.zkp2pDepositId || knownDepositId;
      if (data.status !== "CANCELLING" || !depositId) return;

      // The deposit exists: take it back to the person's own wallet, then send the USDC home.
      const { walletClient, baseWallet } = await getBaseSigner();
      const { base } = await import("viem/chains");
      const { createPublicClient, encodeFunctionData, erc20Abi, http } = await import("viem");
      const { peerWithdraw } = await import("@/services/peerCash");
      await peerWithdraw(depositId, walletClient as never);

      const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
      const rawBalance = (await publicClient.readContract({
        address: BASE_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [baseWallet.address as `0x${string}`],
      })) as bigint;
      if (rawBalance === BigInt(0)) {
        await call("mark-cancelled");
        return;
      }
      const bbRes = await call("bridge-back", { baseWalletAddress: baseWallet.address, amountUsdc: Number(rawBalance) / 1_000_000 });
      const bb = (await bbRes.json().catch(() => ({}))) as { depositAddress?: string; message?: string };
      if (!bbRes.ok || !bb.depositAddress) throw new Error(bb.message || "Could not start the refund.");
      const { base: baseChain } = await import("viem/chains");
      await sendTransaction(
        {
          to: BASE_USDC_ADDRESS,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [bb.depositAddress as `0x${string}`, rawBalance] }),
          chainId: baseChain.id,
        },
        { sponsor: true },
      );
      await call("mark-cancelled");
    },
    [getAccessToken, getBaseSigner, sendTransaction],
  );

  return { cancel };
}
