import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_HTTP_RPC } from "@/trade/lib/solana";

let conn: Connection | null = null;
export function getConnection(): Connection {
  if (!conn) conn = new Connection(SOLANA_HTTP_RPC, "confirmed");
  return conn;
}

export async function getSolBalance(owner: string): Promise<number> {
  const lamports = await getConnection().getBalance(new PublicKey(owner));
  return lamports / 1e9;
}

/** Total balance of one mint across the owner's token accounts, as a human amount. */
export async function getTokenBalance(owner: string, mint: string): Promise<number> {
  const res = await getConnection().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  return res.value.reduce((sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
}

/** Polls until the signature is confirmed or the timeout passes. */
export async function waitForConfirmation(signature: string, timeoutMs = 60_000): Promise<void> {
  const c = getConnection();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await c.getSignatureStatuses([signature]);
    const s = value[0];
    if (s?.err) throw new Error("Transaction failed on chain");
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Confirmation timed out. Check your wallet before retrying.");
}
