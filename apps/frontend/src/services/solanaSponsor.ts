/**
 * Loofta backend Solana fee payer (SOLANA_FEE_PAYER_PRIVATE_KEY) — used when Privy
 * dashboard gas sponsorship is not enabled for devnet/custom RPC.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** True when Privy returns "Gas sponsorship is not configured for chain …". */
export function isPrivyGasSponsorNotConfiguredError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "");
  return /gas sponsorship is not configured/i.test(msg);
}

export async function fetchSolanaFeePayerAddress(): Promise<string | null> {
  try {
    const r = await fetch(`${BACKEND_URL}/claims/solana-sponsor/fee-payer`);
    if (!r.ok) return null;
    const j = (await r.json()) as { feePayerAddress?: string | null };
    const a = j.feePayerAddress?.trim();
    return a && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
  } catch {
    return null;
  }
}

/**
 * User-signed transaction (embedded wallet only); backend adds fee-payer signature and broadcasts.
 * Requires `AuthGuard` header `x-privy-user-id`.
 */
export async function signAndBroadcastSponsoredTx(
  signedTransactionBytes: Uint8Array,
  privyUserId: string
): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/claims/solana-sponsor/sign-and-broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-privy-user-id": privyUserId,
    },
    body: JSON.stringify({
      transaction: uint8ArrayToBase64(signedTransactionBytes),
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    let detail = errText;
    try {
      const j = JSON.parse(errText) as { message?: string };
      if (j?.message) detail = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Sponsor broadcast failed (${r.status})`);
  }
  const j = (await r.json()) as { signature?: string };
  if (!j.signature) throw new Error("Sponsor broadcast returned no signature");
  return j.signature;
}
