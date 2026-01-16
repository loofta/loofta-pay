/**
 * Organizations Companion Swap API
 * 
 * Handles same-chain swaps for EVM chains via Rhinestone companion wallet.
 * When user pays with Token A but organization requires Token B (same chain),
 * we create a companion wallet that:
 * 1. Receives Token A from user
 * 2. Swaps Token A → Token B using Rhinestone
 * 3. Sends Token B to the organization recipient wallet
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
import { OneClickService, OpenAPI } from "@defuse-protocol/one-click-sdk-typescript";
import {
  RHINESTONE_CHAIN_IDS,
  RHINESTONE_RPC_URLS,
  LOOFTA_TREASURY_ADDRESSES,
  LOOFTA_FEE_PERCENT,
  isRhinestoneSwapSupported,
  getRhinestoneChainId,
} from "@/config/rhinestoneChains";

function getEnv(name: string, fallbacks: string[] = []) {
  const all = [name, ...fallbacks];
  for (const n of all) {
    const v = (process as any).env?.[n];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

const ONECLICK_BASE = getEnv("ONECLICK_API_BASE", ["NEXT_PUBLIC_ONECLICK_API_BASE"]) || "https://1click.chaindefuser.com";
const ONECLICK_JWT = getEnv("ONECLICK_JWT", ["NEXT_PUBLIC_ONECLICK_JWT"]);
OpenAPI.BASE = ONECLICK_BASE;
if (ONECLICK_JWT) OpenAPI.TOKEN = ONECLICK_JWT;

// Token contract addresses per chain (for ERC20 tokens)
const TOKEN_ADDRESSES: Record<number, Record<string, Address>> = {
  [mainnet.id]: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  [base.id]: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  [optimism.id]: {
    USDC: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  [arbitrum.id]: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  [polygon.id]: {
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  },
};

const SWAP_COMPANION_PREFIX = "org_swap_companion:";
const SWAP_PENDING_KEY = "org_swap_pending";

export type SwapCompanionData = {
  organizationId: string;
  companionPrivateKey: string;
  companionAddress: string;
  chainId: number;
  
  fromToken: string;
  fromTokenAddress: Address | null;
  fromDecimals: number;
  
  toToken: string;
  toTokenAddress: Address | null;
  toDecimals: number;
  toAmount: string;
  
  recipientAddress: string;
  
  feeAmount: string;
  feeRecipient: string;
  
  status: "pending_deposit" | "processing" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
};

async function getRedis() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const client = createClient({ url: redisUrl });
  if (!client.isOpen) await client.connect();
  return client;
}

/**
 * POST /api/organizations/companion-swap
 * 
 * Create a same-chain swap via companion wallet
 * 
 * Body:
 * - organizationId: string
 * - fromToken: { symbol, chain, decimals }
 * - toToken: { symbol, chain, decimals, amount }
 * - recipientAddress: string
 * - amountUsd: number
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { organizationId, fromToken, toToken, recipientAddress, amountUsd } = body;
    
    if (!organizationId || !fromToken?.symbol || !fromToken?.chain || !toToken?.symbol || !toToken?.amount || !recipientAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    console.log("[organizations/companion-swap] Creating same-chain swap:", {
      organizationId,
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
    
    console.log("[organizations/companion-swap] Companion wallet created:", companionAddress);
    
    // Calculate fee amount (1% of USD value)
    const feeUsd = Number(amountUsd || 0) * LOOFTA_FEE_PERCENT;
    const feeRecipient = LOOFTA_TREASURY_ADDRESSES[chainId];
    
    // Calculate how much user needs to send (amount + fees + gas buffer)
    const fromDecimals = fromToken.decimals || (fromToken.symbol === "ETH" || fromToken.symbol === "WETH" ? 18 : 6);
    const toDecimals = toToken.decimals || (toToken.symbol === "ETH" || toToken.symbol === "WETH" ? 18 : 6);
    
    // Get token prices to calculate amounts
    // First try to use prices passed in the request
    let fromTokenPrice: number | undefined = typeof fromToken.price === "number" && fromToken.price > 0 ? fromToken.price : undefined;
    let toTokenPrice: number | undefined = typeof toToken.price === "number" && toToken.price > 0 ? toToken.price : undefined;
    
    console.log("[organizations/companion-swap] Token prices from request:", {
      fromTokenPrice,
      toTokenPrice,
      fromSymbol: fromToken.symbol,
      toSymbol: toToken.symbol,
      receivedFromPrice: fromToken.price,
      receivedToPrice: toToken.price,
    });
    
    // If prices weren't passed or are invalid, fetch them from OneClick service
    if (fromTokenPrice === undefined || toTokenPrice === undefined) {
      try {
        const tokens: any = await (OneClickService as any).getTokens();
        const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
        
        console.log("[organizations/companion-swap] Fetched tokens, total:", arr.length);
        
        if (!fromTokenPrice) {
          // Try by tokenId first (most reliable)
          const fromTokenId = (fromToken as any).tokenId || (fromToken as any).address;
          if (fromTokenId) {
            const foundById = arr.find((t: any) => {
              const tId = String(t?.tokenId || t?.assetId || "").toLowerCase();
              const fId = String(fromTokenId).toLowerCase();
              return tId === fId || tId.includes(fId) || fId.includes(tId);
            });
            if (foundById && typeof foundById.price === "number") {
              fromTokenPrice = foundById.price;
              console.log("[organizations/companion-swap] Found fromToken price by ID:", fromTokenPrice, "for tokenId:", fromTokenId);
            } else {
              console.log("[organizations/companion-swap] No token found by ID:", fromTokenId, "in", arr.length, "tokens");
            }
          }
          
          // Fallback to symbol + chain
          if (!fromTokenPrice) {
            const foundFrom = arr.find((t: any) => {
              const symbolMatch = String(t?.symbol || "").toUpperCase() === String(fromToken.symbol || "").toUpperCase();
              const chainMatch = String(t?.chain || t?.chainId || "").toLowerCase().includes(String(fromToken.chain || "").toLowerCase());
              return symbolMatch && chainMatch;
            });
            if (foundFrom && typeof foundFrom.price === "number") {
              fromTokenPrice = foundFrom.price;
              console.log("[organizations/companion-swap] Found fromToken price by symbol+chain:", fromTokenPrice);
            } else {
              console.log("[organizations/companion-swap] No token found by symbol+chain:", fromToken.symbol, fromToken.chain);
              // Log sample tokens for debugging
              if (arr.length > 0) {
                console.log("[organizations/companion-swap] Sample tokens:", arr.slice(0, 3).map((t: any) => ({
                  symbol: t.symbol,
                  chain: t.chain,
                  tokenId: t.tokenId || t.assetId,
                  price: t.price,
                })));
              }
            }
          }
        }
        
        if (!toTokenPrice) {
          const foundTo = arr.find((t: any) => {
            const symbolMatch = String(t?.symbol || "").toUpperCase() === String(toToken.symbol || "").toUpperCase();
            const chainMatch = String(t?.chain || t?.chainId || "").toLowerCase().includes(String(toToken.chain || "").toLowerCase());
            return symbolMatch && chainMatch;
          });
          if (foundTo && typeof foundTo.price === "number") {
            toTokenPrice = foundTo.price;
            console.log("[organizations/companion-swap] Found toToken price:", toTokenPrice);
          }
        }
      } catch (e) {
        console.error("[organizations/companion-swap] Error fetching token prices:", e);
      }
    }
    
    console.log("[organizations/companion-swap] Final token prices:", {
      fromTokenPrice,
      toTokenPrice,
      hasFromPrice: !!fromTokenPrice,
      hasToPrice: !!toTokenPrice,
    });
    
    // Calculate destination token amount from USD
    let toTokenAmount = toToken.amount;
    if (typeof toTokenPrice === "number" && toTokenPrice > 0 && typeof amountUsd === "number") {
      const calculatedAmount = amountUsd / toTokenPrice;
      toTokenAmount = calculatedAmount.toFixed(6);
    }
    
    // Store companion data in Redis
    const redis = await getRedis();
    const redisKey = `${SWAP_COMPANION_PREFIX}${organizationId}:${Date.now()}`;
    
    const companionData: SwapCompanionData = {
      organizationId,
      companionPrivateKey,
      companionAddress,
      chainId,
      
      fromToken: fromToken.symbol,
      fromTokenAddress: fromToken.symbol === "ETH" ? null : TOKEN_ADDRESSES[chainId]?.[fromToken.symbol] || null,
      fromDecimals,
      
      toToken: toToken.symbol,
      toTokenAddress: toToken.symbol === "ETH" ? null : TOKEN_ADDRESSES[chainId]?.[toToken.symbol] || null,
      toDecimals,
      toAmount: toTokenAmount,
      
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
    
    console.log("[organizations/companion-swap] Companion data stored in Redis");
    
    // Calculate amount user needs to deposit
    // Convert USD to fromToken amount, add buffer for swap slippage + gas
    let minAmountInFormatted = "0";
    
    if (fromTokenPrice === undefined || fromTokenPrice <= 0) {
      console.error("[organizations/companion-swap] Missing or invalid fromTokenPrice:", {
        fromTokenPrice,
        fromToken: fromToken.symbol,
        chain: fromToken.chain,
        tokenId: (fromToken as any).tokenId,
        receivedPrice: fromToken.price,
      });
      return NextResponse.json({ 
        error: `Unable to calculate deposit amount. Token price not available for ${fromToken.symbol} on ${fromToken.chain}. Please try again or contact support.`,
        code: "PRICE_UNAVAILABLE",
        details: {
          fromToken: fromToken.symbol,
          chain: fromToken.chain,
          tokenId: (fromToken as any).tokenId,
          finalPrice: fromTokenPrice,
          receivedPrice: fromToken.price,
        }
      }, { status: 400 });
    }
    
    if (Number(amountUsd) <= 0) {
      console.error("[organizations/companion-swap] Invalid amountUsd:", amountUsd);
      return NextResponse.json({ 
        error: "Invalid amount. Amount must be greater than 0.",
        code: "INVALID_AMOUNT" 
      }, { status: 400 });
    }
    
    const baseAmount = Number(amountUsd) / fromTokenPrice;
    const totalNeeded = baseAmount * 1.03; // 3% buffer for slippage and gas
    minAmountInFormatted = totalNeeded.toFixed(6);
    
    console.log("[organizations/companion-swap] Amount calculation:", {
      amountUsd,
      fromTokenPrice,
      baseAmount,
      totalNeeded,
      minAmountInFormatted,
    });
    
    return NextResponse.json({
      success: true,
      sameChainSwap: true,
      isCompanionSwap: true,
      depositAddress: companionAddress,
      depositToken: fromToken.symbol,
      depositChain: fromToken.chain,
      chainId,
      recipientReceives: `${toTokenAmount} ${toToken.symbol}`,
      fee: `${LOOFTA_FEE_PERCENT * 100}%`,
      feeUsd: feeUsd.toFixed(2),
      estimatedTotal: minAmountInFormatted,
      minAmountInFormatted,
      message: `Send ${fromToken.symbol} to the deposit address. We'll swap to ${toToken.symbol} and send to recipient.`,
    });
    
  } catch (e: any) {
    console.error("[organizations/companion-swap] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create swap" }, { status: 500 });
  }
}
