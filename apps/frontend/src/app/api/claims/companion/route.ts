/**
 * Claims Companion Wallet API
 * 
 * Handles 2-hop swaps for routes that don't work directly.
 * Example: ARB ETH → SOL (not supported)
 * Solution: ARB ETH → ETH on Ethereum (companion) → SOL
 * 
 * Flow:
 * 1. User wants to pay with Token A and receive Token B
 * 2. Direct route A → B fails
 * 3. We check if ETH mainnet → B works (final_intent)
 * 4. If yes, create Ethereum companion wallet
 * 5. Create intent: Token A → ETH on Ethereum (to companion)
 * 6. User deposits to first intent's deposit address
 * 7. Companion receives ETH, automatically deposits to final_intent
 * 8. Recipient receives Token B
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
// Removed getRefundToForChain - now using user-provided refund addresses only

// Initialize 1Click SDK
const ONECLICK_BASE = process.env.ONECLICK_API_BASE || process.env.NEXT_PUBLIC_ONECLICK_API_BASE || "https://1click.chaindefuser.com";
const ONECLICK_JWT = process.env.ONECLICK_JWT || process.env.NEXT_PUBLIC_ONECLICK_JWT;
OpenAPI.BASE = ONECLICK_BASE;
if (ONECLICK_JWT) OpenAPI.TOKEN = ONECLICK_JWT;

// Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

// Redis key prefixes for claims
const CLAIM_COMPANION_PREFIX = "claim:companion:";
const CLAIM_PENDING_KEY = "claim:pending";

// ETH on Ethereum asset ID (intermediate token)
const ETH_MAINNET_ASSET = "nep141:eth.omft.near";

// Fee buffer for 2-hop (covers both intents fees + slippage)
const TWO_HOP_FEE_MULTIPLIER = 1.05; // 5% extra for fees

// Type for claim companion data
type ClaimCompanionData = {
  claimId: string;
  recipientAddress: string; // Final destination (e.g., Solana address)
  destinationAsset: string; // Final token (e.g., nep141:sol.omft.near)
  destinationAmount: string; // Amount recipient should receive (atomic)
  
  // First intent: User's token → ETH on Ethereum
  firstIntentDepositAddress: string;
  firstIntentQuoteId?: string;
  firstIntentDeadline: string;
  
  // Companion wallet (receives ETH on Ethereum)
  companionPrivateKey: string;
  companionAddress: string;
  
  // Second intent: ETH on Ethereum → Final destination
  finalIntentQuoteId?: string;
  finalIntentDepositAddress?: string;
  finalIntentDeadline?: string;
  
  // Status
  status: "pending_first_deposit" | "first_received" | "second_sent" | "completed" | "failed";
  amountReceivedETH?: string;
  finalTxHash?: string;
  error?: string;
  
  createdAt: number;
  updatedAt: number;
};

// Get balance of Ethereum address
async function getEthBalance(address: string): Promise<{ eth: string; wei: string }> {
  const rpcUrl = process.env.ETH_RPC_URL || "https://eth.llamarpc.com";
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
  });
  const data = await res.json();
  const balanceWei = data.result || "0x0";
  const balanceEth = (parseInt(balanceWei, 16) / 1e18).toFixed(8);
  return { eth: balanceEth, wei: BigInt(balanceWei).toString() };
}

// Helper to convert amount to atomic
function toAtomic(val: string | number, decimals: number): string {
  const str = String(val);
  const [i, f = ""] = str.split(".");
  const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
  const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
  return BigInt(padded).toString();
}

/**
 * POST /api/claims/companion
 * 
 * Create a 2-hop swap via companion wallet
 * 
 * Body:
 * - claimId: string
 * - fromToken: { tokenId, decimals, chain }
 * - destinationAsset: string (e.g., nep141:sol.omft.near)
 * - destinationAmount: string (atomic units)
 * - recipientAddress: string (final destination address)
 * - amountUsd: number (for fee calculation)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { claimId, fromToken, destinationAsset, destinationAmount, recipientAddress, amountUsd, refundAddress } = body;
    
    if (!claimId || !fromToken?.tokenId || !destinationAsset || !destinationAmount || !recipientAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    console.log("[claims/companion] Creating 2-hop swap:", {
      claimId,
      fromToken: fromToken.tokenId,
      destinationAsset,
      destinationAmount,
      recipientAddress,
    });
    
    // Step 1: Check if ETH mainnet → destination works (final_intent)
    console.log("[claims/companion] Step 1: Checking if ETH mainnet → destination works...");
    
    let finalIntentQuote: any;
    try {
      const finalIntentRequest = {
        dry: true,
        swapType: QuoteRequest.swapType.EXACT_OUTPUT,
        slippageTolerance: 100,
        originAsset: ETH_MAINNET_ASSET,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset,
        amount: destinationAmount, // EXACT_OUTPUT - recipient gets this exact amount
        refundTo: refundAddress, // Use user-provided refund address
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient: recipientAddress,
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
        quoteWaitingTimeMs: 5000,
        referral: "loofta",
      };
      
      console.log("[claims/companion] Final intent dry request:", JSON.stringify(finalIntentRequest, null, 2));
      finalIntentQuote = await OneClickService.getQuote(finalIntentRequest as any);
      console.log("[claims/companion] Final intent dry quote succeeded:", JSON.stringify(finalIntentQuote, null, 2));
    } catch (err: any) {
      console.error("[claims/companion] Final intent route not available:", err?.message);
      return NextResponse.json({ 
        error: "Route not available even via ETH mainnet. Please try a different destination token.",
        code: "FINAL_ROUTE_NOT_AVAILABLE"
      }, { status: 400 });
    }
    
    // Get how much ETH is needed for final intent (from the dry quote)
    const quote = (finalIntentQuote as any)?.quote || finalIntentQuote;
    const ethNeededForFinal = quote?.minAmountIn || quote?.amountIn;
    const ethNeededForFinalFormatted = quote?.minAmountInFormatted || quote?.amountInFormatted;
    
    if (!ethNeededForFinal) {
      console.error("[claims/companion] Could not determine ETH needed for final intent");
      return NextResponse.json({ error: "Could not calculate required ETH amount" }, { status: 500 });
    }
    
    console.log("[claims/companion] ETH needed for final intent:", ethNeededForFinalFormatted, "ETH");
    
    // Add fee buffer for both hops
    const ethNeededWithBuffer = BigInt(Math.ceil(Number(ethNeededForFinal) * TWO_HOP_FEE_MULTIPLIER));
    console.log("[claims/companion] ETH needed with buffer:", (Number(ethNeededWithBuffer) / 1e18).toFixed(8), "ETH");
    
    // Step 2: Create companion wallet (Ethereum address to receive ETH)
    console.log("[claims/companion] Step 2: Creating companion wallet...");
    
    const companionPrivateKey = generatePrivateKey();
    const companionAccount = privateKeyToAccount(companionPrivateKey);
    const companionAddress = companionAccount.address;
    
    console.log("[claims/companion] Companion wallet created:", companionAddress);
    
    // Step 3: Create first intent (User's token → ETH on Ethereum to companion)
    console.log("[claims/companion] Step 3: Creating first intent...");
    
    // Refund address is required
    if (!refundAddress) {
      return NextResponse.json({ error: "Refund address is required" }, { status: 400 });
    }
    
    let firstIntentQuote: any;
    try {
      const firstIntentRequest = {
        dry: false,
        swapType: QuoteRequest.swapType.EXACT_OUTPUT,
        slippageTolerance: 100,
        originAsset: fromToken.tokenId,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset: ETH_MAINNET_ASSET,
        amount: ethNeededWithBuffer.toString(), // Need this much ETH for second hop
        refundTo: refundAddress,
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient: companionAddress, // Goes to our companion wallet
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
        quoteWaitingTimeMs: 5000,
        referral: "loofta",
      };
      
      console.log("[claims/companion] First intent request:", JSON.stringify(firstIntentRequest, null, 2));
      firstIntentQuote = await OneClickService.getQuote(firstIntentRequest as any);
      console.log("[claims/companion] First intent quote succeeded:", JSON.stringify(firstIntentQuote, null, 2));
    } catch (err: any) {
      console.error("[claims/companion] First intent failed:", err?.message);
      return NextResponse.json({ 
        error: "Could not create first hop. Please try a different source token.",
        code: "FIRST_HOP_FAILED"
      }, { status: 400 });
    }
    
    const firstQuote = (firstIntentQuote as any)?.quote || firstIntentQuote;
    const firstDepositAddress = firstQuote?.depositAddress;
    const firstQuoteId = firstQuote?.id || firstQuote?.quoteId;
    
    if (!firstDepositAddress) {
      console.error("[claims/companion] No deposit address in first intent response");
      return NextResponse.json({ error: "Could not get deposit address" }, { status: 500 });
    }
    
    // Round UP the minAmountIn to avoid INCOMPLETE_DEPOSIT
    const minAmountInRaw = firstQuote?.minAmountIn || firstQuote?.amountIn;
    let minAmountInFormatted = firstQuote?.minAmountInFormatted || firstQuote?.amountInFormatted;
    
    if (minAmountInRaw) {
      // Round UP to 6 decimal places
      const decimals = Number(fromToken.decimals) || 18;
      const amountFloat = Number(minAmountInRaw) / Math.pow(10, decimals);
      minAmountInFormatted = (Math.ceil(amountFloat * 1000000) / 1000000).toFixed(6);
      
      console.log("[claims/companion] Amount rounded up:", minAmountInFormatted);
    }
    
    // Step 4: Store companion data in Redis
    console.log("[claims/companion] Step 4: Storing companion data in Redis...");
    
    const redis = await getRedis();
    const redisKey = `${CLAIM_COMPANION_PREFIX}${claimId}`;
    
    const companionData: ClaimCompanionData = {
      claimId,
      recipientAddress,
      destinationAsset,
      destinationAmount,
      
      firstIntentDepositAddress: firstDepositAddress,
      firstIntentQuoteId: firstQuoteId,
      firstIntentDeadline: firstQuote?.deadline || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      
      companionPrivateKey,
      companionAddress,
      
      status: "pending_first_deposit",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Store with 24-hour expiry
    await redis.setEx(redisKey, 86400, JSON.stringify(companionData));
    
    // Add to pending set for cron processing
    await redis.sAdd(CLAIM_PENDING_KEY, redisKey);
    
    console.log("[claims/companion] Companion data stored in Redis");
    
    // Return info to frontend
    return NextResponse.json({
      success: true,
      twoHop: true,
      depositAddress: firstDepositAddress,
      quoteId: firstQuoteId,
      deadline: firstQuote?.deadline,
      timeEstimate: (firstQuote?.timeEstimate || 60) + 120, // Add extra time for second hop
      minAmountIn: minAmountInRaw,
      minAmountInFormatted, // Rounded UP
      amountInFormatted: minAmountInFormatted,
      intermediateToken: "ETH on Ethereum",
      companionAddress, // For transparency/debugging
      message: "This payment uses a 2-hop route via ETH mainnet for better liquidity.",
    });
    
  } catch (e: any) {
    console.error("[claims/companion] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create 2-hop swap" }, { status: 500 });
  }
}

/**
 * GET /api/claims/companion?claimId=xxx
 * Get status of a 2-hop claim
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const claimId = searchParams.get("claimId");
    
    if (!claimId) {
      return NextResponse.json({ error: "Missing claimId" }, { status: 400 });
    }
    
    const redis = await getRedis();
    const redisKey = `${CLAIM_COMPANION_PREFIX}${claimId}`;
    const dataStr = await redis.get(redisKey);
    
    if (!dataStr) {
      return NextResponse.json({ error: "Claim companion not found" }, { status: 404 });
    }
    
    const data: ClaimCompanionData = JSON.parse(dataStr);
    
    // Check companion wallet balance
    const balance = await getEthBalance(data.companionAddress);
    
    return NextResponse.json({
      claimId: data.claimId,
      status: data.status,
      companionAddress: data.companionAddress,
      companionBalance: balance.eth,
      firstIntentDepositAddress: data.firstIntentDepositAddress,
      finalTxHash: data.finalTxHash,
      error: data.error,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
    
  } catch (e: any) {
    console.error("[claims/companion] GET error:", e);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

