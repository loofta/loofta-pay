import { Injectable, Logger } from '@nestjs/common';
import { Keypair, PublicKey, Transaction, VersionedTransaction, type Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { EmailService } from '../email/email.service';
import { guardAtaSponsorship } from '@/common/ata-sponsorship-guard';
import { tokenAccountExists } from '@/common/token-account-exists';
import { reclaimBurnerFunds } from '@/common/burner-reclaim';
import { requestMagicblockPrivateTransfer } from '@/common/magicblock-private-transfer';

export interface GiveawayBurner {
  address: string;
  encryptedSecret: string;
}

/**
 * Standalone burner mint/sweep for the Giveaways feature. Deliberately NOT extracted from
 * claims.service.ts (3807 lines, handles live claim/payment money today) — same decrypt/sweep
 * pattern (HKDF-derived per-burner key via SendPaymentEncryptionService, public sweep, private
 * sweep via MagicBlock), zero risk of regressing the existing claims flow. See the "Giveaways
 * Module" plan (project memory) for why this was built new instead of shared.
 *
 * Every method here that creates a destination ATA follows .claude/skills/solana-sponsor-safety:
 * guard client-suppliable destinations (winner wallet, creator refund wallet) before sponsoring
 * their ATA creation, and always recover the burner's own rent (we hold that key) in the same
 * transaction when we build it ourselves, or via reclaimBurnerFunds as a follow-up when MagicBlock
 * builds the transfer.
 */
@Injectable()
export class GiveawayBurnerSweepService {
  private readonly logger = new Logger(GiveawayBurnerSweepService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly encryption: SendPaymentEncryptionService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly emailService: EmailService,
  ) {}

  isAvailable(): boolean {
    return this.encryption.isAvailable() && this.solanaSponsor.isAvailable();
  }

  /** Mint a fresh single-use burner keypair. Secret is always v2 (per-burner HKDF-derived key) — no legacy master-key path, since these are new burners, not migrated ones. */
  createBurner(): GiveawayBurner | null {
    if (!this.encryption.isAvailable()) return null;
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    const encryptedSecret = this.encryption.encrypt(Buffer.from(keypair.secretKey), address);
    return { address, encryptedSecret };
  }

  decryptBurner(address: string, encryptedSecret: string): Keypair {
    const secretKey = this.encryption.decrypt(encryptedSecret, address);
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  }

  private requireFeePayer(): Keypair {
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayerKp) {
      throw new Error('Giveaway sponsorship is not configured (SOLANA_FEE_PAYER_PRIVATE_KEY missing).');
    }
    return feePayerKp;
  }

  /** Poll signature status instead of conn.confirmTransaction (which needs a blockhash-expiry strategy object) — same pattern as claims.service.ts's pollConfirmTransaction. */
  private async pollConfirmTransaction(conn: Connection, signature: string, timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const statuses = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = statuses.value[0];
      if (status?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Transaction ${signature} confirmation timed out`);
  }

  /**
   * Public sweep: burner -> destination wallet, plain SPL transfer. Creates the destination ATA
   * if missing (fee-payer-sponsored, guarded) and closes the burner's own ATA back to the fee
   * payer in the same transaction (rent recovery — we hold the burner's key, so this is free).
   */
  async sweepPublic(params: {
    conn: Connection;
    burnerKeypair: Keypair;
    destination: string;
    mint: PublicKey;
    amountBaseUnits: bigint;
    /** Audit-trail tag for ata_sponsorships, e.g. `giveaway:<id>:entry:<entryId>`. */
    context: string;
  }): Promise<{ sweepTxHash: string }> {
    const { conn, burnerKeypair, destination, mint, amountBaseUnits, context } = params;
    const feePayerKp = this.requireFeePayer();

    const destinationPubkey = new PublicKey(destination.trim());
    const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
    // allowOwnerOffCurve: true mirrors claims.service.ts — some payout destinations (e.g. a
    // program-derived payout address) are off-curve; this only relaxes a client-side check, not
    // the derived address itself.
    const destinationAta = await getAssociatedTokenAddress(mint, destinationPubkey, true);

    const tx = new Transaction();
    if (!(await tokenAccountExists(conn, destinationAta))) {
      const allowed = await guardAtaSponsorship(
        this.supabaseService,
        destinationPubkey.toBase58(),
        mint.toBase58(),
        context,
        this.emailService,
      );
      if (!allowed) {
        throw new Error(
          'This wallet already received a sponsored token account once before and closed it. Further free account creation is blocked to prevent abuse. Please contact support.',
        );
      }
      tx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, destinationAta, destinationPubkey, mint));
    }
    tx.add(createTransferInstruction(burnerAta, destinationAta, burnerKeypair.publicKey, amountBaseUnits));
    tx.add(createCloseAccountInstruction(burnerAta, feePayerKp.publicKey, burnerKeypair.publicKey));

    tx.feePayer = feePayerKp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(burnerKeypair, feePayerKp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[GiveawaySweep] public sweep ${context} tx=${sig}`);
    return { sweepTxHash: sig };
  }

  /**
   * Private sweep: burner -> destination via MagicBlock's Payments API, decorrelating the payout
   * from the giveaway's public burner address. MagicBlock builds the transfer transaction; we
   * only co-sign as burner + fee payer, so rent recovery can't be inlined here — it's swept as a
   * best-effort follow-up via reclaimBurnerFunds, with giveaway-cron.service.ts's GC pass as the
   * backstop if this follow-up fails.
   */
  async sweepPrivate(params: {
    conn: Connection;
    burnerKeypair: Keypair;
    destination: string;
    mint: PublicKey;
    amountBaseUnits: number;
    cluster: 'devnet' | 'mainnet' | 'localhost';
  }): Promise<{ sweepTxHash: string }> {
    const { conn, burnerKeypair, destination, mint, amountBaseUnits, cluster } = params;
    const feePayerKp = this.requireFeePayer();

    const txResponse = await requestMagicblockPrivateTransfer({
      from: burnerKeypair.publicKey.toBase58(),
      to: destination.trim(),
      mint: mint.toBase58(),
      amount: amountBaseUnits,
      cluster,
      // Winner nets exactly amountBaseUnits; funding_required_usd already sized the burner's
      // buffer to absorb MagicBlock's fee on top of the announced per-winner prize.
      exactOut: true,
      gasless: true,
    });

    const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
    let legacyTx: Transaction | null = null;
    let versionedTx: VersionedTransaction | null = null;
    try {
      legacyTx = Transaction.from(txBytes);
    } catch {
      versionedTx = VersionedTransaction.deserialize(txBytes);
    }

    if (legacyTx) {
      legacyTx.feePayer = feePayerKp.publicKey;
      legacyTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      legacyTx.partialSign(burnerKeypair);
      legacyTx.partialSign(feePayerKp);
    } else if (versionedTx) {
      const requiredKeys = new Set(
        versionedTx.message.staticAccountKeys
          .slice(0, versionedTx.message.header.numRequiredSignatures)
          .map((k) => k.toBase58()),
      );
      const signers = [burnerKeypair, feePayerKp].filter((kp) => requiredKeys.has(kp.publicKey.toBase58()));
      versionedTx.sign(signers);
    }

    const serialized = legacyTx ? legacyTx.serialize({ requireAllSignatures: false }) : versionedTx!.serialize();
    const sig = await conn.sendRawTransaction(serialized, { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[GiveawaySweep] private sweep tx=${sig}`);

    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 4_000));
        await reclaimBurnerFunds(conn, burnerKeypair, feePayerKp);
      } catch (e) {
        this.logger.warn(`[GiveawaySweep] post-private-sweep reclaim failed (non-fatal, GC cron will retry): ${String(e)}`);
      }
    })();

    return { sweepTxHash: sig };
  }

  /**
   * Refund whatever's left in the burner (unused fee buffer, once all winners are paid) back to
   * the giveaway creator's own wallet. Same anti-drain guard applies — the creator's wallet is
   * client-supplied, not one we hold the key for. Returns null when there's nothing to refund.
   */
  async refundRemainingToCreator(params: {
    conn: Connection;
    burnerKeypair: Keypair;
    creatorWallet: string;
    mint: PublicKey;
    context: string;
  }): Promise<{ sweepTxHash: string } | null> {
    const { conn, burnerKeypair, creatorWallet, mint, context } = params;
    const feePayerKp = this.requireFeePayer();

    const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
    let remaining = 0n;
    try {
      remaining = (await getAccount(conn, burnerAta)).amount;
    } catch {
      return null; // burner ATA doesn't exist — nothing to refund
    }
    if (remaining === 0n) return null;

    const creatorPubkey = new PublicKey(creatorWallet.trim());
    const creatorAta = await getAssociatedTokenAddress(mint, creatorPubkey, true);

    const tx = new Transaction();
    if (!(await tokenAccountExists(conn, creatorAta))) {
      const allowed = await guardAtaSponsorship(
        this.supabaseService,
        creatorPubkey.toBase58(),
        mint.toBase58(),
        context,
        this.emailService,
      );
      if (!allowed) {
        throw new Error(
          'This wallet already received a sponsored token account once before and closed it. Further free account creation is blocked to prevent abuse. Please contact support.',
        );
      }
      tx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, creatorAta, creatorPubkey, mint));
    }
    tx.add(createTransferInstruction(burnerAta, creatorAta, burnerKeypair.publicKey, remaining));
    tx.add(createCloseAccountInstruction(burnerAta, feePayerKp.publicKey, burnerKeypair.publicKey));

    tx.feePayer = feePayerKp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(burnerKeypair, feePayerKp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[GiveawaySweep] refund-remaining ${context} tx=${sig} amount=${remaining}`);
    return { sweepTxHash: sig };
  }

  /** GC backstop for burners whose sweep never got to close the ATA inline (e.g. sweepPrivate's follow-up failed). Mirrors claims.service.ts's cronReclaimFinishedClaimBurners. */
  async reclaimTerminalBurner(conn: Connection, burnerKeypair: Keypair): Promise<void> {
    const feePayerKp = this.requireFeePayer();
    await reclaimBurnerFunds(conn, burnerKeypair, feePayerKp);
  }
}
