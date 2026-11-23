import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { isCronEnabled } from '@/common/cron-gate';
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
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import { UsersService } from '@/modules/users/users.service';
import { ClaimsService } from '@/modules/claims/claims.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { ATA_RENT_LAMPORTS } from '@/common/ata-rent-recovery';
import { COMPRESS_PER_TX, compressedPayoutsEnabledFor } from '@/common/light-compression.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { PartnersService, Partner } from './partners.service';
import { PartnerRole, can } from './partner-roles';
import { ProposeTreasuryConfigDto } from './dto/partner-treasury.dto';

const { Permission, Permissions } = multisig.types;
const MAX_TX_BYTES = 1232;
const DRAFT_TTL_MS = 10 * 60 * 1000;
const MAX_OPEN_PROPOSALS = 20;
/** The inner message of a vault transaction ignores its blockhash, so any valid key will do. */
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();

type MemberRow = { id: string; user_id: string | null; email: string | null; role: PartnerRole; wallet_address: string | null; status: string };
type ProposalRow = {
  id: string;
  partner_id: string;
  kind: 'payout' | 'config';
  batch_id: string | null;
  chunk_index: number | null;
  transaction_index: number | string;
  payment_ids: string[];
  summary: Record<string, unknown>;
  created_by_user_id: string;
  status: 'draft' | 'active' | 'approved' | 'executed' | 'rejected' | 'cancelled' | 'stale';
  create_signature: string | null;
  execute_signature: string | null;
  created_at: string;
  staged_usdc?: number | null;
  compress_status?: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | null;
};
type UnsignedTx = { proposal_id: string; unsigned_transaction: string; transaction_version: 'v0' };

const has = (mask: number, p: number) => (mask & p) === p;
const big = (v: { toString(): string } | number | bigint) => BigInt(v.toString());

/**
 * Each partner org owns a Squads multisig. Its vault is the org's funding wallet, its members are the
 * team's own Loofta wallets, and the partner decides how many must approve. Loofta is never a
 * member and never the config authority: it only pays network fees and account rent, so it cannot
 * move or freeze the partner's money.
 *
 * The chain is the source of truth. This service builds transactions for a member to sign with their
 * own wallet, and mirrors proposal status into a table so the portal can list what needs approval.
 */
