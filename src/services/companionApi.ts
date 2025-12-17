/**
 * Companion Wallet API Client
 * 
 * Client-side functions to interact with the server-side companion wallet API.
 * This enables widget use without localStorage dependency.
 */

export type CompanionWalletResponse = {
  success: boolean;
  companionAddress: string;
  recipientAddress: string;
  isNew: boolean;
};

export type TransactionStatus = "executed" | "refunded" | "insufficient_funds_no_refund" | "failed";

export type TransactionResponse = {
  success: boolean;
  status: TransactionStatus;
  txHash?: string;
  refundTxHash?: string;
  refundAmount?: string;
  companionAddress?: string;
  balance?: string;
  required?: string;
  message?: string;
  error?: string;
};

export type PaymentLog = {
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

/**
 * Get or create companion wallet for a recipient address
 * The server manages the signer key
 */
export async function getCompanionWalletForRecipient(
  recipientAddress: string
): Promise<CompanionWalletResponse> {
  console.log("[Companion API Client] Getting companion wallet for:", recipientAddress);
  
  const response = await fetch(`/api/companion?recipient=${encodeURIComponent(recipientAddress)}`);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Failed to get companion wallet");
  }
  
  console.log("[Companion API Client] Got companion wallet:", data.companionAddress);
  return data;
}

/**
 * Execute a transaction from the companion wallet
 * Server handles the signing using stored signer key
 * 
 * IMPORTANT: If balance is insufficient, server will auto-refund to recipient
 * and return { success: false, status: "refunded", refundTxHash, refundAmount }
 */
export async function executeCompanionTransaction(input: {
  recipientAddress: string;
  to: string;
  value: string; // wei
  data: string;
  minRequired?: string; // Optional: min ETH required for contract
}): Promise<TransactionResponse> {
  console.log("[Companion API Client] Executing transaction:");
  console.log("[Companion API Client]   Recipient:", input.recipientAddress);
  console.log("[Companion API Client]   To:", input.to);
  console.log("[Companion API Client]   Value:", input.value);
  
  const response = await fetch("/api/companion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  
  const data = await response.json();
  
  // Handle refund case - this is not an error, just insufficient funds
  if (data.status === "refunded") {
    console.log("[Companion API Client] ⚠️ Transaction refunded due to insufficient funds");
    console.log("[Companion API Client]   Refund TX:", data.refundTxHash);
    console.log("[Companion API Client]   Refund Amount:", data.refundAmount, "ETH");
    return data;
  }
  
  if (!response.ok) {
    console.error("[Companion API Client] Transaction failed:", data.error);
    throw new Error(data.error || "Transaction failed");
  }
  
  console.log("[Companion API Client] ✓ Transaction success:", data.txHash);
  return data;
}

/**
 * Clear signer key for a recipient (after emptying wallet)
 */
export async function clearCompanionWallet(
  recipientAddress: string
): Promise<{ success: boolean; deleted: boolean }> {
  console.log("[Companion API Client] Clearing companion wallet for:", recipientAddress);
  
  const response = await fetch(`/api/companion?recipient=${encodeURIComponent(recipientAddress)}`, {
    method: "DELETE",
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Failed to clear companion wallet");
  }
  
  return data;
}

/**
 * Get companion wallet balance on Base
 */
export async function getCompanionBalanceFromApi(
  companionAddress: string
): Promise<{ eth: string; ethWei: string }> {
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

  return {
    eth: balanceEth,
    ethWei: BigInt(balanceWei).toString(),
  };
}

/**
 * Get payment history (admin endpoint)
 */
export async function getPaymentHistory(): Promise<{ payments: PaymentLog[]; count: number }> {
  console.log("[Companion API Client] Fetching payment history...");
  
  const response = await fetch("/api/companion", {
    method: "PATCH", // Using PATCH for admin endpoint
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch payment history");
  }
  
  console.log("[Companion API Client] Got", data.count, "payment records");
  return data;
}
