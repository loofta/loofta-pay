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
import { base } from "viem/chains";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { RHINESTONE_API_KEY } from "@/config/rhinestone";
import { LOOFTA_TREASURY_ADDRESSES } from "@/config/rhinestoneChains";
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
  orgReferral?: string; // Organization referral code for tracking
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
  orgReferral?: string; // Organization referral code for tracking
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
    console.error("[Companion API] ❌ RHINESTONE_API_KEY is missing!");
    throw new Error("Missing RHINESTONE_API_KEY");
  }
  
  // Log API key status (first 8 chars only for security)
  const apiKeyPreview = RHINESTONE_API_KEY.substring(0, 8) + "...";
  console.log("[Companion API] Initializing SDK with API key:", apiKeyPreview);
  
  try {
    const sdk = new RhinestoneSDK({ apiKey: RHINESTONE_API_KEY });
    console.log("[Companion API] ✓ SDK initialized successfully");
    return sdk;
  } catch (error: any) {
    console.error("[Companion API] ❌ Failed to initialize SDK:", error?.message || error);
    throw new Error(`Failed to initialize Rhinestone SDK: ${error?.message || "Unknown error"}`);
  }
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
 * GET /api/companion?logs=true
 * Get recent payment logs (admin endpoint)
 * 
 * Query params:
 * - recipient: EVM address where tickets will be minted
 * - numTickets: Number of tickets to purchase (optional, default 1)
 * - totalCostETH: Total ETH required for purchase (optional)
 * - logs: If true, fetch payment logs (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Check if this is a payment logs request
    if (searchParams.get("logs") === "true") {
      // Admin-only endpoint for payment logs
      const userId = request.headers.get("x-privy-user-id");
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      
      const { isAdmin } = await import("@/lib/admin");
      const adminStatus = await isAdmin(userId);
      if (!adminStatus) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }

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
    }
    
    // Original GET logic for companion wallet
    const recipientAddress = searchParams.get("recipient");
    const numTickets = parseInt(searchParams.get("numTickets") || "1");
    const totalCostETH = searchParams.get("totalCostETH") || undefined;
    const orgReferral = searchParams.get("orgReferral") || undefined;

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
        orgReferral,
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
        orgReferral,
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
    
    console.log("[Companion API] Getting SDK instance...");
    const sdk = getSDK();

    // Recreate companion account
    console.log("[Companion API] Creating companion account...");
    const dummyOwner = {
      address: recipientAddress as `0x${string}`,
      type: "local" as const,
      publicKey: "0x" as `0x${string}`,
      source: "custom" as const,
      signMessage: async () => { throw new Error("Not used"); },
      signTransaction: async () => { throw new Error("Not used"); },
      signTypedData: async () => { throw new Error("Not used"); },
    };

    let companionAccount;
    try {
      companionAccount = await sdk.createAccount({
        account: { type: "nexus" },
        owners: {
          type: "ecdsa",
          accounts: [dummyOwner as any, signerAccount],
          threshold: 1,
        },
      });
      console.log("[Companion API] ✓ Companion account created:", companionAccount.getAddress());
    } catch (error: any) {
      console.error("[Companion API] ❌ Failed to create companion account:", error);
      console.error("[Companion API] Error details:", {
        message: error?.message,
        cause: error?.cause,
        stack: error?.stack,
      });
      throw new Error(`Failed to create companion account: ${error?.message || "Unknown error"}`);
    }

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
      let refundTx;
      try {
        refundTx = await companionAccount.sendTransaction({
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
      } catch (error: any) {
        console.error("[Companion API] ❌ Failed to send refund transaction:", error);
        throw new Error(`Failed to send refund: ${error?.message || "Unknown error"}`);
      }

      let refundResult;
      try {
        refundResult = await companionAccount.waitForExecution(refundTx);
      } catch (error: any) {
        console.error("[Companion API] ❌ Failed to wait for refund execution:", error);
        throw new Error(`Failed to execute refund: ${error?.message || "Unknown error"}`);
      }
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

    let transaction;
    try {
      transaction = await companionAccount.sendTransaction({
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
      console.log("[Companion API] ✓ Transaction sent, waiting for execution...");
    } catch (error: any) {
      console.error("[Companion API] ❌ Failed to send transaction:", error);
      console.error("[Companion API] Error details:", {
        message: error?.message,
        cause: error?.cause,
        stack: error?.stack,
      });
      throw new Error(`Failed to send transaction: ${error?.message || "Unknown error"}`);
    }

    let result;
    try {
      result = await companionAccount.waitForExecution(transaction);
    } catch (error: any) {
      console.error("[Companion API] ❌ Failed to wait for execution:", error);
      console.error("[Companion API] Error details:", {
        message: error?.message,
        cause: error?.cause,
        stack: error?.stack,
      });
      throw new Error(`Failed to wait for execution: ${error?.message || "Unknown error"}`);
    }
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
 * PATCH /api/companion/recover
 * Admin-only endpoint to recover funds from a companion wallet
 * 
 * Body: {
 *   companionAddress: string,
 *   destinationAddress: string, // Where to send the funds
 *   leaveForGas?: string,        // Amount to leave for gas (default: 0.0001)
 * }
 */
export async function PATCH(request: NextRequest) {
  try {
    // Check admin access
    const userId = request.headers.get("x-privy-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const { isAdmin } = await import("@/lib/admin");
    const adminStatus = await isAdmin(userId);
    if (!adminStatus) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { companionAddress, destinationAddress, leaveForGas = "0.0001" } = body;

    if (!companionAddress || !/^0x[0-9a-fA-F]{40}$/.test(companionAddress)) {
      return NextResponse.json(
        { error: "Invalid companion address" },
        { status: 400 }
      );
    }

    if (!destinationAddress || !/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
      return NextResponse.json(
        { error: "Invalid destination address" },
        { status: 400 }
      );
    }

    const redis = await getRedis();
    
    // Search all signer keys to find the one matching this companion address
    const keys = await redis.keys(`${SIGNER_KEY_PREFIX}*`);
    let foundSignerData: SignerData | null = null;

    for (const key of keys) {
      const signerDataStr = await redis.get(key);
      if (signerDataStr) {
        const signerData: SignerData = JSON.parse(signerDataStr);
        if (signerData.companionAddress.toLowerCase() === companionAddress.toLowerCase()) {
          foundSignerData = signerData;
          break;
        }
      }
    }

    if (!foundSignerData) {
      return NextResponse.json(
        { 
          error: `No signer data found for companion wallet ${companionAddress}`,
          hint: "This companion wallet may have been created through a different flow or the signer key may have expired."
        },
        { status: 404 }
      );
    }

    console.log("[Companion Recovery] Recovering funds from:", companionAddress);
    console.log("[Companion Recovery] Destination:", destinationAddress);
    console.log("[Companion Recovery] Original recipient:", foundSignerData.recipientAddress);

    // Check balance
    const balance = await getCompanionBalance(companionAddress);
    const balanceEth = parseFloat(balance.eth);
    const gasReserve = parseFloat(leaveForGas);
    const amountToSend = balanceEth - gasReserve;

    if (amountToSend <= 0) {
      return NextResponse.json({
        success: false,
        error: `Balance too low to recover. Balance: ${balance.eth} ETH, Gas reserve: ${gasReserve} ETH`,
        balance: balance.eth,
      }, { status: 400 });
    }

    console.log("[Companion Recovery] Balance:", balance.eth, "ETH");
    console.log("[Companion Recovery] Amount to send:", amountToSend.toFixed(8), "ETH");

    // Create companion account and send funds
    const signerAccount = privateKeyToAccount(foundSignerData.privateKey as `0x${string}`);
    const sdk = getSDK();

    const dummyOwner = {
      address: foundSignerData.recipientAddress as `0x${string}`,
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

    const recreatedAddress = companionAccount.getAddress();
    if (recreatedAddress.toLowerCase() !== companionAddress.toLowerCase()) {
      return NextResponse.json({
        success: false,
        error: `Address mismatch. Expected ${companionAddress}, got ${recreatedAddress}`,
      }, { status: 500 });
    }

    // Send transaction
    const amountWei = BigInt(Math.floor(amountToSend * 1e18));

    const transaction = await companionAccount.sendTransaction({
      chain: base,
      calls: [{
        to: destinationAddress as `0x${string}`,
        value: amountWei,
        data: "0x" as `0x${string}`,
      }],
      signers: {
        type: "owner",
        kind: "ecdsa",
        accounts: [signerAccount as any],
      },
    });

    console.log("[Companion Recovery] Transaction submitted:", transaction);

    const result = await companionAccount.waitForExecution(transaction);
    const txHash = (result as any)?.transactionHash || "";

    console.log("[Companion Recovery] ✓ Funds recovered successfully!");
    console.log("[Companion Recovery] TX hash:", txHash);
    console.log("[Companion Recovery] View on Basescan: https://basescan.org/tx/" + txHash);

    return NextResponse.json({
      success: true,
      txHash,
      amountSent: amountToSend.toFixed(8),
      destinationAddress,
      companionAddress,
      originalRecipient: foundSignerData.recipientAddress,
    });
  } catch (error: any) {
    console.error("[Companion Recovery] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to recover funds" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/companion?companionAddress=0x...
 * Manually trigger execution for a funded companion wallet
 * Useful when companion wallet is funded but transaction didn't execute automatically
 */
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companionAddress = searchParams.get("companionAddress");
    
    if (!companionAddress || !/^0x[0-9a-fA-F]{40}$/.test(companionAddress)) {
      return NextResponse.json(
        { error: "Invalid companion address" },
        { status: 400 }
      );
    }

    const redis = await getRedis();
    
    // Search all signer keys to find the one matching this companion address
    const keys = await redis.keys(`${SIGNER_KEY_PREFIX}*`);
    let foundSignerData: SignerData | null = null;
    let foundKey: string | null = null;

    for (const key of keys) {
      const signerDataStr = await redis.get(key);
      if (signerDataStr) {
        const signerData: SignerData = JSON.parse(signerDataStr);
        if (signerData.companionAddress.toLowerCase() === companionAddress.toLowerCase()) {
          foundSignerData = signerData;
          foundKey = key;
          break;
        }
      }
    }

    if (!foundSignerData || !foundKey) {
      return NextResponse.json(
        { error: `No signer data found for companion wallet ${companionAddress}` },
        { status: 404 }
      );
    }

    const { recipientAddress, numTickets = 1, totalCostETH } = foundSignerData;
    const { encodeTicketPurchase, getTicketAutomatorAddress } = await import("@/services/lottery");
    
    console.log("[Companion API] Manual trigger for companion:", companionAddress);
    console.log("[Companion API]   Recipient:", recipientAddress);
    console.log("[Companion API]   Tickets:", numTickets);
    console.log("[Companion API]   Total cost:", totalCostETH, "ETH");

    // Check balance
    const balance = await getCompanionBalance(companionAddress);
    const requiredEth = totalCostETH ? parseFloat(totalCostETH) : MIN_ETH_FOR_CONTRACT;
    
    console.log("[Companion API]   Balance:", balance.eth, "ETH");
    console.log("[Companion API]   Required:", requiredEth, "ETH");

    if (parseFloat(balance.eth) < requiredEth * 0.95) {
      return NextResponse.json({
        success: false,
        error: `Insufficient balance. Has ${balance.eth} ETH but needs ${requiredEth} ETH`,
        balance: balance.eth,
        required: requiredEth.toString(),
      }, { status: 400 });
    }

    // Calculate ticket cost (without gas buffer)
    const ticketCostETH = totalCostETH ? (parseFloat(totalCostETH) * 0.95).toString() : "0.0035";
    const ethAmountWei = BigInt(Math.floor(parseFloat(ticketCostETH) * 1e18)).toString();
    
    // Encode contract call
    const calldata = encodeTicketPurchase(recipientAddress, numTickets);
    const ticketAutomatorAddress = getTicketAutomatorAddress();

    // Execute transaction using existing POST logic
    const response = await POST(new NextRequest(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientAddress,
        to: ticketAutomatorAddress,
        value: ethAmountWei,
        data: calldata,
        minRequired: totalCostETH || MIN_ETH_FOR_CONTRACT.toString(),
      }),
    }));

    return response;
  } catch (error: any) {
    console.error("[Companion API] Manual trigger error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to trigger execution" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/companion?recipient=0x...
 * Sweep dust tokens to treasury and clear signer key for a recipient
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
    
    // Get signer data before deleting (needed for dust sweep)
    const signerDataStr = await redis.get(redisKey);
    const signerData: SignerData | null = signerDataStr ? JSON.parse(signerDataStr) : null;
    
    const existed = signerData !== null;
    
    // Sweep dust to treasury if companion wallet exists and has balance
    if (signerData) {
      try {
        const companionAddress = signerData.companionAddress;
        const balance = await getCompanionBalance(companionAddress);
        const balanceEth = parseFloat(balance.eth);
        const minDustThreshold = 0.0001; // Minimum 0.0001 ETH to sweep
        
        if (balanceEth > minDustThreshold) {
          console.log("[Companion API] Sweeping dust to treasury:", balanceEth, "ETH");
          
          // Get Loofta treasury address for Base chain
          const treasuryAddress = LOOFTA_TREASURY_ADDRESSES[8453]; // Base chain ID
          if (!treasuryAddress) {
            console.warn("[Companion API] ⚠️ Treasury address not configured for Base, skipping dust sweep");
          } else {
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
            
            // Calculate amount to sweep (balance minus gas for sweep tx)
            const gasForSweep = 0.0001; // Gas reserve for sweep transaction
            const amountToSweep = balanceEth - gasForSweep;
            
            if (amountToSweep > 0) {
              const sweepWei = BigInt(Math.floor(amountToSweep * 1e18));
              
              const sweepTx = await companionAccount.sendTransaction({
                chain: base,
                calls: [{
                  to: treasuryAddress as `0x${string}`,
                  value: sweepWei,
                  data: "0x" as `0x${string}`,
                }],
                signers: {
                  type: "owner",
                  kind: "ecdsa",
                  accounts: [signerAccount as any],
                },
              });
              
              const sweepResult = await companionAccount.waitForExecution(sweepTx);
              const sweepTxHash = (sweepResult as any)?.transactionHash || "";
              
              console.log("[Companion API] ✓ Dust swept to treasury:", amountToSweep.toFixed(6), "ETH");
              console.log("[Companion API] Sweep TX:", sweepTxHash);
            }
          }
        }
      } catch (sweepError: any) {
        // Don't fail the delete if dust sweep fails (non-critical)
        console.warn("[Companion API] Dust sweep failed (non-critical):", sweepError?.message);
      }
    }
    
    // Remove from pending set and delete signer
    await redis.sRem(PENDING_WALLETS_KEY, redisKey);
    await redis.del(redisKey);

    console.log("[Companion API] Deleted signer for:", recipientAddress, "existed:", existed);

    return NextResponse.json({
      success: true,
      deleted: existed,
    });
  } catch (error: any) {
    console.error("[Companion API] Delete error:", error);
    return NextResponse.json(
      { error: error?.message || "Delete failed" },
      { status: 500 }
    );
  }
}

