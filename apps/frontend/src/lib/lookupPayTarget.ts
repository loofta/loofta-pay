/** Whether a send recipient already has a Loofta account, and whether they only accept
 *  private payments. Never includes a wallet or email. */

export type PayTarget = { registered: boolean; requirePrivatePayments: boolean };

const EMPTY: PayTarget = { registered: false, requirePrivatePayments: false };

export async function lookupPayTarget(
  params: { kind: "email" | "username" | "twitter" | "social"; value: string; platform?: string },
  signal?: AbortSignal,
): Promise<PayTarget> {
  const q = new URLSearchParams({ kind: params.kind, value: params.value });
  if (params.platform) q.set("platform", params.platform);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const r = await fetch(`${backendUrl}/users/pay-target?${q}`, { signal });
  if (!r.ok) return EMPTY;
  const body = (await r.json()) as Partial<PayTarget>;
  return {
    registered: !!body.registered,
    requirePrivatePayments: !!body.requirePrivatePayments,
  };
}
