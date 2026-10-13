/** Whether a send recipient already has a Loofta account, and whether they only accept
 *  private payments. */

export type PayTarget = { registered: boolean; requirePrivatePayments: boolean };
export type PayTargetKind = "email" | "username" | "twitter" | "social";

const EMPTY: PayTarget = { registered: false, requirePrivatePayments: false };

/** True when the typed recipient is an email, even if the Social tab is still selected. */
export function isEmailRecipient(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().replace(/^@+/, ""));
}

/** Pick the pay-target kind from what was typed, not just the selected tab.
 *  An email in the social/handle field must look up as email — otherwise a registered
 *  account is treated as an unknown Twitter handle and the $0.10 claim fee appears. */
export function resolvePayTargetQuery(opts: {
  recipient: string;
  method: "email" | "social" | "username";
  socialPlatform?: string | null;
}): { kind: PayTargetKind; value: string; platform?: string } | null {
  const value = opts.recipient.replace(/^@+/, "").trim();
  if (value.length < 2) return null;
  if (isEmailRecipient(value) || opts.method === "email") {
    return { kind: "email", value: value.toLowerCase() };
  }
  if (opts.method === "username" || opts.socialPlatform === "loofta") {
    return { kind: "username", value: `loo-${value.replace(/^loo-/i, "")}` };
  }
  if (!opts.socialPlatform || opts.socialPlatform === "twitter") {
    return { kind: "twitter", value };
  }
  return { kind: "social", value, platform: opts.socialPlatform };
}

export function payTargetQueryKey(
  query: { kind: string; value: string; platform?: string } | null,
): string {
  return query ? `${query.kind}:${query.value.toLowerCase()}:${query.platform ?? ""}` : "";
}

export async function lookupPayTarget(
  params: { kind: PayTargetKind; value: string; platform?: string },
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
