import { clientApiBase } from "@/services/api/client";
/**
 * Guest (no Loofta account) claim creation — hits the unauthenticated
 * POST /claims/create-from-email-guest / create-from-social-guest routes (protected by
 * Turnstile + tight per-IP rate limiting instead of Privy auth, see claims.controller.ts).
 * Used by the Send & Receive form and the home-v3 hero for a signed-out sender. Callers keep the
 * guest on the send surface with GuestCheckoutPay and only reveal the claim/share link after
 * payment settles — never redirect to /c/[id] before pay (burnerAddress is returned here for that
 * inline pay step).
 */

async function parseCreateClaimError(r: Response): Promise<string> {
  const errText = await r.text().catch(() => "");
  try {
    const errData = JSON.parse(errText) as { message?: string; error?: string };
    return errData?.message || errData?.error || "Failed to create payment";
  } catch {
    return errText || "Failed to create payment";
  }
}

/** MagicBlock split/delay chosen on the Send form — persisted on the claim (private_split /
 *  private_max_delay_ms columns) so later views (recipient, or the sender revisiting without
 *  ?split=&delayMs=) know the real value instead of a stale/guessed default. */
interface PrivacyChoice {
  split?: number;
  maxDelayMs?: number;
}

export async function createClaimFromEmailGuest(input: {
  email: string;
  amount: string;
  isPrivate?: boolean;
  description?: string;
  cluster?: "devnet" | "mainnet";
  turnstileToken: string;
} & PrivacyChoice): Promise<{ id: string; link: string; burnerAddress: string; direct: boolean }> {
  const backendUrl = clientApiBase();
  const r = await fetch(`${backendUrl}/claims/create-from-email-guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      amount: Number(input.amount),
      isPrivate: input.isPrivate ?? false,
      description: input.description ?? undefined,
      cluster: input.cluster,
      turnstileToken: input.turnstileToken,
      split: input.split,
      maxDelayMs: input.maxDelayMs,
    }),
  });
  if (!r.ok) throw new Error(await parseCreateClaimError(r));
  const data = await r.json();
  if (!data?.id || !data?.burnerAddress) throw new Error("Server response missing claim ID or address");
  return { id: data.id, link: data.link, burnerAddress: data.burnerAddress, direct: !!data.direct };
}

export async function createClaimFromSocialGuest(input: {
  platform: "discord" | "github" | "telegram";
  handle: string;
  amount: string;
  isPrivate?: boolean;
  description?: string;
  cluster?: "devnet" | "mainnet";
  turnstileToken: string;
} & PrivacyChoice): Promise<{ id: string; link: string; burnerAddress: string; direct: boolean }> {
  const backendUrl = clientApiBase();
  const r = await fetch(`${backendUrl}/claims/create-from-social-guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: input.platform,
      handle: input.handle,
      amount: Number(input.amount),
      isPrivate: input.isPrivate ?? false,
      description: input.description ?? undefined,
      cluster: input.cluster,
      turnstileToken: input.turnstileToken,
      split: input.split,
      maxDelayMs: input.maxDelayMs,
    }),
  });
  if (!r.ok) throw new Error(await parseCreateClaimError(r));
  const data = await r.json();
  if (!data?.id || !data?.burnerAddress) throw new Error("Server response missing claim ID or address");
  return { id: data.id, link: data.link, burnerAddress: data.burnerAddress, direct: !!data.direct };
}

/** Twitter goes through this endpoint (with treatUnregisteredAsTwitter), not
 *  createClaimFromSocialGuest — see CreateClaimFromUsernameGuestDto. */
export async function createClaimFromUsernameGuest(input: {
  username: string;
  amount: string;
  isPrivate?: boolean;
  description?: string;
  cluster?: "devnet" | "mainnet";
  treatUnregisteredAsTwitter?: boolean;
  turnstileToken: string;
} & PrivacyChoice): Promise<{ id: string; link: string; burnerAddress: string; direct: boolean }> {
  const backendUrl = clientApiBase();
  const r = await fetch(`${backendUrl}/claims/create-from-username-guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      amount: Number(input.amount),
      isPrivate: input.isPrivate ?? false,
      description: input.description ?? undefined,
      cluster: input.cluster,
      treatUnregisteredAsTwitter: input.treatUnregisteredAsTwitter,
      turnstileToken: input.turnstileToken,
      split: input.split,
      maxDelayMs: input.maxDelayMs,
    }),
  });
  if (!r.ok) throw new Error(await parseCreateClaimError(r));
  const data = await r.json();
  if (!data?.id || !data?.burnerAddress) throw new Error("Server response missing claim ID or address");
  return { id: data.id, link: data.link, burnerAddress: data.burnerAddress, direct: !!data.direct };
}
