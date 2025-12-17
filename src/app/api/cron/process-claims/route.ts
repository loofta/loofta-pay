/**
 * Cron Job: Process Pending Claim Companions
 * 
 * Runs every minute to check companion wallets that have received ETH
 * and need to forward it to the final intent.
 * 
 * Schedule: * * * * * (every minute)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { getRefundToForChain } from "@/lib/refundAddresses";

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

// Redis keys
const CLAIM_COMPANION_PREFIX = "claim:companion:";
const CLAIM_PENDING_KEY = "claim:pending";

// ETH on Ethereum asset ID
const ETH_MAINNET_ASSET = "nep141:eth.omft.near";

// Minimum ETH to consider as "funded" (above gas costs)
const MIN_ETH_FUNDED = 0.001; // ~$3
const GAS_RESERVE = 0.0005; // Reserve for gas

// Type for claim companion data
type ClaimCompanionData = {
  claimId: string;
  recipientAddress: string;
  destinationAsset: string;
  destinationAmount: string;
  firstIntentDepositAddress: string;
  firstIntentQuoteId?: string;
  firstIntentDeadline: string;
  companionPrivateKey: string;
  companionAddress: string;
  finalIntentQuoteId?: string;
  finalIntentDepositAddress?: string;
  finalIntentDeadline?: string;
  status: "pending_first_deposit" | "first_received" | "second_sent" | "completed" | "failed";
  amountReceivedETH?: string;
  finalTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

// Get balance of Ethereum address
async function getEthBalance(address: string): Promise<{ eth: number; wei: bigint }> {
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
  const balanceWei = BigInt(data.result || "0x0");
  const balanceEth = Number(balanceWei) / 1e18;
  return { eth: balanceEth, wei: balanceWei };
}

// Update companion data in Redis
async function updateCompanionData(key: string, updates: Partial<ClaimCompanionData>): Promise<void> {
  const redis = await getRedis();
  const existingStr = await redis.get(key);
  if (existingStr) {
    const existing = JSON.parse(existingStr);
    await redis.setEx(key, 86400, JSON.stringify({
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }));
  }
}

export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  console.log("[cron/process-claims] Starting...");
  
  const redis = await getRedis();
  const pendingKeys = await redis.sMembers(CLAIM_PENDING_KEY);
  
  console.log(`[cron/process-claims] Found ${pendingKeys.length} pending claims`);
  
  const results: { claimId: string; action: string; success: boolean; error?: string }[] = [];
  
  for (const redisKey of pendingKeys) {
    const dataStr = await redis.get(redisKey);
    if (!dataStr) {
      await redis.sRem(CLAIM_PENDING_KEY, redisKey);
      continue;
    }
    
    const data: ClaimCompanionData = JSON.parse(dataStr);
    const claimId = data.claimId;
    
    console.log(`[cron/process-claims] Processing claim ${claimId}, status: ${data.status}`);
    
    // Check if expired (24h)
    if (Date.now() - data.createdAt > 24 * 60 * 60 * 1000) {
      console.log(`[cron/process-claims] Claim ${claimId} expired`);
      await updateCompanionData(redisKey, { status: "failed", error: "Expired after 24 hours" });
      await redis.sRem(CLAIM_PENDING_KEY, redisKey);
      results.push({ claimId, action: "expired", success: false, error: "Expired" });
      continue;
    }
    
    try {
      // Check companion wallet balance
      const balance = await getEthBalance(data.companionAddress);
      console.log(`[cron/process-claims] Companion ${data.companionAddress} balance: ${balance.eth} ETH`);
      
      if (data.status === "pending_first_deposit") {
        // Check if companion has received ETH
        if (balance.eth >= MIN_ETH_FUNDED) {
          console.log(`[cron/process-claims] Companion funded with ${balance.eth} ETH`);
          await updateCompanionData(redisKey, { 
            status: "first_received", 
            amountReceivedETH: balance.eth.toFixed(8) 
          });
          data.status = "first_received";
          data.amountReceivedETH = balance.eth.toFixed(8);
        } else {
          console.log(`[cron/process-claims] Still waiting for first deposit...`);
          results.push({ claimId, action: "waiting", success: true });
          continue;
        }
      }
      
      if (data.status === "first_received") {
        // Create final intent (ETH → destination token)
        console.log(`[cron/process-claims] Creating final intent...`);
        
        // Calculate how much ETH to send (balance minus gas reserve)
        const ethToSend = balance.eth - GAS_RESERVE;
        if (ethToSend <= 0) {
          console.log(`[cron/process-claims] Not enough ETH after gas reserve`);
          results.push({ claimId, action: "insufficient_balance", success: false });
          continue;
        }
        
        // Create the final intent quote with EXACT_OUTPUT
        const finalIntentRequest = {
          dry: false,
          swapType: QuoteRequest.swapType.EXACT_OUTPUT,
          slippageTolerance: 100,
          originAsset: ETH_MAINNET_ASSET,
          depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
          destinationAsset: data.destinationAsset,
          amount: data.destinationAmount, // EXACT_OUTPUT
          refundTo: data.companionAddress, // Refund back to companion if fails
          refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
          recipient: data.recipientAddress,
          recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
          deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          quoteWaitingTimeMs: 5000,
          referral: "loofta",
        };
        
        console.log(`[cron/process-claims] Final intent request:`, JSON.stringify(finalIntentRequest, null, 2));
        
        let finalQuote: any;
        try {
          finalQuote = await OneClickService.getQuote(finalIntentRequest as any);
          console.log(`[cron/process-claims] Final intent quote:`, JSON.stringify(finalQuote, null, 2));
        } catch (err: any) {
          console.error(`[cron/process-claims] Final intent quote failed:`, err?.message);
          await updateCompanionData(redisKey, { status: "failed", error: `Final intent failed: ${err?.message}` });
          await redis.sRem(CLAIM_PENDING_KEY, redisKey);
          results.push({ claimId, action: "final_intent_failed", success: false, error: err?.message });
          continue;
        }
        
        const quote = (finalQuote as any)?.quote || finalQuote;
        const depositAddress = quote?.depositAddress;
        const requiredEth = parseFloat(quote?.minAmountInFormatted || quote?.amountInFormatted || "0");
        
        if (!depositAddress) {
          console.error(`[cron/process-claims] No deposit address in final intent`);
          await updateCompanionData(redisKey, { status: "failed", error: "No deposit address for final intent" });
          await redis.sRem(CLAIM_PENDING_KEY, redisKey);
          results.push({ claimId, action: "no_deposit_address", success: false });
          continue;
        }
        
        // Check if we have enough ETH
        if (ethToSend < requiredEth) {
          console.error(`[cron/process-claims] Insufficient ETH: have ${ethToSend}, need ${requiredEth}`);
          // Could implement refund logic here
          await updateCompanionData(redisKey, { 
            status: "failed", 
            error: `Insufficient ETH: have ${ethToSend.toFixed(6)}, need ${requiredEth.toFixed(6)}` 
          });
          await redis.sRem(CLAIM_PENDING_KEY, redisKey);
          results.push({ claimId, action: "insufficient_eth", success: false });
          continue;
        }
        
        // Store final intent info
        await updateCompanionData(redisKey, {
          finalIntentQuoteId: quote?.id || quote?.quoteId,
          finalIntentDepositAddress: depositAddress,
          finalIntentDeadline: quote?.deadline,
        });
        
        // Send ETH from companion to final intent deposit address
        console.log(`[cron/process-claims] Sending ${requiredEth} ETH to ${depositAddress}`);
        
        const account = privateKeyToAccount(data.companionPrivateKey as `0x${string}`);
        const client = createWalletClient({
          account,
          chain: mainnet,
          transport: http(process.env.ETH_RPC_URL || "https://eth.llamarpc.com"),
        });
        
        try {
          const txHash = await client.sendTransaction({
            to: depositAddress as `0x${string}`,
            value: parseEther(requiredEth.toFixed(8)),
          });
          
          console.log(`[cron/process-claims] Transaction sent: ${txHash}`);
          
          await updateCompanionData(redisKey, {
            status: "second_sent",
            finalTxHash: txHash,
          });
          
          results.push({ claimId, action: "second_hop_sent", success: true });
        } catch (err: any) {
          console.error(`[cron/process-claims] Transaction failed:`, err?.message);
          await updateCompanionData(redisKey, { status: "failed", error: `TX failed: ${err?.message}` });
          await redis.sRem(CLAIM_PENDING_KEY, redisKey);
          results.push({ claimId, action: "tx_failed", success: false, error: err?.message });
        }
      }
      
      if (data.status === "second_sent") {
        // Check if final intent completed by polling status
        // For now, we'll consider it done and let user check status manually
        console.log(`[cron/process-claims] Second hop sent, marking as completed`);
        await updateCompanionData(redisKey, { status: "completed" });
        await redis.sRem(CLAIM_PENDING_KEY, redisKey);
        results.push({ claimId, action: "completed", success: true });
      }
      
    } catch (err: any) {
      console.error(`[cron/process-claims] Error processing ${claimId}:`, err?.message);
      results.push({ claimId, action: "error", success: false, error: err?.message });
    }
  }
  
  console.log(`[cron/process-claims] Done. Results:`, results);
  
  return NextResponse.json({
    success: true,
    processed: pendingKeys.length,
    results,
  });
}

