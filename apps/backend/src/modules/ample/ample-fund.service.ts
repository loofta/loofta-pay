import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { encodeFunctionData, erc20Abi } from 'viem';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { RelayService } from '@/modules/lottery/relay.service';
import { RhinestoneService } from '@/modules/lottery/rhinestone.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { isCronEnabled } from '@/common/cron-gate';
import { AmpleCompanionService } from './ample-companion.service';
import { AmpleEvmService } from './ample-evm.service';

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
/** Loofta's Base wallet, the same one Megapot rescues and fees go to. Flat fees and swept dust land here. */
export const LOOFTA_BASE_WALLET = '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39' as const;
/** Loofta's flat fee for moving money in or out of the Earn pool: $0.10 in USDC. */
export const FUND_FEE_UNITS = 100_000n;
const MIN_OUT_UNITS = 1_000_000n;
const MAX_OUT_UNITS = 1_000_000_000n;
const MAX_ORDERS_PER_DAY = 10;
/** A Solana-side quote older than this is not built or sent any more. */
const QUOTE_TTL_MS = 5 * 60_000;
/** A step that has been quiet this long is picked up again. Longer than the slowest step, so two never overlap. */
const STALE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 6;
/** Under $1 cannot be deposited, so it is dust: swept to Loofta's wallet. Anything larger left behind is the person's and is never swept. */
const DUST_UNITS = 1_000_000n;

interface StoredQuote {
  requestId: string;
  instructions: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }[];
  addressLookupTableAddresses: string[];
  requiredInputUnits: string;
}

type Row = any;

/**
 * Funds the Earn pool from a person's Solana USDC and returns it, with no wallet of the person's on Base involved.
 *
 *   add:      Solana USDC --Relay--> their Earn account on Base --> Ample deposit
 *   withdraw: Ample withdraw --> Earn account --Relay--> their Solana wallet
 *
 * The Solana leg follows the Peer cash-out bridge: the quote is stored first and the sponsored broadcast only sends a
 * transaction that matches it exactly. Every later step runs on the backend and is retried until it lands or is flagged, so
 * money is never left half-way without a record saying where it is.
 */
@Injectable()
export class AmpleFundService {
  private readonly logger = new Logger(AmpleFundService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly relay: RelayService,
    private readonly rhinestone: RhinestoneService,
    private readonly sponsor: SolanaSponsorService,
    private readonly config: ConfigService,
    private readonly companions: AmpleCompanionService,
    private readonly evm: AmpleEvmService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  // ---- add money: quote, build, send (the person signs on Solana) ----

  /**
   * Quotes the bridge. `outputUnits` is what should arrive in the Earn account. When `maxTotalUnits` (the Solana balance) is
   * lower than what that costs, the output shrinks so the total fits, so the bridge cost comes out of the deposit.
   */
  async prepare(userId: string, dto: { solanaAddress: string; outputUnits: string; maxTotalUnits?: string }) {
    if (!(await this.users.isSolanaAddressInLinkedAccounts(userId, dto.solanaAddress))) {
      throw new ForbiddenException('solanaAddress must be one of your own linked wallets');
    }
    await this.assertDailyCap(userId);
    const vault = await this.evm.vault();
    if (!vault) throw new BadRequestException('Earn is not available right now. Try again in a moment.');
    const companion = await this.companions.get(userId);

    let out = BigInt(dto.outputUnits);
    const maxTotal = dto.maxTotalUnits ? BigInt(dto.maxTotalUnits) : null;
    if (out > MAX_OUT_UNITS) throw new BadRequestException('That is more than the limit for one transfer.');

    let quote: Awaited<ReturnType<RelayService['getSolToBaseQuote']>> | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (out < MIN_OUT_UNITS) throw new BadRequestException('That amount is too small once the transfer cost is taken out.');
      try {
        quote = await this.relay.getSolToBaseQuote({ fromAddress: dto.solanaAddress, toAddress: companion.address, outputUnits: out });
      } catch (e: any) {
        this.logger.error(`Relay quote failed: ${e?.message ?? e}`);
        throw new BadRequestException('Could not get a price to move your funds. Try again in a moment.');
      }
      const total = quote.requiredInputUnits + FUND_FEE_UNITS;
      if (!maxTotal || total <= maxTotal) break;
      // Relay charges its fee on top of the output, so shrink the output by the overshoot (plus a hair) and quote again.
      out = out - (total - maxTotal) - 1_000n;
      quote = null;
    }
    if (!quote) throw new BadRequestException('That amount is too small once the transfer cost is taken out.');

    const stored: StoredQuote = {
      requestId: quote.requestId,
      instructions: quote.instructions,
      addressLookupTableAddresses: quote.addressLookupTableAddresses,
      requiredInputUnits: quote.requiredInputUnits.toString(),
    };
    const total = quote.requiredInputUnits + FUND_FEE_UNITS;
    const { data, error } = await this.db.from('ample_fund_orders').insert({
      kind: 'fund',
      user_id: userId,
      solana_address: dto.solanaAddress,
      base_address: companion.address,
      vault_id: vault.id,
      out_units: out.toString(),
      fee_units: FUND_FEE_UNITS.toString(),
      total_units: total.toString(),
      quote: stored,
      request_id: quote.requestId,
    }).select('id').single();
    if (error || !data) {
      this.logger.error(`ample_fund_orders insert failed: ${error?.message}`);
      throw new BadRequestException('Could not start the transfer. Try again.');
    }
    return { id: data.id as string, outUnits: out.toString(), feeUnits: FUND_FEE_UNITS.toString(), totalUnits: total.toString() };
  }

