import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createBurnCheckedInstruction, createCloseAccountInstruction } from "@solana/spl-token";
import { getConnection } from "@/trade/lib/balances";
import { USDC, WSOL } from "@/trade/lib/solana";

const PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
/** What closing a token account gives back (its rent), in SOL. */
export const RENT_PER_ACCOUNT_SOL = 0.00203928;
const PER_TX = 8;

export type TokenAcct = { pubkey: string; mint: string; program: string; raw: bigint; decimals: number; amount: number };

export async function getTokenAccounts(owner: string): Promise<TokenAcct[]> {
  const rs = await Promise.all(PROGRAMS.map((p) => getConnection().getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: new PublicKey(p) }).then((r) => r.value.map((a) => ({ a, p })))));
  return rs.flat().flatMap(({ a, p }) => {
    const info = a.account.data.parsed?.info;
    if (!info?.mint) return [];
    return [{ pubkey: a.pubkey.toBase58(), mint: info.mint as string, program: p, raw: BigInt(info.tokenAmount?.amount ?? "0"), decimals: Number(info.tokenAmount?.decimals ?? 0), amount: Number(info.tokenAmount?.uiAmount ?? 0) }];
  });
}

/** Accounts that can be closed: empty ones, plus dust we can price below the dust line. USDC and wrapped SOL are never touched. */
export function closable(accts: TokenAcct[], priceUsd: Map<string, number>, dustUsd: number): TokenAcct[] {
  return accts.filter((a) => {
    if (a.mint === USDC || a.mint === WSOL) return false;
    if (a.raw === 0n) return true;
    const px = priceUsd.get(a.mint);
    return px != null && px * a.amount < dustUsd;
  });
}

/** One unsigned transaction per batch: burn what is left (dust only), then close the account. The rent goes back to the owner. */
export async function buildCleanup(owner: string, accts: TokenAcct[]): Promise<Uint8Array[]> {
  const me = new PublicKey(owner);
  const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
  const out: Uint8Array[] = [];
  for (let i = 0; i < accts.length; i += PER_TX) {
    const ixs = accts.slice(i, i + PER_TX).flatMap((a) => {
      const acct = new PublicKey(a.pubkey);
      const program = new PublicKey(a.program);
      return [
        ...(a.raw > 0n ? [createBurnCheckedInstruction(acct, new PublicKey(a.mint), me, a.raw, a.decimals, [], program)] : []),
        createCloseAccountInstruction(acct, me, me, [], program),
      ];
    });
    out.push(new VersionedTransaction(new TransactionMessage({ payerKey: me, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()).serialize());
  }
  return out;
}
