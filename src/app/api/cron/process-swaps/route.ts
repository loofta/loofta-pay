/**
 * Cron Job: Process Pending Same-Chain Swaps
 * 
 * This endpoint is called periodically by Vercel Cron to:
 * 1. Check pending companion wallets for deposits
 * 2. Execute swaps via Rhinestone when funded
 * 3. Transfer to recipient and take fees
 * 
 * Schedule: Every minute (configured in vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, formatEther, parseEther, Address, erc20Abi, formatUnits, parseUnits, encodeFunctionData } from "viem";
import { mainnet, base, optimism, arbitrum, polygon, zkSync } from "viem/chains";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { RHINESTONE_API_KEY } from "@/config/rhinestone";
import { 
  RHINESTONE_RPC_URLS, 
  LOOFTA_TREASURY_ADDRESSES,
  LOOFTA_FEE_PERCENT,
} from "@/config/rhinestoneChains";
import { withLock } from "@/lib/redis-lock";

// Secret for cron authentication
const CRON_SECRET = process.env.CRON_SECRET;

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
const SWAP_COMPANION_PREFIX = "claim:swap:";
const SWAP_PENDING_KEY = "claim:swap:pending";

// Token addresses per chain
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

type SwapCompanionData = {
  claimId: string;
  companionPrivateKey: string;
  companionAddress: string;
  chainId: number;
  fromToken: string;
  fromTokenAddress: string | null;
  fromDecimals: number;
  toToken: string;
  toTokenAddress: string | null;
  toDecimals: number;
  toAmount: string;
  recipientAddress: string;
  feeAmount: string;
  feeRecipient: string;
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
 * Get token balance
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
 * Execute swap and transfer via Rhinestone
 */
