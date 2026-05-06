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

/** True when Privy sponsorship fails for any expected reason (not user rejection). */
export function isPrivyGasSponsorNotConfiguredError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "");
  return (
    /gas sponsorship is not configured/i.test(msg) ||
    // Wallet is on the old iframe stack, not TEE — sponsor not supported
    /sponsoring transactions is only supported for wallets on the tee stack/i.test(msg) ||
    // Privy wraps sponsorship + simulation failures as this error via TRANSACTION_FAILURE
    /failed to connect to wallet/i.test(msg)
  );
}

/**
 * Sponsor pubkey for instruction accounts (Gum `payer`, PER rent, etc.). Auth-only.
 * Still required client-side to build txs; hybrid prepare only sets fee payer + blockhash.
 */
export async function fetchSolanaFeePayerAddress(privyUserId?: string | null, accessToken?: string | null): Promise<string | null> {
  if (!privyUserId) return null;
  try {
    const r = await fetch(`${BACKEND_URL}/claims/solana-sponsor/fee-payer`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : { "x-privy-user-id": privyUserId },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { feePayerAddress?: string | null };
    const a = j.feePayerAddress?.trim();
    return a && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
  } catch {
    return null;
  }
}

export async function prepareSponsoredTransaction(
  unsignedTransactionBytes: Uint8Array,
  privyUserId: string,
  /** For console logs (e.g. PER action name). */
  stepLabel?: string,
  accessToken?: string | null,
): Promise<Uint8Array> {
  const label = stepLabel ?? "prepare";
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  console.info(`[PER sponsor] POST /prepare start (${label}) bytes=${unsignedTransactionBytes.length}`);
  const r = await fetch(`${BACKEND_URL}/claims/solana-sponsor/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : { "x-privy-user-id": privyUserId }),
    },
    body: JSON.stringify({
      transaction: uint8ArrayToBase64(unsignedTransactionBytes),
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
    throw new Error(detail || `Sponsor prepare failed (${r.status})`);
  }
  const j = (await r.json()) as { transaction?: string };
  if (!j.transaction) throw new Error("Sponsor prepare returned no transaction");
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const outLen =
    typeof Buffer !== "undefined"
      ? Buffer.from(j.transaction, "base64").length
      : atob(j.transaction).length;
  console.info(
    `[PER sponsor] POST /prepare ok (${label}) ${Math.round(t1 - t0)}ms outBytes≈${outLen}`,
  );
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(j.transaction, "base64"));
  }
  const binary = atob(j.transaction);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * User-signed transaction (embedded wallet only); backend adds fee-payer signature and broadcasts.
 * Requires auth via Authorization: Bearer or x-privy-user-id (legacy).
 */
export async function signAndBroadcastSponsoredTx(
  signedTransactionBytes: Uint8Array,
  privyUserId: string,
  stepLabel?: string,
  accessToken?: string | null,
): Promise<string> {
  const label = stepLabel ?? "sign-and-broadcast";
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  console.info(
    `[PER sponsor] POST /sign-and-broadcast start (${label}) bytes=${signedTransactionBytes.length}`,
  );
  const r = await fetch(`${BACKEND_URL}/claims/solana-sponsor/sign-and-broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : { "x-privy-user-id": privyUserId }),
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
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  console.info(
    `[PER sponsor] POST /sign-and-broadcast ok (${label}) ${Math.round(t1 - t0)}ms sig=${j.signature.slice(0, 12)}...`,
  );
  return j.signature;
}
