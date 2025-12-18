/**
 * Cron Job: Process Pending Payments
 * 
 * This runs every minute to check if any companion wallets have received funds
 * and automatically executes the purchase transaction.
 * 
 * Vercel Cron: Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/process-payments",
 *     "schedule": "* * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { privateKeyToAccount } from "viem/accounts";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { RHINESTONE_API_KEY } from "@/config/rhinestone";
import { encodeTicketPurchase, getTicketAutomatorAddress } from "@/services/lottery";
import { base } from "viem/chains";
import { withLock } from "@/lib/redis-lock";

// Redis client
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

// Constants
const TICKET_AUTOMATOR_CONTRACT = getTicketAutomatorAddress();
const MIN_ETH_FOR_CONTRACT = 0.0035;
const GAS_FOR_REFUND = 0.0002;

// Redis key prefixes (must match companion API)
const PENDING_WALLETS_KEY = "companion:pending";
const SIGNER_KEY_PREFIX = "companion:signer:";
const PAYMENT_LOG_PREFIX = "companion:payment:";

type SignerData = {
  privateKey: string;
  recipientAddress: string;
  companionAddress: string;
  createdAt: number;
  numTickets?: number;
  totalCostETH?: string;
};

// Minimal shape of a payment log for idempotency checks
type PaymentLog = {
  status: "pending" | "funded" | "executed" | "refunded" | "failed";
  txHash?: string;
  refundTxHash?: string;
};

// Get SDK instance
function getSDK(): RhinestoneSDK {
  if (!RHINESTONE_API_KEY) {
    throw new Error("Missing RHINESTONE_API_KEY");
  }
  return new RhinestoneSDK({ apiKey: RHINESTONE_API_KEY });
}

// Get companion wallet balance
async function getCompanionBalance(address: string): Promise<{ eth: string; ethWei: string }> {
  const rpcUrl = "https://mainnet.base.org";
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
  return { eth: balanceEth, ethWei: BigInt(balanceWei).toString() };
}

// Update payment log
async function updatePaymentLog(redis: ReturnType<typeof createClient>, id: string, updates: Record<string, any>): Promise<void> {
  const existingStr = await redis.get(`${PAYMENT_LOG_PREFIX}${id}`);
  if (existingStr) {
    const existing = JSON.parse(existingStr);
    await redis.set(`${PAYMENT_LOG_PREFIX}${id}`, JSON.stringify({
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }));
  }
}

/**
 * Process a single pending wallet
 */
async function processPendingWallet(
  redis: ReturnType<typeof createClient>,
  redisKey: string
): Promise<{
  status: "executed" | "refunded" | "waiting" | "expired" | "failed";
  txHash?: string;
  error?: string;
  recipientAddress?: string;
}> {
  
  // Get signer data
  const signerDataStr = await redis.get(redisKey);
  if (!signerDataStr) {
    console.log("[Cron] No signer data for key:", redisKey);
    return { status: "failed", error: "No signer data" };
  }

  const signerData: SignerData = JSON.parse(signerDataStr);
  const { recipientAddress, companionAddress, numTickets = 1, totalCostETH, createdAt } = signerData;
  const requiredEth = totalCostETH ? parseFloat(totalCostETH) : MIN_ETH_FOR_CONTRACT;
  
  console.log("[Cron] Processing wallet for:", recipientAddress);
  console.log("[Cron]   Companion:", companionAddress);
  console.log("[Cron]   Required:", requiredEth, "ETH");
  console.log("[Cron]   Tickets:", numTickets);

  // Check if payment is too old (24 hours)
  if (Date.now() - createdAt > 24 * 60 * 60 * 1000) {
    console.log("[Cron]   Payment expired (>24h)");
    return { status: "expired", recipientAddress };
  }

  try {
    // Check balance
    const balance = await getCompanionBalance(companionAddress);
    const balanceEth = parseFloat(balance.eth);

    console.log("[Cron]   Current balance:", balanceEth, "ETH");

    // Not enough funds yet - keep waiting
    if (balanceEth < 0.0001) {
      console.log("[Cron]   No funds yet, skipping");
      return { status: "waiting", recipientAddress };
    }

    const signerAccount = privateKeyToAccount(signerData.privateKey as `0x${string}`);
    const sdk = getSDK();

    // Recreate companion account
    const dummyOwner = {
      address: recipientAddress as `0x${string}`,
      type: "local" as const,
      publicKey: "0x" as `0x${string}`,
      source: "custom" as const,
      signMessage: async () => { throw new Error("Not used"); },
      signTransaction: async () => { throw new Error("Not used"); },
      signTypedData: async () => { throw new Error("Not used"); },
    };

    const companionAccount = await sdk.createAccount({
      account: { type: "nexus" },
      owners: {
        type: "ecdsa",
        accounts: [dummyOwner as any, signerAccount],
        threshold: 1,
      },
    });

  const key = recipientAddress.toLowerCase();
  const paymentId = `${key}_${createdAt}`;

  // IDEMPOTENCY CHECK: Check if already processed
  const existingLogStr = await redis.get(`${PAYMENT_LOG_PREFIX}${paymentId}`);
  if (existingLogStr) {
    const existingLog: PaymentLog = JSON.parse(existingLogStr);
    if (existingLog.status === "executed" && existingLog.txHash) {
      console.log(`[Cron] Payment ${paymentId} already executed with TX ${existingLog.txHash}, skipping`);
      return { status: "executed", txHash: existingLog.txHash, recipientAddress };
    }
    if (existingLog.status === "refunded" && existingLog.refundTxHash) {
      console.log(`[Cron] Payment ${paymentId} already refunded with TX ${existingLog.refundTxHash}, skipping`);
      return { status: "refunded", txHash: existingLog.refundTxHash, recipientAddress };
    }
  }

  // INSUFFICIENT FUNDS - Refund
  if (balanceEth < requiredEth) {
      console.log("[Cron] ⚠️ Insufficient balance, refunding");
      console.log("[Cron]   Has:", balanceEth, "ETH, needs:", requiredEth, "ETH");
      
      const refundAmount = balanceEth - GAS_FOR_REFUND;
      if (refundAmount <= 0) {
        await updatePaymentLog(redis, paymentId, { status: "failed", error: "Balance too low for refund" });
        return { status: "failed", error: "Balance too low for refund", recipientAddress };
      }

      const refundWei = BigInt(Math.floor(refundAmount * 1e18));

      const refundTx = await companionAccount.sendTransaction({
        chain: base,
        calls: [{
          to: recipientAddress as `0x${string}`,
          value: refundWei,
          data: "0x" as `0x${string}`,
        }],
        signers: {
          type: "owner",
          kind: "ecdsa",
          accounts: [signerAccount as any],
        },
      });

      const refundResult = await companionAccount.waitForExecution(refundTx);
      const refundTxHash = (refundResult as any)?.transactionHash || "";

      console.log("[Cron] ✓ Refund complete:", refundTxHash);

      await updatePaymentLog(redis, paymentId, { status: "refunded", refundTxHash });

      return { status: "refunded", txHash: refundTxHash, recipientAddress };
    }

    // SUFFICIENT FUNDS - Execute purchase
    console.log("[Cron] ✓ Sufficient balance, executing purchase");

    // Calculate ETH to send (balance minus small gas buffer)
    const ethToSend = balanceEth - 0.0002; // Keep tiny amount for gas
    const ethAmountWei = BigInt(Math.floor(ethToSend * 1e18));

    // Encode contract call
    const calldata = encodeTicketPurchase(recipientAddress, numTickets);

    const transaction = await companionAccount.sendTransaction({
      chain: base,
      calls: [{
        to: TICKET_AUTOMATOR_CONTRACT as `0x${string}`,
        value: ethAmountWei,
        data: calldata as `0x${string}`,
      }],
      signers: {
        type: "owner",
        kind: "ecdsa",
        accounts: [signerAccount as any],
      },
    });

    const result = await companionAccount.waitForExecution(transaction);
    const txHash = (result as any)?.transactionHash || "";

    console.log("[Cron] ✓ Purchase executed:", txHash);

    await updatePaymentLog(redis, paymentId, { status: "executed", txHash });

    return { status: "executed", txHash, recipientAddress };

  } catch (error: any) {
    console.error("[Cron] Error processing wallet:", error);
    return { status: "failed", error: error?.message, recipientAddress };
  }
}