@Injectable()
export class PartnerTreasuryService {
  private readonly logger = new Logger(PartnerTreasuryService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
    private readonly users: UsersService,
    private readonly claims: ClaimsService,
    private readonly sponsor: SolanaSponsorService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------- rent recovery

  private closingRent = false;

  /**
   * Every 10 minutes: close the on-chain accounts of finished proposals (executed, rejected,
   * cancelled or out of date). Their rent goes back to our fee payer, which paid it, because the
   * multisig names it as rent collector. Anyone may close them, so nothing here needs a member.
   * A proposal that cannot be closed is retried a few times, then left alone.
   */
  @Cron('0 */10 * * * *')
  async cronCloseFinishedProposals(): Promise<void> {
    if (!isCronEnabled(this.config) || this.closingRent) return;
    this.closingRent = true;
    try {
      const sponsorKp = this.sponsor.getFeePayerKeypair();
      if (!sponsorKp) return;
      const { data: rows, error } = await this.supabase.partnerTreasuryProposals
        .select('id, partner_id, kind, transaction_index')
        .in('status', ['executed', 'rejected', 'cancelled', 'stale'])
        .is('rent_closed_at', null)
        .lt('rent_close_attempts', 5)
        .order('created_at', { ascending: true })
        .limit(20);
      if (error) {
        this.logger.warn(`Rent recovery skipped: ${error.message}`);
        return;
      }
      if (!rows?.length) return;
      const conn = this.conn();
      const partnerIds = [...new Set(rows.map((r) => r.partner_id as string))];
      const { data: partners } = await this.supabase.partners.select('id, treasury_multisig').in('id', partnerIds);
      const multisigOf = new Map((partners ?? []).map((p) => [p.id as string, p.treasury_multisig as string | null]));

      for (const r of rows) {
        const msKey = multisigOf.get(r.partner_id as string);
        if (!msKey) continue;
        try {
          const msPda = new PublicKey(msKey);
          const index = big(r.transaction_index as string | number);
          const args = { multisigPda: msPda, rentCollector: sponsorKp.publicKey, transactionIndex: index };
          const ix = r.kind === 'config' ? multisig.instructions.configTransactionAccountsClose(args) : multisig.instructions.vaultTransactionAccountsClose(args);
          const { blockhash } = await conn.getLatestBlockhash('confirmed');
          const tx = new VersionedTransaction(new TransactionMessage({ payerKey: sponsorKp.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message());
          tx.sign([sponsorKp]);
          const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
          await this.confirmSignature(conn, sig);
          await this.supabase.partnerTreasuryProposals.update({ rent_closed_at: new Date().toISOString() }).eq('id', r.id);
        } catch (e) {
          this.logger.warn(`Could not close proposal ${r.id} accounts: ${(e as Error).message}`);
          const { data: cur } = await this.supabase.partnerTreasuryProposals.select('rent_close_attempts').eq('id', r.id).maybeSingle();
          await this.supabase.partnerTreasuryProposals.update({ rent_close_attempts: ((cur?.rent_close_attempts as number | undefined) ?? 0) + 1 }).eq('id', r.id);
        }
      }
    } finally {
      this.closingRent = false;
    }
  }

  // ------------------------------------------------------------------ helpers

  private conn(): Connection {
    return this.sponsor.getConnectionForCluster(isSolanaDevnetFromConfig(this.config) ? 'devnet' : 'mainnet');
  }

  private usdcMint(): PublicKey {
    return new PublicKey(
      isSolanaDevnetFromConfig(this.config)
        ? this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
        : this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
  }

  private sponsorKeypair(): Keypair {
    const kp = this.sponsor.getFeePayerKeypair();
    if (!kp) throw new ServiceUnavailableException('Company wallets are not available right now.');
    return kp;
  }

  /** The caller's own Loofta wallet, read from Privy on the server. Never taken from a request. */
  private myWallet(userId: string): Promise<string> {
    return this.users.getSolanaWalletAddress(userId, { skipCache: true });
  }

  private chainOf(partner: Partner): { msPda: PublicKey; vault: PublicKey } {
    if (!partner.treasury_multisig || !partner.treasury_vault) throw new BadRequestException('Create your company wallet first.');
    return { msPda: new PublicKey(partner.treasury_multisig), vault: new PublicKey(partner.treasury_vault) };
  }

  private fetchMultisig(conn: Connection, msPda: PublicKey) {
    return multisig.accounts.Multisig.fromAccountAddress(conn, msPda, 'confirmed');
  }

  private async confirmSignature(conn: Connection, signature: string): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const s = value[0];
      if (s?.err) throw new BadRequestException('That transaction failed on-chain.');
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new BadRequestException('The transaction has not confirmed yet. Try again in a moment.');
  }

  /** Server-built transaction: our fee payer signs, the member adds their own signature. */
  private async buildTx(instructions: TransactionInstruction[], lookupTables: AddressLookupTableAccount[] = []): Promise<string> {
    const sponsorKp = this.sponsorKeypair();
    const { blockhash } = await this.conn().getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: sponsorKp.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
    const tx = new VersionedTransaction(message);
    tx.sign([sponsorKp]);
    return Buffer.from(tx.serialize()).toString('base64');
  }

  private async members(partnerId: string): Promise<MemberRow[]> {
    const { data } = await this.supabase.partnerMembers.select('id, user_id, email, role, wallet_address, status').eq('partner_id', partnerId);
    return (data ?? []) as MemberRow[];
  }

  private async openProposalCount(partnerId: string): Promise<number> {
    const { count } = await this.supabase.partnerTreasuryProposals
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId)
      .in('status', ['draft', 'active', 'approved']);
    return count ?? 0;
  }

  /** Next index to use, after clearing drafts that were never signed. Conflicts if someone else holds it. */
  private async claimIndex(partnerId: string, conn: Connection, msPda: PublicKey): Promise<bigint> {
    await this.supabase.partnerTreasuryProposals
      .delete()
      .eq('partner_id', partnerId)
      .eq('status', 'draft')
      .lt('created_at', new Date(Date.now() - DRAFT_TTL_MS).toISOString());
    const ms = await this.fetchMultisig(conn, msPda);
    return big(ms.transactionIndex) + 1n;
  }

  private async insertProposal(row: Omit<ProposalRow, 'id' | 'created_at' | 'status' | 'create_signature' | 'execute_signature'>): Promise<string> {
    const { data, error } = await this.supabase.partnerTreasuryProposals.insert(row).select('id').single();
    if (error || !data) {
      if (error?.code === '23505') throw new ConflictException('Someone on your team is already creating a proposal. Try again in a minute.');
      throw new BadRequestException('Could not create the proposal.');
    }
    return data.id as string;
  }

  // ------------------------------------------------------------------- create

  private async creationFee(conn: Connection): Promise<{ lamports: bigint; treasury: PublicKey }> {
    const cfg = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, multisig.getProgramConfigPda({})[0]);
    return { lamports: big(cfg.multisigCreationFee), treasury: cfg.treasury };
  }

  /**
   * Creates the org's company wallet. The caller's own wallet is the first and only member with a
   * threshold of 1; the partner raises it later. Our fee payer pays the one-off creation fee and
   * is neither a member nor the config authority, so only the partner's members can ever change it.
   */
  async create(orgId: string, userId: string) {
    const { partner, member } = await this.partners.requireMembership(orgId, userId, 'treasury.manage');
    if (partner.treasury_multisig) throw new ConflictException('Your company wallet already exists.');
    const sponsorKp = this.sponsorKeypair();
    const wallet = await this.myWallet(userId);
    const conn = this.conn();

    const fee = await this.creationFee(conn);
    const cap = BigInt(this.config.get<string>('PARTNER_TREASURY_MAX_CREATION_FEE_LAMPORTS') || '200000000');
    if (fee.lamports > cap) {
      this.logger.error(`Squads creation fee ${fee.lamports} lamports is above the cap ${cap}; refusing to create a company wallet.`);
      throw new ServiceUnavailableException('Company wallets are temporarily unavailable. Please try again later.');
    }

    const done = await this.redis.withLock(`partner-treasury-create:${partner.id}`, async () => {
      const { data: fresh } = await this.supabase.partners.select('treasury_multisig').eq('id', partner.id).maybeSingle();
      if (fresh?.treasury_multisig) throw new ConflictException('Your company wallet already exists.');

      const createKey = Keypair.generate();
      const [msPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
      const [vault] = multisig.getVaultPda({ multisigPda: msPda, index: 0 });
      const ix = multisig.instructions.multisigCreateV2({
        treasury: fee.treasury,
        creator: sponsorKp.publicKey,
        multisigPda: msPda,
        configAuthority: null, // autonomous: every change needs the members' approval
        threshold: 1,
        members: [{ key: new PublicKey(wallet), permissions: Permissions.all() }],
        timeLock: 0,
        createKey: createKey.publicKey,
        rentCollector: sponsorKp.publicKey, // closing finished proposals returns their rent to the fee payer
      });
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: sponsorKp.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message());
      tx.sign([sponsorKp, createKey]);
      const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      await this.confirmSignature(conn, signature);

      const { data: won } = await this.supabase.partners
        .update({
          treasury_multisig: msPda.toBase58(),
          treasury_vault: vault.toBase58(),
          treasury_threshold: 1,
          treasury_created_at: new Date().toISOString(),
          treasury_creation_tx: signature,
        })
        .eq('id', partner.id)
        .is('treasury_multisig', null)
        .select('id');
      if (!won?.length) {
        this.logger.error(`CRITICAL company wallet created on-chain but not recorded partner=${partner.id} multisig=${msPda.toBase58()} tx=${signature}`);
        throw new ConflictException('Your company wallet was created but could not be saved. Contact support with this time.');
      }
      await this.supabase.partnerMembers.update({ wallet_address: wallet }).eq('id', member.id);
      await this.partners.audit(partner.id, userId, 'treasury.created', { type: 'partner', id: partner.id }, { multisig: msPda.toBase58(), vault: vault.toBase58(), signature });
      return { multisig: msPda.toBase58(), vault: vault.toBase58() };
    }, 90_000);

    if (!done) throw new ConflictException('Your company wallet is being created. Try again in a moment.');
    return this.state(orgId, userId);
  }

  // -------------------------------------------------------------------- state

  async state(orgId: string, userId: string) {
    const { partner, member } = await this.partners.requireMembership(orgId, userId, 'view');
    const wallet = await this.myWallet(userId).catch(() => null);
    if (!partner.treasury_multisig || !partner.treasury_vault) {
      const fee = await this.creationFee(this.conn()).catch(() => null);
      return {
        created: false as const,
        my_wallet: wallet,
        can_create: can(member.role, 'treasury.manage'),
        creation_fee_sol: fee ? Number(fee.lamports) / 1e9 : null,
      };
    }
    const conn = this.conn();
    const { msPda, vault } = this.chainOf(partner);
    const ms = await this.fetchMultisig(conn, msPda);
    const mint = this.usdcMint();
    const vaultAta = await getAssociatedTokenAddress(mint, vault, true);
    const usdc = await conn
      .getTokenAccountBalance(vaultAta, 'confirmed')
      .then((r) => Number(r.value.uiAmount ?? 0))
      .catch(() => 0);

    if (partner.treasury_threshold !== ms.threshold) {
      await this.supabase.partners.update({ treasury_threshold: ms.threshold }).eq('id', partner.id);
    }

    const rows = await this.members(partner.id);
    const byWallet = new Map(rows.filter((r) => r.wallet_address).map((r) => [r.wallet_address as string, r]));
    const onchain = ms.members.map((m) => {
      const key = m.key.toBase58();
      const r = byWallet.get(key);
      return {
        wallet: key,
        member_id: r?.id ?? null,
        name: r?.email ?? null,
        role: r?.role ?? null,
        is_me: key === wallet,
        can_initiate: has(m.permissions.mask, Permission.Initiate),
        can_vote: has(m.permissions.mask, Permission.Vote),
        can_execute: has(m.permissions.mask, Permission.Execute),
      };
    });
    const proposals = await this.syncAndList(partner, ms, conn, wallet, rows);
    return {
      created: true as const,
      multisig: partner.treasury_multisig,
      vault: partner.treasury_vault,
      threshold: ms.threshold,
      usdc,
      my_wallet: wallet,
      am_member: onchain.some((m) => m.is_me),
      members: onchain,
      proposals,
      // App members who are not yet signers of the company wallet, so the portal can offer to add them.
      addable: rows
        .filter((r) => r.status === 'active' && r.user_id && r.role !== 'viewer' && !r.wallet_address)
        .map((r) => ({ member_id: r.id, name: r.email, role: r.role })),
    };
  }

  // ---------------------------------------------------------------- proposals

  private statusFromChain(kind: string, stale: boolean): ProposalRow['status'] {
    if (kind === 'Executed') return 'executed';
    if (kind === 'Cancelled') return 'cancelled';
    if (kind === 'Rejected') return 'rejected';
    if (stale) return 'stale';
    if (kind === 'Approved' || kind === 'Executing') return 'approved';
    return 'active'; // Active, or a Draft that was not activated
  }

  /** Reads a proposal's account and mirrors it into the table. Returns the chain view too. */
  private async syncOne(partner: Partner, ms: Awaited<ReturnType<PartnerTreasuryService['fetchMultisig']>>, conn: Connection, row: ProposalRow) {
    const { msPda } = this.chainOf(partner);
    const index = big(row.transaction_index);
    const [proposalPda] = multisig.getProposalPda({ multisigPda: msPda, transactionIndex: index });
    let chain: Awaited<ReturnType<typeof multisig.accounts.Proposal.fromAccountAddress>> | null = null;
    try {
      chain = await multisig.accounts.Proposal.fromAccountAddress(conn, proposalPda, 'confirmed');
    } catch {
      chain = null;
    }
    if (!chain) {
      // A draft that never landed expires; one that did land but vanished is left as it was.
      if (row.status === 'draft' && Date.now() - new Date(row.created_at).getTime() > DRAFT_TTL_MS) {
        await this.supabase.partnerTreasuryProposals.delete().eq('id', row.id).eq('status', 'draft');
        return null;
      }
      return { row, approved: [] as string[], rejected: [] as string[] };
    }
    const stale = index <= big(ms.staleTransactionIndex);
    const next = this.statusFromChain(chain.status.__kind, stale);
    if (next !== row.status) {
      const { data: won } = await this.supabase.partnerTreasuryProposals.update({ status: next }).eq('id', row.id).eq('status', row.status).select('id');
      row = { ...row, status: next };
      if (won?.length && next === 'executed' && row.kind === 'config') await this.applyConfigResult(partner, ms, row);
    }
    return { row, approved: chain.approved.map((k) => k.toBase58()), rejected: chain.rejected.map((k) => k.toBase58()) };
  }

  /**
   * For the compressed funding job: reads one proposal's state from the chain and mirrors it into the table, the same
   * thing the portal does when someone looks at the wallet tab. Returns the fresh status, or null if it is gone.
   */
  async refreshProposalStatus(proposalId: string): Promise<ProposalRow['status'] | null> {
    const { data: row } = await this.supabase.partnerTreasuryProposals.select('*').eq('id', proposalId).maybeSingle();
    if (!row) return null;
    const proposal = row as ProposalRow;
    if (!['draft', 'active', 'approved'].includes(proposal.status)) return proposal.status;
    const { data: partner } = await this.supabase.partners.select('*').eq('id', proposal.partner_id).maybeSingle();
    if (!partner) return null;
    const conn = this.conn();
    const ms = await this.fetchMultisig(conn, this.chainOf(partner as Partner).msPda);
    const synced = await this.syncOne(partner as Partner, ms, conn, proposal);
    return synced ? synced.row.status : null;
  }

  /** After a member change is executed, record who is now a signer and the new threshold. */
  private async applyConfigResult(partner: Partner, ms: Awaited<ReturnType<PartnerTreasuryService['fetchMultisig']>>, row: ProposalRow) {
    const onchain = new Set(ms.members.map((m) => m.key.toBase58()));
    const actions = ((row.summary?.actions as Array<{ type: string; member_id: string; wallet: string }> | undefined) ?? []);
    for (const a of actions) {
      if (a.type === 'add_member' && onchain.has(a.wallet)) {
        await this.supabase.partnerMembers.update({ wallet_address: a.wallet }).eq('id', a.member_id).eq('partner_id', partner.id);
      }
      if (a.type === 'remove_member' && !onchain.has(a.wallet)) {
        await this.supabase.partnerMembers.update({ wallet_address: null }).eq('id', a.member_id).eq('partner_id', partner.id);
      }
    }
    await this.supabase.partners.update({ treasury_threshold: ms.threshold }).eq('id', partner.id);
  }

  private async syncAndList(partner: Partner, ms: Awaited<ReturnType<PartnerTreasuryService['fetchMultisig']>>, conn: Connection, myWallet: string | null, members: MemberRow[]) {
    const { data } = await this.supabase.partnerTreasuryProposals
      .select('*')
      .eq('partner_id', partner.id)
      .order('transaction_index', { ascending: false })
      .limit(30);
    const label = new Map(members.filter((m) => m.wallet_address).map((m) => [m.wallet_address as string, m.email ?? 'Team member']));
    const me = myWallet ? ms.members.find((m) => m.key.toBase58() === myWallet) : undefined;
    const out: unknown[] = [];
    for (const raw of (data ?? []) as ProposalRow[]) {
      const live = ['draft', 'active', 'approved'].includes(raw.status);
      const synced = live ? await this.syncOne(partner, ms, conn, raw) : { row: raw, approved: [] as string[], rejected: [] as string[] };
      if (!synced) continue;
      const { row, approved, rejected } = synced;
      out.push({
        id: row.id,
        kind: row.kind,
        batch_id: row.batch_id,
        chunk_index: row.chunk_index,
        transaction_index: Number(row.transaction_index),
        status: row.status,
        summary: row.summary,
        created_at: row.created_at,
        approvals: approved.map((w) => label.get(w) ?? `${w.slice(0, 4)}…${w.slice(-4)}`),
        approvals_count: approved.length,
        approvals_needed: ms.threshold,
        i_approved: !!myWallet && approved.includes(myWallet),
        can_approve: row.status === 'active' && !!me && has(me.permissions.mask, Permission.Vote) && !approved.includes(myWallet as string) && !rejected.includes(myWallet as string),
        can_execute: row.status === 'approved' && !!me && has(me.permissions.mask, Permission.Execute),
      });
    }
    return out;
  }

  private async getProposal(partnerId: string, proposalId: string): Promise<ProposalRow> {
    const { data } = await this.supabase.partnerTreasuryProposals.select('*').eq('id', proposalId).eq('partner_id', partnerId).maybeSingle();
    if (!data) throw new NotFoundException('Proposal not found.');
    return data as ProposalRow;
  }

  /** The caller must be a signer of this wallet with the given permission. Checked against the chain, by their own server-derived wallet. */
  private async requireSigner(userId: string, ms: Awaited<ReturnType<PartnerTreasuryService['fetchMultisig']>>, permission: number) {
    const wallet = await this.myWallet(userId);
    const m = ms.members.find((x) => x.key.toBase58() === wallet);
    if (!m || !has(m.permissions.mask, permission)) {
      throw new ForbiddenException('Your wallet is not allowed to do this on the company wallet. Ask an owner to add you under Wallet.');
    }
    return new PublicKey(wallet);
  }

  /** A member's signature to approve or reject a proposal. */
  async buildVote(orgId: string, userId: string, proposalId: string, action: 'approve' | 'reject'): Promise<UnsignedTx> {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'payout.approve');
    const conn = this.conn();
    const { msPda } = this.chainOf(partner);
    const ms = await this.fetchMultisig(conn, msPda);
    const member = await this.requireSigner(userId, ms, Permission.Vote);
    const row = await this.getProposal(partner.id, proposalId);
    const synced = await this.syncOne(partner, ms, conn, row);
    if (!synced || synced.row.status !== 'active') throw new ConflictException('This proposal is no longer open for voting.');
    if (synced.approved.includes(member.toBase58()) || synced.rejected.includes(member.toBase58())) throw new ConflictException('You already voted on this.');
    const args = { multisigPda: msPda, transactionIndex: big(row.transaction_index), member };
    const ix = action === 'approve' ? multisig.instructions.proposalApprove(args) : multisig.instructions.proposalReject(args);
    return { proposal_id: row.id, unsigned_transaction: await this.buildTx([ix]), transaction_version: 'v0' };
  }

