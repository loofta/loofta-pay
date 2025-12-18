/**
 * Claims Companion Swap API
 * 
 * Handles same-chain swaps for EVM chains via Rhinestone companion wallet.
 * When user pays with Token A but claim requires Token B (same chain),
 * we create a companion wallet that:
 * 1. Receives Token A from user
 * 2. Swaps Token A → Token B using Rhinestone
 * 3. Sends Token B to the claim recipient
 * 
 * Supported chains: Ethereum, Base, Optimism, Arbitrum, Polygon, zkSync
 * Supported tokens: ETH, WETH, USDC, USDT (varies by chain)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatEther, parseEther, Address, erc20Abi, parseUnits, formatUnits } from "viem";
import { mainnet, base, optimism, arbitrum, polygon, zkSync } from "viem/chains";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  RHINESTONE_CHAIN_IDS,
  RHINESTONE_RPC_URLS,
  LOOFTA_TREASURY_ADDRESSES,
  LOOFTA_FEE_PERCENT,
  isRhinestoneSwapSupported,
  getRhinestoneChainId,
} from "@/config/rhinestoneChains";

// Token contract addresses per chain (for ERC20 tokens)
const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  1: { // Ethereum
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  8453: { // Base
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  },
  10: { // Optimism
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  },
  42161: { // Arbitrum
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  137: { // Polygon
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
  324: { // zkSync
    WETH: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91",
    USDC: "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4",
    USDT: "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C",
  },
};

// Chain configs for viem
const CHAIN_CONFIGS: Record<number, any> = {
  1: mainnet,
  8453: base,
  10: optimism,
  42161: arbitrum,
  137: polygon,
  324: zkSync,
};

// Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

// Redis key prefixes
const SWAP_COMPANION_PREFIX = "claim:swap:";
const SWAP_PENDING_KEY = "claim:swap:pending";

// Type for swap companion data
type SwapCompanionData = {
  claimId: string;
  companionPrivateKey: string;
  companionAddress: string;
  chainId: number;
  
  // Input token (what user sends)
  fromToken: string; // ETH, USDC, etc.
  fromTokenAddress: string | null; // null for native ETH
  fromDecimals: number;
  
  // Output token (what recipient receives)
  toToken: string;
  toTokenAddress: string | null;
  toDecimals: number;
  toAmount: string; // Amount recipient should receive (human readable)
  
  // Recipient
  recipientAddress: string;
  
  // Fee tracking
  feeAmount: string; // Amount sent to Loofta treasury
  feeRecipient: string;
  
  // Status
  status: "pending_deposit" | "funded" | "swapping" | "completed" | "failed" | "refunded";
  amountReceived?: string;
  amountSwapped?: string;
  swapTxHash?: string;
  transferTxHash?: string;
  feeTxHash?: string;
  error?: string;
  
  createdAt: number;
  updatedAt: number;
};

/**
 * Get token balance (native or ERC20)
 */
async function getTokenBalance(
  address: string, 
  tokenSymbol: string, 
  chainId: number
): Promise<{ formatted: string; raw: bigint }> {
  const rpcUrl = RHINESTONE_RPC_URLS[chainId];
  const chain = CHAIN_CONFIGS[chainId];
  
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  
  if (tokenSymbol === "ETH") {
    const balance = await client.getBalance({ address: address as Address });
    return { formatted: formatEther(balance), raw: balance };
  }
  
  const tokenAddress = TOKEN_ADDRESSES[chainId]?.[tokenSymbol];
  if (!tokenAddress) {
    throw new Error(`Token ${tokenSymbol} not supported on chain ${chainId}`);
  }
  
  const decimals = tokenSymbol === "USDC" || tokenSymbol === "USDT" ? 6 : 18;
  const balance = await client.readContract({
    address: tokenAddress as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as Address],
  });
  
  return { formatted: formatUnits(balance, decimals), raw: balance };
}

