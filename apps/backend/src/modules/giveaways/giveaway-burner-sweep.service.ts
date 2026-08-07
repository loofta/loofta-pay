import { Injectable, Logger } from '@nestjs/common';
import { Keypair, PublicKey, Transaction, type Connection } from '@solana/web3.js';
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
import { guardAtaSponsorship, assertPerUserAtaCreationCapNotExceeded } from '@/common/ata-sponsorship-guard';
import { tokenAccountExists } from '@/common/token-account-exists';
import { reclaimBurnerFunds } from '@/common/burner-reclaim';

export interface GiveawayBurner {
  address: string;
  encryptedSecret: string;
}

/**
 * Standalone burner mint/fund for the Giveaways feature. Deliberately NOT extracted from
 * claims.service.ts (3807 lines, handles live claim/payment money today) — same decrypt pattern
 * (HKDF-derived per-burner key via SendPaymentEncryptionService), zero risk of regressing the
 * existing claims flow. Winner payout no longer sweeps directly to a wallet here — instead
 * fundNewClaimBurner funds a fresh per-winner burner from the giveaway's own burner, and
 * giveaway-payout.service.ts turns that into a normal claims-table payments row (a /c/[id] claim
 * link), reusing the exact claim/sweep mechanism claims.service.ts already has for every other
 * payment instead of duplicating it here. See the "Giveaways Module" plan (project memory).
 *
 * Every method here that creates a destination ATA follows .claude/skills/solana-sponsor-safety:
 * guard client-suppliable destinations (creator refund wallet) before sponsoring their ATA
 * creation; a fresh burner we mint and hold the key for needs no guard (the "we own it" bucket).
 * Always recover the burner's own rent (we hold that key) in the same transaction when we build it.
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
   * Refund whatever's left in the burner (once all winners are paid) back to the giveaway
   * creator's own wallet — MINUS the giveaway's platform fee, if any, which goes to our own fee
   * payer's wallet instead (an address we hold the key for, so no anti-drain guard needed for
   * that leg). Same anti-drain guard applies to the creator leg — that wallet is client-supplied,
   * not one we hold the key for. Returns null when there's nothing to refund.
   */
  async refundRemainingToCreator(params: {
    conn: Connection;
    burnerKeypair: Keypair;
    creatorWallet: string;
    mint: PublicKey;
    context: string;
    /** Giveaway creator's Privy user id — same rationale as sweepPublic's callerUserId. */
    callerUserId?: string;
    /** Platform fee to withhold from the creator's refund and send to the fee payer's own wallet instead. */
    platformFeeBaseUnits?: bigint;
  }): Promise<{ sweepTxHash: string; platformFeeBaseUnits: bigint } | null> {
    const { conn, burnerKeypair, creatorWallet, mint, context, callerUserId } = params;
    const feePayerKp = this.requireFeePayer();

    const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
    let remaining = 0n;
    try {
      remaining = (await getAccount(conn, burnerAta)).amount;
    } catch {
      return null; // burner ATA doesn't exist — nothing to refund
    }
    if (remaining === 0n) return null;

    // Never withhold more than the burner actually holds — an underfunded edge case (giveaway
    // completed with less buffer than expected) should degrade to "creator gets less back", not
    // "fee sweep fails outright".
    const requestedFeeUnits = params.platformFeeBaseUnits ?? 0n;
    const feeUnits = requestedFeeUnits > remaining ? remaining : requestedFeeUnits;
    const creatorUnits = remaining - feeUnits;

    const creatorPubkey = new PublicKey(creatorWallet.trim());
    const creatorAta = await getAssociatedTokenAddress(mint, creatorPubkey, true);

    const tx = new Transaction();
    if (creatorUnits > 0n) {
      if (!(await tokenAccountExists(conn, creatorAta))) {
        if (callerUserId) {
          await assertPerUserAtaCreationCapNotExceeded(this.supabaseService, callerUserId, 1, 'GiveawayRefund');
        }
        const allowed = await guardAtaSponsorship(
          this.supabaseService,
          creatorPubkey.toBase58(),
          mint.toBase58(),
          context,
          this.emailService,
          callerUserId,
        );
        if (!allowed) {
          throw new Error(
            'This wallet already received a sponsored token account once before and closed it. Further free account creation is blocked to prevent abuse. Please contact support.',
          );
        }
        tx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, creatorAta, creatorPubkey, mint));
      }
      tx.add(createTransferInstruction(burnerAta, creatorAta, burnerKeypair.publicKey, creatorUnits));
    }
    if (feeUnits > 0n) {
      // Fee payer's own ATA — an address we generate/hold the key for, so no guardAtaSponsorship
      // needed (the "we own it" bucket, same as fundNewClaimBurner's destination).
      const feePayerAta = await getAssociatedTokenAddress(mint, feePayerKp.publicKey);
      if (!(await tokenAccountExists(conn, feePayerAta))) {
        tx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, feePayerAta, feePayerKp.publicKey, mint));
      }
      tx.add(createTransferInstruction(burnerAta, feePayerAta, burnerKeypair.publicKey, feeUnits));
    }
    tx.add(createCloseAccountInstruction(burnerAta, feePayerKp.publicKey, burnerKeypair.publicKey));

    tx.feePayer = feePayerKp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(burnerKeypair, feePayerKp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[GiveawaySweep] refund-remaining ${context} tx=${sig} creator=${creatorUnits} platformFee=${feeUnits}`);
    return { sweepTxHash: sig, platformFeeBaseUnits: feeUnits };
  }

  /**
   * Mints a fresh one-time burner and funds it from the giveaway's own (already-funded) burner —
   * this becomes a winner's dedicated claim-payment burner, same shape as send-payment.service.ts's
   * fanOutMultiSendHubTransfer (hub -> per-recipient burner), except the giveaway's burner plays the
   * hub role instead of the platform fee payer. The new burner's ATA needs no guardAtaSponsorship
   * check — it's an address we generate and hold the key for (the "we own it" bucket), same as
   * fanOutMultiSendHubTransfer's own comment on this exact pattern. Does NOT close the giveaway
   * burner's ATA (siblings may still need funding from it); that happens once in
   * refundRemainingToCreator after every winner is paid.
   */
  async fundNewClaimBurner(params: {
    conn: Connection;
    giveawayBurnerKeypair: Keypair;
    mint: PublicKey;
    amountBaseUnits: bigint;
  }): Promise<{ burner: GiveawayBurner; txHash: string }> {
    const { conn, giveawayBurnerKeypair, mint, amountBaseUnits } = params;
    const feePayerKp = this.requireFeePayer();

    const burner = this.createBurner();
    if (!burner) throw new Error('Giveaway sweep encryption is not configured (SEND_PAYMENT_ENC_KEY missing).');
    const newBurnerKeypair = this.decryptBurner(burner.address, burner.encryptedSecret);

    const sourceAta = await getAssociatedTokenAddress(mint, giveawayBurnerKeypair.publicKey);
    const destAta = await getAssociatedTokenAddress(mint, newBurnerKeypair.publicKey);

    const tx = new Transaction();
    tx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, destAta, newBurnerKeypair.publicKey, mint));
    tx.add(createTransferInstruction(sourceAta, destAta, giveawayBurnerKeypair.publicKey, amountBaseUnits));

    tx.feePayer = feePayerKp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(giveawayBurnerKeypair, feePayerKp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[GiveawaySweep] funded new claim burner=${burner.address} tx=${sig} amount=${amountBaseUnits}`);
    return { burner, txHash: sig };
  }

  /** GC backstop for a giveaway burner whose refund-to-creator sweep never got to close the ATA inline. Mirrors claims.service.ts's cronReclaimFinishedClaimBurners. */
  async reclaimTerminalBurner(conn: Connection, burnerKeypair: Keypair): Promise<void> {
    const feePayerKp = this.requireFeePayer();
    await reclaimBurnerFunds(conn, burnerKeypair, feePayerKp);
  }
}
