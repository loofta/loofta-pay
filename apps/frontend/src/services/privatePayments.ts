/**
 * Private USDC payment flow: PER auth, then backend builds/signs/submits.
 * Payer never sees recipient wallet; recipient never sees payer (PER + backend).
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export interface PrivatePayInfo {
  recipientDepositPda: string;
  amount: string;
  tokenMint: string;
  claimId: string;
}

/** Fetch private-pay info for a claim (recipient deposit PDA, amount, mint). Wallet never exposed. */
export async function fetchPrivatePayInfo(
  claimId: string,
  accessToken: string
): Promise<PrivatePayInfo> {
  const r = await fetch(`${BACKEND_URL}/claims/${claimId}/private-pay-info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.message || err?.error || "Failed to get private pay info");
  }
  return r.json();
}

/** Request backend to build the private-pay tx; returns serialized message to sign (base64). */
export async function buildPrivatePayTx(params: {
  claimId: string;
  payerPublicKey: string;
  sessionPublicKey: string;
  amountLamports: string;
  accessToken: string;
}): Promise<{ serializedMessageBase64: string }> {
  const r = await fetch(
    `${BACKEND_URL}/claims/${params.claimId}/build-private-pay-tx`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        payerPublicKey: params.payerPublicKey,
        sessionPublicKey: params.sessionPublicKey,
        amountLamports: params.amountLamports,
      }),
    }
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.message || err?.error || "Failed to build private pay tx");
  }
  return r.json();
}

/** Send signed tx to backend; backend adds platform signature and submits to PER. */
export async function submitPrivatePay(params: {
  claimId: string;
  signedTxBase64: string;
  accessToken: string;
}): Promise<{ signature: string }> {
  const r = await fetch(
    `${BACKEND_URL}/claims/${params.claimId}/submit-private-pay`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({ signedTxBase64: params.signedTxBase64 }),
    }
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.message || err?.error || "Failed to submit private pay");
  }
  return r.json();
}
