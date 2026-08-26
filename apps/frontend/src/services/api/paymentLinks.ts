/**
 * POST /payment-links — authed with a raw integrator API key (not a Privy access token), so this
 * intentionally does not touch useAuth()/getAccessToken() anywhere in this file.
 */

import { fetchApi } from './client';

export interface CreatedPaymentLink {
  short_id: string;
  url: string;
  amount: number;
  message: string | null;
  webhook_secret: string | null;
}

export async function createPaymentLinkWithKey(
  apiKey: string,
  input: { amount: number; message?: string; isPrivate?: boolean; webhookUrl?: string },
): Promise<CreatedPaymentLink> {
  // fetchApi's `accessToken` option only ever becomes `Authorization: Bearer <value>` — reused
  // here for the raw API key, which is exactly what IntegratorGuard expects on this endpoint.
  return fetchApi<CreatedPaymentLink>('/payment-links', {
    method: 'POST',
    accessToken: apiKey,
    body: JSON.stringify({
      amount: input.amount,
      message: input.message,
      is_private: input.isPrivate,
      webhook_url: input.webhookUrl,
    }),
  });
}

export interface PaymentLinkStatus {
  short_id: string;
  status: string;
  amount: number;
  message: string | null;
  paid_at: string | null;
}

export async function getPaymentLinkStatusWithKey(apiKey: string, shortId: string): Promise<PaymentLinkStatus> {
  return fetchApi<PaymentLinkStatus>(`/payment-links/${shortId}`, { accessToken: apiKey });
}
