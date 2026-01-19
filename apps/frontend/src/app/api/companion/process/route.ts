/**
 * Companion Wallet Background Processor
 * 
 * This endpoint is called by Vercel Cron to process pending companion wallets.
 * It checks all pending wallets, and if funded, executes the transaction automatically.
 * 
 * Cron schedule: Every 1 minute
 * 
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/companion/process",
 *     "schedule": "* * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { RHINESTONE_API_KEY } from "@/config/rhinestone";
import { createClient } from "redis";
import { encodeTicketPurchase, getTicketAutomatorAddress } from "@/services/lottery";

// Redis client singleton
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
const TICKET_PRICE_ETH = 0.0034; // ~$9.95 at $2900 ETH

// Redis key prefixes
const SIGNER_KEY_PREFIX = "companion:signer:";
const PENDING_WALLETS_KEY = "companion:pending"; // Set of pending wallet redis keys
const PAYMENT_LOG_PREFIX = "companion:payment:";

// Types
type SignerData = {
  privateKey: string;
  recipientAddress: string;
  companionAddress: string;
  createdAt: number;
  numTickets?: number;
};

type PaymentLog = {
  id: string;
  recipientAddress: string;
  companionAddress: string;
  status: "pending" | "funded" | "executed" | "refunded" | "failed";
  amountReceived?: string;
  amountRequired?: string;
  txHash?: string;
  refundTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

// Get SDK instance
function getSDK(): RhinestoneSDK {
  if (!RHINESTONE_API_KEY) {
    throw new Error("Missing RHINESTONE_API_KEY");
  }
  return new RhinestoneSDK({ apiKey: RHINESTONE_API_KEY });
}

// Get companion wallet balance via RPC
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
async function updatePaymentLog(id: string, updates: Partial<PaymentLog>): Promise<void> {
  const redis = await getRedis();
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
 * Process a single pending companion wallet
 */
async function processPendingWallet(redisKey: string): Promise<{
  processed: boolean;
  status: "executed" | "refunded" | "waiting" | "error";
  txHash?: string;
  error?: string;
}> {
  const redis = await getRedis();
  
  // Get signer data
  const signerDataStr = await redis.get(redisKey);
  if (!signerDataStr) {
    console.log(`[Processor] No signer data for ${redisKey}, removing from pending`);
    await redis.sRem(PENDING_WALLETS_KEY, redisKey);
    return { processed: false, status: "error", error: "No signer data" };
  }

  const signerData: SignerData = JSON.parse(signerDataStr);
  const { companionAddress, privateKey, recipientAddress, numTickets = 1 } = signerData;
  const key = recipientAddress.toLowerCase();
  const paymentId = `${key}_${signerData.createdAt}`;

  // Check balance
  const balance = await getCompanionBalance(companionAddress);
  const balanceEth = parseFloat(balance.eth);
  const requiredEth = MIN_ETH_FOR_CONTRACT;

  console.log(`[Processor] Checking ${companionAddress}:`);
  console.log(`[Processor]   Balance: ${balanceEth} ETH`);
  console.log(`[Processor]   Required: ${requiredEth} ETH`);

  // Not funded yet - skip
  if (balanceEth < 0.0001) {
    console.log(`[Processor]   Status: Waiting for funds`);
    return { processed: false, status: "waiting" };
  }

  // Has some funds - process
  const signerAccount = privateKeyToAccount(privateKey as `0x${string}`);
  const sdk = getSDK();

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

  const { base } = await import("viem/chains");

  // Insufficient for contract - REFUND
  if (balanceEth < requiredEth) {
    console.log(`[Processor]   Insufficient balance - REFUNDING`);
    
    const refundAmount = balanceEth - GAS_FOR_REFUND;
    if (refundAmount <= 0) {
      console.log(`[Processor]   Balance too low even for refund`);
      await updatePaymentLog(paymentId, { status: "failed", error: "Balance too low for refund" });
      await redis.sRem(PENDING_WALLETS_KEY, redisKey);
      await redis.del(redisKey);
      return { processed: true, status: "error", error: "Balance too low for refund" };
    }

    const refundWei = BigInt(Math.floor(refundAmount * 1e18));

    try {
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

      console.log(`[Processor]   ✓ Refunded ${refundAmount.toFixed(6)} ETH, TX: ${refundTxHash}`);

      await updatePaymentLog(paymentId, { status: "refunded", refundTxHash });
      await redis.sRem(PENDING_WALLETS_KEY, redisKey);
      await redis.del(redisKey);

      return { processed: true, status: "refunded", txHash: refundTxHash };
    } catch (error: any) {
      console.error(`[Processor]   ✗ Refund failed:`, error?.message);
      await updatePaymentLog(paymentId, { status: "failed", error: error?.message });
      return { processed: false, status: "error", error: error?.message };
    }
  }

  // Sufficient balance - EXECUTE CONTRACT CALL
  console.log(`[Processor]   Sufficient balance - EXECUTING`);

  try {
    // Encode the contract call
    const calldata = encodeTicketPurchase(recipientAddress, numTickets);
    const ethAmountWei = BigInt(Math.floor(TICKET_PRICE_ETH * numTickets * 1e18));

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

    console.log(`[Processor]   ✓ Executed! TX: ${txHash}`);

    await updatePaymentLog(paymentId, { status: "executed", txHash });
    await redis.sRem(PENDING_WALLETS_KEY, redisKey);
    await redis.del(redisKey);

    return { processed: true, status: "executed", txHash };
  } catch (error: any) {
    console.error(`[Processor]   ✗ Execution failed:`, error?.message);
    await updatePaymentLog(paymentId, { status: "failed", error: error?.message });
    return { processed: false, status: "error", error: error?.message };
  }
}

/**
 * GET /api/companion/process
 * Called by Vercel Cron every minute to process pending wallets
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (optional but recommended)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow in development
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startTime = Date.now();
  console.log("[Processor] ========================================");
  console.log("[Processor] Starting background processing...");

  try {
    const redis = await getRedis();
    
    // Get all pending wallet keys from the SET
    const pendingKeys = await redis.sMembers(PENDING_WALLETS_KEY);
    
    if (!pendingKeys || pendingKeys.length === 0) {
      console.log("[Processor] No pending wallets to process");
      return NextResponse.json({
        success: true,
        processed: 0,
        duration: Date.now() - startTime,
      });
    }

    console.log(`[Processor] Found ${pendingKeys.length} pending wallet(s)`);

    const results = {
      executed: 0,
      refunded: 0,
      waiting: 0,
      errors: 0,
    };

    // Process each pending wallet
    for (const redisKey of pendingKeys) {
      try {
        const result = await processPendingWallet(redisKey);
        results[result.status === "executed" ? "executed" : 
               result.status === "refunded" ? "refunded" :
               result.status === "waiting" ? "waiting" : "errors"]++;
      } catch (error: any) {
        console.error(`[Processor] Error processing ${redisKey}:`, error?.message);
        results.errors++;
      }
    }

    const duration = Date.now() - startTime;
    console.log("[Processor] ========================================");
    console.log(`[Processor] Completed in ${duration}ms`);
    console.log(`[Processor] Results:`, results);

    return NextResponse.json({
      success: true,
      ...results,
      total: pendingKeys.length,
      duration,
    });
  } catch (error: any) {
    console.error("[Processor] Fatal error:", error);
    return NextResponse.json(
      { error: error?.message || "Processing failed" },
      { status: 500 }
    );
  }
}

