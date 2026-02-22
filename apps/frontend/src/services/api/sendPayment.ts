/**
 * Send Payment API – create link, get public details, claim, reclaim
 * Backend: POST/GET /send-payment/*
 */

import { fetchApi } from './client';

export type SendPaymentStatus = 'OPEN' | 'FUNDED' | 'CLAIMED' | 'CANCELLED' | 'EXPIRED';
export type RecipientType = 'email' | 'twitter';

export interface SendPaymentLinkPublic {
  id: string;
  amount: string;
  token: string;
  chain: string;
  recipient_type: RecipientType;
  status: SendPaymentStatus;
  message?: string | null;
  deposit_address?: string | null;
  burner_address?: string | null;
  /** SOL lamports to send to burner for claim gas (e.g. 500000 = 0.0005 SOL). */
  required_sol_lamports?: number;
  is_sender?: boolean;
}

export interface CreateSendPaymentInput {
  amount: number;
  recipient_type: RecipientType;
  recipient_identifier: string;
  message?: string;
}

export interface CreateSendPaymentResult {
  id: string;
  link: string;
  deposit_address: string;
  burner_address: string;
  /** SOL lamports sender should send to burner for claim gas (0.0005 SOL). */
  required_sol_lamports: number;
  amount: string;
  token: string;
}

export interface ClaimSendPaymentResult {
  claim_tx_hash: string;
  amount_received: string;
}

export interface ReclaimSendPaymentResult {
  reclaim_tx_hash: string;
  amount_reclaimed: string;
}

export async function createSendPayment(
  input: CreateSendPaymentInput,
  userId: string
): Promise<CreateSendPaymentResult> {
  return fetchApi<CreateSendPaymentResult>('/send-payment/create', {
    method: 'POST',
    body: JSON.stringify(input),
    userId,
  });
}

export interface MySendPaymentLinkItem {
  id: string;
  amount: string;
  token: string;
  status: string;
  recipient_type: string;
  created_at: string;
}

export async function getMySendPaymentLinks(userId: string): Promise<MySendPaymentLinkItem[]> {
  return fetchApi<MySendPaymentLinkItem[]>('/send-payment/my-links', { userId });
}

export async function getSendPaymentPublic(
  id: string,
  userId?: string
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}`, { userId });
}

export async function confirmSendPaymentFunded(
  id: string,
  depositTxHash: string | null,
  userId: string
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}/confirm-funded`, {
    method: 'POST',
    body: JSON.stringify({ deposit_tx_hash: depositTxHash || undefined }),
    userId,
  });
}

