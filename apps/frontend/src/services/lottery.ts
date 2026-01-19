import { encodeFunctionData } from "viem";

// TicketAutomator contract ABI
// Contract: https://basescan.org/address/0xd1950a138328b52da4fe73dbdb167a83f2c83db9
// 
// Using buyTicketsWithLoan(address receiver, bytes32 refCode) - same as Across Protocol
// This function:
// - Automatically uses maxLoops (100)
// - Handles the loan mechanism for gas efficiency
// - Returns leftover ETH to receiver
// - Accepts a referral code

const TICKET_AUTOMATOR_ABI = [
  {
    name: "buyTicketsWithLoan",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "refCode", type: "bytes32" }
    ],
    outputs: [
      { name: "ticketCount", type: "uint256" },
      { name: "ethBackAmount", type: "uint256" }
    ]
  }
] as const;

// Referral code for Loofta (padded to bytes32 = 64 hex chars)
// "LOOFTA" in hex: L=4c O=4f O=4f F=46 T=54 A=41
const LOOFTA_REF_CODE = "0x4c4f4f4654410000000000000000000000000000000000000000000000000000" as `0x${string}`;

/**
 * Encode function call to ticketAutomator contract
 * Uses buyTicketsWithLoan(address receiver, bytes32 refCode) - same as Across Protocol
 */
export function encodeTicketPurchase(
  recipientAddress: string,
  numTickets: number // Note: This is approximate - actual tickets depend on ETH amount
): string {
  console.log("[Lottery] Encoding ticket purchase calldata:");
  console.log("[Lottery]   Function: buyTicketsWithLoan(address receiver, bytes32 refCode)");
  console.log("[Lottery]   Receiver address:", recipientAddress);
  console.log("[Lottery]   Ref code:", LOOFTA_REF_CODE);
  console.log("[Lottery]   (Note: numTickets is approximate, actual depends on ETH sent)");
  
  try {
    const calldata = encodeFunctionData({
      abi: TICKET_AUTOMATOR_ABI,
      functionName: "buyTicketsWithLoan",
      args: [recipientAddress as `0x${string}`, LOOFTA_REF_CODE],
    });
    
    console.log("[Lottery] ✓ Calldata encoded successfully");
    console.log("[Lottery]   Full calldata:", calldata);
    console.log("[Lottery]   Expected selector: 0x07f4ab99 (buyTicketsWithLoan)");
    console.log("[Lottery]   Actual selector:", calldata.slice(0, 10));
    
    // Verify the function selector matches what Across uses
    if (calldata.slice(0, 10).toLowerCase() === "0x07f4ab99") {
      console.log("[Lottery] ✓ CONFIRMED: Function selector matches Across Protocol!");
    } else {
      console.warn("[Lottery] ⚠️ WARNING: Function selector mismatch!");
    }
    
    // Verify recipient address appears in calldata
    const recipientInCalldata = calldata.toLowerCase().includes(recipientAddress.toLowerCase().slice(2));
    if (recipientInCalldata) {
      console.log("[Lottery] ✓ CONFIRMED: Receiver address is present in calldata!");
    } else {
      console.warn("[Lottery] ⚠️ WARNING: Receiver address not found in calldata!");
    }
    
    return calldata;
  } catch (error) {
    console.error("[Lottery] Failed to encode ticket purchase:", error);
    throw error;
  }
}

/**
 * Get the ticketAutomator contract address on Base
 */
export function getTicketAutomatorAddress(): string {
  return "0xd1950a138328b52da4fe73dbdb167a83f2c83db9";
}

