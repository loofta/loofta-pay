import { clientApiBase } from "@/services/api/client";
/**
 * Create a claim from a recipient username (wallet resolved server-side).
 * Used by /me/[username] page and the in-app send flow.
 */

export async function createClaimFromUsername(input: {
  username: string;
  amount: string;
  userId?: string;
  accessToken?: string | null;
  userEmail?: string;
  isPrivate?: boolean;
  description?: string;
  cluster?: 'devnet' | 'mainnet';
  /** Set when `username` is actually a Twitter handle picked from the social picker — see DTO for why. */
  treatUnregisteredAsTwitter?: boolean;
  /** MagicBlock split/delay chosen on the Send form — persisted on the claim so later views
   *  (recipient, or the sender revisiting without ?split=&delayMs=) know the real value. */
  split?: number;
  maxDelayMs?: number;
}): Promise<{ id: string; short_id?: string | null }> {
  const backendUrl = clientApiBase();
  const authHeader: Record<string, string> = input.accessToken
    ? { Authorization: `Bearer ${input.accessToken}` }
    : input.userId
      ? { "x-privy-user-id": input.userId }
      : {};
  const r = await fetch(`${backendUrl}/claims/create-from-username`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({
      username: input.username,
      amount: Number(input.amount),
      isPrivate: input.isPrivate ?? false,
      description: input.description ?? undefined,
      cluster: input.cluster,
      treatUnregisteredAsTwitter: input.treatUnregisteredAsTwitter ?? false,
      split: input.split,
      maxDelayMs: input.maxDelayMs,
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    let errData: { message?: string; error?: string } = {};
    try {
      errData = JSON.parse(errText);
    } catch {
      errData = { message: errText || "Failed to create claim" };
    }
    throw new Error(errData?.message || errData?.error || "Failed to create claim");
  }
  const data = await r.json();
  if (!data?.id) throw new Error("Server response missing claim ID");
  return { id: data.id, short_id: data.short_id ?? null };
}
