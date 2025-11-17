import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { BLOCKCHAIN_EXPLORERS } from './constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString();
}

export function usdtToFriendlyUnits(units: number) {
  return (units) * 1000000;
}

export function friendlyUnitsToUsdt(units: number) {
  return (units) / 1000000;
}

export function buildDealLink(dealId: string) {
  return `${process.env.NEXT_PUBLIC_WEB_LINK}/deal/${dealId}`
}

export function toFriendlyAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 3)}...${address.slice(-3)}`;
}

export function engagementRateScore(rate: number): string {

  if (rate >= 0.05) return 'A+';
  if (rate >= 0.04) return 'A';
  if (rate >= 0.03) return 'B';
  if (rate >= 0.02) return 'C';
  return 'D';

}

export const GIVEAWAY__FEE = 10;
export const MIN_GIVEAWAY_PRIZE = 20;
export const POINTS_FOLLOW_COST = 300;
export const USDT_FOLLOW_COST = 10;
export const POINTS_PAYMENT_MIN_AMOUNT = 100;
export const UNLOCK_CREATORS_ACCESS_AMOUNT = 99;

/**
 * Constructs a blockchain explorer URL for a transaction hash
 * @param txHash - The transaction hash
 * @param network - The network ('taraxa' | 'eth')
 * @returns The full transaction URL
 */
export function getTransactionUrl(txHash: string, network: 'taraxa' | 'eth'): string {
  const baseUrl = BLOCKCHAIN_EXPLORERS[network];
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Attempts to determine the network from a transaction hash
 * This is a fallback when network information is not available
 * @param txHash - The transaction hash
 * @returns The detected network or 'taraxa' as default
 */
export function detectNetworkFromTxHash(txHash: string): 'taraxa' | 'eth' {
  // Ethereum transaction hashes are 66 characters long (0x + 64 hex chars)
  // Taraxa transaction hashes are typically 66 characters as well
  // For now, we'll default to 'taraxa' since that's the primary network
  // In the future, this could be enhanced with more sophisticated detection
  return 'taraxa';
}

