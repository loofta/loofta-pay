import { fetchApi } from './client';

export type TicketStatus =
  | 'pending_send'
  | 'sent'
  | 'bridging'
  | 'buying'
  | 'active'
  | 'won'
  | 'lost'
  | 'failed'
  | 'withdrawn';

export interface LotteryTicketSummary {
  id: string;
  status: TicketStatus;
  numTickets: number;
  costUsdc: number;
  roundId: string | null;
  drawTime: string | null;
  winAmountUsdc: number | null;
  winTier: number | null;
  createdAt: string;
  depositAddress: string | null;
  bridgeStatus: string | null;
  bridgeExpiresAt: string | null;
  ticketNumbers: { main: number[]; bonus: number }[] | null;
  winningNumbers: { main: number[]; bonus: number } | null;
  /** True when this ticket came from claiming a gift, not a self-purchase — excluded from spend. */
  isGift: boolean;
  /** Backend-authoritative: a won ticket below the withdrawal floor, shown as "Free ticket". */
  isFreeTicket?: boolean;
}

export interface LotteryWithdrawalSummary {
  id: string;
  ticketId: string;
  route: 'base' | 'solana_private';
  destinationAddress: string;
  amountUsdc: number;
  status: string;
  createdAt: string;
}

export interface LotteryDashboard {
  activeTickets: LotteryTicketSummary[];
  history: LotteryTicketSummary[];
  withdrawals: LotteryWithdrawalSummary[];
  stats: { totalSpent: number; totalWon: number; netPnl: number; ticketCount: number };
  nextDraw: { roundId: string | null; drawTime: string | null; prizePool: string | null };
  /** Withdrawal floor (USDC) from the backend — below it a win is a "free ticket". */
  withdrawMinUsdc?: number;
}

export async function getDashboard(accessToken: string | null): Promise<LotteryDashboard> {
  return fetchApi('/lottery/dashboard', { accessToken });
}

export async function getHistory(
  offset: number,
  limit: number,
  accessToken: string | null,
): Promise<{ tickets: LotteryTicketSummary[]; total: number }> {
  return fetchApi(`/lottery/history?offset=${offset}&limit=${limit}`, { accessToken });
}

export async function getTicketStatus(ticketId: string, accessToken: string | null): Promise<LotteryTicketSummary | null> {
  return fetchApi(`/lottery/status/${ticketId}`, { accessToken });
}

// ─── Buy (self) ─────────────────────────────────────────────────────────────

export interface InitiatePurchaseResult {
  ticketId: string;
  txBase64: string;
  requiredSigners: string[];
}

export async function buyTickets(
  numTickets: number,
  userSolanaAddress: string,
  accessToken: string | null,
): Promise<InitiatePurchaseResult> {
  return fetchApi('/lottery/buy', {
    method: 'POST',
    body: JSON.stringify({ numTickets, userSolanaAddress }),
    accessToken,
  });
}

export async function confirmBuyFee(ticketId: string, feeTxHash: string, accessToken: string | null): Promise<{ ok: boolean }> {
  return fetchApi('/lottery/buy-fee-confirm', {
    method: 'POST',
    body: JSON.stringify({ ticketId, feeTxHash }),
    accessToken,
  });
}

/** Cancels a still-pending_send ticket (no funds sent yet) — e.g. the user backed out of the
 *  Seeker signing prompt. Safe to call speculatively: the backend only actually cancels while the
 *  ticket is still pending_send, and no-ops (throws, harmless to ignore) once funds are in transit. */
export async function cancelTicket(ticketId: string, accessToken: string | null): Promise<{ ok: boolean }> {
  return fetchApi(`/lottery/tickets/${ticketId}`, { method: 'DELETE', accessToken });
}

export async function confirmBuy(ticketId: string, senderTxHash: string, accessToken: string | null): Promise<{ ok: boolean }> {
  return fetchApi('/lottery/buy-confirm', {
    method: 'POST',
    body: JSON.stringify({ ticketId, senderTxHash }),
    accessToken,
  });
}

// ─── Buy (public / non-private) ────────────────────────────────────────────

export interface InitiatePublicPurchaseResult {
  ticketId: string;
  depositAddress: string;
  amountUsdc: number;
  txBase64: string;
}

export async function buyTicketsPublic(
  numTickets: number,
  userSolanaAddress: string,
  accessToken: string | null,
): Promise<InitiatePublicPurchaseResult> {
  return fetchApi('/lottery/buy-public', {
    method: 'POST',
    body: JSON.stringify({ numTickets, userSolanaAddress }),
    accessToken,
  });
}

// ─── Redeem / withdraw ──────────────────────────────────────────────────────
// Entirely server-side — no wallet signature needed. The backend already controls the
// companion/burner wallets from the original purchase; it just needs to know where to send the
// funds.

export async function getBridgeFee(amountUsdc: number, accessToken: string | null): Promise<{ feeUsd: number; receiveUsdc: number }> {
  return fetchApi(`/lottery/bridge-fee?amountUsdc=${amountUsdc}`, { accessToken });
}

export async function withdrawBatch(
  ticketIds: string[],
  destinationAddress: string,
  accessToken: string | null,
): Promise<{ withdrawalIds: string[]; batchId: string }> {
  return fetchApi('/lottery/withdraw-batch', {
    method: 'POST',
    body: JSON.stringify({ ticketIds, destinationAddress }),
    accessToken,
  });
}

/** Claim a won ticket's winnings and reinvest them into new tickets on the same companion wallet — no bridge, no fees. */
export async function playAgain(
  ticketId: string,
  accessToken: string | null,
): Promise<{ newTicketId: string; numTickets: number; roundId: string | null }> {
  return fetchApi(`/lottery/tickets/${ticketId}/play-again`, {
    method: 'POST',
    accessToken,
  });
}
