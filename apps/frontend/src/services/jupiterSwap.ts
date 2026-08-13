/**
 * USDC -> native SOL withdrawal via Jupiter's v2 order/execute API. Stateless on the backend —
 * no DB row (see project memory: sol withdrawal via jupiter). The user's own embedded wallet
 * signs and pays for the swap itself, never Loofta's fee payer, so this doesn't go through the
 * generic sign-and-broadcast sponsor endpoint at all. Jupiter's own /execute broadcasts +
 * confirms the signed transaction, so there's no separate client-side RPC send/confirm step.
 * The completed withdrawal is recorded the same way every other Solana withdrawal is, via
 * BalanceModal.tsx's saveWithdrawalToDB.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

async function parseErrorDetail(r: Response, fallback: string): Promise<string> {
  const errText = await r.text().catch(() => "");
  try {
    const j = JSON.parse(errText) as { message?: string };
    if (j?.message) return Array.isArray(j.message) ? j.message.join(", ") : j.message;
  } catch { /* ignore */ }
  return errText || `${fallback} (${r.status})`;
}

export async function prepareSolWithdrawal(
  params: { solanaAddress: string; destinationAddress: string; amountUSDC: number },
  accessToken?: string | null,
): Promise<{ swapTransactionBase64: string; requestId: string; estimatedSolOut: number }> {
  const r = await fetch(`${BACKEND_URL}/jupiter/prepare-sol-withdrawal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(await parseErrorDetail(r, "Failed to prepare SOL withdrawal"));
  return r.json();
}

export async function executeSolWithdrawal(
  requestId: string,
  signedTransactionBase64: string,
  accessToken?: string | null,
): Promise<{ status: string; signature: string }> {
  const r = await fetch(`${BACKEND_URL}/jupiter/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ requestId, signedTransaction: signedTransactionBase64 }),
  });
  if (!r.ok) throw new Error(await parseErrorDetail(r, "Failed to execute SOL withdrawal"));
  return r.json();
}
