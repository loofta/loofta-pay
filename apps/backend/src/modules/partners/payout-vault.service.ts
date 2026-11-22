import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import bs58 from 'bs58';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import { UsersService } from '@/modules/users/users.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { isValidSolanaAddress } from '@/common/solana-address';
import { PartnersService, Partner } from './partners.service';
import { computePartnerFeeUsdc } from './partner-fee';
import { allocateLines, buildFeeLines, publicLines, type FeeLine } from './partner-fee-lines';

const { Permissions } = multisig.types;
/** An exit the user does not finish within this time is dropped, and Loofta never co-signs it. */
const EXIT_TTL_MS = 15 * 60 * 1000;
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();
const big = (v: { toString(): string } | number | bigint) => BigInt(v.toString());

type VaultRow = { id: string; user_id: string; multisig_pda: string; vault_address: string; user_wallet: string; cosigner: string; is_devnet: boolean };
type ExitRow = {
  id: string; vault_id: string; user_id: string; partner_id: string; transaction_index: number | string; status: 'proposed' | 'executed' | 'cancelled' | 'failed';
  destination: string; gross_units: number | string; net_units: number | string; fee_lines: Array<{ kind: string; units: string; destination: string | null }>;
  message_hash: string; created_at: string;
};

/**
 * A per-user payout vault: a Squads multisig of the user's own Loofta wallet and a Loofta co-signer key, threshold 2,
 * no config authority. Neither side can move the money alone. Loofta co-signs an exit only after it checked that the
 * exit pays the partner fee and Loofta fee in the same transaction, so a fee is taken exactly when money leaves, and
 * never if the user walks away. The vault address is a separate account, so the balance never shows in the user's
 * Loofta wallet.
 *
 * Nothing here sponsors an account for a destination the user chose: an exit only pays accounts that already exist.
 * The feature is off unless PAYOUT_VAULT_ENABLED=true and a co-signer key is configured.
 */
@Injectable()
export class PayoutVaultService {
  private readonly logger = new Logger(PayoutVaultService.name);
  private cosignerKp: Keypair | null | undefined;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
    private readonly users: UsersService,
    private readonly sponsor: SolanaSponsorService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------ setup

  private enabled(): boolean {
    return this.config.get<string>('PAYOUT_VAULT_ENABLED') === 'true';
  }

  /** The Loofta co-signer. Loaded once from the environment; its secret is never logged or returned. */
  private cosigner(): Keypair {
    if (this.cosignerKp === undefined) {
      const raw = this.config.get<string>('PAYOUT_VAULT_COSIGNER_PRIVATE_KEY');
      try {
        this.cosignerKp = raw ? Keypair.fromSecretKey(new Uint8Array(bs58.decode(raw))) : null;
      } catch {
        this.cosignerKp = null;
      }
    }
    if (!this.enabled() || !this.cosignerKp) throw new ServiceUnavailableException('Payout vaults are not available right now.');
    return this.cosignerKp;
  }

  private sponsorKeypair(): Keypair {
    const kp = this.sponsor.getFeePayerKeypair();
    if (!kp) throw new ServiceUnavailableException('Payout vaults are not available right now.');
    return kp;
  }

  private get devnet() {
    return isSolanaDevnetFromConfig(this.config);
  }

  protected conn(): Connection {
    return this.sponsor.getConnectionForCluster(this.devnet ? 'devnet' : 'mainnet');
  }

