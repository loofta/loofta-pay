/**
 * Create a claim addressed to a Discord/GitHub/Telegram handle (wallet resolved server-side
 * if the handle is already connected to a Loofta account).
 * Used by the in-app send flow.
 */

export async function createClaimFromSocial(input: {
  platform: "discord" | "github" | "telegram";
  handle: string;
  amount: string;
  userId?: string;
  accessToken?: string | null;
  isPrivate?: boolean;
  description?: string;
  cluster?: 'devnet' | 'mainnet';
}): Promise<{ id: string; short_id?: string | null }> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const authHeader: Record<string, string> = input.accessToken
    ? { Authorization: `Bearer ${input.accessToken}` }
    : input.userId
      ? { "x-privy-user-id": input.userId }
      : {};
  const r = await fetch(`${backendUrl}/claims/create-from-social`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({
      platform: input.platform,
      handle: input.handle,
      amount: Number(input.amount),
      isPrivate: input.isPrivate ?? false,
      description: input.description ?? undefined,
      cluster: input.cluster,
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
