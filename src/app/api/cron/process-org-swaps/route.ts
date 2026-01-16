/**
 * Cron Job: Process Pending Organization Same-Chain Swaps
 * 
 * This endpoint is called periodically by Vercel Cron to:
 * 1. Check pending organization companion wallets for deposits
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
    redisClient = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    await redisClient.connect();
  }
  return redisClient;
}

// Redis keys - MUST match companion-swap route.ts
const SWAP_COMPANION_PREFIX = "org_swap_companion:";
const SWAP_PENDING_KEY = "org_swap_pending";

// Token addresses per chain
const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  [mainnet.id]: {
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  [base.id]: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  [optimism.id]: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  },
  [arbitrum.id]: {
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  [polygon.id]: {
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
};

// Chain configs for viem
const CHAIN_CONFIGS: Record<number, any> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [optimism.id]: optimism,
  [arbitrum.id]: arbitrum,
  [polygon.id]: polygon,
  [zkSync.id]: zkSync,
};

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
  
  if (!rpcUrl || !chain) {
    throw new Error(`Chain ${chainId} not supported`);
  }
  
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  
  console.log(`[process-org-swaps] Checking balance for ${address} on chain ${chainId}, token: ${tokenSymbol}`);
  
  if (tokenSymbol === "ETH") {
    const balance = await client.getBalance({ address: address as Address });
    const formatted = formatEther(balance);
    console.log(`[process-org-swaps] ETH balance: ${formatted} ETH`);
    return { formatted, raw: balance };
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
  
  const formatted = formatUnits(balance, decimals);
  console.log(`[process-org-swaps] ${tokenSymbol} balance: ${formatted} ${tokenSymbol}`);
  return { formatted, raw: balance };
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
    console.log(`[process-org-swaps] =========================================`);
    console.log(`[process-org-swaps] Executing swap for org ${data.organizationId}`);
    console.log(`[process-org-swaps] Companion address: ${data.companionAddress}`);
    console.log(`[process-org-swaps] From: ${data.fromToken} → To: ${data.toToken}`);
    console.log(`[process-org-swaps] Recipient: ${data.recipientAddress}`);
    console.log(`[process-org-swaps] Chain ID: ${data.chainId}`);
    
    const sdk = new RhinestoneSDK({ apiKey: RHINESTONE_API_KEY || "" }) as any;
    const account = privateKeyToAccount(data.companionPrivateKey as `0x${string}`);
    
    // Create companion wallet account via Rhinestone
    console.log(`[process-org-swaps] Creating companion account...`);
    const companionAccount = await sdk.getCompanionAccount({
      signerAddress: account.address,
      chainId: data.chainId,
    });
    
    console.log(`[process-org-swaps] Companion account created: ${companionAccount.address}`);
    
    // Check balance
    const balance = await getTokenBalance(data.companionAddress, data.fromToken, data.chainId);
    console.log(`[process-org-swaps] Current balance: ${balance.formatted} ${data.fromToken} (raw: ${balance.raw.toString()})`);
    
    if (balance.raw === BigInt(0)) {
      console.log(`[process-org-swaps] No balance received yet`);
      return { success: false, error: "No balance received" };
    }
    
    // Calculate amounts
    const feePercent = LOOFTA_FEE_PERCENT;
    const feeAmount = (balance.raw * BigInt(Math.floor(feePercent * 10000))) / BigInt(10000);
    const amountAfterFee = balance.raw - feeAmount;
    
    console.log(`[process-org-swaps] Fee calculation:`);
    console.log(`[process-org-swaps]   Fee percent: ${feePercent * 100}%`);
    console.log(`[process-org-swaps]   Fee amount: ${formatUnits(feeAmount, data.fromDecimals)} ${data.fromToken}`);
    console.log(`[process-org-swaps]   Amount after fee: ${formatUnits(amountAfterFee, data.fromDecimals)} ${data.fromToken}`);
    
    // If same token, just transfer directly
    if (data.fromToken === data.toToken) {
      console.log(`[process-org-swaps] Same token - direct transfer`);
      
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
      console.log(`[process-org-swaps] Executing transfer via Rhinestone...`);
      const orchestrator = await sdk.getOrchestrator({ chainId: data.chainId });
      const bundle = await orchestrator.encodeExecutionBundle({
        account: companionAccount,
        calls,
        signer: account,
      });
      
      const txHash = await orchestrator.sendTransaction(bundle);
      console.log(`[process-org-swaps] ✅ Transfer TX hash: ${txHash}`);
      
      return { 
        success: true, 
        transferTxHash: txHash,
      };
    }
    
    // Different tokens - need to swap
    console.log(`[process-org-swaps] Different tokens - executing swap ${data.fromToken} → ${data.toToken}`);
    
    try {
      // Try using Rhinestone's built-in swap functionality
      console.log(`[process-org-swaps] Attempting swap via Rhinestone SDK...`);
      const swapResult = await sdk.swap({
        account: companionAccount,
        chainId: data.chainId,
        fromToken: data.fromToken === "ETH" ? "native" : (TOKEN_ADDRESSES[data.chainId]?.[data.fromToken] || ""),
        toToken: data.toToken === "ETH" ? "native" : (TOKEN_ADDRESSES[data.chainId]?.[data.toToken] || ""),
        amount: amountAfterFee.toString(),
        recipient: data.recipientAddress as Address,
        signer: account,
      });
      
      console.log(`[process-org-swaps] ✅ Swap result:`, swapResult);
      
      return {
        success: true,
        swapTxHash: swapResult.txHash,
        transferTxHash: swapResult.txHash,
      };
    } catch (swapError: any) {
      console.error(`[process-org-swaps] ❌ Swap error:`, swapError?.message);
      console.error(`[process-org-swaps] Swap error details:`, swapError);
      
      // Fallback: If swap fails, refund to recipient in original token
      console.log(`[process-org-swaps] Swap failed, refunding original token to recipient`);
      
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
      console.log(`[process-org-swaps] Refund TX hash: ${refundTxHash}`);
      
      return {
        success: false,
        transferTxHash: refundTxHash,
        error: `Swap failed: ${swapError?.message}. Refunded original token.`,
      };
    }
    
  } catch (e: any) {
    console.error(`[process-org-swaps] ❌ Execute error:`, e);
    console.error(`[process-org-swaps] Error stack:`, e?.stack);
    return { success: false, error: e?.message || "Unknown error" };
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret (optional in dev)
  const authHeader = request.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  
  if (!isDev && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    console.log("[process-org-swaps] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const startTime = Date.now();
  console.log("[process-org-swaps] =========================================");
  console.log("[process-org-swaps] Cron job started at", new Date().toISOString());
  
  try {
    const redis = await getRedis();
    
    // Get all pending swaps
    const pendingKeys = await redis.sMembers(SWAP_PENDING_KEY);
    console.log(`[process-org-swaps] Found ${pendingKeys.length} pending organization swaps`);
    
    if (pendingKeys.length === 0) {
      console.log("[process-org-swaps] No pending swaps");
      return NextResponse.json({
        success: true,
        message: "No pending swaps",
        duration: Date.now() - startTime,
      });
    }
    
    const results: any[] = [];
    
    for (const redisKey of pendingKeys) {
      try {
        console.log(`[process-org-swaps] -----------------------------------------`);
        console.log(`[process-org-swaps] Processing key: ${redisKey}`);
        
        const dataStr = await redis.get(redisKey);
        if (!dataStr) {
          console.log(`[process-org-swaps] Key expired or deleted, removing from pending`);
          await redis.sRem(SWAP_PENDING_KEY, redisKey);
          continue;
        }
        
        const data: SwapCompanionData = JSON.parse(dataStr);
        console.log(`[process-org-swaps] Organization ID: ${data.organizationId}`);
        console.log(`[process-org-swaps] Status: ${data.status}`);
        console.log(`[process-org-swaps] Created: ${new Date(data.createdAt).toISOString()}`);
        console.log(`[process-org-swaps] Updated: ${new Date(data.updatedAt).toISOString()}`);
        
        // Skip if already completed or failed
        if (data.status === "completed" || data.status === "failed") {
          console.log(`[process-org-swaps] Already ${data.status}, removing from pending`);
          await redis.sRem(SWAP_PENDING_KEY, redisKey);
          continue;
        }
        
        // Process with distributed lock to prevent concurrent processing
        const lockKey = `org_swap:${data.organizationId}:${data.createdAt}`;
        const processed = await withLock(lockKey, async () => {
          // Re-read data after acquiring lock
          const freshDataStr = await redis.get(redisKey);
          if (!freshDataStr) {
            console.log(`[process-org-swaps] Data not found after lock acquisition`);
            return null;
          }
          const freshData: SwapCompanionData = JSON.parse(freshDataStr);
          
          // IDEMPOTENCY: Check if already has transaction hash
          if (freshData.transferTxHash) {
            console.log(`[process-org-swaps] Already processed with TX ${freshData.transferTxHash}`);
            freshData.status = "completed";
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            return { organizationId: freshData.organizationId, status: "completed" as const, txHash: freshData.transferTxHash };
          }
          
          // Check if expired (24 hours)
          const age = Date.now() - freshData.createdAt;
          const maxAge = 24 * 60 * 60 * 1000; // 24 hours
          if (age > maxAge) {
            console.log(`[process-org-swaps] Expired (age: ${Math.floor(age / 1000 / 60)} minutes)`);
            freshData.status = "failed";
            freshData.error = "Expired - no deposit received within 24 hours";
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            return { organizationId: freshData.organizationId, status: "expired" as const };
          }
          
          // Check balance
          console.log(`[process-org-swaps] Checking balance for ${freshData.companionAddress}...`);
          const balance = await getTokenBalance(freshData.companionAddress, freshData.fromToken, freshData.chainId);
          console.log(`[process-org-swaps] Balance: ${balance.formatted} ${freshData.fromToken} (raw: ${balance.raw.toString()})`);
          
          // If no balance yet, skip
          if (balance.raw === BigInt(0)) {
            console.log(`[process-org-swaps] No balance yet, waiting...`);
            return { organizationId: freshData.organizationId, status: "waiting_for_deposit" as const, balance: "0" };
          }
          
          // Update status to funded
          freshData.status = "funded";
          freshData.amountReceived = balance.formatted;
          freshData.updatedAt = Date.now();
          await redis.set(redisKey, JSON.stringify(freshData));
          console.log(`[process-org-swaps] Status updated to: funded`);
          
          // Update status to swapping
          freshData.status = "swapping";
          freshData.updatedAt = Date.now();
          await redis.set(redisKey, JSON.stringify(freshData));
          console.log(`[process-org-swaps] Status updated to: swapping`);
          
          const result = await executeSwapAndTransfer(freshData);
          
          if (result.success) {
            freshData.status = "completed";
            freshData.swapTxHash = result.swapTxHash;
            freshData.transferTxHash = result.transferTxHash;
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            
            console.log(`[process-org-swaps] ✅ Swap completed successfully!`);
            console.log(`[process-org-swaps] TX hash: ${result.transferTxHash}`);
            
            return { 
              organizationId: freshData.organizationId, 
              status: "completed" as const, 
              txHash: result.transferTxHash,
            };
          } else {
            freshData.status = "failed";
            freshData.error = result.error;
            freshData.transferTxHash = result.transferTxHash;
            freshData.updatedAt = Date.now();
            await redis.set(redisKey, JSON.stringify(freshData));
            await redis.sRem(SWAP_PENDING_KEY, redisKey);
            
            console.log(`[process-org-swaps] ❌ Swap failed: ${result.error}`);
            
            return { 
              organizationId: freshData.organizationId, 
              status: "failed" as const, 
              error: result.error,
            };
          }
        }, 300); // 5 minute lock
        
        if (processed) {
          results.push(processed);
        }
        
      } catch (e: any) {
        console.error(`[process-org-swaps] ❌ Error processing ${redisKey}:`, e);
        console.error(`[process-org-swaps] Error stack:`, e?.stack);
        results.push({ key: redisKey, error: e?.message });
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[process-org-swaps] =========================================`);
    console.log(`[process-org-swaps] Cron job completed in ${duration}ms`);
    console.log(`[process-org-swaps] Processed: ${results.length} swaps`);
    console.log(`[process-org-swaps] Results:`, JSON.stringify(results, null, 2));
    
    return NextResponse.json({
      success: true,
      processed: results.length,
      duration,
      results,
    });
    
  } catch (e: any) {
    console.error("[process-org-swaps] ❌ Cron error:", e);
    console.error("[process-org-swaps] Error stack:", e?.stack);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
