/**
 * Cron Job: Process Companion Wallets
 * 
 * Runs every minute to check pending companion wallets and
 * automatically execute transactions when funds arrive.
 * 
 * This ensures purchases complete even if the user closes their browser.
 * 
 * Vercel Cron: Add to vercel.json
 * {
 *   "crons": [{
 *     "path": "/api/cron/process-companions",
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

// Verify cron secret to prevent unauthorized calls
const CRON_SECRET = process.env.CRON_SECRET;

// Redis key prefixes (same as companion route)
const SIGNER_KEY_PREFIX = "companion:signer:";
const PAYMENT_LOG_PREFIX = "companion:payment:";
const PENDING_WALLETS_KEY = "companion:pending"; // List of pending wallet keys

// Contract and pricing
const TICKET_AUTOMATOR_CONTRACT = getTicketAutomatorAddress();
const TICKET_PRICE_ETH = 0.0034; // ~$10 worth of ETH
const GAS_BUFFER_ETH = 0.0001; // Gas for contract call
const MIN_BALANCE_FOR_PURCHASE = TICKET_PRICE_ETH + GAS_BUFFER_ETH;

// Types
type SignerData = {
  privateKey: string;
  recipientAddress: string;
  companionAddress: string;
  createdAt: number;
  numTickets?: number;
  totalCostETH?: string;
};

type PaymentLog = {
  id: string;
  recipientAddress: string;
  companionAddress: string;
  status: "pending" | "funded" | "executing" | "executed" | "refunded" | "failed";
  amountReceived?: string;
  amountRequired?: string;
  txHash?: string;
  refundTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

// Redis client
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

// Get SDK instance
function getSDK(): RhinestoneSDK {
  if (!RHINESTONE_API_KEY) {
    throw new Error("Missing RHINESTONE_API_KEY");
  }
  return new RhinestoneSDK({ apiKey: RHINESTONE_API_KEY });
}

// Get companion wallet balance via RPC
async function getCompanionBalance(address: string): Promise<{ eth: number; ethWei: string }> {
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
  const balanceEth = parseInt(balanceWei, 16) / 1e18;
  return { eth: balanceEth, ethWei: BigInt(balanceWei).toString() };
}

// Update payment log
async function updatePaymentLog(redis: ReturnType<typeof createClient>, id: string, updates: Partial<PaymentLog>): Promise<void> {
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
 * GET /api/cron/process-companions
 * Called by Vercel Cron every minute
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify cron secret (Vercel adds this header)
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    console.log("[Cron] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron] =========================================");
  console.log("[Cron] Processing companion wallets...");
  console.log("[Cron] Time:", new Date().toISOString());

  const results = {
    checked: 0,
    executed: 0,
    refunded: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    const redis = await getRedis();
    
    // Get all pending wallet keys
    const pendingKeys = await redis.sMembers(PENDING_WALLETS_KEY);
    console.log("[Cron] Found", pendingKeys.length, "pending wallets");

    if (pendingKeys.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending wallets",
        duration: Date.now() - startTime,
      });
    }

    const { base } = await import("viem/chains");
    const sdk = getSDK();

    for (const redisKey of pendingKeys) {
      results.checked++;
      
      try {
        // Get signer data
        const signerDataStr = await redis.get(redisKey);
        if (!signerDataStr) {
          // Key expired or deleted, remove from pending
          await redis.sRem(PENDING_WALLETS_KEY, redisKey);
          results.skipped++;
          continue;
        }

        const signerData: SignerData = JSON.parse(signerDataStr);
        const { companionAddress, recipientAddress, privateKey, numTickets = 1, totalCostETH } = signerData;
        const paymentId = `${recipientAddress.toLowerCase()}_${signerData.createdAt}`;

        console.log("[Cron] Checking:", companionAddress);
        console.log("[Cron]   Recipient:", recipientAddress);

        // Check balance
        const balance = await getCompanionBalance(companionAddress);
        const requiredEth = totalCostETH ? parseFloat(totalCostETH) : MIN_BALANCE_FOR_PURCHASE * numTickets;

        console.log("[Cron]   Balance:", balance.eth.toFixed(6), "ETH");
        console.log("[Cron]   Required:", requiredEth.toFixed(6), "ETH");

        // Not enough funds yet - skip
        if (balance.eth < requiredEth * 0.95) { // 5% tolerance
          console.log("[Cron]   Status: Waiting for funds");
          results.skipped++;
          continue;
        }

        // Has funds - execute purchase!
        console.log("[Cron]   Status: FUNDED - Executing purchase!");

        // Update status to executing
        await updatePaymentLog(redis, paymentId, {
          status: "executing",
          amountReceived: balance.eth.toFixed(8),
        });

        // Create companion account
        const signerAccount = privateKeyToAccount(privateKey as `0x${string}`);
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

        // Encode contract call
        const calldata = encodeTicketPurchase(recipientAddress, numTickets);
        const ethAmountWei = BigInt(Math.floor(requiredEth * 0.95 * 1e18)); // Leave some for gas

        // Execute transaction
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

        console.log("[Cron]   ✓ EXECUTED! TX:", txHash);

        // Update payment log
        await updatePaymentLog(redis, paymentId, {
          status: "executed",
          txHash,
        });

        // Remove from pending list and delete signer
        await redis.sRem(PENDING_WALLETS_KEY, redisKey);
        await redis.del(redisKey);

        results.executed++;

      } catch (error: any) {
        console.error("[Cron] Error processing wallet:", error?.message);
        results.errors++;
        
        // Don't remove from pending - will retry next minute
      }
    }

    const duration = Date.now() - startTime;
    console.log("[Cron] =========================================");
    console.log("[Cron] Complete! Duration:", duration, "ms");
    console.log("[Cron] Results:", results);

    return NextResponse.json({
      success: true,
      results,
      duration,
    });

  } catch (error: any) {
    console.error("[Cron] Fatal error:", error);
    return NextResponse.json(
      { error: error?.message || "Cron job failed" },
      { status: 500 }
    );
  }
}

