/**
 * Private Deposit / Private Withdrawal API — burner-relay MagicBlock private transfers.
 * Backend: POST/GET /private-balance/*
 */

import { fetchApi } from './client';
import type { MagicblockTxResponse } from '../magicblockPaymentsApi';

export type PrivateTransferDirection = 'deposit' | 'withdrawal';

export type PrivateTransferStatus =
  | 'awaiting_funds'
  | 'delivering_privately'
  | 'awaiting_signature'
  | 'delivering_to_burner'
  | 'bridging'
  | 'complete'
  | 'failed';

export interface PrivateTokenRef {
  symbol: string;
  chain: string;
}

export interface PrivateTransferStatusResponse {
  id: string;
  direction: PrivateTransferDirection;
  status: PrivateTransferStatus;
  amountRequestedUsdc: number;
  depositAddress?: string;
  depositMemo?: string | null;
  destinationAddress?: string | null;
  leg1TxSignature?: string | null;
  leg2TxSignature?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** USDC on Solana direct — omit sourceToken/sourceAmount. */
export async function startPrivateDeposit(
  amountUsdc: number,
  userId: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
  schedule?: { split?: number; maxDelayMs?: number },
): Promise<{ id: string; depositAddress: string; memo?: string | null; amountToSendUsdc?: number; feeEstimateUsdc?: number }> {
  return fetchApi(`/private-balance/deposit/start`, {
    method: 'POST',
    body: JSON.stringify({
      amount_usdc: amountUsdc,
      cluster,
      ...(schedule?.split ? { split: schedule.split } : {}),
      ...(schedule?.maxDelayMs != null ? { max_delay_ms: schedule.maxDelayMs } : {}),
    }),
    userId,
    accessToken,
  });
}

/** Any Near-Intents-supported source token — bridges into the burner, then delivers privately once it lands. */
export async function startPrivateDepositCrossChain(
  sourceToken: PrivateTokenRef,
  sourceAmount: number,
  userId: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
): Promise<{ id: string; depositAddress: string; memo?: string | null }> {
  return fetchApi(`/private-balance/deposit/start`, {
    method: 'POST',
    body: JSON.stringify({ source_token: sourceToken, source_amount: sourceAmount, cluster }),
    userId,
    accessToken,
  });
}

/** Direct private deposit: a connected external wallet -> the caller's own wallet, no burner. */
export async function buildDirectPrivateDeposit(
  amountUsdc: number,
  sourceWalletAddress: string,
  userId: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
  schedule?: { split?: number; maxDelayMs?: number },
): Promise<MagicblockTxResponse> {
  return fetchApi(`/private-balance/deposit/build-direct`, {
    method: 'POST',
    body: JSON.stringify({
      amount_usdc: amountUsdc,
      source_wallet_address: sourceWalletAddress,
      cluster,
      ...(schedule?.split ? { split: schedule.split } : {}),
      ...(schedule?.maxDelayMs != null ? { max_delay_ms: schedule.maxDelayMs } : {}),
    }),
    userId,
    accessToken,
  });
}

export async function buildPrivateWithdrawal(
  amountUsdc: number,
  destinationAddress: string,
  userId: string,
  accessToken?: string | null,
  cluster?: 'devnet' | 'mainnet',
  destinationToken?: PrivateTokenRef,
  timing?: { split?: number; maxDelayMs?: number },
): Promise<{ id: string } & MagicblockTxResponse> {
  return fetchApi(`/private-balance/withdrawal/build`, {
    method: 'POST',
    body: JSON.stringify({
      amount_usdc: amountUsdc,
      destination_address: destinationAddress,
      cluster,
      ...(destinationToken ? { destination_token: destinationToken } : {}),
      ...(timing?.split !== undefined ? { split: timing.split } : {}),
      ...(timing?.maxDelayMs !== undefined ? { max_delay_ms: Math.round(timing.maxDelayMs) } : {}),
    }),
    userId,
    accessToken,
  });
}

export async function recordPrivateWithdrawalSignature(
  id: string,
  signature: string,
  userId: string,
  accessToken?: string | null,
): Promise<void> {
  await fetchApi<{ ok: boolean }>(`/private-balance/withdrawal/${id}/signature`, {
    method: 'POST',
    body: JSON.stringify({ signature }),
    userId,
    accessToken,
  });
}

export async function getPrivateTransferStatus(
  id: string,
  userId: string,
  accessToken?: string | null,
): Promise<PrivateTransferStatusResponse> {
  return fetchApi(`/private-balance/${id}`, { userId, accessToken });
}

export type PrivateTokenWithdrawalBuild = {
  transactionBase64: string;
  version: 'legacy' | 'v0';
  sendTo: 'base' | 'ephemeral';
  mint: string;
  decimals: number;
  /** Total privacy fee in the token itself (MagicBlock volume fee plus Loofta's cut). */
  feeAmountToken: number;
  /** Same fee in USD at the price the backend used. */
  feeAmountUsd: number;
  /** Network fee the sender pays in SOL (private transfers of non-stablecoins are not gasless). */
  networkFeeSol: number;
};

export async function buildPrivateTokenWithdrawal(
  params: { mint: string; amount: string; destinationAddress: string; split?: number; maxDelayMs?: number },
  userId: string,
  accessToken?: string | null,
): Promise<PrivateTokenWithdrawalBuild> {
  return fetchApi(`/private-balance/withdrawal/build-token`, {
    method: 'POST',
    body: JSON.stringify({
      mint: params.mint,
      amount: params.amount,
      destination_address: params.destinationAddress,
      ...(params.split !== undefined ? { split: params.split } : {}),
      ...(params.maxDelayMs !== undefined ? { max_delay_ms: Math.round(params.maxDelayMs) } : {}),
    }),
    userId,
    accessToken,
  });
}
