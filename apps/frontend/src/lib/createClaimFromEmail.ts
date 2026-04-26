/**
 * Create a claim from a recipient email. If they have an account, wallet is used; otherwise they claim by signing in with this email later.
 */

export async function createClaimFromEmail(input: {
  email: string;
  amount: string;
  userId?: string;
  accessToken?: string | null;
  isPrivate?: boolean;
  description?: string;
}): Promise<{ id: string }> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const authHeader: Record<string, string> = input.accessToken
    ? { Authorization: `Bearer ${input.accessToken}` }
    : input.userId
      ? { "x-privy-user-id": input.userId }
      : {};
  const r = await fetch(`${backendUrl}/claims/create-from-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      amount: Number(input.amount),
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
