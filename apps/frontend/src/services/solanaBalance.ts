/**
 * Get Solana wallet balance in USD
 * Client-side only - fetches directly from Solana RPC
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getSolanaCluster, isNonMainnetCluster } from "@/lib/solanaCluster";
import { getRpcForMode, getUsdcMintForMode, type NetworkMode } from "@/lib/solanaRpc";

/** @deprecated Prefer getUsdcMintForMode() for networkMode-aware mint */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function defaultNetworkMode(): NetworkMode {
  return isNonMainnetCluster() ? "devnet" : "mainnet";
}

/** React Query stale time shared by header + pay modal for embedded-wallet USDC reads */
export const EMBEDDED_SOLANA_USDC_BALANCE_STALE_MS = 5_000;

export type EmbeddedSolanaUsdcBalanceRow = {
  balanceUSD: number;
  walletAddress: string;
};

export function embeddedSolanaUsdcBalanceQueryKey(address: string, networkMode?: NetworkMode) {
  const tag = networkMode ?? defaultNetworkMode();
  return ["embeddedSolanaUsdcBalance", address, tag] as const;
}

/**
 * Cached USDC balance row for React Query.
 */
export async function fetchEmbeddedSolanaUsdcBalance(
  address: string,
  networkMode?: NetworkMode
): Promise<EmbeddedSolanaUsdcBalanceRow> {
  const balanceUSD = await getSolanaUSDCBalance(address, networkMode);
  return { balanceUSD, walletAddress: address };
}

/**
 * USDC balance in raw base units (6 decimals) for a wallet's USDC ATA.
 * Uses getAccountInfo instead of getTokenAccountBalance — the latter errors when ATA doesn't exist.
 */
/** SPL token balance in raw base units. `tokenProgram` is the mint's program (classic SPL or Token-2022). */
export async function getSplAtaBalanceBaseUnits(
  ownerAddress: string,
  mintAddress: string,
  networkMode?: NetworkMode,
  tokenProgram?: string,
): Promise<number> {
  try {
    const mode = networkMode ?? defaultNetworkMode();
    const conn = new Connection(getRpcForMode(mode), "confirmed");
    const programId = new PublicKey(tokenProgram || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ata = getAssociatedTokenAddressSync(new PublicKey(mintAddress), new PublicKey(ownerAddress), false, programId);
    const acctInfo = await conn.getAccountInfo(ata);
    if (!acctInfo || acctInfo.data.length < 72) return 0;
    return Number(acctInfo.data.readBigUInt64LE(64));
  } catch {
    return 0;
  }
}

export async function getUsdcAtaBalanceBaseUnits(ownerAddress: string, networkMode?: NetworkMode): Promise<number> {
  try {
    const mode = networkMode ?? defaultNetworkMode();
    const conn = new Connection(getRpcForMode(mode), "confirmed");
    const usdcMint = getUsdcMintForMode(mode);
    const ata = getAssociatedTokenAddressSync(usdcMint, new PublicKey(ownerAddress));
    const acctInfo = await conn.getAccountInfo(ata);
    if (!acctInfo || acctInfo.data.length < 72) return 0;
    // SPL Token account layout: amount is a u64 at offset 64
    const amount = acctInfo.data.readBigUInt64LE(64);
    return Number(amount);
  } catch {
    return 0;
  }
}

/**
 * Get USDC balance from Solana wallet address
 */
export async function getSolanaUSDCBalance(walletAddress: string, networkMode?: NetworkMode): Promise<number> {
  try {
    const mode = networkMode ?? defaultNetworkMode();
    const rpc = getRpcForMode(mode);
    const mint = getUsdcMintForMode(mode).toBase58();

    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          { mint },
          { encoding: "jsonParsed" },
        ],
      }),
    });

    const data = await response.json();

    if (data.error || !data.result?.value || data.result.value.length === 0) {
      return 0;
    }

    const account = data.result.value[0];
    const balance = account.account.data.parsed.info.tokenAmount.uiAmount;

    if (process.env.NODE_ENV === "development") {
      console.info("[Loofta] USDC balance", {
        cluster: getSolanaCluster(),
        networkMode: mode,
        mint,
        uiAmount: balance ?? 0,
      });
    }

    return balance || 0;
  } catch (error) {
    console.error("[Solana Balance] Error fetching USDC balance:", error);
    return 0;
  }
}

/**
 * Get SOL balance from Solana wallet address
 */
export async function getSolanaSOLBalance(walletAddress: string, networkMode?: NetworkMode): Promise<number> {
  try {
    const rpc = getRpcForMode(networkMode ?? defaultNetworkMode());
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [walletAddress],
      }),
    });

    const data = await response.json();

    if (data.error || !data.result?.value) {
      return 0;
    }

    const lamports = data.result.value;
    return lamports / 1e9;
  } catch (error) {
    console.error("[Solana Balance] Error fetching SOL balance:", error);
    return 0;
  }
}

/**
 * Get total USD balance (USDC 1:1 with USD).
 */
export async function getSolanaBalanceUSD(walletAddress: string, networkMode?: NetworkMode): Promise<number> {
  try {
    return await getSolanaUSDCBalance(walletAddress, networkMode);
  } catch (error) {
    console.error("[Solana Balance] Error calculating USD balance:", error);
    return 0;
  }
}
