import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { isCronEnabled } from '@/common/cron-gate';
import { Keypair, PublicKey, Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, createTransferInstruction, createAssociatedTokenAccountInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { StatusService } from '../intents/status.service';
import { PrivateBalanceService, PRIVATE_BALANCE_PLATFORM_FEE_BPS } from './private-balance.service';
import { requestMagicblockPrivateTransfer, resolveMagicblockRelayFeeUsdc, estimateMagicblockGrossUp, MAGICBLOCK_VOLUME_FEE_BPS, type MagicblockPrivateTransferTxResponse } from '@/common/magicblock-private-transfer';
import { guardAtaSponsorship, assertPerUserAtaCreationCapNotExceeded } from '@/common/ata-sponsorship-guard';
import { tokenAccountExists } from '@/common/token-account-exists';
import { reclaimBurnerFunds } from '@/common/burner-reclaim';
import { EmailService } from '../email/email.service';
import type { PrivateTransfer } from './entities/private-transfer.entity';

const BATCH_LIMIT = 25;
const DEPOSIT_ABANDON_DAYS = 7;

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
    private readonly config: ConfigService,
  ) {
    if (!this.isProd) {
      this.logger.warn('PrivateBalanceProcessorService: NODE_ENV != production — cron disabled on this instance (avoids racing production for the same burner/transfer rows and doubling RPC load)');
    }
  }

  /**
   * Same rationale as LotteryCronService.isProd: this cron drives real burner wallets and
   * MagicBlock transfers keyed only by DB row against the shared production Supabase project.
   * A local/dev instance polling the same rows races production and doubles RPC call volume
   * against the same rate-limited key.
   */
  private get isProd(): boolean {
    return isCronEnabled(this.config);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (!this.isProd) return;
    if (this.isProcessing) {
      this.logger.debug('[PrivateBalanceProcessor] previous run still in progress, skipping');
      return;
    }
    this.isProcessing = true;
    try {
      await this.expireAbandonedDeposits();
      await this.processDeposits();
      await this.processWithdrawals();
      await this.reclaimFinishedBurners();
    } catch (e) {
      this.logger.error(`[PrivateBalanceProcessor] cron error: ${String(e)}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Backstop reclaiming ATA rent from terminal ('complete' only) burners — the post-delivery and
   * post-bridge reclaims handle the happy path;
   * this catches misses plus the historical backlog (rent audit 2026-07-29: 39% of terminal
   * private-balance burners still held their ~0.002 SOL rent). 'failed' rows are deliberately
   * excluded — their burner may still hold the user's funds, which must never be swept.
   * Requires migration 20260729130000 (burner_reclaimed_at on private_transfers); until applied,
   * the query fails with "column does not exist" and this logs + skips harmlessly.
   */
  private async reclaimFinishedBurners() {
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayerKp) return;
    const { data: rows, error } = await this.supabaseService.privateTransfers
      .select('id, burner_address, burner_encrypted_secret, cluster')
      .eq('status', 'complete')
      .is('burner_reclaimed_at', null)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) {
      this.logger.warn(`[BurnerReclaim] query failed (migration 20260729130000 applied yet?): ${error.message}`);
      return;
    }
    for (const row of (rows ?? []) as PrivateTransfer[]) {
      try {
        const burnerKeypair = this.privateBalanceService.decryptBurnerSecret(row.burner_encrypted_secret, row.burner_address);
        const conn = this.solanaSponsor.getConnectionForCluster(row.cluster);
        const result = await reclaimBurnerFunds(conn, burnerKeypair, feePayerKp);
        await this.supabaseService.privateTransfers
          .update({ burner_reclaimed_at: new Date().toISOString() })
          .eq('id', row.id);
        if (result.signature) {
          this.logger.log(`[BurnerReclaim] ${row.id}: reclaimed burner ${row.burner_address.slice(0, 8)}… (${result.closedTokenAccounts} ATA(s) closed)`);
        }
      } catch (e) {
        this.logger.warn(`[BurnerReclaim] ${row.id}: failed (will retry next tick): ${String(e)}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Deposits: burner funded (directly or via Near Intents bridge) -> private transfer -> user
  // ─────────────────────────────────────────────────────────────────

  /**
   * Direct-deposit burners that were created but never funded (user abandoned the flow client-side)
   * stay 'awaiting_funds' forever — nothing else ever transitions them out. With no ordering on the
   * processDeposits() query below, an unbounded backlog of these dead rows permanently starves newer,
   * genuinely-funded deposits out of the BATCH_LIMIT window (confirmed incident 2026-08-05: 29 rows
   * matched the filter, only 25 fit in a batch, and the newest 4 — including one already funded
   * on-chain for 8+ hours — never got picked up). Excludes near_deposit_address rows (cross-chain via
   * Near Intents) since those are driven by advanceCrossChainDeposit's bridge-status poll instead and
   * shouldn't be auto-failed on a timer.
   */
  private async expireAbandonedDeposits() {
    const cutoff = new Date(Date.now() - DEPOSIT_ABANDON_DAYS * 24 * 60 * 60_000).toISOString();
    const { data, error } = await this.supabaseService.privateTransfers
      .update({
        status: 'failed',
        error_message: `Deposit abandoned — no funds received within ${DEPOSIT_ABANDON_DAYS} days`,
      })
      .eq('direction', 'deposit')
      .eq('status', 'awaiting_funds')
      .is('near_deposit_address', null)
      .lt('created_at', cutoff)
      .select('id');
    if (error) { this.logger.warn(`expireAbandonedDeposits: query failed: ${error.message}`); return; }
    if (data?.length) {
      this.logger.log(`[PrivateDeposit] expired ${data.length} abandoned deposit row(s) unfunded for >${DEPOSIT_ABANDON_DAYS}d`);
    }
  }

  private async processDeposits() {
    // Newest-first: a growing backlog of dead/abandoned 'awaiting_funds' rows must never be able to
    // starve a genuinely-funded recent deposit out of the BATCH_LIMIT window. expireAbandonedDeposits()
    // (run just before this every tick) caps how large that backlog can get, but ordering oldest-last
    // is defense in depth for the window before a stuck row crosses the expiry cutoff.
    // 'delivering_privately' must stay in this list: tryDeliverBurnerBalance() sets that status
    // BEFORE building/broadcasting the MagicBlock transfer, so any failure after that point
    // (RPC hiccup, wallet-resolve error, broadcast failure) would otherwise strand the row
    // forever — it'd never match this query again and never get retried, even though the burner
    // still holds the funds untouched (confirmed real incident 2026-08-05, private_transfers
    // 43138a5e-...: reached 'delivering_privately', no leg2_tx_signature, no error_message,
    // burner balance unchanged — stuck with no path back into this query). Safe to retry: the
    // balance re-check at the top of tryDeliverBurnerBalance means a row that already completed
    // on-chain (but crashed before the DB write) would just see balance <= relayFeeUnits and
    // no-op rather than double-spend.
    const { data, error } = await this.supabaseService.privateTransfers
      .select('*')
      .eq('direction', 'deposit')
      .in('status', ['awaiting_funds', 'bridging', 'delivering_privately'])
      .order('created_at', { ascending: false })
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
   *
   * IMPORTANT (confirmed via on-chain inspection, 2026-08-06 incident): the transaction this
   * builds and confirms below does NOT deliver funds to the user directly. Its own program logs
   * show "Instruction: DepositAndDelegateShuttleEphemeralAtaWithMergeAndPrivateTransfer" and a
   * "queue=..." address — it deposits into MagicBlock's own queued-delivery system. The actual
   * delivery to the user's wallet happens 1-10 minutes later via one or more separate
   * "ExecuteReadyQueuedTransfer" instructions MagicBlock's own relay submits, which we neither
   * control nor get notified of. So this method only gets the row to "hop1 confirmed" — it does
   * NOT mark 'complete' itself. That's verifyQueuedDelivery()'s job, called on later ticks once
   * leg2_tx_signature is set, which watches the destination's actual balance instead of trusting
   * the first on-chain hop (mirrors the same pattern deliverToBurnerThenRoute already uses for
   * withdrawals' leg1 — checking the burner's real balance, not just the signature status).
   */
  private async tryDeliverBurnerBalance(row: PrivateTransfer, opts: { requireExpected: boolean }) {
    // Hop1 already confirmed on a prior tick — just checking whether MagicBlock's queue has
    // actually released the funds yet, not rebuilding/rebroadcasting anything.
    if (row.status === 'delivering_privately' && row.leg2_tx_signature) {
      await this.verifyQueuedDelivery(row);
      return;
    }

    const mint = this.privateBalanceService.getUsdcMint(row.cluster);
    const conn = this.solanaSponsor.getConnectionForCluster(row.cluster);
    const burnerPubkey = new PublicKey(row.burner_address);
    const burnerAta = await getAssociatedTokenAddress(mint, burnerPubkey);

    let balance = BigInt(0);
    try {
      balance = (await getAccount(conn, burnerAta)).amount;
    } catch (e: any) {
      // TokenAccountNotFoundError means genuinely not funded yet — expected, stay quiet.
      // Anything else (RPC timeout/rate-limit/etc) previously vanished here with zero trace,
      // making a stuck row indistinguishable from "still waiting" — log so it's diagnosable.
      if (e?.name !== 'TokenAccountNotFoundError') {
        this.logger.warn(`[PrivateDeposit] ${row.id}: balance check failed (will retry next tick): ${e?.message ?? e}`);
      }
    }

    const relayFeeUnits = BigInt(Math.round((await resolveMagicblockRelayFeeUsdc()) * 1_000_000));
    if (balance <= relayFeeUnits) {
      // A row already at 'delivering_privately' with a drained/empty burner most likely already
      // completed on-chain on a prior tick but crashed before the final DB write (status stuck,
      // no leg2_tx_signature) — silently no-op-ing here would hide a real delivered payment
      // behind a row that looks stuck forever. Surface it instead of staying quiet.
      if (row.status === 'delivering_privately') {
        this.logger.warn(`[PrivateDeposit] ${row.id}: status is 'delivering_privately' but burner is empty/near-empty — likely already delivered on a prior attempt that crashed before recording leg2_tx_signature. Needs manual on-chain verification.`);
      }
      return; // nothing yet, or not even enough to cover the relay fee
    }

    if (opts.requireExpected) {
      // Direct deposits only — don't sweep a still-arriving partial transfer early. Cross-chain
      // rows have no reliable expected figure (amount_requested_usdc is a rough quote estimate),
      // so completion there is gated by the bridge status instead (advanceCrossChainDeposit).
      const expectedUnits = BigInt(Math.round(Number(row.amount_requested_usdc) * 1_000_000));
      if (balance < expectedUnits) return;
    }

    this.logger.log(`[PrivateDeposit] ${row.id}: burner funded (${balance} units) — delivering privately`);
    await this.supabaseService.privateTransfers.update({ status: 'delivering_privately' }).eq('id', row.id);

    // Deliver the user's EXACT requested net amount whenever the burner holds enough padding to
    // support it — MagicBlock's exactOut:true grosses up the debit internally and guarantees the
    // destination nets exactly `amount` (confirmed semantics, see this file's top comment). Any
    // leftover stays in the burner and is swept to the fee payer by reclaimBurnerLater() below —
    // "burner delivers the exact amount, we get the rest," same as claim/send-payment burners.
    // Only fall back to the old best-effort (deliver whatever's left, amount may run slightly over
    // or under) when the burner doesn't provably hold enough: exactOut:true debiting more than the
    // burner has would fail on-chain outright, so this must stay conservative. A manually-funded
    // (QR/address) deposit that only just cleared the requireExpected gate above, with no padding
    // beyond the bare net target, is the common case that still needs the fallback.
    const netTargetUnits = BigInt(Math.round(Number(row.amount_requested_usdc) * 1_000_000));
    const totalBps = MAGICBLOCK_VOLUME_FEE_BPS + PRIVATE_BALANCE_PLATFORM_FEE_BPS;
    const estimatedGrossForExactOut = BigInt(estimateMagicblockGrossUp(Number(netTargetUnits), totalBps));
    // +2% on top of the estimate: estimateMagicblockGrossUp is an approximation of MagicBlock's
    // internal math (see its own doc comment), not a confirmed-exact figure — this is a smaller,
    // separate margin from the one applied when quoting the send amount in private-balance.service.ts.
    const requiredForExactOut = estimatedGrossForExactOut + (estimatedGrossForExactOut * BigInt(200)) / BigInt(10_000) + relayFeeUnits;
    const useExactOut = balance >= requiredForExactOut;
    const transferUnits = useExactOut ? netTargetUnits : (balance - relayFeeUnits);

    const destination = await this.usersService.getSolanaWalletAddress(row.user_id, { skipCache: true });
    const destinationPubkey = new PublicKey(destination);
    // Snapshot BEFORE broadcasting hop1 — this is the baseline verifyQueuedDelivery() compares
    // against later to detect the actual (delayed) arrival.
    const destinationBalanceBefore = await this.getUsdcBalance(conn, mint, destinationPubkey);
    const burnerKeypair = this.privateBalanceService.decryptBurnerSecret(row.burner_encrypted_secret, row.burner_address);
    // MagicBlock confirmed platformFeeAccount must be the fee collector's initialized USDC ATA,
    // not its wallet address — same bug as private-balance.service.ts's build leg.
    const feePayerAddress = this.solanaSponsor.getFeePayerAddress();
    const platformFeeAccount = feePayerAddress
      ? (await getAssociatedTokenAddress(mint, new PublicKey(feePayerAddress))).toBase58()
      : null;

    this.logger.log(`[PrivateDeposit] ${row.id}: burner balance=${balance} exactOut=${useExactOut} (needs>=${requiredForExactOut}) amount=${transferUnits}`);

    const txResponse = await requestMagicblockPrivateTransfer({
      from: row.burner_address,
      to: destination,
      mint: mint.toBase58(),
      amount: Number(transferUnits),
      cluster: row.cluster,
      exactOut: useExactOut,
      gasless: true,
      ...(platformFeeAccount ? { platformFeeBps: PRIVATE_BALANCE_PLATFORM_FEE_BPS, platformFeeAccount } : {}),
    });

    const sig = await this.signAndBroadcastFromBurner(txResponse, burnerKeypair, conn);
    await this.pollConfirm(conn, sig);

    // hop1 (burner -> MagicBlock's queue) confirmed — NOT the same as delivered. Record what to
    // expect and wait for verifyQueuedDelivery() to observe it actually landing before completing.
    // exactOut:true already guarantees the exact figure, no need to parse it back out of the logs.
    const expectedUnits = useExactOut ? netTargetUnits : await this.parseExpectedDeliveryUnits(conn, sig, transferUnits);
    await this.supabaseService.privateTransfers.update({
      leg2_tx_signature: sig,
      delivery_hop1_confirmed_at: new Date().toISOString(),
      delivery_expected_usdc: (Number(expectedUnits) / 1_000_000).toString(),
      delivery_baseline_usdc: (Number(destinationBalanceBefore) / 1_000_000).toString(),
    }).eq('id', row.id);
    this.logger.log(`[PrivateDeposit] ${row.id}: hop1 confirmed tx=${sig}, waiting for MagicBlock's queued release of ~$${(Number(expectedUnits) / 1_000_000).toFixed(6)} (checked again next tick)`);

    // The delivery tx above is built by MagicBlock's relay, so we can't append a closeAccount to
    // it — reclaim the burner's ATA rent (+ any dust MagicBlock's fee accounting left behind) in
    // a follow-up tx instead, after a short settle delay. Safe to do now regardless of the queued
    // release's outcome: the burner itself is already fully drained by hop1 either way.
    this.reclaimBurnerLater(row.id, burnerKeypair, conn);
  }

  /** Current USDC balance for an arbitrary owner, or 0 if the ATA doesn't exist yet. */
  private async getUsdcBalance(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
    try {
      const ata = await getAssociatedTokenAddress(mint, owner);
      return (await getAccount(conn, ata)).amount;
    } catch {
      return BigInt(0);
    }
  }

  /**
   * The confirmed hop1 transaction's own program logs report exactly what MagicBlock's queue will
   * release (observed in production: "private_transfer_amount: 5052403") — more reliable than
   * re-deriving it ourselves, since this build uses exactOut:false and MagicBlock's bps math on a
   * non-exactOut transfer was never independently confirmed the way the exactOut path was (see
   * magicblock-private-transfer.ts's top comment). Falls back to an approximation only if the log
   * line isn't found, which isn't expected in normal operation.
   */
  private async parseExpectedDeliveryUnits(conn: Connection, signature: string, transferUnits: bigint): Promise<bigint> {
    try {
      const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      for (const line of tx?.meta?.logMessages ?? []) {
        const match = line.match(/private_transfer_amount:\s*(\d+)/);
        if (match) return BigInt(match[1]);
      }
      this.logger.warn(`[PrivateDeposit] no private_transfer_amount found in hop1 logs for ${signature} — falling back to bps estimate`);
    } catch (e) {
      this.logger.warn(`[PrivateDeposit] failed to fetch hop1 logs for ${signature}: ${String(e)} — falling back to bps estimate`);
    }
    const totalBps = BigInt(MAGICBLOCK_VOLUME_FEE_BPS + PRIVATE_BALANCE_PLATFORM_FEE_BPS);
    return (transferUnits * (BigInt(10_000) - totalBps)) / BigInt(10_000);
  }

  /**
   * Watches for MagicBlock's delayed queued release (see tryDeliverBurnerBalance's doc comment)
   * actually landing in the destination wallet, instead of trusting hop1's on-chain confirmation
   * alone. Called every tick while status is 'delivering_privately' with leg2_tx_signature set.
   */
  private async verifyQueuedDelivery(row: PrivateTransfer) {
    if (row.delivery_expected_usdc == null || row.delivery_baseline_usdc == null || !row.delivery_hop1_confirmed_at) {
      // Row from before this verification step shipped (or the migration adding these columns
      // hasn't landed on this environment yet) — nothing to compare against. Mark complete rather
      // than getting permanently stuck; only affects rows created before this fix went live.
      await this.supabaseService.privateTransfers.update({ status: 'complete' }).eq('id', row.id);
      this.logger.warn(`[PrivateDeposit] ${row.id}: no delivery-verification baseline recorded (pre-fix row) — marking complete without verifying actual arrival, tx=${row.leg2_tx_signature}`);
      return;
    }

    const mint = this.privateBalanceService.getUsdcMint(row.cluster);
    const conn = this.solanaSponsor.getConnectionForCluster(row.cluster);
    const destination = await this.usersService.getSolanaWalletAddress(row.user_id, { skipCache: true });
    const currentUnits = await this.getUsdcBalance(conn, mint, new PublicKey(destination));
    const baselineUnits = BigInt(Math.round(Number(row.delivery_baseline_usdc) * 1_000_000));
    const expectedUnits = BigInt(Math.round(Number(row.delivery_expected_usdc) * 1_000_000));
    const delta = currentUnits - baselineUnits;

    if (delta >= expectedUnits) {
      await this.supabaseService.privateTransfers.update({ status: 'complete' }).eq('id', row.id);
      this.logger.log(`[PrivateDeposit] ${row.id}: MagicBlock queued release confirmed (destination +${delta} units, expected >=${expectedUnits}) — complete`);
      return;
    }

    const elapsedMs = Date.now() - new Date(row.delivery_hop1_confirmed_at).getTime();
    const VERIFY_TIMEOUT_MS = 30 * 60_000; // generous vs MagicBlock's own documented 10min max delay
    if (elapsedMs > VERIFY_TIMEOUT_MS) {
      // Deliberately NOT marking 'complete' (the money may genuinely not have arrived) or 'failed'
      // (it may still be sitting in MagicBlock's queue, not lost) — surface loudly instead so this
      // gets a human looking at the actual on-chain state rather than either lying about it.
      this.logger.error(`[PrivateDeposit] ${row.id}: queued delivery NOT observed ${Math.round(elapsedMs / 60_000)}min after hop1 confirmed (tx=${row.leg2_tx_signature}, destination=${destination}, expected +${expectedUnits} units, only +${delta} seen) — needs manual on-chain investigation`);
    }
    // else: still within the normal delay window — checked again next tick
  }

  /** Fire-and-forget rent reclaim for a finished burner (see @/common/burner-reclaim). */
  private reclaimBurnerLater(rowId: string, burnerKeypair: Keypair, conn: Connection): void {
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayerKp) return;
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 4_000));
        await reclaimBurnerFunds(conn, burnerKeypair, feePayerKp);
      } catch (e) {
        this.logger.warn(`[BurnerReclaim] ${rowId}: reclaim failed (non-fatal, rent stays until manually swept): ${String(e)}`);
      }
    })();
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

    // Confirm the user's transaction actually landed before deciding anything.
    const statuses = await conn.getSignatureStatuses([row.leg1_tx_signature], { searchTransactionHistory: true });
    const status = statuses.value[0];
    if (status?.err) {
      await this.supabaseService.privateTransfers.update({
        status: 'failed',
        error_message: `Transaction failed on-chain: ${JSON.stringify(status.err)}`,
      }).eq('id', row.id);
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: transaction failed on-chain`);
      return;
    }
    if (status?.confirmationStatus !== 'confirmed' && status?.confirmationStatus !== 'finalized') {
      return; // still in flight — checked again next tick
    }

    const mint = this.privateBalanceService.getUsdcMint(row.cluster);

    // Cross-chain destinations still route through the burner: bridging needs the funds to sit in
    // a wallet we control so we can initiate the Near Intents leg. That path is currently disabled
    // at buildWithdrawal, so nothing reaches here today, but keep it working for when it ships.
    if (row.source_or_dest_token) {
      const burnerKeypair = this.privateBalanceService.decryptBurnerSecret(row.burner_encrypted_secret, row.burner_address);
      const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
      const expectedUnits = BigInt(Math.round(Number(row.amount_requested_usdc) * 1_000_000));
      let balance = BigInt(0);
      try { balance = (await getAccount(conn, burnerAta)).amount; } catch { /* ATA not indexed yet */ }
      if (balance < expectedUnits) return;

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
      await this.startOutboundBridge(row, mint, conn, burnerKeypair, feePayerKp, balance);
      return;
    }

    // Direct Solana destination: MagicBlock delivers straight to it, so there is no sweep of ours
    // to perform — only confirmation that the queue has released the funds. Delivery is deferred
    // 1-10 min and split across several transfers, so watch the destination's balance climb to
    // the expected amount rather than expecting one arrival.
    await this.confirmDirectPrivateDelivery(row, mint, conn);
  }

  /**
   * Watches the destination's USDC balance until MagicBlock's queue has delivered the full amount.
   * Baseline is captured on the first tick (before anything can have arrived, since the queue's
   * minimum delay comfortably exceeds one cron interval) so a destination that already held USDC
   * isn't mistaken for a completed delivery.
   */
  private async confirmDirectPrivateDelivery(row: PrivateTransfer, mint: PublicKey, conn: Connection) {
    // Transition guard: a row built by the OLD two-leg code sent the user's funds to a burner that
    // this method no longer sweeps. There were no such rows in flight when the one-leg change
    // shipped, but a signature landing in the deploy window could still produce one — and silently
    // "confirming" it would strand real money. Detect the burner holding a balance, leave the row
    // in place, and shout, so it can be swept by hand rather than lost.
    try {
      const legacyBurnerAta = await getAssociatedTokenAddress(mint, new PublicKey(row.burner_address));
      const legacyBalance = (await getAccount(conn, legacyBurnerAta)).amount;
      if (legacyBalance > BigInt(0)) {
        this.logger.error(
          `[PrivateWithdrawal] ${row.id}: NEEDS MANUAL SWEEP — legacy two-leg row, burner ${row.burner_address.slice(0, 8)}… holds ${legacyBalance} base units destined for ${row.destination_address!.slice(0, 8)}…`,
        );
        return;
      }
    } catch { /* no burner ATA — the expected case for a one-leg withdrawal */ }

    const destinationAta = await getAssociatedTokenAddress(mint, new PublicKey(row.destination_address!));
    let current = BigInt(0);
    try { current = (await getAccount(conn, destinationAta)).amount; } catch { /* not created yet */ }

    if (row.delivery_baseline_usdc == null) {
      await this.supabaseService.privateTransfers
        .update({ delivery_baseline_usdc: Number(current) / 1_000_000 })
        .eq('id', row.id);
      this.logger.log(`[PrivateWithdrawal] ${row.id}: awaiting MagicBlock delivery, destination baseline ${current}`);
      return;
    }

    const baseline = BigInt(Math.round(Number(row.delivery_baseline_usdc) * 1_000_000));
    const expected = BigInt(Math.round(Number(row.amount_requested_usdc) * 1_000_000));
    // Tolerate a hair under the requested amount: MagicBlock's splits round per-transfer, so the
    // sum can land a base unit or two short of the exact figure.
    const delivered = current > baseline ? current - baseline : BigInt(0);
    if (delivered + BigInt(10) < expected) return; // still arriving — checked again next tick

    await this.supabaseService.privateTransfers
      .update({ status: 'complete', leg2_tx_signature: row.leg1_tx_signature })
      .eq('id', row.id);
    this.logger.log(`[PrivateWithdrawal] ${row.id}: delivered ${delivered} to ${row.destination_address!.slice(0, 8)}… — complete`);
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
    if (!(await tokenAccountExists(conn, bridgeDestAta))) {
      // Bridge deposit addresses are freshly generated per quote — never repeated — so
      // guardAtaSponsorship's same-wallet check can't catch a user cycling withdrawals to rack up
      // free ATA creations (2026-08-04 fee-payer audit: this path had no cost recovery at all,
      // unlike the deposit delivery path, which closes its burner in the same tx).
      try {
        await assertPerUserAtaCreationCapNotExceeded(this.supabaseService, row.user_id, 1, 'PrivateWithdrawalBridge');
      } catch (e: unknown) {
        await this.supabaseService.privateTransfers.update({
          status: 'failed',
          error_message: e instanceof Error ? e.message : String(e),
        }).eq('id', row.id);
        this.logger.warn(`[PrivateWithdrawal] ${row.id}: blocked by per-user ATA cap`);
        return;
      }
      const allowed = await guardAtaSponsorship(this.supabaseService, bridgeDestPubkey.toBase58(), mint.toBase58(), `private-withdrawal-bridge:${row.id}`, this.emailService, row.user_id);
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

    // Bridge delivered — the burner is finished for good. Reclaim its ATA rent now; deliberately
    // NOT done when the bridge fails (isFailed above), because a failed bridge may refund USDC
    // back to the burner and closing its ATA first would complicate that recovery.
    try {
      const burnerKeypair = this.privateBalanceService.decryptBurnerSecret(row.burner_encrypted_secret, row.burner_address);
      const conn = this.solanaSponsor.getConnectionForCluster(row.cluster);
      this.reclaimBurnerLater(row.id, burnerKeypair, conn);
    } catch (e) {
      this.logger.warn(`[PrivateWithdrawal] ${row.id}: could not schedule burner reclaim (non-fatal): ${String(e)}`);
    }
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
