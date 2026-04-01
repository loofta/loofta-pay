/**
 * Create a claim from a recipient username (wallet resolved server-side).
 * Used by /link/[username] page and in-app SendFlowInApp.
 */

export async function createClaimFromUsername(input: {
  username: string;
  amount: string;
  userId?: string;
  accessToken?: string | null;
  userEmail?: string;
  isPrivate?: boolean;
  description?: string;
}): Promise<{ id: string }> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
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
      userId: input.userId,
      userEmail: input.userEmail,
      isPrivate: input.isPrivate ?? false,
      description: input.description ?? undefined,
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
  return { id: data.id };
}
