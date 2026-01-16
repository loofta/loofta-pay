/**
 * Direct Deposit Status Check API
 * 
 * Checks if a direct deposit (same chain, same token) has been received
 * by querying the blockchain for transactions to the recipient address.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatEther, formatUnits, Address, erc20Abi } from "viem";
import { mainnet, base, optimism, arbitrum, polygon } from "viem/chains";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

// Chain configs for viem
const CHAIN_CONFIGS: Record<string, any> = {
  eth: mainnet,
  ethereum: mainnet,
  base: base,
  op: optimism,
  optimism: optimism,
  arb: arbitrum,
  arbitrum: arbitrum,
  polygon: polygon,
  pol: polygon,
};

// RPC URLs (can be moved to env vars)
const RPC_URLS: Record<string, string> = {
  eth: process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
  ethereum: process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
  base: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  op: process.env.OP_RPC_URL || "https://mainnet.optimism.io",
  optimism: process.env.OP_RPC_URL || "https://mainnet.optimism.io",
  arb: process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc",
  arbitrum: process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc",
  polygon: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
  pol: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
};

// Token addresses per chain
const TOKEN_ADDRESSES: Record<string, Record<string, Address>> = {
  eth: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  op: {
    USDC: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  arb: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  polygon: {
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  },
};

/**
 * Check if a direct deposit has been received
 */
async function checkDirectDeposit(
  recipientAddress: string,
  expectedAmount: string,
  tokenSymbol: string,
  chain: string,
  sinceTimestamp?: number
): Promise<{
  received: boolean;
  receivedAmount?: string;
  transactionHash?: string;
  blockNumber?: number;
  timestamp?: number;
}> {
  const chainLower = chain.toLowerCase();
  const chainConfig = CHAIN_CONFIGS[chainLower];
  const rpcUrl = RPC_URLS[chainLower];

  if (!chainConfig || !rpcUrl) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  const client = createPublicClient({
    chain: chainConfig,
    transport: http(rpcUrl),
  });

  const tokenSymbolUpper = tokenSymbol.toUpperCase();
  const isNative = tokenSymbolUpper === "ETH" || tokenSymbolUpper === "WETH";

  // Parse expected amount
  const expectedAmountFloat = parseFloat(expectedAmount);
  if (isNaN(expectedAmountFloat) || expectedAmountFloat <= 0) {
    throw new Error(`Invalid expected amount: ${expectedAmount}`);
  }

  try {
    if (isNative) {
      // Check ETH balance
      const balance = await client.getBalance({ address: recipientAddress as Address });
      const balanceEth = parseFloat(formatEther(balance));
      
      // For ETH, we check if balance increased by at least the expected amount
      // Since we don't have a "before" balance, we check if current balance >= expected
      // This is a simplified check - in production, you'd want to track balance changes
      if (balanceEth >= expectedAmountFloat * 0.95) { // 5% tolerance
        // Try to find the transaction that sent the funds
        // For now, we'll just return that funds were received
        return {
          received: true,
          receivedAmount: balanceEth.toFixed(6),
        };
      }
    } else {
      // Check ERC20 token balance
      const tokenAddress = TOKEN_ADDRESSES[chainLower]?.[tokenSymbolUpper];
      if (!tokenAddress) {
        throw new Error(`Token ${tokenSymbol} not supported on ${chain}`);
      }

      const decimals = tokenSymbolUpper === "USDC" || tokenSymbolUpper === "USDT" ? 6 : 18;
      const balance = await client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipientAddress as Address],
      });

      const balanceFormatted = parseFloat(formatUnits(balance, decimals));
      
      // Check if balance >= expected amount (with 5% tolerance)
      if (balanceFormatted >= expectedAmountFloat * 0.95) {
        // Try to get recent transfer events to find the transaction
        // For now, we'll just return that funds were received
        return {
          received: true,
          receivedAmount: balanceFormatted.toFixed(6),
        };
      }
    }

    return { received: false };
  } catch (error: any) {
    console.error("[direct-status] Error checking deposit:", error);
    throw new Error(`Failed to check deposit: ${error?.message || "Unknown error"}`);
  }
}

/**
 * GET /api/organizations/direct-status
 * 
 * Query params:
 * - recipientAddress: string (required)
 * - expectedAmount: string (required)
 * - tokenSymbol: string (required)
 * - chain: string (required)
 * - organizationId: string (optional, for logging)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recipientAddress = searchParams.get("recipientAddress");
    const expectedAmount = searchParams.get("expectedAmount");
    const tokenSymbol = searchParams.get("tokenSymbol");
    const chain = searchParams.get("chain");
    const organizationId = searchParams.get("organizationId");

    if (!recipientAddress || !expectedAmount || !tokenSymbol || !chain) {
      return NextResponse.json(
        { error: "Missing required parameters: recipientAddress, expectedAmount, tokenSymbol, chain" },
        { status: 400 }
      );
    }

    console.log("[direct-status] Checking deposit:", {
      organizationId,
      recipientAddress: `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`,
      expectedAmount,
      tokenSymbol,
      chain,
    });

    const result = await checkDirectDeposit(
      recipientAddress,
      expectedAmount,
      tokenSymbol,
      chain
    );

    if (result.received) {
      return NextResponse.json({
        status: "SUCCESS",
        received: true,
        receivedAmount: result.receivedAmount,
        transactionHash: result.transactionHash,
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: "PENDING_DEPOSIT",
      received: false,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[direct-status] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to check direct deposit status" },
      { status: 500 }
    );
  }
}