async function executeSwapAndTransfer(data: SwapCompanionData): Promise<{
  success: boolean;
  swapTxHash?: string;
  transferTxHash?: string;
  error?: string;
}> {
  try {
    // Cast to any because current RhinestoneSDK type definitions might not expose
    // helper methods like getCompanionAccount / getOrchestrator / swap yet.
    const sdk = new RhinestoneSDK({ apiKey: RHINESTONE_API_KEY || "" }) as any;
    const account = privateKeyToAccount(data.companionPrivateKey as `0x${string}`);
    
    // Create companion wallet account via Rhinestone
    const companionAccount = await sdk.getCompanionAccount({
      signerAddress: account.address,
      chainId: data.chainId,
    });
    
    console.log(`[process-swaps] Companion account:`, companionAccount.address);
    
    // Check balance
    const balance = await getTokenBalance(data.companionAddress, data.fromToken, data.chainId);
    console.log(`[process-swaps] Balance: ${balance.formatted} ${data.fromToken}`);
    
    if (balance.raw === BigInt(0)) {
      return { success: false, error: "No balance received" };
    }
    
    // Calculate amounts
    const feePercent = LOOFTA_FEE_PERCENT;
    const feeAmount = (balance.raw * BigInt(Math.floor(feePercent * 10000))) / BigInt(10000);
    const amountAfterFee = balance.raw - feeAmount;
    
    console.log(`[process-swaps] Fee: ${formatEther(feeAmount)} ${data.fromToken}`);
    console.log(`[process-swaps] After fee: ${formatEther(amountAfterFee)} ${data.fromToken}`);
    
    // If same token, just transfer directly
    if (data.fromToken === data.toToken) {
      console.log(`[process-swaps] Same token - direct transfer`);
      
      // Build transfer call
      const calls: any[] = [];
      
      // Transfer to recipient
      if (data.fromToken === "ETH") {
        calls.push({
          to: data.recipientAddress,
          value: amountAfterFee,
          data: "0x",
        });
        
        // Fee to treasury
        if (feeAmount > BigInt(0)) {
          calls.push({
            to: data.feeRecipient,
            value: feeAmount,
            data: "0x",
          });
        }
      } else {
        const tokenAddress = TOKEN_ADDRESSES[data.chainId]?.[data.fromToken];
        if (!tokenAddress) {
          return { success: false, error: `Token address not found for ${data.fromToken}` };
        }
        
        calls.push({
          to: tokenAddress,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [data.recipientAddress as Address, amountAfterFee],
          }),
        });
        
        // Fee to treasury
        if (feeAmount > BigInt(0)) {
          calls.push({
            to: tokenAddress,
            value: BigInt(0),
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [data.feeRecipient as Address, feeAmount],
            }),
          });
        }
      }
      
      // Execute via Rhinestone
      const orchestrator = await sdk.getOrchestrator({ chainId: data.chainId });
      const bundle = await orchestrator.encodeExecutionBundle({
        account: companionAccount,
        calls,
        signer: account,
      });
      
      const txHash = await orchestrator.sendTransaction(bundle);
      console.log(`[process-swaps] Transfer TX hash:`, txHash);
      
      return { 
        success: true, 
        transferTxHash: txHash,
      };
    }
    
    // Different tokens - need to swap
    console.log(`[process-swaps] Different tokens - executing swap ${data.fromToken} → ${data.toToken}`);
    
    // For now, use simple transfer if it's a stablecoin swap (same value)
    // In production, you'd integrate with a DEX (Uniswap, etc.)
    // Rhinestone supports swap via their SDK
    
    try {
      // Try using Rhinestone's built-in swap functionality
      const swapResult = await sdk.swap({
        account: companionAccount,
        chainId: data.chainId,
        fromToken: data.fromToken === "ETH" ? "native" : (TOKEN_ADDRESSES[data.chainId]?.[data.fromToken] || ""),
        toToken: data.toToken === "ETH" ? "native" : (TOKEN_ADDRESSES[data.chainId]?.[data.toToken] || ""),
        amount: amountAfterFee.toString(),
        recipient: data.recipientAddress as Address,
        signer: account,
      });
      
      console.log(`[process-swaps] Swap result:`, swapResult);
      
      return {
        success: true,
        swapTxHash: swapResult.txHash,
        transferTxHash: swapResult.txHash,
      };
    } catch (swapError: any) {
      console.error(`[process-swaps] Swap error:`, swapError?.message);
      
      // Fallback: If swap fails, refund to recipient in original token
      console.log(`[process-swaps] Swap failed, refunding original token to recipient`);
      
      const calls: any[] = [];
      
      if (data.fromToken === "ETH") {
        calls.push({
          to: data.recipientAddress,
          value: amountAfterFee,
          data: "0x",
        });
      } else {
        const tokenAddress = TOKEN_ADDRESSES[data.chainId]?.[data.fromToken];
        if (tokenAddress) {
          calls.push({
            to: tokenAddress,
            value: BigInt(0),
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [data.recipientAddress as Address, amountAfterFee],
            }),
          });
        }
      }
      
      const orchestrator = await sdk.getOrchestrator({ chainId: data.chainId });
      const bundle = await orchestrator.encodeExecutionBundle({
        account: companionAccount,
        calls,
        signer: account,
      });
      
      const refundTxHash = await orchestrator.sendTransaction(bundle);
      console.log(`[process-swaps] Refund TX hash:`, refundTxHash);
      
      return {
        success: false,
        transferTxHash: refundTxHash,
        error: `Swap failed: ${swapError?.message}. Refunded original token.`,
      };
    }
    
  } catch (e: any) {
    console.error(`[process-swaps] Execute error:`, e);
    return { success: false, error: e?.message };
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  console.log("[process-swaps] Cron job started");
  
  try {
    const redis = await getRedis();
    const supabase = getSupabaseAdmin();
    
    // Get all pending swaps
    const pendingKeys = await redis.sMembers(SWAP_PENDING_KEY);
    console.log(`[process-swaps] Found ${pendingKeys.length} pending swaps`);
    
    const results: any[] = [];
    
    for (const redisKey of pendingKeys) {
      try {
        const dataStr = await redis.get(redisKey);
        if (!dataStr) {
          await redis.sRem(SWAP_PENDING_KEY, redisKey);
          continue;
        }
        
        const data: SwapCompanionData = JSON.parse(dataStr);
        console.log(`[process-swaps] Processing claim ${data.claimId}, status: ${data.status}`);
        
        // Skip if already completed or failed
        if (data.status === "completed" || data.status === "failed") {
          await redis.sRem(SWAP_PENDING_KEY, redisKey);
          continue;
        }
        
        // Process with distributed lock to prevent concurrent processing
        const lockKey = `swap:${data.claimId}`;
        const processed = await withLock(lockKey, async () => {
          // Re-read data after acquiring lock
          const freshDataStr = await redis.get(redisKey);
          if (!freshDataStr) return null;
          const freshData: SwapCompanionData = JSON.parse(freshDataStr);
          
          // IDEMPOTENCY: Check if already has transaction hash
          if (freshData.transferTxHash) {
            console.log(`[process-swaps] Claim ${freshData.claimId} already processed with TX ${freshData.transferTxHash}`);
            freshData.status = "completed";
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            return { claimId: freshData.claimId, status: "completed" as const, txHash: freshData.transferTxHash };
          }
          
          // Check if expired (24 hours)
          if (Date.now() - freshData.createdAt > 24 * 60 * 60 * 1000) {
            console.log(`[process-swaps] Claim ${freshData.claimId} expired`);
            freshData.status = "failed";
            freshData.error = "Expired - no deposit received within 24 hours";
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            
            await supabase.from("claims").update({ 
              status: "EXPIRED",
            }).eq("id", freshData.claimId);
            
            return { claimId: freshData.claimId, status: "expired" as const };
          }
          
          // Check balance
          const balance = await getTokenBalance(freshData.companionAddress, freshData.fromToken, freshData.chainId);
          console.log(`[process-swaps] Balance for ${freshData.claimId}: ${balance.formatted} ${freshData.fromToken}`);
          
          // If no balance yet, skip
          if (balance.raw === BigInt(0)) {
            return { claimId: freshData.claimId, status: "waiting_for_deposit" as const, balance: "0" };
          }
          
          // Update status to funded
          freshData.status = "funded";
          freshData.amountReceived = balance.formatted;
          freshData.updatedAt = Date.now();
          await redis.set(redisKey, JSON.stringify(freshData));
          
          // Update status to swapping
          freshData.status = "swapping";
          freshData.updatedAt = Date.now();
          await redis.set(redisKey, JSON.stringify(freshData));
          
          const result = await executeSwapAndTransfer(freshData);
          
          if (result.success) {
            freshData.status = "completed";
            freshData.swapTxHash = result.swapTxHash;
            freshData.transferTxHash = result.transferTxHash;
            
            await supabase.from("claims").update({ 
              status: "COMPLETED",
            }).eq("id", freshData.claimId);
            
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            
            return { 
              claimId: freshData.claimId, 
              status: "completed" as const, 
              txHash: result.transferTxHash,
            };
          } else {
            freshData.status = "failed";
            freshData.error = result.error;
            freshData.transferTxHash = result.transferTxHash;
            
            await supabase.from("claims").update({ 
              status: "FAILED",
            }).eq("id", freshData.claimId);
            
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            
            return { 
              claimId: freshData.claimId, 
              status: "failed" as const, 
              error: result.error,
            };
          }
        }, 300); // 5 minute lock
        
        if (processed) {
          results.push(processed);
        }
        
      } catch (e: any) {
        console.error(`[process-swaps] Error processing ${redisKey}:`, e);
        results.push({ key: redisKey, error: e?.message });
      }
    }
    
    console.log(`[process-swaps] Cron job completed. Results:`, results);
    
    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
    });
    
  } catch (e: any) {
    console.error("[process-swaps] Cron error:", e);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

