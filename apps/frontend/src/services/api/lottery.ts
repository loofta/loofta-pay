/**
 * Lottery API Service
 * 
 * Handles lottery-related operations:
 * - Contract info
 * - Ticket purchases
 * - ETH calculations
 */

import { fetchApi } from './client';

// ===========================================
// Types
// ===========================================

export interface LotteryContractInfo {
  address: string;
  chain: string;
  chainId: number;
  referralCode: string;
  ticketPrice?: string;
}

export interface TicketPurchaseParams {
  numTickets: number;
  referralCode: string;
  recipient: string;
}

export interface EncodedTransaction {
  to: string;
  data: string;
  value: string;
}

export interface TicketEstimate {
  ethAmount: number;
  estimatedTickets: number;
  ticketPrice: number;
}

export interface EthCalculation {
  tickets: number;
  ethNeeded: number;
  ticketPrice: number;
}

// ===========================================
// API Functions
// ===========================================

/**
 * Get lottery contract info
 */
export async function getContractInfo(): Promise<LotteryContractInfo> {
  return fetchApi<LotteryContractInfo>('/lottery/contract');
}

/**
 * Encode a ticket purchase transaction
 */
export async function encodeTicketPurchase(
  params: TicketPurchaseParams
): Promise<EncodedTransaction> {
  return fetchApi<EncodedTransaction>('/lottery/encode', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * Estimate tickets for a given ETH amount
 */
export async function estimateTickets(ethAmount: string): Promise<TicketEstimate> {
  return fetchApi<TicketEstimate>(`/lottery/estimate?ethAmount=${ethAmount}`);
}

/**
 * Calculate ETH needed for a number of tickets
 */
export async function calculateEthNeeded(numTickets: number): Promise<EthCalculation> {
  return fetchApi<EthCalculation>(`/lottery/calculate-eth?tickets=${numTickets}`);
}

// ===========================================
// Default export
// ===========================================

export const lotteryApi = {
  getContractInfo,
  encodeTicketPurchase,
  estimateTickets,
  calculateEthNeeded,
};
