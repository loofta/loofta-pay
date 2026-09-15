import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { SupabaseService } from '@/database/supabase.service';
import { getMainnetSolanaRpcUrl, getDevnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { ledgerUserId } from './nest-ledger-id';

const MAINNET_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
// Widely-used community devnet USDC-alike (6 decimals) — no real value, exists purely so a
// demo deposit looks and behaves like the real one without needing actual money.
const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const MIN_DEPOSIT_USDC = 5;
const MAX_DEPOSIT_USDC = 5000;
const MAX_DEVNET_DEPOSIT_USDC = 1_000_000; // free money — cap is just to keep numbers sane on screen

interface NetworkCtx {
  network: 'mainnet' | 'devnet';
  connection: Connection;
  usdcMint: PublicKey;
}

/**
 * Funds a user's Nest with an on-chain USDC transfer into the treasury (same wallet as Mystery
 * Pack's, SOLANA_FEE_PAYER_PRIVATE_KEY) — mirrors pack.service.ts's buildPaymentTx /
 * verifyPackPaymentOnChain: treasury sponsors gas + its own (safe-bucket, we hold the key)
 * destination ATA, user signs client-side, server verifies on-chain before crediting anything.
 *
 * Two networks, two ledgers, never mixed: real mainnet deposits credit the caller's own
 * user_id; devnet demo deposits (free devnet USDC, no real value) credit a suffixed identity
 * (see nest-ledger-id.ts) so a hackathon demo can never be mistaken for real capital.
 */
@Injectable()
export class NestDepositService {
  private readonly logger = new Logger(NestDepositService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private mainnetCtx(): NetworkCtx {
    return { network: 'mainnet', connection: new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed'), usdcMint: MAINNET_USDC_MINT };
  }

  private devnetCtx(): NetworkCtx {
    return { network: 'devnet', connection: new Connection(getDevnetSolanaRpcUrl(this.config), 'confirmed'), usdcMint: DEVNET_USDC_MINT };
  }

  private getTreasuryKeypair(): Keypair {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    // A keypair's address isn't network-scoped — the same treasury key is a valid devnet address
    // too, it just happens to hold no real assets there. No second secret to provision.
    return Keypair.fromSecretKey(bs58.decode(feePayerKey));
  }

  private async buildTx(ctx: NetworkCtx, userSolanaAddress: string, amountUsdc: number): Promise<string> {
    const treasuryKeypair = this.getTreasuryKeypair();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(ctx.usdcMint, fromPubkey);
    const toAta = await getAssociatedTokenAddress(ctx.usdcMint, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, ctx.usdcMint),
      createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(amountUsdc * 1_000_000)),
    ];

    const { blockhash } = await ctx.connection.getLatestBlockhash();
    const message = new TransactionMessage({ payerKey: treasuryKeypair.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasuryKeypair]);
    return Buffer.from(tx.serialize()).toString('base64');
  }

  async buildDepositTx(userSolanaAddress: string, amountUsdc: number): Promise<string> {
    if (!Number.isFinite(amountUsdc) || amountUsdc < MIN_DEPOSIT_USDC || amountUsdc > MAX_DEPOSIT_USDC) {
      throw new BadRequestException(`Deposit amount must be between $${MIN_DEPOSIT_USDC} and $${MAX_DEPOSIT_USDC}`);
    }
    return this.buildTx(this.mainnetCtx(), userSolanaAddress, amountUsdc);
  }

  async buildDevnetDepositTx(userSolanaAddress: string, amountUsdc: number): Promise<string> {
    if (!Number.isFinite(amountUsdc) || amountUsdc < 1 || amountUsdc > MAX_DEVNET_DEPOSIT_USDC) {
      throw new BadRequestException(`Demo deposit amount must be between $1 and $${MAX_DEVNET_DEPOSIT_USDC}`);
    }
    return this.buildTx(this.devnetCtx(), userSolanaAddress, amountUsdc);
  }

  private findUsdcDebitOwner(tx: any, usdcMint: string): { owner: string | null; amount: bigint } {
    const preByIdx = new Map((tx.meta?.preTokenBalances ?? []).map((b: any) => [b.accountIndex, b]));
    const postByIdx = new Map((tx.meta?.postTokenBalances ?? []).map((b: any) => [b.accountIndex, b]));
    let debitOwner: string | null = null;
    let maxDebit = 0n;
    for (const [idx, post] of postByIdx as Map<number, any>) {
      if (post.mint !== usdcMint) continue;
      const pre = preByIdx.get(idx) as any;
      if (!pre || pre.mint !== usdcMint) continue;
      const delta = BigInt(pre.uiTokenAmount.amount) - BigInt(post.uiTokenAmount.amount);
      if (delta > maxDebit) { maxDebit = delta; debitOwner = post.owner ?? pre.owner ?? null; }
    }
    return { owner: debitOwner, amount: maxDebit };
  }

  /** Verifies on-chain, then credits `ledgerUserId` (the real user, or their devnet-demo identity
   *  — caller decides which). Replay-proof via nest_deposits' unique tx_hash. */
  private async verifyAndCredit(ctx: NetworkCtx, ledgerId: string, userSolanaAddress: string, txHash: string, amountUsdc: number): Promise<{ creditedUsd: number }> {
    const treasuryKeypair = this.getTreasuryKeypair();
    const usdcMint = ctx.usdcMint.toBase58();
    const treasury = treasuryKeypair.publicKey.toBase58();

    let tx: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      tx = await ctx.connection.getTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!tx) throw new BadRequestException('Deposit transaction not found on-chain — wait a few seconds and retry');
    if (tx.meta?.err) throw new BadRequestException('Deposit transaction failed on-chain');

    const pre = tx.meta?.preTokenBalances?.find((b: any) => b.owner === treasury && b.mint === usdcMint);
    const post = tx.meta?.postTokenBalances?.find((b: any) => b.owner === treasury && b.mint === usdcMint);
    const received = BigInt(post?.uiTokenAmount?.amount ?? '0') - BigInt(pre?.uiTokenAmount?.amount ?? '0');
    const expectedUnits = BigInt(Math.round(amountUsdc * 1_000_000));
    if (received < expectedUnits) throw new BadRequestException(`Deposit paid ${received} units, expected ${expectedUnits}`);

    const debit = this.findUsdcDebitOwner(tx, usdcMint);
    if (debit.owner !== userSolanaAddress) throw new BadRequestException('This payment was not sent from your wallet');

    const db = this.supabase.getClient();
    const { error: insertErr } = await db.from('nest_deposits').insert({ user_id: ledgerId, amount_usdc: amountUsdc, tx_hash: txHash, network: ctx.network });
    if (insertErr) {
      if (insertErr.code === '23505') {
        this.logger.warn(`verifyAndCredit: tx_hash ${txHash} already recorded — not re-crediting`);
        return { creditedUsd: 0 };
      }
      throw new Error(`nest_deposits insert: ${insertErr.message}`);
    }

    const { data: existing } = await db.from('nest_holdings').select('units').eq('user_id', ledgerId).eq('symbol', 'USD').maybeSingle();
    const newUnits = (existing ? Number(existing.units) : 0) + amountUsdc;
    const { error: upsertErr } = await db
      .from('nest_holdings')
      .upsert({ user_id: ledgerId, symbol: 'USD', units: newUnits, avg_cost_usd: 1, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' });
    if (upsertErr) throw new Error(`nest_holdings cash credit: ${upsertErr.message}`);

    return { creditedUsd: amountUsdc };
  }

  async confirmDeposit(userId: string, userSolanaAddress: string, txHash: string, amountUsdc: number): Promise<{ creditedUsd: number }> {
    return this.verifyAndCredit(this.mainnetCtx(), userId, userSolanaAddress, txHash, amountUsdc);
  }

  async confirmDevnetDeposit(userId: string, userSolanaAddress: string, txHash: string, amountUsdc: number): Promise<{ creditedUsd: number }> {
    return this.verifyAndCredit(this.devnetCtx(), ledgerUserId(userId, true), userSolanaAddress, txHash, amountUsdc);
  }
}
