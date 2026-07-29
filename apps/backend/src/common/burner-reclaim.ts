import { Logger } from '@nestjs/common';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createCloseAccountInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const log = new Logger('BurnerReclaim');

/** USDC mints whose dust is worth sweeping to the fee wallet before closing. Any other mint's
 *  token account is left alone (closing a non-empty non-USDC account would burn the tokens). */
const SWEEPABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mainnet
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
]);

export interface BurnerReclaimResult {
  /** null when there was nothing to reclaim (no open token accounts, no lamports). */
  signature: string | null;
  closedTokenAccounts: number;
  sweptUsdcUnits: bigint;
  sweptLamports: number;
}

/**
 * Reclaims everything of value left on a finished single-use burner wallet back to the fee
 * payer, in one transaction: residual USDC dust → fee payer's USDC ATA, every empty(-able) USDC
 * token account closed (≈0.00203928 SOL rent each → fee payer), and the burner's full lamport
 * balance transferred out (the fee payer signs as tx fee payer, so the burner can go to zero).
 *
 * This is the single shared implementation of what lottery.service.ts's sweepBurner has been
 * doing for lottery-ticket burners only — extracted because a 2026-07-29 audit found every OTHER
 * burner flow (lottery withdrawals, private-balance transfers, private/cross-chain claim sweeps,
 * creator reclaims) leaked its ATA rent permanently: on-chain sampling showed 59% of terminal
 * withdrawal burners and 39% of private-balance burners still holding their rent. At ~0.002 SOL
 * per burner that is a steady, volume-proportional drain on the fee payer with zero benefit.
 *
 * The pattern every burner flow must follow (see .claude/skills/solana-sponsor-safety):
 *   1. If the flow builds its own final drain transaction, append createCloseAccountInstruction
 *      inline — same tx, zero extra fee. (Don't call this helper for that; it's one line.)
 *   2. If the final transfer is built by an external party (MagicBlock relay, a bridge), call
 *      this helper right after the transfer completes, and/or from the module's GC cron for
 *      rows whose `burner_reclaimed_at` is still null.
 *
 * SAFETY: only call this on burners in a TERMINAL state whose funds have provably left (or whose
 * residual funds legitimately belong to the fee wallet, e.g. a stall-refund already reimbursed
 * the user). It sweeps *everything* — calling it on an in-flight burner strands the user's money.
 *
 * Never throws for "nothing to do"; throws only on a real build/send failure so callers can
 * retry next tick.
 */
export async function reclaimBurnerFunds(
  conn: Connection,
  burnerKeypair: Keypair,
  feePayerKeypair: Keypair,
): Promise<BurnerReclaimResult> {
  const burnerPubkey = burnerKeypair.publicKey;
  const instructions: TransactionInstruction[] = [];
  let closedTokenAccounts = 0;
  let sweptUsdcUnits = 0n;

  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(burnerPubkey, { programId: TOKEN_PROGRAM_ID });
  let feePayerUsdcAta: PublicKey | null = null;

  for (const a of tokenAccounts.value) {
    const info = (a.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } }).parsed?.info;
    const mint = info?.mint;
    if (!mint || !SWEEPABLE_MINTS.has(mint)) continue;
    const balance = BigInt(info?.tokenAmount?.amount ?? '0');
    if (balance > 0n) {
      if (!feePayerUsdcAta) {
        feePayerUsdcAta = await getAssociatedTokenAddress(new PublicKey(mint), feePayerKeypair.publicKey);
      }
      instructions.push(createTransferInstruction(new PublicKey(a.pubkey), feePayerUsdcAta, burnerPubkey, balance));
      sweptUsdcUnits += balance;
    }
    instructions.push(createCloseAccountInstruction(new PublicKey(a.pubkey), feePayerKeypair.publicKey, burnerPubkey));
    closedTokenAccounts++;
  }

  const lamports = await conn.getBalance(burnerPubkey);
  if (lamports > 0) {
    instructions.push(SystemProgram.transfer({ fromPubkey: burnerPubkey, toPubkey: feePayerKeypair.publicKey, lamports }));
  }

  if (!instructions.length) {
    return { signature: null, closedTokenAccounts: 0, sweptUsdcUnits: 0n, sweptLamports: 0 };
  }

  const tx = new Transaction().add(...instructions);
  tx.feePayer = feePayerKeypair.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(feePayerKeypair, burnerKeypair);
  const signature = await conn.sendRawTransaction(tx.serialize());
  const confirmation = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`burner reclaim failed on-chain (${signature}): ${JSON.stringify(confirmation.value.err)}`);
  }
  log.log(
    `reclaimed burner ${burnerPubkey.toBase58().slice(0, 8)}…: closed ${closedTokenAccounts} token account(s), ` +
    `swept ${(Number(sweptUsdcUnits) / 1e6).toFixed(6)} USDC + ${(lamports / 1e9).toFixed(6)} SOL → fee payer, sig=${signature.slice(0, 12)}…`,
  );
  return { signature, closedTokenAccounts, sweptUsdcUnits, sweptLamports: lamports };
}
