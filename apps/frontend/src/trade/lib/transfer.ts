import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "@/trade/lib/balances";
import { USDC } from "@/trade/lib/solana";

/**
 * Unsigned transfer of SOL or USDC, paid for by the sender. The user's own wallet pays the network
 * fee, so this never touches the Loofta fee payer. USDC creates the receiver's token account if
 * it does not exist yet.
 */
export async function buildTransfer(p: { from: string; to: string; token: "SOL" | "USDC"; amount: number; fee?: { to: string; amount: number } }): Promise<Uint8Array> {
  const from = new PublicKey(p.from);
  const to = new PublicKey(p.to);
  const fee = p.fee && p.fee.amount > 0 ? p.fee : null;
  const ixs =
    p.token === "SOL"
      ? [
          SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Math.round(p.amount * 1e9) }),
          ...(fee ? [SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(fee.to), lamports: Math.round(fee.amount * 1e9) })] : []),
        ]
      : (() => {
          const mint = new PublicKey(USDC);
          const src = getAssociatedTokenAddressSync(mint, from);
          const dst = getAssociatedTokenAddressSync(mint, to, true);
          const out = [
            createAssociatedTokenAccountIdempotentInstruction(from, dst, to, mint),
            createTransferCheckedInstruction(src, mint, dst, from, BigInt(Math.round(p.amount * 1e6)), 6),
          ];
          if (fee) {
            const feeOwner = new PublicKey(fee.to);
            const feeAta = getAssociatedTokenAddressSync(mint, feeOwner, true);
            out.push(createAssociatedTokenAccountIdempotentInstruction(from, feeAta, feeOwner, mint), createTransferCheckedInstruction(src, mint, feeAta, from, BigInt(Math.round(fee.amount * 1e6)), 6));
          }
          return out;
        })();
  const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: from, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg).serialize();
}

/** Unsigned transfer of any token the user holds (classic or Token-2022), paid for by the sender. Creates the receiver's token account if needed. */
export async function buildTokenTransfer(p: { from: string; to: string; mint: string; rawAmount: bigint; decimals: number }): Promise<Uint8Array> {
  const from = new PublicKey(p.from);
  const to = new PublicKey(p.to);
  const mint = new PublicKey(p.mint);
  const info = await getConnection().getAccountInfo(mint);
  if (!info) throw new Error("That token could not be found.");
  const program = info.owner;
  const src = getAssociatedTokenAddressSync(mint, from, true, program);
  const dst = getAssociatedTokenAddressSync(mint, to, true, program);
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(from, dst, to, mint, program), createTransferCheckedInstruction(src, mint, dst, from, p.rawAmount, p.decimals, [], program)];
  const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
  return new VersionedTransaction(new TransactionMessage({ payerKey: from, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()).serialize();
}
