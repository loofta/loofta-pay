/**
 * PAJ Cash (Naira on/off-ramp) API — backend: /paj-cash/*
 *
 * Uses a dedicated fetch wrapper (not the shared `fetchApi`) because the backend returns a
 * structured `{ code, message }` body for specific error cases (PAJ_LINK_REQUIRED, KYC_REQUIRED)
 * that the UI branches on — the shared client collapses error bodies into a plain Error(message)
 * and would lose the `code` field.
 */

import { BACKEND_URL } from './api/client';

export class PajCashApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PajCashApiError';
    this.code = code;
  }
}

async function pajCashFetch<T>(
  endpoint: string,
  opts: (RequestInit & { accessToken?: string | null }) = {},
): Promise<T> {
  const { accessToken, headers, ...rest } = opts;
  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...((headers as Record<string, string>) ?? {}),
    },
  });

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const obj = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
    const message = typeof obj.message === 'string' ? obj.message : `Request failed (${res.status})`;
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    throw new PajCashApiError(message, code);
  }

  return data as T;
}

export type PajLinkStatus = { linked: boolean; expiresAt: string | null; kycStatus: string };

export type PajBank = { id: string; code: string; name: string; logo?: string; country: string };

export type PajResolvedBankAccount = {
  accountName: string;
  accountNumber: string;
  bank: { id: string; name: string; code: string; country: string };
};

export type PajSavedBankAccount = {
  id: string;
  user_id: string;
  paj_bank_account_id: string;
  bank_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  created_at: string;
};

export type PajValueQuote = { amount: number; fiatAmount: number; mint: string; currency: string; rate: number };

export type PajOrderStatus =
  | 'CREATED' | 'AWAITING_PAYMENT' | 'USDC_SENT' | 'PAJ_PAID' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

export type PajCashOrder = {
  id: string;
  user_id: string;
  direction: 'ON_RAMP' | 'OFF_RAMP';
  paj_order_id: string | null;
  currency: string;
  fiat_amount: number | null;
  amount_usdc: number | null;
  rate: number | null;
  fee_usdc: number | null;
  onramp_bank_name: string | null;
  onramp_account_number: string | null;
  onramp_account_name: string | null;
  offramp_deposit_address: string | null;
  offramp_bank_account_id: string | null;
  offramp_tx_signature: string | null;
  status: PajOrderStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export const PAJ_TERMINAL_STATUSES: PajOrderStatus[] = ['COMPLETE', 'FAILED', 'CANCELLED', 'EXPIRED'];

export async function pajLinkInitiate(recipient: string, accessToken: string | null): Promise<{ sent: boolean }> {
  return pajCashFetch('/paj-cash/link/initiate', { method: 'POST', body: JSON.stringify({ recipient }), accessToken });
}

export async function pajLinkVerify(
  recipient: string,
  otp: string,
  deviceUuid: string,
  accessToken: string | null,
): Promise<{ linked: boolean; expiresAt: string }> {
  return pajCashFetch('/paj-cash/link/verify', {
    method: 'POST',
    body: JSON.stringify({ recipient, otp, deviceUuid, os: navigator.platform, browser: navigator.userAgent.slice(0, 64) }),
    accessToken,
  });
}

export async function pajLinkStatus(accessToken: string | null): Promise<PajLinkStatus> {
  return pajCashFetch('/paj-cash/link/status', { accessToken });
}

export async function pajGetValue(
  direction: 'onramp' | 'offramp',
  amount: number,
  currency: string,
  accessToken: string | null,
): Promise<PajValueQuote> {
  const qs = new URLSearchParams({ direction, amount: String(amount), currency });
  return pajCashFetch(`/paj-cash/value?${qs}`, { accessToken });
}

export async function pajListBanks(accessToken: string | null): Promise<PajBank[]> {
  return pajCashFetch('/paj-cash/banks', { accessToken });
}

export async function pajConfirmBankAccount(bankId: string, accountNumber: string, accessToken: string | null): Promise<PajResolvedBankAccount> {
  const qs = new URLSearchParams({ bankId, accountNumber });
  return pajCashFetch(`/paj-cash/bank-account/confirm?${qs}`, { accessToken });
}

export async function pajSaveBankAccount(bankId: string, bankName: string, accountNumber: string, accessToken: string | null): Promise<PajSavedBankAccount> {
  return pajCashFetch('/paj-cash/bank-account', { method: 'POST', body: JSON.stringify({ bankId, bankName, accountNumber }), accessToken });
}

export async function pajListBankAccounts(accessToken: string | null): Promise<PajSavedBankAccount[]> {
  return pajCashFetch('/paj-cash/bank-account', { accessToken });
}

export async function pajSubmitKyc(idNumber: string, idType: 'BVN' | 'NIN', accessToken: string | null): Promise<{ message: string }> {
  return pajCashFetch('/paj-cash/kyc', { method: 'POST', body: JSON.stringify({ idNumber, idType, country: 'NG' }), accessToken });
}

export async function pajCreateOnramp(amountUsdc: number, accessToken: string | null): Promise<PajCashOrder> {
  return pajCashFetch('/paj-cash/onramp', { method: 'POST', body: JSON.stringify({ amountUsdc, currency: 'NGN' }), accessToken });
}

export async function pajCreateOfframp(bankAccountId: string, amountUsdc: number, accessToken: string | null): Promise<PajCashOrder> {
  return pajCashFetch('/paj-cash/offramp', { method: 'POST', body: JSON.stringify({ bankAccountId, amountUsdc, currency: 'NGN' }), accessToken });
}

export async function pajConfirmOfframpSent(orderId: string, txSignature: string, accessToken: string | null): Promise<PajCashOrder> {
  return pajCashFetch(`/paj-cash/offramp/${orderId}/confirm-sent`, { method: 'POST', body: JSON.stringify({ txSignature }), accessToken });
}

export async function pajListOrders(accessToken: string | null): Promise<PajCashOrder[]> {
  return pajCashFetch('/paj-cash/orders', { accessToken });
}

export async function pajGetOrder(orderId: string, accessToken: string | null): Promise<PajCashOrder> {
  return pajCashFetch(`/paj-cash/orders/${orderId}`, { accessToken });
}