export async function claimSendPayment(
  id: string,
  userId: string,
  options?: { forward_to?: { chain: string; token: string; address: string } }
): Promise<ClaimSendPaymentResult> {
  return fetchApi<ClaimSendPaymentResult>(`/send-payment/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
    userId,
  });
}

export async function reclaimSendPayment(
  id: string,
  userId: string
): Promise<ReclaimSendPaymentResult> {
  return fetchApi<ReclaimSendPaymentResult>(`/send-payment/${id}/reclaim`, {
    method: 'POST',
    body: JSON.stringify({}),
    userId,
  });
}

/** Session message for Privacy Cash (must match backend/relayer). */
export const PRIVACY_SESSION_MESSAGE = 'Privacy Money account sign in';

export interface PreparePrivateResult {
  unsigned_deposit_tx: string;
  last_valid_block_height: number;
  activity_id: string;
  passphrase: string;
  /** When true, backend pays gas; send signed tx to submit-private instead of broadcasting. */
  use_sponsor_used?: boolean;
  /** Privacy Cash fees (sender pays so recipient gets full amount). */
  fee_usdc: number;
  /** Total USDC to deposit (recipient amount + fees). */
  total_deposit_usdc: number;
  /** Optional: unsigned SOL tx (sender → burner) for claim gas; sign and send in submit. */
  unsigned_sol_tx?: string;
}

export async function prepareSendPaymentPrivate(
  id: string,
  senderPublicKey: string,
  sessionSignatureBase64: string,
  userId: string,
  options?: { useSponsor?: boolean }
): Promise<PreparePrivateResult> {
  const data = await fetchApi<{
    unsignedDepositTx: string;
    lastValidBlockHeight: number;
    activityId: string;
    passphrase: string;
    useSponsorUsed?: boolean;
    feeUsdc: number;
    totalDepositUsdc: number;
    unsignedSolTx?: string;
  }>(`/send-payment/${id}/prepare-private`, {
    method: 'POST',
    headers: {
      'X-Session-Signature': sessionSignatureBase64,
    },
    body: JSON.stringify({
      sender_public_key: senderPublicKey,
      use_sponsor: options?.useSponsor === true,
    }),
    userId,
  });
  return {
    unsigned_deposit_tx: data.unsignedDepositTx,
    last_valid_block_height: data.lastValidBlockHeight,
    activity_id: data.activityId,
    passphrase: data.passphrase,
    use_sponsor_used: data.useSponsorUsed,
    fee_usdc: data.feeUsdc,
    total_deposit_usdc: data.totalDepositUsdc,
    unsigned_sol_tx: data.unsignedSolTx,
  };
}

export async function submitSendPaymentPrivate(
  id: string,
  body: {
    signed_deposit_tx: string;
    activity_id: string;
    sender_public_key: string;
    last_valid_block_height?: number;
    passphrase: string;
    /** Optional: signed SOL tx (sender → burner) for claim gas; base64. */
    signed_sol_tx?: string;
  },
  sessionSignatureBase64: string,
  userId: string
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}/submit-private`, {
    method: 'POST',
    headers: {
      'X-Session-Signature': sessionSignatureBase64,
    },
    body: JSON.stringify({
      signed_deposit_tx: body.signed_deposit_tx,
      activity_id: body.activity_id,
      sender_public_key: body.sender_public_key,
      last_valid_block_height: body.last_valid_block_height,
      passphrase: body.passphrase,
      signed_sol_tx: body.signed_sol_tx,
    }),
    userId,
  });
}

/** Get fully signed deposit tx (backend adds sponsor sig). Frontend sends this tx then calls completeSendPaymentPrivateWithSignature. */
export async function getSignedSendPaymentPrivateTx(
  id: string,
  body: {
    signed_deposit_tx: string;
    activity_id: string;
    sender_public_key: string;
    last_valid_block_height?: number;
    passphrase: string;
  },
  sessionSignatureBase64: string,
  userId: string
): Promise<{ signed_deposit_tx: string }> {
  return fetchApi<{ signed_deposit_tx: string }>(`/send-payment/${id}/private/signed-tx`, {
    method: 'POST',
    headers: {
      'X-Session-Signature': sessionSignatureBase64,
    },
    body: JSON.stringify({
      signed_deposit_tx: body.signed_deposit_tx,
      activity_id: body.activity_id,
      sender_public_key: body.sender_public_key,
      last_valid_block_height: body.last_valid_block_height,
      passphrase: body.passphrase,
    }),
    userId,
  });
}

/** Complete private claim after frontend has sent the deposit tx (no SOL needed; tx sent from client). */
export async function completeSendPaymentPrivateWithSignature(
  id: string,
  body: {
    deposit_tx_signature: string;
    activity_id: string;
    sender_public_key: string;
    last_valid_block_height?: number;
    passphrase: string;
  },
  sessionSignatureBase64: string,
  userId: string
): Promise<SendPaymentLinkPublic> {
  return fetchApi<SendPaymentLinkPublic>(`/send-payment/${id}/private/complete`, {
    method: 'POST',
    headers: {
      'X-Session-Signature': sessionSignatureBase64,
    },
    body: JSON.stringify({
      deposit_tx_signature: body.deposit_tx_signature,
      activity_id: body.activity_id,
      sender_public_key: body.sender_public_key,
      last_valid_block_height: body.last_valid_block_height,
      passphrase: body.passphrase,
    }),
    userId,
  });
}
