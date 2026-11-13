/* eslint-disable */
/**
 * Holder numbers for a coin straight from Solana, no data provider. Every holder is a token account of the coin, so one
 * getProgramAccounts call (filtered to this coin, and sliced down to just owner and balance, 40 bytes per holder) gives:
 * how many holders there are, how much the ten biggest hold, how much the creator still holds, and the biggest holders.
 *
 * The bonding curve itself holds most of a young coin's supply. It is not a person, so it is left out of every number,
 * the same way Pump's own site does it.
 *
 * Cost is one RPC call per coin, so answers are kept 5 minutes and shared by every request.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { getMainnetSolanaRpcUrl } from "@/common/solana-cluster-env";
import { cached } from "./sharedCache";

export interface HolderStats {
  /** People holding the coin, not counting the bonding curve. */
  count: number;
  /** Share of the supply the ten biggest holders have, in percent, without the curve. */
  top10Pct: number;
  /** Share the creator still holds, in percent. Null when the creator is not known. */
  devPct: number | null;
  /** The biggest holders, for the Holders tab. */
  top: Array<{ owner: string; pct: number }>;
}

let lastWarn = 0;
function warnOnce(msg: string) {
  if (Date.now() - lastWarn < 60_000) return;
  lastWarn = Date.now();
  console.warn(`[holders] ${msg.slice(0, 220)}`);
}

let conn: Connection | null = null;
// The default RPC refuses getProgramAccounts on Token-2022 coins ("too many accounts"). Helius answers it in about 100 ms, so it
// is used for this read when its key is set.
const connection = () => {
  if (conn) return conn;
  const helius = process.env.HELIUS_API_KEY;
  conn = new Connection(helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : getMainnetSolanaRpcUrl({ get: () => undefined } as never), "confirmed");
  return conn;
};
const TTL_SEC = 300;
/** A coin with this many token accounts is far past a fresh launch. Stop rather than download megabytes. */
const MAX_ACCOUNTS = 40_000;

async function compute(mint: string, creator: string | null): Promise<HolderStats | null> {
  const mintPk = new PublicKey(mint);
  const c = connection();
  const info = await c.getAccountInfo(mintPk);
  if (!info) return null;
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const supply = Number((await c.getTokenSupply(mintPk)).value.amount);
  if (!(supply > 0)) return null;

  // Token account layout: mint 0..32, owner 32..64, amount 64..72. Only owner and amount come back.
  const accounts = await c.getProgramAccounts(program, {
    filters: [{ memcmp: { offset: 0, bytes: mintPk.toBase58() } }],
    dataSlice: { offset: 32, length: 40 },
  });
  if (accounts.length > MAX_ACCOUNTS) return null;

  const curveOwner = bondingCurvePda(mintPk).toBase58();
  const byOwner = new Map<string, number>();
  for (const a of accounts) {
    const d = a.account.data;
    const amount = Number(d.readBigUInt64LE(32));
    if (amount <= 0) continue;
    const owner = new PublicKey(d.subarray(0, 32)).toBase58();
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + amount);
  }
  byOwner.delete(curveOwner);
  const sorted = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
  const pct = (n: number) => (n / supply) * 100;
  return {
    count: sorted.length,
    top10Pct: pct(sorted.slice(0, 10).reduce((s, [, n]) => s + n, 0)),
    devPct: creator ? pct(byOwner.get(creator) ?? 0) : null,
    top: sorted.slice(0, 20).map(([owner, n]) => ({ owner, pct: pct(n) })),
  };
}

/** Holder stats for a coin, cached for 5 minutes. Null when it cannot be read (unknown coin, or far too many holders). */
export function holderStats(mint: string, creator: string | null = null): Promise<HolderStats | null> {
  return cached(
    `holderstats:${mint}`,
    TTL_SEC,
    () =>
      compute(mint, creator).catch((e) => {
        warnOnce(`holder read failed: ${(e as Error)?.message ?? e}`);
        return null;
      }),
    (v) => v != null,
  );
}

/** What is already cached, without making a call. Lets a list show numbers it has and fill in the rest in the background. */
const warm = new Map<string, { at: number; stats: HolderStats }>();
export function peekHolderStats(mint: string): HolderStats | null {
  const w = warm.get(mint);
  return w && Date.now() - w.at < 10 * 60_000 ? w.stats : null;
}

/** Starts reading stats for these coins in the background, a few at a time, and remembers the results for peekHolderStats. */
let running = 0;
export function warmHolderStats(coins: Array<{ mint: string; creator: string | null }>) {
  for (const c of coins) {
    const w = warm.get(c.mint);
    if (w && Date.now() - w.at < 4 * 60_000) continue;
    if (running >= 4) break;
    running++;
    void holderStats(c.mint, c.creator)
      .then((s) => {
        if (s) warm.set(c.mint, { at: Date.now(), stats: s });
      })
      .finally(() => running--);
  }
  if (warm.size > 600) warm.clear();
}
