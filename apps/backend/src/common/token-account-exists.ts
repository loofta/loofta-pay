import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';

/**
 * Checks whether a token account exists on-chain, distinguishing "genuinely doesn't exist"
 * (spl-token's TokenAccountNotFoundError) from a transient RPC failure (timeout, rate limit,
 * network blip) — the two must never be treated the same way. Conflating them was a real bug:
 * treating ANY getAccount failure as "missing" meant a rate-limited RPC call on a wallet that
 * legitimately already has this ATA could wrongly trip the sponsor-abuse guard and block a real
 * user's claim/withdrawal on a false premise.
 *
 * The fix for that bug (re-throwing on ambiguous errors) creates a DIFFERENT problem on its own:
 * if every transient RPC hiccup propagates all the way up to a caller — often a 5-second cron —
 * the cron's next tick just redoes the ENTIRE multi-step flow from scratch and hits the RPC
 * again, and again, amplifying load on exactly the RPC that's already struggling. A few short,
 * bounded retries with backoff absorb the blip right here instead, at a fraction of the RPC
 * cost of unwinding and re-running a whole cron cycle. Only re-throws (and only then, to the
 * caller, for genuine handling) after retries are exhausted on a persistent, non-"not found"
 * error — at that point something is actually wrong and ought to surface, not be silently eaten.
 */
export async function tokenAccountExists(
  conn: Connection,
  ata: PublicKey,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<boolean> {
  const retries = opts?.retries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  for (let attempt = 0; ; attempt++) {
    try {
      await getAccount(conn, ata);
      return true;
    } catch (e: any) {
      if (e?.name === 'TokenAccountNotFoundError') return false;
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
}