  /** A member's signature to execute an approved proposal. */
  async buildExecute(orgId: string, userId: string, proposalId: string): Promise<UnsignedTx> {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'payout.approve');
    const conn = this.conn();
    const { msPda } = this.chainOf(partner);
    const ms = await this.fetchMultisig(conn, msPda);
    const member = await this.requireSigner(userId, ms, Permission.Execute);
    const row = await this.getProposal(partner.id, proposalId);
    const synced = await this.syncOne(partner, ms, conn, row);
    if (!synced || synced.row.status !== 'approved') throw new ConflictException('This proposal is not ready to execute.');
    const transactionIndex = big(row.transaction_index);
    const sponsorKp = this.sponsorKeypair();
    if (row.kind === 'config') {
      const ix = multisig.instructions.configTransactionExecute({ multisigPda: msPda, transactionIndex, member, rentPayer: sponsorKp.publicKey });
      return { proposal_id: row.id, unsigned_transaction: await this.buildTx([ix]), transaction_version: 'v0' };
    }
    const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: msPda, transactionIndex, member });
    return {
      proposal_id: row.id,
      unsigned_transaction: await this.buildTx([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), instruction], lookupTableAccounts),
      transaction_version: 'v0',
    };
  }

  /** After the member broadcast a transaction: wait for it, then refresh what we show. */
  async confirm(orgId: string, userId: string, proposalId: string, signature: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const conn = this.conn();
    const row = await this.getProposal(partner.id, proposalId);
    await this.confirmSignature(conn, signature.trim());
    const ms = await this.fetchMultisig(conn, this.chainOf(partner).msPda);
    const synced = await this.syncOne(partner, ms, conn, row);
    const patchCol = row.status === 'draft' ? { create_signature: signature.trim() } : synced?.row.status === 'executed' ? { execute_signature: signature.trim() } : null;
    if (patchCol) await this.supabase.partnerTreasuryProposals.update(patchCol).eq('id', row.id);
    await this.partners.audit(partner.id, userId, 'treasury.tx_confirmed', { type: 'treasury_proposal', id: row.id }, { signature: signature.trim() });
    return this.state(orgId, userId);
  }

  // ------------------------------------------------------------ member changes

  /** Propose adding or removing signers, or changing how many approvals are needed. */
  async proposeConfig(orgId: string, userId: string, dto: ProposeTreasuryConfigDto): Promise<UnsignedTx> {
    const { partner, member } = await this.partners.requireMembership(orgId, userId, 'members.manage');
    if (dto.threshold !== undefined && !can(member.role, 'treasury.manage')) throw new ForbiddenException('Only an owner can change how many approvals are needed.');
    if (!dto.add_member_ids?.length && !dto.remove_member_ids?.length && dto.threshold === undefined) throw new BadRequestException('Nothing to change.');
    const conn = this.conn();
    const { msPda } = this.chainOf(partner);
    const sponsorKp = this.sponsorKeypair();

    const result = await this.redis.withLock(`partner-treasury-index:${partner.id}`, async () => {
      const ms = await this.fetchMultisig(conn, msPda);
      const creator = await this.requireSigner(userId, ms, Permission.Initiate);
      if ((await this.openProposalCount(partner.id)) >= MAX_OPEN_PROPOSALS) throw new ConflictException('Too many open proposals. Approve or let some expire first.');
      const { count: openConfig } = await this.supabase.partnerTreasuryProposals
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', partner.id)
        .eq('kind', 'config')
        .in('status', ['draft', 'active', 'approved']);
      if (openConfig) throw new ConflictException('A change to the company wallet is already waiting for approval.');

      const rows = await this.members(partner.id);
      const onchain = new Set(ms.members.map((m) => m.key.toBase58()));
      const actions: multisig.types.ConfigAction[] = [];
      const summaryActions: Array<{ type: string; member_id: string; wallet: string; name: string | null; role: string }> = [];
      const voters = new Set(ms.members.filter((m) => has(m.permissions.mask, Permission.Vote)).map((m) => m.key.toBase58()));

      for (const id of dto.add_member_ids ?? []) {
        const row = rows.find((r) => r.id === id && r.status === 'active' && r.user_id);
        if (!row) throw new BadRequestException('That team member is not active.');
        if (row.role === 'viewer') throw new BadRequestException('Viewers cannot be signers.');
        const wallet = await this.myWallet(row.user_id as string);
        if (onchain.has(wallet)) throw new BadRequestException('That wallet is already a signer.');
        const permissions = row.role === 'payer' ? Permissions.fromPermissions([Permission.Initiate]) : Permissions.all();
        actions.push({ __kind: 'AddMember', newMember: { key: new PublicKey(wallet), permissions } });
        summaryActions.push({ type: 'add_member', member_id: row.id, wallet, name: row.email, role: row.role });
        if (row.role !== 'payer') voters.add(wallet);
      }
      for (const id of dto.remove_member_ids ?? []) {
        const row = rows.find((r) => r.id === id && r.wallet_address);
        if (!row || !onchain.has(row.wallet_address as string)) throw new BadRequestException('That member is not a signer.');
        actions.push({ __kind: 'RemoveMember', oldMember: new PublicKey(row.wallet_address as string) });
        summaryActions.push({ type: 'remove_member', member_id: row.id, wallet: row.wallet_address as string, name: row.email, role: row.role });
        voters.delete(row.wallet_address as string);
      }
      const nextThreshold = dto.threshold ?? ms.threshold;
      if (nextThreshold > voters.size) throw new BadRequestException(`${nextThreshold} approvals needed but only ${voters.size} signer${voters.size === 1 ? '' : 's'} can approve.`);
      if (dto.threshold !== undefined && dto.threshold !== ms.threshold) {
        actions.push({ __kind: 'ChangeThreshold', newThreshold: dto.threshold });
        summaryActions.push({ type: 'threshold', member_id: '', wallet: '', name: null, role: String(dto.threshold) });
      }
      if (!actions.length) throw new BadRequestException('Nothing to change.');

      const transactionIndex = await this.claimIndex(partner.id, conn, msPda);
      const proposalId = await this.insertProposal({
        partner_id: partner.id,
        kind: 'config',
        batch_id: null,
        chunk_index: null,
        transaction_index: transactionIndex.toString(),
        payment_ids: [],
        summary: { actions: summaryActions, threshold_after: nextThreshold },
        created_by_user_id: userId,
      });
      const ixs = [
        multisig.instructions.configTransactionCreate({ multisigPda: msPda, transactionIndex, creator, rentPayer: sponsorKp.publicKey, actions }),
        multisig.instructions.proposalCreate({ multisigPda: msPda, transactionIndex, creator, rentPayer: sponsorKp.publicKey }),
        multisig.instructions.proposalApprove({ multisigPda: msPda, transactionIndex, member: creator }),
      ];
      return { proposal_id: proposalId, unsigned_transaction: await this.buildTx(ixs), transaction_version: 'v0' as const };
    }, 30_000);

    if (!result) throw new ConflictException('Another proposal is being created. Try again in a moment.');
    await this.partners.audit(partner.id, userId, 'treasury.config_proposed', { type: 'treasury_proposal', id: result.proposal_id });
    return result;
  }

  // ----------------------------------------------------------- payout funding

  private async ensureTokenAccounts(conn: Connection, mint: PublicKey, owners: PublicKey[]): Promise<void> {
    const sponsorKp = this.sponsorKeypair();
    const ixs: TransactionInstruction[] = [];
    for (const owner of owners) {
      const ata = await getAssociatedTokenAddress(mint, owner, true);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(sponsorKp.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    for (let i = 0; i < ixs.length; i += 8) {
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: sponsorKp.publicKey, recentBlockhash: blockhash, instructions: ixs.slice(i, i + 8) }).compileToV0Message());
      tx.sign([sponsorKp]);
      const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      await this.confirmSignature(conn, sig);
    }
  }

  /**
   * Builds the next proposal for a batch: as many payouts as fit one transaction, paid from the
   * company wallet, plus the network fee in USDC. The member who proposes signs it with their own
   * wallet and it counts as their approval. Call again for the next chunk until nothing is left.
   *
   * Safe because the instructions are fixed here from our own records: the transfers go only to
   * burners we generated for this partner's payouts, and the only extra transfer is the network fee
   * to our fee payer. A member cannot change them, and our fee payer signs only this exact message.
   */
  async buildPayoutProposal(orgId: string, userId: string, batchId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'payout.create');
    const conn = this.conn();
    const { msPda, vault } = this.chainOf(partner);
    const sponsorKp = this.sponsorKeypair();
    const mint = this.usdcMint();

    const result = await this.redis.withLock(`partner-treasury-index:${partner.id}`, async () => {
      const ms = await this.fetchMultisig(conn, msPda);
      const creator = await this.requireSigner(userId, ms, Permission.Initiate);
      const creatorCanVote = has(ms.members.find((m) => m.key.equals(creator))!.permissions.mask, Permission.Vote);
      if ((await this.openProposalCount(partner.id)) >= MAX_OPEN_PROPOSALS) throw new ConflictException('Too many open proposals. Approve or let some expire first.');

      const { data: batch } = await this.supabase.payoutBatches.select('id, status, sender_wallet, label').eq('id', batchId).eq('partner_id', partner.id).maybeSingle();
      if (!batch) throw new NotFoundException('Batch not found.');
      // Everything already paid: nothing left to propose. Not an error, so a caller looping over chunks just stops.
      if (batch.status === 'executed') return { done: true as const };
      if (batch.status !== 'awaiting_funding' || batch.sender_wallet !== vault.toBase58()) throw new ConflictException('This batch is not ready to be funded from the company wallet.');

      const { data: items } = await this.supabase.payoutBatchItems.select('payment_id').eq('batch_id', batchId).eq('status', 'created').not('payment_id', 'is', null);
      const { data: live } = await this.supabase.partnerTreasuryProposals
        .select('payment_ids, status, created_at')
        .eq('partner_id', partner.id)
        .eq('batch_id', batchId)
        .in('status', ['draft', 'active', 'approved', 'executed']);
      const taken = new Set(
        (live ?? [])
          .filter((p) => p.status !== 'draft' || Date.now() - new Date(p.created_at as string).getTime() < DRAFT_TTL_MS)
          .flatMap((p) => p.payment_ids as string[]),
      );
      const remaining = (items ?? []).map((i) => i.payment_id as string).filter((id) => !taken.has(id));
      if (!remaining.length) return { done: true as const };

      const targets = await this.claims.getPartnerPayoutTargets(remaining, partner.id);
      const vaultAta = await getAssociatedTokenAddress(mint, vault, true);
      const sponsorAta = await getAssociatedTokenAddress(mint, sponsorKp.publicKey);
      // Compressed mode (flag): ONE transfer to our staging account for the whole batch; the money is then
      // compressed into the burners by our own job, so there are no token accounts and no size limit per proposal.
      // Old mode: a transfer to every burner's token account, as many per proposal as fit one transaction.
      const compressed = compressedPayoutsEnabledFor(this.config, partner.id);
      const burnerAtas = compressed ? [] : await Promise.all(targets.map((t) => getAssociatedTokenAddress(mint, new PublicKey(t.burner))));

      // Fees for this proposal's transactions: create, the other approvals, execute. Two signatures
      // each at 5,000 lamports, doubled for headroom. Never free, even when the price feed is down.
      const txCount = ms.threshold + 1;
      const solPrice = await fetchSolPriceUsd().catch(() => null);
      const gasUnits = Math.max(1, Math.ceil(solPrice && solPrice > 0 ? ((txCount * 20_000) / 1e9) * solPrice * 1_000_000 : txCount * 20_000));

      const transactionIndex = await this.claimIndex(partner.id, conn, msPda);
      const build = (count: number) => {
        const ixs = compressed
          ? [createTransferInstruction(vaultAta, sponsorAta, vault, targets.reduce((a, t) => a + t.baseUnits, 0) + gasUnits, [], TOKEN_PROGRAM_ID)]
          : [
              ...targets.slice(0, count).map((t, i) => createTransferInstruction(vaultAta, burnerAtas[i], vault, t.baseUnits, [], TOKEN_PROGRAM_ID)),
              createTransferInstruction(vaultAta, sponsorAta, vault, gasUnits, [], TOKEN_PROGRAM_ID),
            ];
        const transactionMessage = new TransactionMessage({ payerKey: vault, recentBlockhash: PLACEHOLDER_BLOCKHASH, instructions: ixs });
        return [
          multisig.instructions.vaultTransactionCreate({
            multisigPda: msPda, transactionIndex, creator, rentPayer: sponsorKp.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage,
          }),
          multisig.instructions.proposalCreate({ multisigPda: msPda, transactionIndex, creator, rentPayer: sponsorKp.publicKey }),
          ...(creatorCanVote ? [multisig.instructions.proposalApprove({ multisigPda: msPda, transactionIndex, member: creator })] : []),
        ];
      };
      // web3.js throws when a message does not fit, which here just means "too big".
      const sizeOf = (count: number) => {
        try {
          return new VersionedTransaction(new TransactionMessage({ payerKey: sponsorKp.publicKey, recentBlockhash: PLACEHOLDER_BLOCKHASH, instructions: build(count) }).compileToV0Message()).serialize().length;
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      };
      let count = 1;
      if (compressed) count = targets.length;
      else while (count < targets.length && sizeOf(count + 1) <= MAX_TX_BYTES) count++;
      if (sizeOf(count) > MAX_TX_BYTES) throw new BadRequestException(compressed ? 'This batch is too large for one proposal.' : 'A single payout does not fit in a transaction.');

      const chunk = targets.slice(0, count);
      const payoutBase = chunk.reduce((a, t) => a + t.baseUnits, 0);
      const totalBase = payoutBase + gasUnits;
      const balance = await conn.getTokenAccountBalance(vaultAta, 'confirmed').then((r) => Number(r.value.amount)).catch(() => 0);
      if (balance < totalBase) {
        const usdc = (n: number) => (n / 1e6).toFixed(n % 10_000 === 0 ? 2 : 4);
        throw new BadRequestException(
          `The company wallet has ${usdc(balance)} USDC. This step needs ${usdc(payoutBase)} for the payouts plus ${usdc(gasUnits)} for network fees, ${usdc(totalBase)} in total. Add at least ${usdc(totalBase - balance + 10_000)} USDC to the company wallet first.`,
        );
      }

      // Our fee payer advances SOL for the proposal's accounts (and, in the old mode, the burners' token accounts).
      // If it is too low, say so plainly instead of failing half way, and shout in the logs so it gets topped up.
      const atasToMake = compressed ? [sponsorAta] : [sponsorAta, ...burnerAtas.slice(0, count)];
      const existing = await conn.getMultipleAccountsInfo(atasToMake, 'confirmed').catch(() => null);
      const missing = existing ? existing.filter((a) => !a).length : atasToMake.length;
      const compressFees = compressed ? Math.ceil(chunk.length / COMPRESS_PER_TX) * 30_000 : 0; // the compress transactions after approval
      const neededLamports = missing * ATA_RENT_LAMPORTS + 6_000_000 + compressFees; // 6,000,000: proposal accounts and fees, with headroom
      const sponsorLamports = await conn.getBalance(sponsorKp.publicKey, 'confirmed');
      if (sponsorLamports < neededLamports) {
        this.logger.error(`Loofta fee payer is low on SOL: ${sponsorLamports / 1e9} SOL, a payout step needs about ${neededLamports / 1e9}. Top it up.`);
        throw new ServiceUnavailableException('Payouts are temporarily unavailable. Please try again in a little while.');
      }

      // Token accounts are created by our fee payer, outside the vault transaction (the vault holds no SOL).
      // Old mode: one per burner, rent recovered when the payout is swept. Compressed mode: only our staging account.
      await this.ensureTokenAccounts(conn, mint, compressed ? [sponsorKp.publicKey] : [sponsorKp.publicKey, ...chunk.map((t) => new PublicKey(t.burner))]);

      const { count: previous } = await this.supabase.partnerTreasuryProposals.select('id', { count: 'exact', head: true }).eq('partner_id', partner.id).eq('batch_id', batchId);
      const paymentIds = chunk.map((t) => t.claimId);
      await this.supabase.payments.update({ sender_user_id: userId }).in('id', paymentIds);
      // Which kind of burner holds each payout. Separate from the update above so an old database without the column
      // (migration not run yet) never blocks the old mode; an error here is ignored on purpose when the flag is off.
      const flagged = await this.supabase.payments.update({ burner_compressed: compressed }).in('id', paymentIds);
      if (compressed && flagged.error) throw new ServiceUnavailableException('Payouts are temporarily unavailable. Please try again in a little while.');
      const proposalId = await this.insertProposal({
        partner_id: partner.id,
        kind: 'payout',
        batch_id: batchId,
        chunk_index: previous ?? 0,
        transaction_index: transactionIndex.toString(),
        payment_ids: paymentIds,
        summary: {
          label: batch.label,
          payouts: chunk.length,
          total_usdc: Math.round(payoutBase) / 1e6,
          gas_usdc: gasUnits / 1e6,
        },
        ...(compressed ? { staged_usdc: payoutBase / 1e6, compress_status: 'pending' } : {}),
        created_by_user_id: userId,
      });
      const unsigned = await this.buildTx(build(count));
      return { done: false as const, proposal_id: proposalId, unsigned_transaction: unsigned, transaction_version: 'v0' as const, remaining_after: targets.length - count };
    }, 120_000);

    if (!result) throw new ConflictException('Another proposal is being created. Try again in a moment.');
    if (!result.done) await this.partners.audit(partner.id, userId, 'treasury.payout_proposed', { type: 'batch', id: batchId }, { proposal_id: result.proposal_id });
    return result;
  }
}
