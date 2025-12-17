/**
 * Companion Wallet API
 * 
 * Server-side management of companion wallets for widget use.
 * Uses Redis for:
 * - Signer key storage
 * - Payment history logging
 * 
 * This enables:
 * - Widget use across domains (no localStorage dependency)
 * - Secure signer key storage
 * - No user wallet signing required
 * - Auto-refund when insufficient funds
 * 
 * Setup: Add REDIS_URL to your environment variables
 * e.g. REDIS_URL=redis://default:password@host:port
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { RHINESTONE_API_KEY } from "@/config/rhinestone";
import { createClient } from "redis";

// Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

// Minimum ETH needed for contract interaction (ticket price + gas)
const MIN_ETH_FOR_CONTRACT = 0.0035; // ~$10 at $2800 ETH + gas buffer
const GAS_FOR_REFUND = 0.0002; // Gas reserve for refund transaction

// Types for Redis storage
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
  status: "pending" | "funded" | "executed" | "refunded" | "failed";
  amountReceived?: string;
  amountRequired?: string;
  txHash?: string;
  refundTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

// Redis key prefixes
const SIGNER_KEY_PREFIX = "companion:signer:";
const PAYMENT_LOG_PREFIX = "companion:payment:";
const PAYMENT_LIST_KEY = "companion:payments";
const PENDING_WALLETS_KEY = "companion:pending"; // Set of pending wallet keys for cron job

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

// Save payment log
async function savePaymentLog(log: PaymentLog): Promise<void> {
  const redis = await getRedis();
  await redis.set(`${PAYMENT_LOG_PREFIX}${log.id}`, JSON.stringify(log));
  // Add to list for querying
  await redis.lPush(PAYMENT_LIST_KEY, log.id);
  // Keep only last 1000 payments
  await redis.lTrim(PAYMENT_LIST_KEY, 0, 999);
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
 * GET /api/companion?recipient=0x...&numTickets=1&totalCostETH=0.0035
 * Get or create companion wallet for a recipient address
 * 
 * Query params:
 * - recipient: EVM address where tickets will be minted
 * - numTickets: Number of tickets to purchase (optional, default 1)
 * - totalCostETH: Total ETH required for purchase (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recipientAddress = searchParams.get("recipient");
    const numTickets = parseInt(searchParams.get("numTickets") || "1");
    const totalCostETH = searchParams.get("totalCostETH") || undefined;

    if (!recipientAddress || !/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
      return NextResponse.json(
        { error: "Invalid recipient address" },
        { status: 400 }
      );
    }

    const redis = await getRedis();
    const key = recipientAddress.toLowerCase();
    const redisKey = `${SIGNER_KEY_PREFIX}${key}`;
    
    // Check if we have existing signer data
    const signerDataStr = await redis.get(redisKey);
    let signerData: SignerData | null = signerDataStr ? JSON.parse(signerDataStr) : null;
    let isNew = false;
    
    if (!signerData) {
      // Generate new signer key for this recipient
      const signerPk = generatePrivateKey();
      const signerAccount = privateKeyToAccount(signerPk as `0x${string}`);
      const sdk = getSDK();

      // Create companion wallet
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

      const companionAddress = companionAccount.getAddress();

      const now = Date.now();
      signerData = {
        privateKey: signerPk,
        recipientAddress,
        companionAddress,
        createdAt: now,
        numTickets,
        totalCostETH,
      };

      // Store in Redis with 7-day expiry (604800 seconds)
      await redis.setEx(redisKey, 604800, JSON.stringify(signerData));
      isNew = true;

      // Add to pending wallets set for cron job to process
      await redis.sAdd(PENDING_WALLETS_KEY, redisKey);

      console.log("[Companion API] Created new signer for:", recipientAddress);
      console.log("[Companion API] Companion wallet:", companionAddress);
      console.log("[Companion API] Added to pending set for background processing");

      // Create initial payment log
      const paymentId = `${key}_${now}`;
      await savePaymentLog({
        id: paymentId,
        recipientAddress,
        companionAddress,
        status: "pending",
        amountRequired: totalCostETH,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      console.log("[Companion API] Using existing signer for:", recipientAddress);
    }

    return NextResponse.json({
      success: true,
      companionAddress: signerData.companionAddress,
      recipientAddress,
      isNew,
    });
  } catch (error: any) {
    console.error("[Companion API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to get companion wallet" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/companion
 * Execute a transaction from companion wallet
 * Auto-refunds if insufficient balance for contract interaction
 * 
 * Body: {
 *   recipientAddress: string,
 *   to: string,
 *   value: string,        // ETH amount in wei
 *   data: string,
 *   minRequired?: string, // Optional: min ETH required (default: MIN_ETH_FOR_CONTRACT)
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let paymentId = "";
  
  try {
    const body = await request.json();
    const { recipientAddress, to, value, data, minRequired } = body;

    if (!recipientAddress || !/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
      return NextResponse.json(
        { error: "Invalid recipient address" },
        { status: 400 }
      );
    }

    if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
      return NextResponse.json(
        { error: "Invalid target address" },
        { status: 400 }
      );
    }

    const redis = await getRedis();
    const key = recipientAddress.toLowerCase();
    const redisKey = `${SIGNER_KEY_PREFIX}${key}`;
    const signerDataStr = await redis.get(redisKey);
    const signerData: SignerData | null = signerDataStr ? JSON.parse(signerDataStr) : null;

    if (!signerData) {
      return NextResponse.json(
        { error: "No signer key found for this recipient. Call GET first." },
        { status: 404 }
      );
    }

    paymentId = `${key}_${signerData.createdAt}`;
    const companionAddress = signerData.companionAddress;

    console.log("[Companion API] Processing transaction:");
    console.log("[Companion API]   Recipient:", recipientAddress);
    console.log("[Companion API]   Companion:", companionAddress);

    // Check balance first
    const balance = await getCompanionBalance(companionAddress);
    const balanceEth = parseFloat(balance.eth);
    const requiredEth = minRequired ? parseFloat(minRequired) : MIN_ETH_FOR_CONTRACT;

    console.log("[Companion API]   Balance:", balanceEth, "ETH");
    console.log("[Companion API]   Required:", requiredEth, "ETH");

    await updatePaymentLog(paymentId, {
      amountReceived: balance.eth,
      amountRequired: requiredEth.toString(),
      status: "funded",
    });

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

    const { base } = await import("viem/chains");

    // CHECK: Is balance sufficient for contract interaction?
    if (balanceEth < requiredEth) {
      console.log("[Companion API] ⚠️ INSUFFICIENT BALANCE - Initiating refund");
      console.log("[Companion API]   Balance:", balanceEth, "ETH");
      console.log("[Companion API]   Required:", requiredEth, "ETH");
      console.log("[Companion API]   Refund to:", recipientAddress);

      // Calculate refund amount (balance minus gas for refund tx)
      const refundAmount = balanceEth - GAS_FOR_REFUND;

      if (refundAmount <= 0) {
        await updatePaymentLog(paymentId, {
          status: "failed",
          error: "Balance too low even for refund",
        });

        return NextResponse.json({
          success: false,
          status: "insufficient_funds_no_refund",
          error: `Balance (${balanceEth} ETH) is too low for refund (need gas: ${GAS_FOR_REFUND} ETH)`,
          balance: balance.eth,
          required: requiredEth.toString(),
        }, { status: 400 });
      }

      const refundWei = BigInt(Math.floor(refundAmount * 1e18));

      // Execute refund
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

      console.log("[Companion API] ✓ REFUND COMPLETE");
      console.log("[Companion API]   Amount:", refundAmount.toFixed(6), "ETH");
      console.log("[Companion API]   TX:", refundTxHash);

      await updatePaymentLog(paymentId, {
        status: "refunded",
        refundTxHash,
      });

      // Remove from pending set and clear signer key
      await redis.sRem(PENDING_WALLETS_KEY, redisKey);
      await redis.del(redisKey);

      return NextResponse.json({
        success: false,
        status: "refunded",
        message: `Insufficient balance. Refunded ${refundAmount.toFixed(6)} ETH to ${recipientAddress}`,
        refundTxHash,
        refundAmount: refundAmount.toFixed(6),
        balance: balance.eth,
        required: requiredEth.toString(),
        companionAddress,
      });
    }

    // SUFFICIENT BALANCE - Execute contract call
    console.log("[Companion API] ✓ Balance sufficient, executing contract call");

    const transaction = await companionAccount.sendTransaction({
      chain: base,
      calls: [{
        to: to as `0x${string}`,
        value: BigInt(value || "0"),
        data: (data || "0x") as `0x${string}`,
      }],
      signers: {
        type: "owner",
        kind: "ecdsa",
        accounts: [signerAccount as any],
      },
    });

    const result = await companionAccount.waitForExecution(transaction);
    const txHash = (result as any)?.transactionHash || "";

    console.log("[Companion API] ✓ Transaction executed!");
    console.log("[Companion API]   TX hash:", txHash);
    console.log("[Companion API]   Duration:", Date.now() - startTime, "ms");

    await updatePaymentLog(paymentId, {
      status: "executed",
      txHash,
    });

    // Remove from pending set and clear signer key
    await redis.sRem(PENDING_WALLETS_KEY, redisKey);
    await redis.del(redisKey);

    return NextResponse.json({
      success: true,
      status: "executed",
      txHash,
      companionAddress,
    });
  } catch (error: any) {
    console.error("[Companion API] Transaction error:", error);
    
    if (paymentId) {
      await updatePaymentLog(paymentId, {
        status: "failed",
        error: error?.message,
      });
    }

    return NextResponse.json(
      { error: error?.message || "Transaction failed" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/companion?recipient=0x...
 * Clear signer key for a recipient (after emptying wallet)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recipientAddress = searchParams.get("recipient");

    if (!recipientAddress) {
      return NextResponse.json(
        { error: "Missing recipient address" },
        { status: 400 }
      );
    }

    const redis = await getRedis();
    const key = recipientAddress.toLowerCase();
    const redisKey = `${SIGNER_KEY_PREFIX}${key}`;
    
    const existed = await redis.exists(redisKey);
    
    // Remove from pending set and delete signer
    await redis.sRem(PENDING_WALLETS_KEY, redisKey);
    await redis.del(redisKey);

    console.log("[Companion API] Deleted signer for:", recipientAddress, "existed:", existed);

    return NextResponse.json({
      success: true,
      deleted: existed > 0,
    });
  } catch (error: any) {
    console.error("[Companion API] Delete error:", error);
    return NextResponse.json(
      { error: error?.message || "Delete failed" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/companion
 * Get recent payment logs (admin endpoint)
 */
export async function PATCH() {
  try {
    const redis = await getRedis();
    
    // Get last 50 payment IDs
    const paymentIds = await redis.lRange(PAYMENT_LIST_KEY, 0, 49);
    
    if (!paymentIds || paymentIds.length === 0) {
      return NextResponse.json({ payments: [], count: 0 });
    }

    // Fetch all payment logs
    const payments: PaymentLog[] = [];
    for (const id of paymentIds) {
      const logStr = await redis.get(`${PAYMENT_LOG_PREFIX}${id}`);
      if (logStr) {
        payments.push(JSON.parse(logStr));
      }
    }

    return NextResponse.json({
      success: true,
      payments,
      count: payments.length,
    });
  } catch (error: any) {
    console.error("[Companion API] Error fetching payments:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch payments" },
      { status: 500 }
    );
  }
}
