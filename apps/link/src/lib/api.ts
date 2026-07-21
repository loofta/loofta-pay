const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.loofta.xyz";

export interface ClaimSummary {
  id: string;
  short_id: string | null;
  amount: string;
  to_symbol: string | null;
  description: string | null;
  status: string;
}

/** Public, pre-auth summary — accepts either the short_id from the URL or a UUID. */
export async function fetchClaim(idOrShortId: string): Promise<ClaimSummary> {
  const res = await fetch(`${API_BASE_URL}/claims/${idOrShortId}/summary`, { cache: "no-store" });
  if (!res.ok) throw new Error("This link isn't valid or has expired.");
  return res.json();
}

export async function claimAsRecipient(
  id: string,
  accessToken: string,
  params: { destinationAddress: string; claimPrivately: boolean },
): Promise<{ claimed: boolean; sweepTxHash?: string; sweptAmount?: string }> {
  const res = await fetch(`${API_BASE_URL}/claims/${id}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      destinationAddress: params.destinationAddress,
      claimPrivately: params.claimPrivately,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || `Claim failed (${res.status})`);
  }
  return data;
}
