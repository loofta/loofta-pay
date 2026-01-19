/**
 * Lottery Purchase Service
 * 
 * Hybrid approach:
 * 1. Use NEAR Intents to fund Rhinestone companion wallet with ETH on Base (cross-chain)
 * 2. Use Rhinestone companion wallet to call ticketAutomator contract with calldata
 * 
 * This solves the calldata forwarding limitation of NEAR Intents by using
 * Rhinestone's contract call capabilities.
 */

import type { NearToken } from "@/services/nearIntents";
import { getAccurateQuote } from "@/services/nearIntents";
import { getCompanionAddress, getOrCreateSignerKey, getSDK } from "@/services/rhinestone";
import { encodeTicketPurchase, getTicketAutomatorAddress } from "@/services/lottery";
import { getRefundToForChain } from "@/lib/refundAddresses";
import { isEvmChainId } from "@/config/biconomy";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

// Simple balance check using Base RPC directly
async function getCompanionBalanceRpc(companionAddress: string): Promise<{ eth: string; ethWei: string }> {
  const rpcUrl = "https://mainnet.base.org";
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [companionAddress, "latest"],
      id: 1,
    }),
  });
  const data = await res.json();
  const balanceWei = data.result || "0x0";
  const balanceEth = (parseInt(balanceWei, 16) / 1e18).toFixed(8);
  return { eth: balanceEth, ethWei: BigInt(balanceWei).toString() };
}

const TICKET_AUTOMATOR_CONTRACT = getTicketAutomatorAddress();
const BASE_CHAIN_ID = 8453;

/**
 * Create a lottery purchase flow:
 * 1. Get companion wallet address
 * 2. Use NEAR Intents to fund companion wallet with ETH on Base
 * 3. Use Rhinestone to call ticketAutomator contract with calldata
 */
export async function createLotteryPurchaseFlow(input: {
  fromToken: NearToken;
  toToken: NearToken; // ETH on Base token from tokens list
  amountNeeded: string; // Amount in fromToken needed
  totalCostETH: string; // Total ETH needed on Base
  recipientAddress: string; // Where NFTs will be minted
  numTickets: number;
  userAddress: string;
}): Promise<{
  step: "fund" | "execute";
  companionAddress: string;
}> {
  const { fromToken, toToken, amountNeeded, totalCostETH, recipientAddress, numTickets, userAddress } = input;

  console.log("[Lottery Purchase Flow] Starting purchase flow:", {
    fromToken: `${fromToken.symbol} on ${fromToken.chain}`,
    amountNeeded,
    totalCostETH,
    recipientAddress,
    numTickets,
    userAddress,
  });

  // Step 1: Get or create companion wallet address
  console.log("[Lottery Purchase Flow] Step 1: Getting companion wallet address...");
  const companionAddress = await getCompanionAddress(userAddress);
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] ✓ COMPANION WALLET ADDRESS (Rhinestone):", companionAddress);
  console.log("[Lottery Purchase Flow] This address will receive ETH from NEAR Intents");
  console.log("[Lottery Purchase Flow] After funding, this wallet will call ticketAutomator contract");
  console.log("[Lottery Purchase Flow] =========================================");

  // Step 2: Check if companion already has ETH on Base
  // If yes, skip funding and go straight to execution
  // If no, create NEAR Intents deposit to fund companion wallet

  const isCrossChain = String(fromToken.chain).toLowerCase() !== "base";
  const isNonEvmChain = !isEvmChainId(fromToken.chain);

  // Always return fund step - deposit API will handle getting quote and deposit address
  console.log("[Lottery Purchase Flow] ✓ Companion wallet address obtained");
  console.log("[Lottery Purchase Flow] → Next: Get deposit address from /api/lottery/deposit");

  return {
    step: "fund",
    companionAddress,
  };
}

/**
 * Poll companion wallet balance until it has sufficient ETH
 */
