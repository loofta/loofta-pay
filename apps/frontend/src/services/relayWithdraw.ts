import { clientApiBase } from "@/services/api/client";

export type RelayPreview = {
  amountOutFormatted: string | null;
  /** USDC added on top of the amount to cover the sponsored network cost. */
  feeUsdc: number;
};

export type RelayPreparedOrder = {
  /** Pass as nearIntentsOrderId so the sponsor can bind the ATA it pays for to this order. */
  id: string;
  depositAddress: string;
  requestId: string;
  feeUsdc: number;
  amountOutFormatted: string | null;
};

async function post<T>(path: string, body: unknown, accessToken?: string | null): Promise<T> {
  const r = await fetch(`${clientApiBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text) as { message?: string | string[] };
      if (j?.message) detail = Array.isArray(j.message) ? j.message.join(", ") : j.message;
    } catch {
      /* keep raw text */
    }
    throw new Error(detail || `Request failed (${r.status})`);
  }
  return JSON.parse(text) as T;
}

export function previewRelayWithdrawal(assetKey: string, amountUsdc: string, accessToken?: string | null) {
  return post<RelayPreview>("/intents/withdraw/relay-preview", { assetKey, amountUsdc }, accessToken);
}

export function prepareRelayWithdrawal(
  params: { assetKey: string; amountUsdc: string; destinationAddress: string; refundAddress: string },
  accessToken?: string | null,
) {
  return post<RelayPreparedOrder>("/intents/withdraw/prepare-relay", params, accessToken);
}