  private async assertDailyCap(userId: string) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await this.db.from('ample_fund_orders').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
    if ((count ?? 0) >= MAX_ORDERS_PER_DAY) throw new BadRequestException('Too many transfers today. Try again tomorrow.');
  }

  private async load(id: string, userId: string): Promise<Row> {
    const { data } = await this.db.from('ample_fund_orders').select('*').eq('id', id).maybeSingle();
    if (!data || data.user_id !== userId) throw new NotFoundException('Transfer not found');
    return data;
  }

  private feeTransfer(solanaAddress: string) {
    const feePayer = this.sponsor.getFeePayerAddress();
    if (!feePayer) throw new BadRequestException('Fee payer not configured');
    const mint = new PublicKey(this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || SOLANA_USDC_MINT);
    const owner = new PublicKey(solanaAddress);
    return {
      mint,
      owner,
      sourceAta: getAssociatedTokenAddressSync(mint, owner),
      destAta: getAssociatedTokenAddressSync(mint, new PublicKey(feePayer)),
      amountUnits: FUND_FEE_UNITS,
    };
  }

  private assertFresh(row: Row) {
    if (row.kind !== 'fund' || row.status !== 'PENDING') throw new BadRequestException('This transfer was already sent.');
    if (Date.now() - new Date(row.created_at).getTime() > QUOTE_TTL_MS) throw new BadRequestException('That price expired. Try again.');
  }

  /** Unsigned Solana transaction for the stored quote: Relay's instructions, then our flat fee. The fee payer covers the network fee. */
  async buildTx(id: string, userId: string) {
    const row = await this.load(id, userId);
    this.assertFresh(row);
    const quote = row.quote as StoredQuote;
    const feePayer = this.sponsor.getFeePayerAddress();
    if (!feePayer) throw new BadRequestException('Fee payer not configured');
    const { blockhash } = await this.sponsor.getConnection().getLatestBlockhash('confirmed');
    const ixs = quote.instructions.map(ix => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map(k => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(ix.data, 'hex'),
    }));
    const fee = this.feeTransfer(row.solana_address);
    ixs.push(createTransferCheckedInstruction(fee.sourceAta, fee.mint, fee.destAta, fee.owner, fee.amountUnits, 6));
    const message = new TransactionMessage({ payerKey: new PublicKey(feePayer), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    return { transaction: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64') };
  }

  /** Co-signs and sends the user-signed transaction, but only if it is exactly the stored quote plus our fee. Once per order. */
  async submit(id: string, userId: string, transactionBase64: string) {
    const row = await this.load(id, userId);
    this.assertFresh(row);
    const quote = row.quote as StoredQuote;
    // Claim the order first so two concurrent submits cannot both broadcast it.
    const { data: claimed } = await this.db.from('ample_fund_orders')
      .update({ status: 'BRIDGING', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'PENDING').select('id');
    if (!claimed?.length) throw new BadRequestException('This transfer was already sent.');
    try {
      const { signature } = await this.sponsor.broadcastMatchedRelayDeposit({
        transactionBase64,
        userSolanaAddress: row.solana_address,
        instructions: quote.instructions,
        looftaFee: this.feeTransfer(row.solana_address),
      });
      await this.db.from('ample_fund_orders').update({ signature, updated_at: new Date().toISOString() }).eq('id', id);
      return { signature };
    } catch (err) {
      await this.db.from('ample_fund_orders').update({ status: 'FAILED', last_error: 'broadcast failed', updated_at: new Date().toISOString() }).eq('id', id);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('insufficient funds')) throw new BadRequestException('Not enough USDC in your wallet for this transfer.');
      throw err;
    }
  }

  // ---- withdraw: entirely on the backend, the person only says how much and where ----

  async startWithdraw(userId: string, dto: { amount: string; solanaAddress: string }) {
    if (!(await this.users.isSolanaAddressInLinkedAccounts(userId, dto.solanaAddress))) {
      throw new ForbiddenException('solanaAddress must be one of your own linked wallets');
    }
    const amount = BigInt(dto.amount);
    if (amount < FUND_FEE_UNITS + MIN_OUT_UNITS + 100_000n) throw new BadRequestException('Withdraw at least $1.25 at a time.');
    await this.assertDailyCap(userId);
    const vault = await this.evm.vault();
    if (!vault) throw new BadRequestException('Earn is not available right now. Try again in a moment.');
    const { data, error } = await this.db.from('ample_fund_orders').insert({
      kind: 'withdraw',
      status: 'WITHDRAWING',
      user_id: userId,
      solana_address: dto.solanaAddress,
      vault_id: vault.id,
      out_units: amount.toString(),
      fee_units: FUND_FEE_UNITS.toString(),
      total_units: amount.toString(),
    }).select('*').single();
    if (error || !data) {
      this.logger.error(`withdraw order insert failed: ${error?.message}`);
      throw new BadRequestException('Could not start the withdrawal. Try again.');
    }
    void this.advance(data, true);
    return { id: data.id as string };
  }

  /** Claims prizes into the person's savings. Quick enough to run inline. */
  async claim(userId: string, payoutIds: string[]) {
    const c = await this.companions.ready(userId);
    const q: any = await this.evm.buildClaim(userId, payoutIds);
    const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];
    for (const t of [q.authorization, q.transaction]) {
      if (!t) continue;
      // The cross-chain messaging fee is paid in ETH, which the account does not hold. Say so plainly instead of reverting.
      if (t.value && BigInt(t.value) > 0n) throw new BadRequestException('This prize needs a cross-chain claim that is not available yet. We are working on it.');
      calls.push({ to: t.to, data: t.data });
    }
    const hash = await this.rhinestone.sendSponsored(c.key, calls);
    return { hash };
  }

  // ---- status and the step machine ----

  async status(id: string, userId: string) {
    let row = await this.load(id, userId);
    if (!['DONE', 'FAILED', 'PENDING'].includes(row.status)) {
      await this.advance(row);
      row = await this.load(id, userId);
    }
    if (row.status === 'DONE') return { status: 'SUCCESS' as const };
    if (row.status === 'FAILED') return { status: 'FAILED' as const, detail: row.kind === 'fund' ? 'Your money is safe and we are looking into it.' : 'Your savings are safe and we are looking into it.' };
    return { status: 'PENDING' as const };
  }

  private async setStatus(id: string, from: string, patch: Record<string, unknown>): Promise<boolean> {
    const { data } = await this.db.from('ample_fund_orders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('status', from).select('id');
    return !!data?.length;
  }

  /**
   * Moves one order forward by one step. `fresh` is true right after a step handed over to the next one; otherwise a step that
   * is still being worked on (touched within STALE_MS) is left alone.
   */
  async advance(row: Row, fresh = false): Promise<void> {
    if (this.running.has(row.id)) return;
    if (!fresh && Date.now() - new Date(row.updated_at).getTime() < (row.status === 'BRIDGING' ? 15_000 : STALE_MS)) return;
    this.running.add(row.id);
    try {
      if (row.status === 'BRIDGING') await this.watchBridge(row);
      else if (row.status === 'DEPOSITING') await this.depositStep(row);
      else if (row.status === 'WITHDRAWING') await this.withdrawStep(row);
      else if (row.status === 'RETURNING') await this.returnStep(row);
    } catch (e: any) {
      // Money that has not shown up yet is not a failure: look again in about 10 seconds, and only give up after 30 minutes.
      if (String(e?.message ?? '').startsWith('waiting') && Date.now() - new Date(row.created_at).getTime() < 30 * 60_000) {
        await this.db.from('ample_fund_orders').update({ last_error: String(e.message).slice(0, 300), updated_at: new Date(Date.now() - (STALE_MS - 10_000)).toISOString() }).eq('id', row.id);
        return;
      }
      const attempts = (row.attempts ?? 0) + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      this.logger.warn(`ample order ${row.id} (${row.kind}/${row.status}) attempt ${attempts}: ${e?.message ?? e}`);
      await this.db.from('ample_fund_orders').update({
        attempts, last_error: String(e?.message ?? e).slice(0, 300), updated_at: new Date().toISOString(),
        ...(failed ? { status: 'FAILED' } : {}),
      }).eq('id', row.id);
      if (failed) this.logger.error(`ample order ${row.id} FAILED for user ${row.user_id}: funds are held in their Earn account, needs a manual look`);
    } finally {
      this.running.delete(row.id);
    }
  }

  /** Waits for Relay. Add: then deposit. Withdraw: then done. */
  private async watchBridge(row: Row) {
    const s = await this.relay.getStatus(row.request_id);
    if (s === 'PENDING') return;
    if (s === 'FAILED') {
      await this.setStatus(row.id, 'BRIDGING', { status: 'FAILED', last_error: 'bridge failed or refunded' });
      return;
    }
    if (row.kind === 'withdraw') {
      await this.setStatus(row.id, 'BRIDGING', { status: 'DONE' });
      return;
    }
    if (await this.setStatus(row.id, 'BRIDGING', { status: 'DEPOSITING' })) await this.depositStep({ ...row, status: 'DEPOSITING' });
  }

  /** Puts what the bridge delivered into the pool: one sponsored batch (approval, deposit) from the Earn account. */
  private async depositStep(row: Row) {
    const c = await this.companions.ready(row.user_id);
    const want = BigInt(row.out_units);
    const have = await this.rhinestone.usdcBalance(c.address);
    // Only what this order delivered, never other money that happens to be there.
    const amount = have < want ? have : want;
    if (amount < MIN_OUT_UNITS) throw new Error(`waiting for funds: ${have} of ${want}`);
    const q: any = await this.evm.buildDeposit(row.user_id, amount.toString());
    const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];
    if (q.approval) {
      calls.push({ to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [q.approval.spender, BigInt(q.approval.amount)] }) });
    }
    if (q.transaction.value && BigInt(q.transaction.value) > 0n) throw new Error('deposit needs ETH value');
    calls.push({ to: q.transaction.to, data: q.transaction.data });
    const hash = await this.rhinestone.sendSponsored(c.key, calls);
    await this.setStatus(row.id, 'DEPOSITING', { status: 'DONE', step_hash: hash });
    await this.evm.recordEvent(row.user_id, { kind: 'deposit', vaultId: row.vault_id, amountBase: amount.toString(), txSignature: hash }).catch(() => null);
  }

  /** Takes the money out of the pool into the Earn account. Remembers the transaction first so a retry never withdraws twice. */
  private async withdrawStep(row: Row) {
    const c = await this.companions.ready(row.user_id);
    let hash: string | null = row.step_hash ?? null;
    if (!hash) {
      const q: any = await this.evm.buildWithdraw(row.user_id, String(row.out_units));
      if (q.transaction.value && BigInt(q.transaction.value) > 0n) throw new Error('withdraw needs ETH value');
      hash = await this.rhinestone.sendSponsored(c.key, [{ to: q.transaction.to, data: q.transaction.data }]);
      await this.db.from('ample_fund_orders').update({ step_hash: hash }).eq('id', row.id);
      await this.evm.recordEvent(row.user_id, { kind: 'withdraw', vaultId: row.vault_id, amountBase: String(row.out_units), txSignature: hash }).catch(() => null);
    }
    if (await this.setStatus(row.id, 'WITHDRAWING', { status: 'RETURNING' })) await this.returnStep({ ...row, status: 'RETURNING', step_hash: hash });
  }

  /** Sends the withdrawn USDC back to the person's Solana wallet through Relay, taking Loofta's flat fee first. */
  private async returnStep(row: Row) {
    const c = await this.companions.ready(row.user_id);
    const expected = BigInt(row.total_units);
    const have = await this.rhinestone.usdcBalance(c.address);
    // The vault takes its own small fee, so slightly less than asked can arrive. Wait for it, then use what is there.
    if (have < (expected * 99n) / 100n && Date.now() - new Date(row.created_at).getTime() < 10 * 60_000) throw new Error(`waiting for withdrawal: ${have} of ${expected}`);
    const amount = have < expected ? have : expected;
    const send = amount - FUND_FEE_UNITS;
    if (send < MIN_OUT_UNITS) throw new Error('amount too small to return');
    const q = await this.relay.getBaseToSolQuote({ fromAddress: c.address, toAddress: row.solana_address, amountUnits: send });
    if (q.depositValue > 0n) throw new Error('return needs ETH value');
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [
      { to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [LOOFTA_BASE_WALLET, FUND_FEE_UNITS] }) },
      { to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [q.approvalAddress as `0x${string}`, send] }) },
      { to: q.depositTo as `0x${string}`, data: q.depositData as `0x${string}` },
    ];
    const hash = await this.rhinestone.sendSponsored(c.key, calls);
    await this.setStatus(row.id, 'RETURNING', { status: 'BRIDGING', request_id: q.requestId, step_hash: hash });
  }

  // ---- background ----

  /** Keeps every open order moving even if the person closed the page. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick() {
    if (!isCronEnabled(this.config)) return;
    const { data } = await this.db.from('ample_fund_orders').select('*').in('status', ['BRIDGING', 'DEPOSITING', 'WITHDRAWING', 'RETURNING']).order('created_at').limit(25);
    for (const row of data ?? []) await this.advance(row);
  }

  /**
   * Sweeps dust left in an Earn account (under $1, too small to deposit) to Loofta's Base wallet. Money above that is the
   * person's: it is never swept, only logged, and the order that left it behind keeps retrying.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepDust() {
    if (!isCronEnabled(this.config)) return;
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: list } = await this.db.from('ample_companions').select('user_id, address').or(`swept_at.is.null,swept_at.lt.${dayAgo}`).order('swept_at', { ascending: true, nullsFirst: true }).limit(40);
    for (const c of list ?? []) {
      try {
        const { data: open } = await this.db.from('ample_fund_orders').select('id').eq('user_id', c.user_id).in('status', ['BRIDGING', 'DEPOSITING', 'WITHDRAWING', 'RETURNING']).limit(1);
        if (open?.length) continue;
        const bal = await this.rhinestone.usdcBalance(c.address as `0x${string}`);
        if (bal > 0n && bal < DUST_UNITS) {
          const comp = await this.companions.get(c.user_id);
          const hash = await this.rhinestone.sendSponsored(comp.key, [{ to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [LOOFTA_BASE_WALLET, bal] }) }]);
          this.logger.log(`Earn dust swept: ${bal} units from ${c.address} (${hash})`);
        } else if (bal >= DUST_UNITS) {
          this.logger.warn(`Earn account ${c.address} holds ${bal} USDC units with no open order, belongs to ${c.user_id}, needs a look`);
        }
        await this.db.from('ample_companions').update({ swept_at: new Date().toISOString() }).eq('user_id', c.user_id);
      } catch (e: any) {
        this.logger.warn(`dust sweep ${c.address}: ${e?.message ?? e}`);
      }
    }
  }
}