export async function pollCompanionBalance(
  companionAddress: string,
  requiredEth: string,
  maxAttempts: number = 30,
  intervalMs: number = 3000
): Promise<{ success: boolean; balance: string; attempts: number }> {
  console.log("[Lottery Purchase Flow] Starting balance polling...");
  console.log("[Lottery Purchase Flow] Polling params:", {
    companionAddress,
    requiredEth,
    maxAttempts,
    intervalMs,
  });

  const requiredWei = BigInt(Math.floor(parseFloat(requiredEth) * 1e18));
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[Lottery Purchase Flow] Poll attempt ${attempt}/${maxAttempts}...`);
    
    try {
      const balance = await getCompanionBalanceRpc(companionAddress);
      const balanceWei = BigInt(balance.ethWei);
      
      console.log(`[Lottery Purchase Flow] Balance check ${attempt}:`, {
        balance: balance.eth,
        required: requiredEth,
        sufficient: balanceWei >= requiredWei,
      });

      if (balanceWei >= requiredWei) {
        console.log("[Lottery Purchase Flow] ✓ Sufficient balance detected!");
        return { success: true, balance: balance.eth, attempts: attempt };
      }

      if (attempt < maxAttempts) {
        console.log(`[Lottery Purchase Flow] Waiting ${intervalMs}ms before next check...`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    } catch (error) {
      console.error(`[Lottery Purchase Flow] Error checking balance (attempt ${attempt}):`, error);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
  }

  console.log("[Lottery Purchase Flow] ✗ Polling timeout - insufficient balance");
  return { success: false, balance: "0", attempts: maxAttempts };
}

/**
 * Execute the contract call after companion wallet is funded
 */
export async function executeLotteryContractCall(input: {
  companionAddress: string;
  userAddress: string;
  recipientAddress: string;
  numTickets: number;
  ethAmount: string; // Amount of ETH to send to contract
}): Promise<{ txHash: string; status: string }> {
  const { companionAddress, userAddress, recipientAddress, numTickets, ethAmount } = input;

  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Step 4: Executing contract call...");
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Input parameters:");
  console.log("[Lottery Purchase Flow]   - companionAddress:", companionAddress);
  console.log("[Lottery Purchase Flow]   - userAddress:", userAddress);
  console.log("[Lottery Purchase Flow]   - recipientAddress:", recipientAddress);
  console.log("[Lottery Purchase Flow]   - numTickets:", numTickets);
  console.log("[Lottery Purchase Flow]   - ethAmount:", ethAmount, "ETH");
  console.log("[Lottery Purchase Flow] =========================================");

  // Get signer key for this user
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Step 4.1: Getting signer key...");
  const signerPk = getOrCreateSignerKey(userAddress);
  console.log("[Lottery Purchase Flow] ✓ Signer key obtained");
  console.log("[Lottery Purchase Flow] Signer key (first 10 chars):", signerPk.slice(0, 10) + "...");
  
  const signerAccount = privateKeyToAccount(signerPk);
  console.log("[Lottery Purchase Flow] ✓ Signer account created from private key");
  console.log("[Lottery Purchase Flow] Signer account address:", signerAccount.address);
  console.log("[Lottery Purchase Flow] Signer account type:", signerAccount.type);
  console.log("[Lottery Purchase Flow] =========================================");

  // Recreate companion account
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Step 4.2: Recreating companion account...");
  const sdk = getSDK();
  console.log("[Lottery Purchase Flow] SDK initialized");
  
  // Create owner account - this is just for address reference in the multisig
  // It should NOT be used for signing, but Rhinestone might call it during validation
  // So we need to provide stub implementations that won't be called
  const ownerAccount = {
    address: userAddress as `0x${string}`,
    type: "local" as const,
    publicKey: "0x" as `0x${string}`,
    source: "custom" as const,
    // These should never be called since we only use signerAccount for signing
    signMessage: async () => { 
      throw new Error("Owner account should not be used for signing - use signer account");
    },
    signTransaction: async () => { 
      throw new Error("Owner account should not be used for signing - use signer account");
    },
    signTypedData: async () => { 
      throw new Error("Owner account should not be used for signing - use signer account");
    },
  };

  console.log("[Lottery Purchase Flow] Owner account created:");
  console.log("[Lottery Purchase Flow]   - Address:", ownerAccount.address);
  console.log("[Lottery Purchase Flow]   - Type:", ownerAccount.type);
  console.log("[Lottery Purchase Flow] Signer account (will sign):");
  console.log("[Lottery Purchase Flow]   - Address:", signerAccount.address);
  console.log("[Lottery Purchase Flow]   - Type:", signerAccount.type);
  console.log("[Lottery Purchase Flow] Creating companion account with 1-of-2 multisig...");

  const companionAccount = await sdk.createAccount({
    account: { type: "nexus" },
    owners: {
      type: "ecdsa",
      accounts: [ownerAccount as any, signerAccount as any],
      threshold: 1, // 1-of-2 multisig (either owner OR signer can sign)
    },
  });

  // Verify address matches
  const recreatedAddress = companionAccount.getAddress();
  console.log("[Lottery Purchase Flow] Companion account recreated:");
  console.log("[Lottery Purchase Flow]   - Expected address:", companionAddress);
  console.log("[Lottery Purchase Flow]   - Recreated address:", recreatedAddress);
  
  if (recreatedAddress.toLowerCase() !== companionAddress.toLowerCase()) {
    throw new Error(`Address mismatch! Expected ${companionAddress}, got ${recreatedAddress}`);
  }
  console.log("[Lottery Purchase Flow] ✓ Companion account address verified");
  console.log("[Lottery Purchase Flow] =========================================");

  // Deploy account on Base if not already deployed (per Rhinestone docs granular API example)
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Step 4.3: Deploying account on Base (if needed)...");
  console.log("[Lottery Purchase Flow] Chain:", base.name, "ID:", base.id);
  try {
    const deployResult = await companionAccount.deploy(base);
    console.log("[Lottery Purchase Flow] ✓ Account deployment completed");
    console.log("[Lottery Purchase Flow] Deployment result:", deployResult);
  } catch (deployError: any) {
    // Account might already be deployed
    console.log("[Lottery Purchase Flow] Deployment attempt result:");
    console.log("[Lottery Purchase Flow]   - Error message:", deployError?.message);
    console.log("[Lottery Purchase Flow]   - Error type:", deployError?.name);
    
    if (deployError?.message?.includes("already deployed") || deployError?.message?.includes("deployed")) {
      console.log("[Lottery Purchase Flow] ✓ Account already deployed on Base (this is OK)");
    } else {
      console.warn("[Lottery Purchase Flow] ⚠️ Deployment error (may be OK if already deployed):");
      console.warn("[Lottery Purchase Flow]   - Full error:", deployError);
      // Continue - might already be deployed
    }
  }
  console.log("[Lottery Purchase Flow] =========================================");

  // Encode contract call with recipient address
  console.log("[Lottery Purchase Flow] Encoding contract call...");
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] RECIPIENT ADDRESS (will receive NFTs):", recipientAddress);
  console.log("[Lottery Purchase Flow] Number of tickets:", numTickets);
  console.log("[Lottery Purchase Flow] Contract address:", TICKET_AUTOMATOR_CONTRACT);
  console.log("[Lottery Purchase Flow] =========================================");
  
  const contractCalldata = encodeTicketPurchase(recipientAddress, numTickets);
  console.log("[Lottery Purchase Flow] ✓ Contract calldata encoded:", contractCalldata);
  console.log("[Lottery Purchase Flow] Calldata breakdown:");
  console.log("[Lottery Purchase Flow]   - Function selector: 0x88f57767 (buyTickets)");
  console.log("[Lottery Purchase Flow]   - Recipient address:", recipientAddress);
  console.log("[Lottery Purchase Flow]   - Number of tickets:", numTickets);
  
  // Convert ETH amount to wei
  const ethAmountWei = BigInt(Math.floor(parseFloat(ethAmount) * 1e18));

  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Contract call details:");
  console.log("[Lottery Purchase Flow]   Contract:", TICKET_AUTOMATOR_CONTRACT);
  console.log("[Lottery Purchase Flow]   Calldata:", contractCalldata);
  console.log("[Lottery Purchase Flow]   ETH amount (wei):", ethAmountWei.toString());
  console.log("[Lottery Purchase Flow]   ETH amount (human):", ethAmount);
  console.log("[Lottery Purchase Flow]   Recipient (in calldata):", recipientAddress);
  console.log("[Lottery Purchase Flow]   Number of tickets:", numTickets);
  console.log("[Lottery Purchase Flow] =========================================");

  // Check companion wallet balance before submitting
  console.log("[Lottery Purchase Flow] =========================================");
  console.log("[Lottery Purchase Flow] Step 4.5: Checking companion wallet balance...");
  console.log("[Lottery Purchase Flow] Checking balance on Base...");
  console.log("[Lottery Purchase Flow] Companion wallet address:", companionAddress);
  
  const balanceCheck = await getCompanionBalanceRpc(companionAddress);
  console.log("[Lottery Purchase Flow] Balance check result:");
  console.log("[Lottery Purchase Flow]   - Balance (ETH):", balanceCheck.eth);
  console.log("[Lottery Purchase Flow]   - Balance (wei):", balanceCheck.ethWei);
  console.log("[Lottery Purchase Flow]   - Required (ETH):", ethAmount);
  console.log("[Lottery Purchase Flow]   - Required (wei):", BigInt(Math.floor(parseFloat(ethAmount) * 1e18)).toString());
  
  const balanceEth = parseFloat(balanceCheck.eth);
  const requiredEth = parseFloat(ethAmount);
  const sufficient = balanceEth >= requiredEth;
  
  console.log("[Lottery Purchase Flow]   - Sufficient:", sufficient);
  console.log("[Lottery Purchase Flow]   - Difference:", (balanceEth - requiredEth).toFixed(8), "ETH");
  
  if (!sufficient) {
    const errorMsg = `Insufficient balance in companion wallet. ` +
      `Balance: ${balanceCheck.eth} ETH, Required: ${ethAmount} ETH + gas fees. ` +
      `Please ensure the deposit has been confirmed.`;
    console.error("[Lottery Purchase Flow] ✗", errorMsg);
    throw new Error(errorMsg);
  }
  console.log("[Lottery Purchase Flow] ✓ Sufficient balance confirmed");
  console.log("[Lottery Purchase Flow] =========================================");

  // Send transaction from companion wallet to contract
  // Following Rhinestone docs: https://docs.rhinestone.dev/smart-wallet/core/create-first-transaction
  console.log("[Lottery Purchase Flow] Sending transaction from companion wallet...");
  console.log("[Lottery Purchase Flow] Following Rhinestone transaction format...");

  console.log("[Lottery Purchase Flow] Transaction details:", {
    to: TICKET_AUTOMATOR_CONTRACT,
    value: ethAmountWei.toString(),
    data: contractCalldata,
    from: companionAddress,
    recipientInCalldata: recipientAddress,
  });

  // Try to estimate gas manually using viem to get better error messages
  try {
    console.log("[Lottery Purchase Flow] =========================================");
    console.log("[Lottery Purchase Flow] Step 4.5.5: Attempting manual gas estimation...");
    const publicClient = createWalletClient({
      chain: base,
      transport: http(),
    });
    
    // Note: We can't actually estimate gas from the companion address without the private key
    // But we can at least validate the transaction parameters
    console.log("[Lottery Purchase Flow] Transaction parameters validated:");
    console.log("[Lottery Purchase Flow]   - Contract address is valid:", /^0x[0-9a-fA-F]{40}$/.test(TICKET_AUTOMATOR_CONTRACT));
    console.log("[Lottery Purchase Flow]   - Calldata is valid hex:", /^0x[0-9a-fA-F]*$/.test(contractCalldata));
    console.log("[Lottery Purchase Flow]   - Value is valid:", ethAmountWei > BigInt(0));
    console.log("[Lottery Purchase Flow] =========================================");
  } catch (gasEstimateError: any) {
    console.warn("[Lottery Purchase Flow] Gas estimation check failed (non-critical):", gasEstimateError?.message);
  }

  try {
    // Use sendTransaction directly (simpler, like the docs example)
    // https://docs.rhinestone.dev/smart-wallet/core/create-first-transaction
    console.log("[Lottery Purchase Flow] =========================================");
    console.log("[Lottery Purchase Flow] Step 4.6: Sending transaction via sendTransaction...");
    console.log("[Lottery Purchase Flow] Transaction configuration:");
    console.log("[Lottery Purchase Flow]   - Chain:", base.name, "(ID:", base.id, ")");
    console.log("[Lottery Purchase Flow]   - Contract:", TICKET_AUTOMATOR_CONTRACT);
    console.log("[Lottery Purchase Flow]   - Value (wei):", ethAmountWei.toString());
    console.log("[Lottery Purchase Flow]   - Value (ETH):", ethAmount);
    console.log("[Lottery Purchase Flow]   - Calldata:", contractCalldata);
    console.log("[Lottery Purchase Flow]   - Calldata length:", contractCalldata.length, "chars");
    console.log("[Lottery Purchase Flow]   - Signer account:", signerAccount.address);
    console.log("[Lottery Purchase Flow]   - Signer type: owner, kind: ecdsa");
    console.log("[Lottery Purchase Flow] Calling companionAccount.sendTransaction...");
    
    const transaction = await companionAccount.sendTransaction({
      chain: base,
      calls: [
        {
          to: TICKET_AUTOMATOR_CONTRACT as `0x${string}`,
          value: ethAmountWei,
          data: contractCalldata as `0x${string}`,
        },
      ],
      // Specify signers - only use signerAccount (not ownerAccount)
      signers: {
        type: "owner",
        kind: "ecdsa",
        accounts: [signerAccount as any], // Only signer account signs (has private key)
      },
    });
    
    console.log("[Lottery Purchase Flow] ✓ Transaction submitted successfully!");
    console.log("[Lottery Purchase Flow] Transaction object:", JSON.stringify(transaction, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
    console.log("[Lottery Purchase Flow] =========================================");

    // Wait for execution
    console.log("[Lottery Purchase Flow] =========================================");
    console.log("[Lottery Purchase Flow] Step 4.7: Waiting for execution...");
    console.log("[Lottery Purchase Flow] This may take a few moments...");
    
    const result = await companionAccount.waitForExecution(transaction);

    console.log("[Lottery Purchase Flow] =========================================");
    console.log("[Lottery Purchase Flow] ✓ Contract call executed successfully!");
    console.log("[Lottery Purchase Flow] Execution result:");
    console.log("[Lottery Purchase Flow]   - Transaction hash:", (result as any)?.transactionHash);
    console.log("[Lottery Purchase Flow]   - Status:", (result as any)?.status);
    console.log("[Lottery Purchase Flow]   - Full result:", JSON.stringify(result, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
    console.log("[Lottery Purchase Flow] =========================================");

    return {
      txHash: (result as any)?.transactionHash || "",
      status: "COMPLETED",
    };
  } catch (error: any) {
    console.error("[Lottery Purchase Flow] =========================================");
    console.error("[Lottery Purchase Flow] ✗ TRANSACTION EXECUTION FAILED");
    console.error("[Lottery Purchase Flow] =========================================");
    console.error("[Lottery Purchase Flow] Error type:", error?.constructor?.name);
    console.error("[Lottery Purchase Flow] Error name:", error?.name);
    console.error("[Lottery Purchase Flow] Error message:", error?.message);
    console.error("[Lottery Purchase Flow] Error stack:", error?.stack);
    console.error("[Lottery Purchase Flow] Error cause:", error?.cause);
    console.error("[Lottery Purchase Flow] Error errors:", error?.errors);
    
    // Try to extract more details from the error object
    const errorKeys = Object.keys(error || {});
    console.error("[Lottery Purchase Flow] Error object keys:", errorKeys);
    
    // Try to get nested error details
    if (error?.cause) {
      console.error("[Lottery Purchase Flow] Error cause details:", {
        message: error.cause?.message,
        name: error.cause?.name,
        stack: error.cause?.stack,
        keys: Object.keys(error.cause || {}),
      });
    }
    
    // Try to extract from error.errors array
    if (error?.errors && Array.isArray(error.errors)) {
      console.error("[Lottery Purchase Flow] Error.errors array:", error.errors.map((e: any) => ({
        message: e?.message,
        name: e?.name,
        code: e?.code,
        data: e?.data,
      })));
    }
    
    // Try to extract from error.data
    if (error?.data) {
      console.error("[Lottery Purchase Flow] Error.data:", error.data);
    }
    
    // Try to extract from error.shortMessage (viem format)
    if (error?.shortMessage) {
      console.error("[Lottery Purchase Flow] Error.shortMessage:", error.shortMessage);
    }
    
    // Try to extract from error.details
    if (error?.details) {
      console.error("[Lottery Purchase Flow] Error.details:", error.details);
    }
    
    // Try to stringify with all properties
    try {
      const errorString = JSON.stringify(error, (key, value) => {
        // Handle BigInt
        if (typeof value === 'bigint') return value.toString();
        // Skip functions and circular references
        if (typeof value === 'function') return '[Function]';
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            ...Object.getOwnPropertyNames(value).reduce((acc, prop) => {
              try {
                const propValue = (value as any)[prop];
                acc[prop] = typeof propValue === 'bigint' ? propValue.toString() : propValue;
              } catch {
                acc[prop] = '[Unable to serialize]';
              }
              return acc;
            }, {} as any),
          };
        }
        return value;
      }, 2);
      console.error("[Lottery Purchase Flow] Full error object (serialized):", errorString);
    } catch (serializeError) {
      console.error("[Lottery Purchase Flow] Could not serialize error:", serializeError);
    }
    
    // Re-check balance in case it changed
    console.error("[Lottery Purchase Flow] =========================================");
    console.error("[Lottery Purchase Flow] Re-checking balance after error...");
    const finalBalance = await getCompanionBalanceRpc(companionAddress);
    console.error("[Lottery Purchase Flow] Final balance check:");
    console.error("[Lottery Purchase Flow]   - Balance (ETH):", finalBalance.eth);
    console.error("[Lottery Purchase Flow]   - Required (ETH):", ethAmount);
    console.error("[Lottery Purchase Flow]   - Still sufficient:", parseFloat(finalBalance.eth) >= parseFloat(ethAmount));
    
    // Calculate gas estimate (rough) - Base has very low gas (~0.01 gwei)
    // 150k gas * 0.01 gwei = 0.0000015 ETH (realistic for Base L2)
    const estimatedGasWei = BigInt(150000) * BigInt(10000000); // 150k gas * 0.01 gwei (10M wei)
    const estimatedGasEth = Number(estimatedGasWei) / 1e18;
    const totalNeeded = parseFloat(ethAmount) + estimatedGasEth;
    console.error("[Lottery Purchase Flow]   - Estimated gas (ETH):", estimatedGasEth.toFixed(8));
    console.error("[Lottery Purchase Flow]   - Total needed (value + gas):", totalNeeded.toFixed(8));
    console.error("[Lottery Purchase Flow]   - Sufficient for value + gas:", parseFloat(finalBalance.eth) >= totalNeeded);
    console.error("[Lottery Purchase Flow] =========================================");
    
    // Log transaction details for debugging
    console.error("[Lottery Purchase Flow] Transaction details that failed:");
    console.error("[Lottery Purchase Flow]   - Contract:", TICKET_AUTOMATOR_CONTRACT);
    console.error("[Lottery Purchase Flow]   - Value:", ethAmountWei.toString(), "wei (", ethAmount, "ETH)");
    console.error("[Lottery Purchase Flow]   - Calldata:", contractCalldata);
    console.error("[Lottery Purchase Flow]   - Calldata length:", contractCalldata.length);
    console.error("[Lottery Purchase Flow]   - Recipient in calldata:", recipientAddress);
    console.error("[Lottery Purchase Flow]   - Number of tickets:", numTickets);
    console.error("[Lottery Purchase Flow]   - Companion address:", companionAddress);
    console.error("[Lottery Purchase Flow]   - Signer address:", signerAccount.address);
    console.error("[Lottery Purchase Flow] =========================================");
    
    // Create a more informative error message
    let errorMessage = error?.message || "Transaction execution failed";
    
    // Try to extract more specific error information
    if (error?.message?.includes("simulation") || error?.message?.includes("Simulation")) {
      errorMessage = `Transaction simulation failed. This usually means: ` +
        `(1) The contract call would revert, (2) Insufficient gas, or (3) Invalid contract state. ` +
        `Balance: ${finalBalance.eth} ETH, Required: ${ethAmount} ETH + gas. ` +
        `Check the contract at ${TICKET_AUTOMATOR_CONTRACT} on Base.`;
      
      // Try to get more details from nested errors
      if (error?.cause?.message) {
        errorMessage += ` Cause: ${error.cause.message}`;
      }
      if (error?.errors?.[0]?.message) {
        errorMessage += ` Error: ${error.errors[0].message}`;
      }
    }
    
    // Create enhanced error with more context
    const enhancedError = new Error(errorMessage);
    (enhancedError as any).originalError = error;
    (enhancedError as any).balance = finalBalance.eth;
    (enhancedError as any).required = ethAmount;
    (enhancedError as any).contract = TICKET_AUTOMATOR_CONTRACT;
    (enhancedError as any).calldata = contractCalldata;
    
    throw enhancedError;
  }
}

// Loofta treasury address on Base - receives leftover dust
const LOOFTA_TREASURY_ADDRESS = process.env.NEXT_PUBLIC_LOOFTA_TREASURY_ADDRESS as `0x${string}`;

/**
 * Sweep leftover ETH from companion wallet to Loofta treasury
 * Called after successful lottery purchase to collect dust
 */
export async function sweepDustToLoofta(input: {
  companionAddress: string;
  userAddress: string;
  minDustThreshold?: string; // Minimum ETH to sweep (default: 0.0001)
}): Promise<{ success: boolean; amountSwept?: string; txHash?: string }> {
  const { companionAddress, userAddress, minDustThreshold = "0.0001" } = input;
  
  console.log("[Dust Sweep] Starting dust sweep...");
  console.log("[Dust Sweep] Companion wallet:", companionAddress);
  console.log("[Dust Sweep] Min threshold:", minDustThreshold, "ETH");
  
  try {
    // Check current balance
    const balance = await getCompanionBalanceRpc(companionAddress);
    const balanceEth = parseFloat(balance.eth);
    const threshold = parseFloat(minDustThreshold);
    
    console.log("[Dust Sweep] Current balance:", balance.eth, "ETH");
    
    if (balanceEth < threshold) {
      console.log("[Dust Sweep] Balance below threshold, skipping sweep");
      return { success: true, amountSwept: "0" };
    }
    
    // Leave a tiny bit for any future gas needs (0.00001 ETH)
    const gasReserve = 0.00001;
    const amountToSweep = balanceEth - gasReserve;
    
    if (amountToSweep <= 0) {
      console.log("[Dust Sweep] No dust to sweep after gas reserve");
      return { success: true, amountSwept: "0" };
    }
    
    console.log("[Dust Sweep] Amount to sweep:", amountToSweep.toFixed(8), "ETH");
    console.log("[Dust Sweep] Sending to Loofta treasury:", LOOFTA_TREASURY_ADDRESS);
    
    // Get SDK and recreate companion account
    const sdk = await getSDK();
    const signerKey = getOrCreateSignerKey(userAddress);
    const signerAccount = privateKeyToAccount(signerKey as `0x${string}`);
    
    // Create owner account (public address only)
    const ownerAccount = {
      address: userAddress as `0x${string}`,
      type: "local" as const,
    };
    
    const companionAccount = await sdk.createAccount({
      account: { type: "nexus" },
      owners: {
        type: "ecdsa",
        accounts: [ownerAccount as any, signerAccount as any],
        threshold: 1,
      },
    });
    
    // Convert amount to wei
    const amountWei = BigInt(Math.floor(amountToSweep * 1e18));
    
    // Send ETH to Loofta treasury
    const transaction = await companionAccount.sendTransaction({
      chain: base,
      calls: [
        {
          to: LOOFTA_TREASURY_ADDRESS,
          value: amountWei,
          data: "0x" as `0x${string}`,
        },
      ],
      signers: {
        type: "owner",
        kind: "ecdsa",
        accounts: [signerAccount as any],
      },
    });
    
    console.log("[Dust Sweep] ✓ Transaction submitted");
    
    // Wait for execution
    const result = await companionAccount.waitForExecution(transaction);
    const txHash = (result as any)?.transactionHash || "";
    
    console.log("[Dust Sweep] ✓ Dust sweep complete!");
    console.log("[Dust Sweep] TX hash:", txHash);
    console.log("[Dust Sweep] Amount swept:", amountToSweep.toFixed(8), "ETH");
    
    return {
      success: true,
      amountSwept: amountToSweep.toFixed(8),
      txHash,
    };
  } catch (error: any) {
    console.error("[Dust Sweep] Error:", error?.message);
    // Don't throw - dust sweep is non-critical
    return { success: false };
  }
}

