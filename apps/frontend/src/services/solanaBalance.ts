/**
 * Get Solana wallet balance in USD
 * Client-side only - fetches directly from Solana RPC
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  getSolanaCluster,
  getSolanaHttpRpc,
  isNonMainnetCluster,
} from "@/lib/solanaCluster";
import { getUsdcMint } from "@/lib/per/constants";

/** @deprecated Prefer getUsdcMint() for cluster-aware mint */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function rpcUrl(): string {
  return getSolanaHttpRpc();
}

function usdcMintAddress(): string {
  return getUsdcMint().toBase58();
}

/** React Query stale time shared by header + pay modal for embedded-wallet USDC reads */
export const EMBEDDED_SOLANA_USDC_BALANCE_STALE_MS = 60_000;

export type EmbeddedSolanaUsdcBalanceRow = {
  balanceUSD: number;
  walletAddress: string;
};

export function embeddedSolanaUsdcBalanceQueryKey(address: string) {
  return [
    "embeddedSolanaUsdcBalance",
    address,
    isNonMainnetCluster() ? "dev" : "main",
  ] as const;
}

/**
 * Cached USDC balance row for React Query (same RPC as {@link getSolanaUSDCBalance}).
 */
export async function fetchEmbeddedSolanaUsdcBalance(
  address: string
): Promise<EmbeddedSolanaUsdcBalanceRow> {
  const balanceUSD = await getSolanaUSDCBalance(address);
  return { balanceUSD, walletAddress: address };
}

/**
 * USDC balance in raw base units (6 decimals) for a wallet’s USDC ATA.
 * One `getTokenAccountBalance` RPC — cheaper than {@link getSolanaUSDCBalance} (`getTokenAccountsByOwner`) when you only need “is there USDC yet”.
 *
 * Not replaceable with Privy: claim **burner** pubkeys are not embedded wallets; the chain must be read until a backend pushes readiness.
 */
export async function getUsdcAtaBalanceBaseUnits(ownerAddress: string): Promise<number> {
  try {
    const conn = new Connection(getSolanaHttpRpc(), "confirmed");
    const usdcMint = getUsdcMint();
    const ata = getAssociatedTokenAddressSync(usdcMint, new PublicKey(ownerAddress));
    const info = await conn.getTokenAccountBalance(ata);
    return Number(info.value.amount);
  } catch {
    return 0;
  }
}

/**
 * Get USDC balance from Solana wallet address
 */
export async function getSolanaUSDCBalance(walletAddress: string): Promise<number> {
  try {
    // Use Solana Web3.js or direct RPC call
    const response = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          {
            mint: usdcMintAddress(),
          },
          {
            encoding: "jsonParsed",
          },
        ],
      }),
    });

    const data = await response.json();
    
    if (data.error || !data.result?.value || data.result.value.length === 0) {
      return 0;
    }

    // Get USDC balance (6 decimals)
    const account = data.result.value[0];
    const balance = account.account.data.parsed.info.tokenAmount.uiAmount;

    if (process.env.NODE_ENV === "development") {
      console.info("[Loofta] USDC balance", {
        cluster: getSolanaCluster(),
        mint: usdcMintAddress(),
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
export async function getSolanaSOLBalance(walletAddress: string): Promise<number> {
  try {
    const response = await fetch(rpcUrl(), {
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

    // Convert lamports to SOL (9 decimals)
    const lamports = data.result.value;
    return lamports / 1e9;
  } catch (error) {
    console.error("[Solana Balance] Error fetching SOL balance:", error);
    return 0;
  }
}

/**
 * Get total balance in USD
 * Fetches USDC balance (1:1 with USD) and optionally SOL balance
 */
export async function getSolanaBalanceUSD(walletAddress: string): Promise<number> {
  try {
    // Get USDC balance (primary - 1:1 with USD)
    const usdcBalance = await getSolanaUSDCBalance(walletAddress);
    
    // Optionally get SOL balance and convert to USD
    // For now, just return USDC balance
    // TODO: Add SOL price conversion if needed
    
    return usdcBalance;
  } catch (error) {
    console.error("[Solana Balance] Error calculating USD balance:", error);
    return 0;
  }
}