  private usdcMint(): PublicKey {
    return new PublicKey(
      this.devnet
        ? this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
        : this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
  }

  /** The caller's own Loofta wallet, read from Privy on the server. Never taken from a request. */
  protected myWallet(userId: string): Promise<string> {
    return this.users.getSolanaWalletAddress(userId, { skipCache: true });
  }

  protected async buildTx(payer: Keypair, instructions: TransactionInstruction[], lookupTables: AddressLookupTableAccount[] = []): Promise<VersionedTransaction> {
    const { blockhash } = await this.conn().getLatestBlockhash('confirmed');
    return new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables));
  }

  protected async sendAndConfirm(tx: VersionedTransaction): Promise<string> {
    const conn = this.conn();
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    for (let i = 0; i < 40; i++) {
      const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
      const s = value[0];
      if (s?.err) throw new BadRequestException('That transaction failed on-chain.');
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return sig;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new BadRequestException('The transaction has not confirmed yet. Try again in a moment.');
  }

  private hashMessage(tx: VersionedTransaction): string {
    return createHash('sha256').update(tx.message.serialize()).digest('hex');
  }

  // ------------------------------------------------------------------ the vault

  private async loadVault(userId: string): Promise<VaultRow | null> {
    const { data } = await this.supabase.payoutVaults.select('*').eq('user_id', userId).eq('is_devnet', this.devnet).maybeSingle();
    return (data as VaultRow | null) ?? null;
  }

  /** The user's vault, created on first use. Loofta's fee payer pays the one-off rent; the user signs nothing to get one. */
  async getOrCreateVault(userId: string): Promise<VaultRow> {
    const cosigner = this.cosigner();
    const existing = await this.loadVault(userId);
    if (existing) return existing;
    const created = await this.redis.withLock(`payout-vault-create:${userId}`, async () => {
      const again = await this.loadVault(userId);
      if (again) return again;
      const userWallet = await this.myWallet(userId);
      const sponsorKp = this.sponsorKeypair();
      const createKey = Keypair.generate();
      const [msPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
      const [vault] = multisig.getVaultPda({ multisigPda: msPda, index: 0 });
      const conn = this.conn();
      const cfg = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, multisig.getProgramConfigPda({})[0]);
      const ix = multisig.instructions.multisigCreateV2({
        treasury: cfg.treasury,
        creator: sponsorKp.publicKey,
        multisigPda: msPda,
        configAuthority: null, // autonomous: no one can change members or the threshold alone
        threshold: 2,
        members: [
          { key: new PublicKey(userWallet), permissions: Permissions.all() },
          { key: cosigner.publicKey, permissions: Permissions.all() },
        ],
        timeLock: 0,
        createKey: createKey.publicKey,
        rentCollector: sponsorKp.publicKey,
      });
      const tx = await this.buildTx(sponsorKp, [ix]);
      tx.sign([sponsorKp, createKey]);
      await this.sendAndConfirm(tx);
      const { data, error } = await this.supabase.payoutVaults
        .insert({ user_id: userId, multisig_pda: msPda.toBase58(), vault_address: vault.toBase58(), user_wallet: userWallet, cosigner: cosigner.publicKey.toBase58(), is_devnet: this.devnet })
        .select('*').single();
      if (error || !data) throw new ServiceUnavailableException('Could not set up your payout vault. Please try again.');
      return data as VaultRow;
    });
    if (!created) throw new ConflictException('Your payout vault is being set up. Try again in a moment.');
    return created;
  }

  /** What the user has in the vault, per partner, and the on-chain balance it must be covered by. */
  async state(userId: string) {
    if (!this.enabled()) throw new ServiceUnavailableException('Payout vaults are not available right now.');
    const vault = await this.loadVault(userId);
    if (!vault) return { vault: null, credits: [] as Array<{ partner_id: string; usdc: number }> };
    const { data } = await this.supabase.payoutVaultCredits.select('partner_id, units').eq('vault_id', vault.id).is('exit_id', null);
    const byPartner = new Map<string, bigint>();
    for (const r of data ?? []) byPartner.set(r.partner_id as string, (byPartner.get(r.partner_id as string) ?? BigInt(0)) + big(r.units as number));
    return {
      vault: { address: vault.vault_address },
      credits: [...byPartner].map(([partner_id, units]) => ({ partner_id, usdc: Number(units) / 1e6 })),
    };
  }

  /**
   * Records that one partner payout reached this user's vault. Called by the claim step after the sweep. Idempotent on
   * the payment, so a retry cannot credit twice.
   */
  async recordCredit(userId: string, partnerId: string, paymentId: string, units: bigint): Promise<void> {
    const vault = await this.loadVault(userId);
    if (!vault) throw new NotFoundException('No payout vault.');
    if (units <= BigInt(0)) throw new BadRequestException('Nothing to credit.');
    const { error } = await this.supabase.payoutVaultCredits.upsert(
      { vault_id: vault.id, partner_id: partnerId, payment_id: paymentId, units: units.toString() },
      { onConflict: 'payment_id', ignoreDuplicates: true },
    );
    if (error) throw new ServiceUnavailableException('Could not record the payout. Please try again.');
  }

  // ------------------------------------------------------------------ exits

  private async loadExit(userId: string, exitId: string): Promise<{ exit: ExitRow; vault: VaultRow }> {
    // Scoped by the caller: someone else's exit id answers "not found", never their data.
    const { data } = await this.supabase.payoutVaultExits.select('*').eq('id', exitId).eq('user_id', userId).maybeSingle();
    if (!data) throw new NotFoundException('Exit not found.');
    const exit = data as ExitRow;
    const { data: v } = await this.supabase.payoutVaults.select('*').eq('id', exit.vault_id).eq('user_id', userId).maybeSingle();
    if (!v) throw new NotFoundException('Exit not found.');
    return { exit, vault: v as VaultRow };
  }

  /**
   * Starts an exit of everything one partner paid this user. Loofta decides the fee lines here from the partner's own
   * settings, builds the transfers (net to the destination, each fee to its owner) and creates the proposal. The user
   * then approves it; Loofta approves and executes only after that, so a walked-away exit never moves a cent.
   */
  async prepareExit(userId: string, orgId: string, destination: string) {
    const cosigner = this.cosigner();
    const dest = (destination ?? '').trim();
    if (!isValidSolanaAddress(dest)) throw new BadRequestException('Invalid destination address.');
    const vault = await this.loadVault(userId);
    if (!vault) throw new NotFoundException('You have nothing in a payout vault yet.');

    const { data: partnerRow } = await this.supabase.partners.select('*').eq('org_id', orgId).maybeSingle();
    if (!partnerRow) throw new NotFoundException('Partner not found.');
    const partner = partnerRow as Partner;
    if (partner.status !== 'active') throw new BadRequestException('Withdrawals from this partner are unavailable right now.');

    const result = await this.redis.withLock(`payout-vault-exit:${vault.id}`, async () => {
      // The user's wallet must still be the vault's signer, read from Privy now.
      const wallet = await this.myWallet(userId);
      if (wallet !== vault.user_wallet) throw new ConflictException('Your wallet changed. Contact support to recover your payout vault.');

      await this.expireStale(vault.id);
      const { data: open } = await this.supabase.payoutVaultExits.select('id').eq('vault_id', vault.id).eq('partner_id', partner.id).eq('status', 'proposed').maybeSingle();
      if (open) throw new ConflictException('You already have a withdrawal in progress for this partner. Finish or cancel it first.');

      const { data: credits } = await this.supabase.payoutVaultCredits.select('id, payment_id, units').eq('vault_id', vault.id).eq('partner_id', partner.id).is('exit_id', null);
      if (!credits?.length) throw new BadRequestException('Nothing to withdraw from this partner.');
      const units = credits.map((c) => big(c.units as number));
      const grossUnits = units.reduce((a, b) => a + b, BigInt(0));

      const partnerFee = computePartnerFeeUsdc(partner, Number(grossUnits) / 1e6);
      const partnerFeeUnits = BigInt(Math.round(partnerFee * 1e6));
      if (partnerFeeUnits > BigInt(0)) {
        if (!partner.fee_wallet) throw new BadRequestException('Withdrawals from this partner are unavailable right now.');
        await this.partners.assertFeeWalletReady(partner.fee_wallet);
      }
      const breakdown = buildFeeLines({ grossUnits, partnerFeeUnits, partnerWallet: partner.fee_wallet, looftaFeeUnits: BigInt(0) });

      const conn = this.conn();
      const mint = this.usdcMint();
      const vaultKey = new PublicKey(vault.vault_address);
      const vaultAta = await getAssociatedTokenAddress(mint, vaultKey, true);
      const held = await getAccount(conn, vaultAta).then((a) => a.amount).catch(() => BigInt(0));
      if (held < grossUnits) throw new ConflictException('Your payout has not fully arrived yet. Try again in a minute.');

      // Only accounts that already exist are paid, so this never makes Loofta's fee payer open an account for anyone.
      const ataOf = async (owner: string) => {
        const ata = await getAssociatedTokenAddress(mint, new PublicKey(owner), true);
        if (!(await getAccount(conn, ata).then(() => true).catch(() => false))) throw new BadRequestException('That wallet has no USDC account yet.');
        return ata;
      };
      const ixs: TransactionInstruction[] = [createTransferInstruction(vaultAta, await ataOf(dest), vaultKey, breakdown.netUnits, [], TOKEN_PROGRAM_ID)];
      for (const line of breakdown.lines) {
        if (!line.destination) throw new BadRequestException('A fee has no wallet to receive it.');
        ixs.push(createTransferInstruction(vaultAta, await ataOf(line.destination), vaultKey, line.units, [], TOKEN_PROGRAM_ID));
      }

      const msPda = new PublicKey(vault.multisig_pda);
      const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, msPda, 'confirmed');
      const transactionIndex = big(ms.transactionIndex) + BigInt(1);
      const sponsorKp = this.sponsorKeypair();
      const inner = new TransactionMessage({ payerKey: vaultKey, recentBlockhash: PLACEHOLDER_BLOCKHASH, instructions: ixs });
      const create = await this.buildTx(sponsorKp, [
        multisig.instructions.vaultTransactionCreate({ multisigPda: msPda, transactionIndex, creator: cosigner.publicKey, rentPayer: sponsorKp.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage: inner }),
        multisig.instructions.proposalCreate({ multisigPda: msPda, transactionIndex, creator: cosigner.publicKey, rentPayer: sponsorKp.publicKey }),
      ]);
      create.sign([sponsorKp, cosigner]);

      // The user's one step: approve the proposal. Built and signed by the fee payer here, the user adds their signature.
      const approve = await this.buildTx(sponsorKp, [multisig.instructions.proposalApprove({ multisigPda: msPda, transactionIndex, member: new PublicKey(vault.user_wallet) })]);
      approve.sign([sponsorKp]);

      const feeJson = breakdown.lines.map((l) => ({ kind: l.kind, units: l.units.toString(), destination: l.destination }));
      const { data: exit, error } = await this.supabase.payoutVaultExits
        .insert({
          vault_id: vault.id, user_id: userId, partner_id: partner.id, transaction_index: transactionIndex.toString(), status: 'proposed', destination: dest,
          gross_units: grossUnits.toString(), net_units: breakdown.netUnits.toString(), fee_lines: feeJson, message_hash: this.hashMessage(approve),
        })
        .select('*').single();
      if (error || !exit) throw new ConflictException('Could not start the withdrawal. Please try again.');
      // The exit owns these credits now; the conditional update makes sure nothing else claimed them first.
      const ids = credits.map((c) => c.id as string);
      const { data: claimed } = await this.supabase.payoutVaultCredits.update({ exit_id: exit.id }).in('id', ids).is('exit_id', null).select('id');
      if ((claimed?.length ?? 0) !== ids.length) {
        await this.release(exit.id as string, 'failed');
        throw new ConflictException('Your balance changed. Please try again.');
      }
      try {
        await this.sendAndConfirm(create);
      } catch (e) {
        await this.release(exit.id as string, 'failed');
        throw e;
      }
      return { exit_id: exit.id as string, unsigned_transaction: Buffer.from(approve.serialize()).toString('base64'), net_units: breakdown.netUnits, lines: breakdown.lines };
    });
    if (!result) throw new ConflictException('Another withdrawal is being prepared. Try again in a moment.');
    return {
      exit_id: result.exit_id,
      unsigned_transaction: result.unsigned_transaction,
      transaction_version: 'v0' as const,
      net_usdc: Number(result.net_units) / 1e6,
      fees: publicLines(result.lines),
      expires_in_seconds: EXIT_TTL_MS / 1000,
    };
  }

  /** Gives an exit's credits back and closes it. Loofta never co-signs a closed exit, so nothing can still move. */
  private async release(exitId: string, status: 'cancelled' | 'failed'): Promise<void> {
    await this.supabase.payoutVaultExits.update({ status }).eq('id', exitId).eq('status', 'proposed');
    await this.supabase.payoutVaultCredits.update({ exit_id: null }).eq('exit_id', exitId);
  }

  private async expireStale(vaultId: string): Promise<void> {
    const cutoff = new Date(Date.now() - EXIT_TTL_MS).toISOString();
    const { data } = await this.supabase.payoutVaultExits.select('id').eq('vault_id', vaultId).eq('status', 'proposed').lt('created_at', cutoff);
    for (const row of data ?? []) await this.release(row.id as string, 'cancelled');
  }

  async cancelExit(userId: string, exitId: string) {
    if (!this.enabled()) throw new ServiceUnavailableException('Payout vaults are not available right now.');
    const { exit } = await this.loadExit(userId, exitId);
    if (exit.status === 'cancelled') return { status: 'cancelled' as const };
    if (exit.status !== 'proposed') throw new ConflictException('This withdrawal can no longer be cancelled.');
    await this.release(exit.id, 'cancelled');
    return { status: 'cancelled' as const };
  }

  /**
   * The user's signed approval arrives. Check it is exactly the transaction Loofta built and still open, broadcast it,
   * confirm the user's approval is on-chain, and only then approve and execute as the co-signer.
   */
  async submitExit(userId: string, exitId: string, signedTransaction: string) {
    const cosigner = this.cosigner();
    const { exit, vault } = await this.loadExit(userId, exitId);
    if (exit.status === 'executed') return { status: 'executed' as const };
    if (exit.status !== 'proposed') throw new ConflictException('This withdrawal is no longer open.');
    if (Date.now() - new Date(exit.created_at).getTime() > EXIT_TTL_MS) {
      await this.release(exit.id, 'cancelled');
      throw new ConflictException('This withdrawal expired. Start it again.');
    }

    return this.redis.withLock(`payout-vault-exit:${vault.id}`, async () => {
      let tx: VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
      } catch {
        throw new BadRequestException('Invalid transaction.');
      }
      if (this.hashMessage(tx) !== exit.message_hash) throw new BadRequestException('That is not the transaction for this withdrawal.');
      const userKey = new PublicKey(vault.user_wallet);
      const idx = tx.message.staticAccountKeys.findIndex((k) => k.equals(userKey));
      if (idx < 0 || idx >= tx.message.header.numRequiredSignatures || !tx.signatures[idx] || tx.signatures[idx].every((b) => b === 0)) {
        throw new BadRequestException('Your signature is missing.');
      }

      const conn = this.conn();
      const msPda = new PublicKey(vault.multisig_pda);
      const transactionIndex = big(exit.transaction_index);
      const proposalPda = multisig.getProposalPda({ multisigPda: msPda, transactionIndex })[0];
      let approveSig: string | null = null;
      const approved = async () => {
        const p = await multisig.accounts.Proposal.fromAccountAddress(conn, proposalPda, 'confirmed').catch(() => null);
        return !!p && p.approved.some((k) => k.equals(userKey));
      };
      if (!(await approved())) approveSig = await this.sendAndConfirm(tx);
      if (!(await approved())) throw new BadRequestException('Your approval did not land. Try again.');

      // The exit is still ours to finish: re-check it was not cancelled while the approval was on its way.
      const { data: fresh } = await this.supabase.payoutVaultExits.select('status').eq('id', exit.id).maybeSingle();
      if (fresh?.status !== 'proposed') throw new ConflictException('This withdrawal was cancelled.');

      const sponsorKp = this.sponsorKeypair();
      const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: msPda, transactionIndex, member: cosigner.publicKey });
      const exec = await this.buildTx(sponsorKp, [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        multisig.instructions.proposalApprove({ multisigPda: msPda, transactionIndex, member: cosigner.publicKey }),
        instruction,
      ], lookupTableAccounts);
      exec.sign([sponsorKp, cosigner]);
      const executeSig = await this.sendAndConfirm(exec);

      await this.supabase.payoutVaultExits
        .update({ status: 'executed', approve_signature: approveSig, execute_signature: executeSig, executed_at: new Date().toISOString() })
        .eq('id', exit.id).eq('status', 'proposed');
      await this.recordLedger(exit);
      this.logger.log(`payout vault exit ${exit.id} executed`);
      return { status: 'executed' as const, signature: executeSig };
    }).then((r) => r ?? Promise.reject(new ConflictException('This withdrawal is being finished. Try again in a moment.')));
  }

  /** Spreads the exit's fee lines over the payments it spent, so earnings and Loofta's fees are recorded per payment. Best effort. */
  private async recordLedger(exit: ExitRow): Promise<void> {
    try {
      const { data: credits } = await this.supabase.payoutVaultCredits.select('payment_id, units').eq('exit_id', exit.id);
      if (!credits?.length) return;
      const lines: FeeLine[] = exit.fee_lines.map((l) => ({ kind: l.kind as FeeLine['kind'], units: BigInt(l.units), destination: l.destination }));
      const per = allocateLines(credits.map((c) => big(c.units as number)), lines);
      const stamped = new Date().toISOString();
      const rows = per.flatMap((ls, i) => ls.map((l) => ({
        payment_id: credits[i].payment_id, partner_id: exit.partner_id, kind: l.kind, units: l.units.toString(), destination: l.destination, status: 'collected', stamped_at: stamped,
      })));
      if (rows.length) await this.supabase.partnerPaymentFeeLines.upsert(rows, { onConflict: 'payment_id,kind', ignoreDuplicates: true });
    } catch (e) {
      this.logger.warn(`vault exit ${exit.id} ledger not recorded: ${(e as Error).message}`);
    }
  }
}