/**
 * GET /api/cron/process-payments
 * Called by Vercel Cron every minute
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (optional but recommended)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron] ========================================");
  console.log("[Cron] Starting payment processing...");
  console.log("[Cron] Time:", new Date().toISOString());

  try {
    const redis = await getRedis();
    
    // Get all pending wallet keys from the SET
    const pendingKeys = await redis.sMembers(PENDING_WALLETS_KEY);
    
    if (!pendingKeys || pendingKeys.length === 0) {
      console.log("[Cron] No pending wallets");
      return NextResponse.json({ 
        success: true, 
        message: "No pending wallets",
        processed: 0 
      });
    }

    console.log("[Cron] Found", pendingKeys.length, "pending wallets");

    const results = {
      processed: 0,
      executed: 0,
      refunded: 0,
      waiting: 0,
      expired: 0,
      failed: 0,
      details: [] as any[],
    };

    // Process each pending wallet with distributed lock to prevent double processing
    for (const redisKey of pendingKeys) {
      results.processed++;

      // Use distributed lock to prevent concurrent processing
      const lockKey = `payment:${redisKey}`;
      const result = await withLock(lockKey, async () => {
        // Double-check: verify still in pending set (another instance might have processed it)
        const stillPending = await redis.sIsMember(PENDING_WALLETS_KEY, redisKey);
        if (!stillPending) {
          console.log(`[Cron] ${redisKey} already processed by another instance, skipping`);
          return { status: "waiting" as const, recipientAddress: undefined };
        }

        return await processPendingWallet(redis, redisKey);
      }, 300); // 5 minute lock

      if (!result) {
        // Lock not acquired - another instance is processing
        results.waiting++;
        continue;
      }

      results.details.push({
        key: redisKey,
        ...result,
      });

      // Remove from pending set if processed (not waiting)
      // Only remove if we successfully processed it (not if lock failed)
      if (result.status !== "waiting") {
        await redis.sRem(PENDING_WALLETS_KEY, redisKey);
        // Also delete the signer data
        await redis.del(redisKey);
      }

      // Count results
      if (result.status === "executed") results.executed++;
      else if (result.status === "refunded") results.refunded++;
      else if (result.status === "waiting") results.waiting++;
      else if (result.status === "expired") results.expired++;
      else results.failed++;
    }

    console.log("[Cron] ========================================");
    console.log("[Cron] Processing complete:");
    console.log("[Cron]   Processed:", results.processed);
    console.log("[Cron]   Executed:", results.executed);
    console.log("[Cron]   Refunded:", results.refunded);
    console.log("[Cron]   Waiting:", results.waiting);
    console.log("[Cron]   Expired:", results.expired);
    console.log("[Cron]   Failed:", results.failed);

    return NextResponse.json({
      success: true,
      ...results,
    });

  } catch (error: any) {
    console.error("[Cron] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Cron job failed" },
      { status: 500 }
    );
  }
}
