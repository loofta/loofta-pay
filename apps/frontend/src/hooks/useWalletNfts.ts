"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { getRpcForMode } from "@/lib/solanaRpc";

export type WalletNft = {
  id: string;
  name: string;
  collection: string | null;
  description: string | null;
  compressed: boolean;
  /** True for plain token NFTs we can transfer ourselves (not programmable, Core, compressed or frozen). */
  sendable: boolean;
  attributes: Array<{ trait: string; value: string }>;
  /** Same-origin artwork URL (the proxy reads the image from the asset index, never from a caller-supplied URL). */
  image: string;
};

type DasAsset = {
  id: string;
  interface?: string;
  burnt?: boolean;
  content?: { metadata?: { name?: string; description?: string; attributes?: Array<{ trait_type?: string; value?: unknown }> } };
  grouping?: Array<{ group_key?: string; group_value?: string }>;
  compression?: { compressed?: boolean };
  ownership?: { frozen?: boolean };
};

const FUNGIBLE = new Set(["FungibleToken", "FungibleAsset"]);
const PLAIN_NFT = new Set(["V1_NFT", "V2_NFT", "LEGACY_NFT"]);

/** Every NFT (standard, programmable, Core and compressed) held by the user's Loofta Solana wallet. */
export function useWalletNfts() {
  const { authenticated, user } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const address = deriveSolanaEmbeddedAddress(user ?? null);
  const rpc = getRpcForMode(networkMode);

  return useQuery({
    queryKey: ["walletNfts", address, networkMode],
    enabled: authenticated === true && !!address && networkMode === "mainnet",
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<WalletNft[]> => {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetsByOwner", params: { ownerAddress: address, page: 1, limit: 100 } }),
      });
      const items = ((await res.json())?.result?.items ?? []) as DasAsset[];
      return items
        .filter((a) => !a.burnt && !FUNGIBLE.has(a.interface ?? ""))
        .map((a) => {
          const m = a.content?.metadata;
          const short = `${a.id.slice(0, 4)}…${a.id.slice(-4)}`;
          return {
            id: a.id,
            name: m?.name?.trim() || `NFT ${short}`,
            collection: a.grouping?.find((g) => g.group_key === "collection")?.group_value ?? null,
            description: m?.description?.trim() || null,
            compressed: a.compression?.compressed === true,
            sendable: PLAIN_NFT.has(a.interface ?? "") && a.compression?.compressed !== true && a.ownership?.frozen !== true,
            attributes: (m?.attributes ?? []).filter((t) => t.trait_type && t.value != null).map((t) => ({ trait: String(t.trait_type), value: String(t.value) })),
            image: `/api/tokens/image?asset=${a.id}`,
          };
        });
    },
  });
}
