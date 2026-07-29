import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Keypair, PublicKey, Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, createTransferInstruction, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { StatusService } from '../intents/status.service';
import { PrivateBalanceService, PRIVATE_BALANCE_PLATFORM_FEE_BPS } from './private-balance.service';
import { requestMagicblockPrivateTransfer, MAGICBLOCK_GAS_USDC, type MagicblockPrivateTransferTxResponse } from '@/common/magicblock-private-transfer';
import { guardAtaSponsorship } from '@/common/ata-sponsorship-guard';
import { EmailService } from '../email/email.service';
import type { PrivateTransfer } from './entities/private-transfer.entity';

const BATCH_LIMIT = 25;

@Injectable()
export class PrivateBalanceProcessorService {
  private readonly logger = new Logger(PrivateBalanceProcessorService.name);
  private isProcessing = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly privateBalanceService: PrivateBalanceService,
    private readonly nearIntentsService: NearIntentsService,
    private readonly statusService: StatusService,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.isProcessing) {
      this.logger.debug('[PrivateBalanceProcessor] previous run still in progress, skipping');
      return;
    }
    this.isProcessing = true;
    try {
      await this.processDeposits();
      await this.processWithdrawals();
    } catch (e) {
      this.logger.error(`[PrivateBalanceProcessor] cron error: ${String(e)}`);
    } finally {
      this.isProcessing = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Deposits: burner funded (directly or via Near Intents bridge) -> private transfer -> user
  // ─────────────────────────────────────────────────────────────────

  private async processDeposits() {
    const { data, error } = await this.supabaseService.privateTransfers
      .select('*')
      .eq('direction', 'deposit')
      .in('status', ['awaiting_funds', 'bridging'])
      .limit(BATCH_LIMIT);
    if (error) { this.logger.warn(`processDeposits: query failed: ${error.message}`); return; }
    for (const row of (data ?? []) as PrivateTransfer[]) {
      try {
        if (row.near_deposit_address) {
          await this.advanceCrossChainDeposit(row);
        } else {
          await this.tryDeliverBurnerBalance(row, { requireExpected: true });
        }
      } catch (e) {
        this.logger.warn(`[PrivateDeposit] ${row.id}: attempt failed (will retry next tick): ${String(e)}`);
      }
    }
  }

  /** Cross-chain deposit: poll the Near Intents bridge into the burner, then deliver once it lands. */
  private async advanceCrossChainDeposit(row: PrivateTransfer) {
    const statusResult = await this.statusService.getNearIntentsStatus(row.near_deposit_address!);
    if (row.status === 'awaiting_funds' && statusResult.normalizedStatus !== 'unknown') {
      await this.supabaseService.privateTransfers.update({ status: 'bridging' }).eq('id', row.id).eq('status', 'awaiting_funds');
    }
    if (statusResult.isFailed) {
      await this.supabaseService.privateTransfers.update({
        status: 'failed',
        error_message: `Bridge failed: ${statusResult.status}`,
      }).eq('id', row.id);
      this.logger.warn(`[PrivateDeposit] ${row.id}: bridge failed (${statusResult.status})`);
      return;
    }
    if (!statusResult.isComplete) return; // still bridging — checked again next tick
    await this.tryDeliverBurnerBalance(row, { requireExpected: false });
  }

  /**
   * Delivers whatever USDC is actually sitting in the burner to the user, privately. Always
   * forwards the ACTUAL balance (minus the flat relay fee) rather than a pre-computed expected
   * amount — the burner has no gross-up padding (unlike claim burners, which are pre-funded
   * with extra to cover MagicBlock's fee), so exactOut must be false here: exactOut:true would
   * ask MagicBlock to debit MORE than the burner holds, which would just fail on-chain.
   */
  private async tryDeliverBurnerBalance(row: PrivateTransfer, opts: { requireExpected: boolean }) {
    const mint = this.privateBalanceService.getUsdcMint(row.cluster);
    const conn = this.solanaSponsor.getConnectionForCluster(row.cluster);
    const burnerPubkey = new PublicKey(row.burner_address);
    const burnerAta = await getAssociatedTokenAddress(mint, burnerPubkey);

    let balance = BigInt(0);
    try { balance = (await getAccount(conn, burnerAta)).amount; } catch { /* not funded yet */ }

    const relayFeeUnits = BigInt(Math.round(MAGICBLOCK_GAS_USDC * 1_000_000));
    if (balance <= relayFeeUnits) return; // nothing yet, or not even enough to cover the flat relay fee

    if (opts.requireExpected) {
      // Direct deposits only — don't sweep a still-arriving partial transfer early. Cross-chain
      // rows have no reliable expected figure (amount_requested_usdc is a rough quote estimate),
      // so completion there is gated by the bridge status instead (advanceCrossChainDeposit).
      const expectedUnits = BigInt(Math.round(Number(row.amount_requested_usdc) * 1_000_000));
      if (balance < expectedUnits) return;
    }

    this.logger.log(`[PrivateDeposit] ${row.id}: burner funded (${balance} units) — delivering privately`);
    await this.supabaseService.privateTransfers.update({ status: 'delivering_privately' }).eq('id', row.id);

    const transferUnits = balance - relayFeeUnits;
    const destination = await this.usersService.getSolanaWalletAddress(row.user_id);
    const burnerKeypair = this.privateBalanceService.decryptBurnerSecret(row.burner_encrypted_secret, row.burner_address);
    // MagicBlock confirmed platformFeeAccount must be the fee collector's initialized USDC ATA,
    // not its wallet address — same bug as private-balance.service.ts's build leg.
    const feePayerAddress = this.solanaSponsor.getFeePayerAddress();
    const platformFeeAccount = feePayerAddress
      ? (await getAssociatedTokenAddress(mint, new PublicKey(feePayerAddress))).toBase58()
      : null;

    const txResponse = await requestMagicblockPrivateTransfer({
      from: row.burner_address,
      to: destination,
      mint: mint.toBase58(),
      amount: Number(transferUnits),
      cluster: row.cluster,
      exactOut: false,
      gasless: true,
      ...(platformFeeAccount ? { platformFeeBps: PRIVATE_BALANCE_PLATFORM_FEE_BPS, platformFeeAccount } : {}),
    });

    const sig = await this.signAndBroadcastFromBurner(txResponse, burnerKeypair, conn);
    await this.pollConfirm(conn, sig);

    await this.supabaseService.privateTransfers.update({ status: 'complete', leg2_tx_signature: sig }).eq('id', row.id);
    this.logger.log(`[PrivateDeposit] ${row.id}: complete, tx=${sig}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Withdrawals: leg-1 (user -> burner) confirmed -> route burner -> destination
  // ─────────────────────────────────────────────────────────────────

  private async processWithdrawals() {
    const { data, error } = await this.supabaseService.privateTransfers
      .select('*')
      .eq('direction', 'withdrawal')
      .in('status', ['delivering_to_burner', 'bridging'])
      .limit(BATCH_LIMIT);
    if (error) { this.logger.warn(`processWithdrawals: query failed: ${error.message}`); return; }
    for (const row of (data ?? []) as PrivateTransfer[]) {
      try {
        if (row.status === 'bridging') {
          await this.pollOutboundBridge(row);
        } else {
          await this.deliverToBurnerThenRoute(row);
        }
      } catch (e) {
        this.logger.warn(`[PrivateWithdrawal] ${row.id}: attempt failed (will retry next tick): ${String(e)}`);
      }
    }
  }

  private async deliverToBurnerThenRoute(row: PrivateTransfer) {
    if (!row.leg1_tx_signature || !row.destination_address) return; // shouldn't happen at this status

    const conn = this.solanaSponsor.getConnectionForCluster(row.cluster);

    // Confirm leg 1 (user -> burner) actually landed before trusting the burner's balance.
    const statuses = await conn.getSignatureStatuses([row.leg1_tx_signature], { searchTransactionHistory: true });
    const status = statuses.value[0];
    if (status?.err) {
      await this.supabaseService.privateTransfers.update({
        status: 'failed',
        error_message: `Leg 1 transaction failed on-chain: ${JSON.stringify(status.err)}`,
      }).eq('id', row.id);
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: leg1 failed on-chain`);
      return;
    }
    if (status?.confirmationStatus !== 'confirmed' && status?.confirmationStatus !== 'finalized') {
      return; // still in flight — checked again next tick
    }

    const mint = this.privateBalanceService.getUsdcMint(row.cluster);
    const burnerKeypair = this.privateBalanceService.decryptBurnerSecret(row.burner_encrypted_secret, row.burner_address);
    const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
    const expectedUnits = BigInt(Math.round(Number(row.amount_requested_usdc) * 1_000_000));

    let balance = BigInt(0);
    try { balance = (await getAccount(conn, burnerAta)).amount; } catch { /* ATA not indexed yet */ }
    if (balance < expectedUnits) return; // leg 1 confirmed but burner ATA not visible yet — checked again next tick

    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayerKp) {
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: sponsor unavailable — will retry next tick`);
      return;
    }
    const feePayerSol = await conn.getBalance(feePayerKp.publicKey).catch(() => 0);
    if (feePayerSol < 10_000) {
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: fee payer low on SOL — will retry next tick`);
      return;
    }

    if (row.source_or_dest_token) {
      await this.startOutboundBridge(row, mint, conn, burnerKeypair, feePayerKp, balance);
    } else {
      await this.sweepDirectToDestination(row, mint, conn, burnerKeypair, feePayerKp, balance);
    }
  }

  /** Direct Solana destination: plain SPL transfer, burner -> destination_address. */
  private async sweepDirectToDestination(
    row: PrivateTransfer,
    mint: PublicKey,
    conn: Connection,
    burnerKeypair: Keypair,
    feePayerKp: Keypair,
    balance: bigint,
  ) {
    const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
    const destinationPubkey = new PublicKey(row.destination_address!);
    const destinationAta = await getAssociatedTokenAddress(mint, destinationPubkey);
    const sweepTx = new Transaction();
    try {
      await getAccount(conn, destinationAta);
    } catch {
      // Anti-drain guard: the destination is a raw client-supplied address with no ownership
      // check (that's the point — private withdrawal can go anywhere). Without this, a wallet
      // could create -> close -> get sponsored again indefinitely, draining the fee payer.
      const allowed = await guardAtaSponsorship(this.supabaseService, destinationPubkey.toBase58(), mint.toBase58(), `private-withdrawal:${row.id}`, this.emailService);
      if (!allowed) {
        await this.supabaseService.privateTransfers.update({
          status: 'failed',
          error_message: 'This destination wallet already received a sponsored token account once before and closed it. Further free account creation is blocked to prevent abuse. Please contact support.',
        }).eq('id', row.id);
        this.logger.warn(`[PrivateWithdrawal] ${row.id}: blocked — destination ATA already sponsored once before`);
        return;
      }
      sweepTx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, destinationAta, destinationPubkey, mint));
    }
    sweepTx.add(createTransferInstruction(burnerAta, destinationAta, burnerKeypair.publicKey, balance));
    sweepTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    sweepTx.feePayer = feePayerKp.publicKey;
    sweepTx.sign(burnerKeypair, feePayerKp);

    const sig = await conn.sendRawTransaction(sweepTx.serialize(), { skipPreflight: true });
    await this.pollConfirm(conn, sig);

    await this.supabaseService.privateTransfers.update({ status: 'complete', leg2_tx_signature: sig }).eq('id', row.id);
    this.logger.log(`[PrivateWithdrawal] ${row.id}: complete, burner -> ${row.destination_address!.slice(0, 8)}… tx=${sig}`);
  }

  /** Cross-chain destination: quote + fund a Near Intents outbound bridge from the burner. One-time; subsequent ticks poll it via pollOutboundBridge. */
  private async startOutboundBridge(
    row: PrivateTransfer,
    mint: PublicKey,
    conn: Connection,
    burnerKeypair: Keypair,
    feePayerKp: Keypair,
    balance: bigint,
  ) {
    const { symbol, chain } = row.source_or_dest_token!;
    const [fromToken, toToken] = await Promise.all([
      this.privateBalanceService.resolveSolanaUsdcNearToken(),
      this.privateBalanceService.resolveNearToken(symbol, chain),
    ]);
    const amountInHuman = (Number(balance) / 1_000_000).toString();

    let quote;
    try {
      quote = await this.nearIntentsService.getDepositQuote({
        fromToken,
        toToken,
        amountIn: amountInHuman,
        recipient: row.destination_address!,
        refundAddress: row.burner_address,
        referral: 'loofta',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.supabaseService.privateTransfers.update({
        status: 'failed',
        error_message: `Could not get a bridge address for ${symbol}: ${msg}`,
      }).eq('id', row.id);
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: outbound quote failed: ${msg}`);
      return;
    }
    if (!quote.depositAddress) {
      await this.supabaseService.privateTransfers.update({
        status: 'failed',
        error_message: `Could not get a bridge address for ${symbol}`,
      }).eq('id', row.id);
      return;
    }

    const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
    const bridgeDestPubkey = new PublicKey(quote.depositAddress);
    const bridgeDestAta = await getAssociatedTokenAddress(mint, bridgeDestPubkey);
    const fundTx = new Transaction();
    try {
      await getAccount(conn, bridgeDestAta);
    } catch {
      const allowed = await guardAtaSponsorship(this.supabaseService, bridgeDestPubkey.toBase58(), mint.toBase58(), `private-withdrawal-bridge:${row.id}`, this.emailService);
      if (!allowed) {
        await this.supabaseService.privateTransfers.update({
          status: 'failed',
          error_message: 'The bridge account for this transfer already received a sponsored token account once before. Please contact support.',
        }).eq('id', row.id);
        this.logger.warn(`[PrivateWithdrawal] ${row.id}: blocked — bridge ATA already sponsored once before`);
        return;
      }
      fundTx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, bridgeDestAta, bridgeDestPubkey, mint));
    }
    fundTx.add(createTransferInstruction(burnerAta, bridgeDestAta, burnerKeypair.publicKey, balance));
    fundTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    fundTx.feePayer = feePayerKp.publicKey;
    fundTx.sign(burnerKeypair, feePayerKp);

    const sig = await conn.sendRawTransaction(fundTx.serialize(), { skipPreflight: true });
    await this.pollConfirm(conn, sig);

    await this.supabaseService.privateTransfers.update({
      status: 'bridging',
      near_deposit_address: quote.depositAddress,
      near_memo: quote.memo ?? null,
      leg2_tx_signature: sig,
    }).eq('id', row.id);
    this.logger.log(`[PrivateWithdrawal] ${row.id}: bridging to ${symbol}/${chain} via ${quote.depositAddress.slice(0, 8)}… tx=${sig}`);
  }

  private async pollOutboundBridge(row: PrivateTransfer) {
    if (!row.near_deposit_address) return; // shouldn't happen at 'bridging' status
    const statusResult = await this.statusService.getNearIntentsStatus(row.near_deposit_address);
    if (statusResult.isFailed) {
      await this.supabaseService.privateTransfers.update({
        status: 'failed',
        error_message: `Bridge failed: ${statusResult.status}`,
      }).eq('id', row.id);
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: outbound bridge failed (${statusResult.status})`);
      return;
    }
    if (!statusResult.isComplete) return; // still bridging — checked again next tick
    await this.supabaseService.privateTransfers.update({ status: 'complete' }).eq('id', row.id);
    this.logger.log(`[PrivateWithdrawal] ${row.id}: complete (bridged to destination)`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Shared helpers
  // ─────────────────────────────────────────────────────────────────

  /** Signs a MagicBlock-built private-transfer tx with the burner keypair (+ fee payer if present) and broadcasts. */
  private async signAndBroadcastFromBurner(
    txResponse: MagicblockPrivateTransferTxResponse,
    burnerKeypair: Keypair,
    conn: Connection,
  ): Promise<string> {
    if (txResponse.sendTo === 'ephemeral') {
      // Burner-sourced transfers routing through the ephemeral rollup isn't handled yet —
      // fail loudly (row stays put, retried next tick) rather than broadcast to the wrong layer.
      throw new Error('Unexpected ephemeral routing for burner-sourced private transfer');
    }
    const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    let legacyTx: Transaction | null = null;
    let versionedTx: VersionedTransaction | null = null;
    try { legacyTx = Transaction.from(txBytes); } catch { versionedTx = VersionedTransaction.deserialize(txBytes); }

    if (legacyTx) {
      if (feePayerKp) {
        legacyTx.feePayer = feePayerKp.publicKey;
        legacyTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      }
      legacyTx.partialSign(burnerKeypair);
      if (feePayerKp) legacyTx.partialSign(feePayerKp);
      return conn.sendRawTransaction(legacyTx.serialize({ requireAllSignatures: false }), { skipPreflight: true });
    }

    const requiredKeys = new Set(
      versionedTx!.message.staticAccountKeys
        .slice(0, versionedTx!.message.header.numRequiredSignatures)
        .map((k) => k.toBase58()),
    );
    const signers = [burnerKeypair, feePayerKp].filter(
      (kp): kp is Keypair => !!kp && requiredKeys.has(kp.publicKey.toBase58()),
    );
    versionedTx!.sign(signers);
    return conn.sendRawTransaction(versionedTx!.serialize(), { skipPreflight: true });
  }

  private async pollConfirm(conn: Connection, signature: string, timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
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
}