/**
 * POST /api/claims/companion-swap
 * 
 * Create a same-chain swap via companion wallet
 * 
 * Body:
 * - claimId: string
 * - fromToken: { symbol, chain, decimals }
 * - toToken: { symbol, chain, decimals, amount }
 * - recipientAddress: string
 * - amountUsd: number
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { claimId, fromToken, toToken, recipientAddress, amountUsd } = body;
    
    if (!claimId || !fromToken?.symbol || !fromToken?.chain || !toToken?.symbol || !toToken?.amount || !recipientAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    console.log("[claims/companion-swap] Creating same-chain swap:", {
      claimId,
      from: `${fromToken.symbol} on ${fromToken.chain}`,
      to: `${toToken.symbol} (amount: ${toToken.amount})`,
      recipient: recipientAddress,
    });
    
    // Validate chain support
    const chainId = getRhinestoneChainId(fromToken.chain);
    if (!chainId) {
      return NextResponse.json({ 
        error: `Chain ${fromToken.chain} not supported for swaps. Supported: Ethereum, Base, Optimism, Arbitrum, Polygon, zkSync.`,
        code: "CHAIN_NOT_SUPPORTED" 
      }, { status: 400 });
    }
    
    // Validate token support
    if (!isRhinestoneSwapSupported(fromToken.symbol, toToken.symbol, chainId)) {
      return NextResponse.json({ 
        error: `Swap ${fromToken.symbol} → ${toToken.symbol} not supported on ${fromToken.chain}. Supported tokens: ETH, WETH, USDC, USDT.`,
        code: "TOKENS_NOT_SUPPORTED" 
      }, { status: 400 });
    }
    
    // Create companion wallet
    const companionPrivateKey = generatePrivateKey();
    const companionAccount = privateKeyToAccount(companionPrivateKey);
    const companionAddress = companionAccount.address;
    
    console.log("[claims/companion-swap] Companion wallet created:", companionAddress);
    
    // Calculate fee amount (1% of USD value)
    const feeUsd = Number(amountUsd || 0) * LOOFTA_FEE_PERCENT;
    const feeRecipient = LOOFTA_TREASURY_ADDRESSES[chainId];
    
    // Calculate how much user needs to send (amount + fees + gas buffer)
    // For now, we'll estimate based on USD amounts
    const fromDecimals = fromToken.decimals || (fromToken.symbol === "ETH" || fromToken.symbol === "WETH" ? 18 : 6);
    const toDecimals = toToken.decimals || (toToken.symbol === "ETH" || toToken.symbol === "WETH" ? 18 : 6);
    
    // Store companion data in Redis
    const redis = await getRedis();
    const redisKey = `${SWAP_COMPANION_PREFIX}${claimId}`;
    
    const companionData: SwapCompanionData = {
      claimId,
      companionPrivateKey,
      companionAddress,
      chainId,
      
      fromToken: fromToken.symbol,
      fromTokenAddress: fromToken.symbol === "ETH" ? null : TOKEN_ADDRESSES[chainId]?.[fromToken.symbol] || null,
      fromDecimals,
      
      toToken: toToken.symbol,
      toTokenAddress: toToken.symbol === "ETH" ? null : TOKEN_ADDRESSES[chainId]?.[toToken.symbol] || null,
      toDecimals,
      toAmount: toToken.amount,
      
      recipientAddress,
      
      feeAmount: feeUsd.toFixed(2),
      feeRecipient,
      
      status: "pending_deposit",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Store with 24-hour expiry
    await redis.setEx(redisKey, 86400, JSON.stringify(companionData));
    
    // Add to pending set for cron processing
    await redis.sAdd(SWAP_PENDING_KEY, redisKey);
    
    console.log("[claims/companion-swap] Companion data stored in Redis");
    
    // Update claim status in Supabase
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from("claims").update({ 
        status: "PENDING_DEPOSIT",
      }).eq("id", claimId);
    } catch (e) {
      console.error("[claims/companion-swap] Failed to update claim status:", e);
    }
    
    // Calculate amount user needs to deposit
    // Add buffer for swap slippage + gas
    const totalNeeded = Number(amountUsd) * 1.03; // 3% buffer
    
    return NextResponse.json({
      success: true,
      sameChainSwap: true,
      depositAddress: companionAddress,
      depositToken: fromToken.symbol,
      depositChain: fromToken.chain,
      chainId,
      recipientReceives: `${toToken.amount} ${toToken.symbol}`,
      fee: `${LOOFTA_FEE_PERCENT * 100}%`,
      feeUsd: feeUsd.toFixed(2),
      estimatedTotal: totalNeeded.toFixed(2),
      message: `Send ${fromToken.symbol} to the deposit address. We'll swap to ${toToken.symbol} and send to recipient.`,
    });
    
  } catch (e: any) {
    console.error("[claims/companion-swap] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create swap" }, { status: 500 });
  }
}

/**
 * GET /api/claims/companion-swap?claimId=xxx
 * Get status of a same-chain swap
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const claimId = searchParams.get("claimId");
    
    if (!claimId) {
      return NextResponse.json({ error: "Missing claimId" }, { status: 400 });
    }
    
    const redis = await getRedis();
    const redisKey = `${SWAP_COMPANION_PREFIX}${claimId}`;
    const dataStr = await redis.get(redisKey);
    
    if (!dataStr) {
      return NextResponse.json({ error: "Swap not found" }, { status: 404 });
    }
    
    const data: SwapCompanionData = JSON.parse(dataStr);
    
    // Check companion wallet balance
    let balance = { formatted: "0", raw: BigInt(0) };
    try {
      balance = await getTokenBalance(data.companionAddress, data.fromToken, data.chainId);
    } catch (e) {
      console.error("[claims/companion-swap] Balance check error:", e);
    }
    
    return NextResponse.json({
      claimId: data.claimId,
      status: data.status,
      companionAddress: data.companionAddress,
      chainId: data.chainId,
      depositToken: data.fromToken,
      balance: balance.formatted,
      recipientAddress: data.recipientAddress,
      toToken: data.toToken,
      toAmount: data.toAmount,
      swapTxHash: data.swapTxHash,
      transferTxHash: data.transferTxHash,
      error: data.error,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
    
  } catch (e: any) {
    console.error("[claims/companion-swap] GET error:", e);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

