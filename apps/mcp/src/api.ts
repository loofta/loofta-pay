export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(api: string, path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const m = data?.message;
    const msg = typeof m === 'string' ? m : m?.message ?? data?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, m?.code ?? data?.code ?? data?.error ?? 'error', Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return data as T;
}

export interface PaymentInput {
  payments: Array<{ recipient: string; amount_usd: number }>;
  privately?: boolean;
  delay_minutes?: number;
  split?: number;
}

export const loofta = (api: string, token: string) => ({
  me: () => request<any>(api, '/agent/v1/me', { token }),
  quote: (b: PaymentInput) => request<any>(api, '/agent/v1/quote', { token, body: b }),
  pay: (b: PaymentInput, idempotencyKey: string) => request<any>(api, '/agent/v1/payments', { token, body: b, headers: { 'Idempotency-Key': idempotencyKey } }),
  get: (id: string) => request<any>(api, `/agent/v1/payments/${encodeURIComponent(id)}`, { token }),
  contacts: (limit = 30) => request<any>(api, `/agent/v1/contacts?limit=${limit}`, { token }),
  lookup: (recipient: string) => request<any>(api, `/agent/v1/lookup?recipient=${encodeURIComponent(recipient)}`, { token }),
  list: (limit = 20) => request<any>(api, `/agent/v1/payments?limit=${limit}`, { token }),
});

export const authApi = (api: string) => ({
  start: (label: string) => request<{ device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }>(api, '/agent/auth/device', { body: { label } }),
  poll: async (deviceCode: string) => {
    try {
      return { ok: true as const, data: await request<{ access_token: string; expires_at: string }>(api, '/agent/auth/token', { body: { device_code: deviceCode } }) };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false as const, error: e.code };
      throw e;
    }
  },
});
export { request };
