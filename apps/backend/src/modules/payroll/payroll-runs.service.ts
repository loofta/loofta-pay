import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { NearIntentsService } from '../intents/near-intents.service';
import {
  CreatePayrollRunDto,
  CreatePayrollRunEntryDto,
  PayrollRunResponse,
  PayrollRunEntryWithIntent,
} from './dto';
import { computeBatchHash } from './payroll-batch-hash';
import { PayrollReceiptLoggerService } from './payroll-receipt-logger.service';

@Injectable()
export class PayrollRunsService {
  private readonly logger = new Logger(PayrollRunsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly payrollOrgsService: PayrollOrganizationsService,
    private readonly nearIntentsService: NearIntentsService,
    private readonly receiptLogger: PayrollReceiptLoggerService,
  ) {}

  /**
   * Create a payment run and request deposit quotes (intents) for each entry.
   */
  async createRun(
    organizationId: string,
    userId: string,
    dto: CreatePayrollRunDto,
  ): Promise<PayrollRunResponse> {
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    if (!dto.entries?.length) {
      throw new BadRequestException('At least one entry is required');
    }

    const tokenSymbol = (dto.tokenSymbol || '').trim().toUpperCase();
    const network = (dto.network || '').trim().toLowerCase();
    if (!tokenSymbol || !network) {
      throw new BadRequestException('tokenSymbol and network are required');
    }

    const client = this.supabaseService.getClient();

    // Fetch contributors and validate
    const contributorIds = [...new Set(dto.entries.map((e) => e.contributorId))];
    const { data: contributors, error: contribError } = await client
      .from('payroll_contributors')
      .select('id, organization_id, email, wallet_address, network, token_symbol, first_name, last_name')
      .eq('organization_id', organizationId)
      .in('id', contributorIds)
      .eq('status', 'joined');

    if (contribError) {
      this.logger.error('Failed to fetch contributors:', contribError);
      throw new Error(`Database error: ${contribError.message}`);
    }

    const contribMap = new Map((contributors || []).map((c) => [c.id, c]));

    for (const entry of dto.entries) {
      const c = contribMap.get(entry.contributorId);
      if (!c) {
        throw new BadRequestException(`Contributor ${entry.contributorId} not found or not joined`);
      }
      if (!c.wallet_address?.trim()) {
        throw new BadRequestException(`Contributor ${c.email} has no wallet address set`);
      }
      const amt = (entry.amount || '').trim();
      if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
        throw new BadRequestException(`Invalid amount for contributor ${c.email}`);
      }
    }

    // Create run
    const { data: run, error: runError } = await client
      .from('payroll_runs')
      .insert({
        organization_id: organizationId,
        created_by: userId,
        status: 'draft',
        total_entries: dto.entries.length,
        completed_entries: 0,
      })
      .select('id, organization_id, created_by, status, total_entries, completed_entries, created_at, updated_at')
      .single();

    if (runError || !run) {
      this.logger.error('Failed to create run:', runError);
      throw new Error(`Database error: ${runError?.message || 'Unknown'}`);
    }

    await this.logEvent(run.id, null, 'run_created', { entries: dto.entries.length, tokenSymbol, network });

    const tokens = await this.nearIntentsService.getTokens();
    const fromToken = tokens.find(
      (t) =>
        t.symbol.toUpperCase() === tokenSymbol &&
        (t.chain.toLowerCase() === network || t.chain.toLowerCase() === (network === 'solana' ? 'sol' : network)),
    );
    if (!fromToken?.tokenId) {
      await this.logEvent(run.id, null, 'run_failed', { reason: 'Token not found for quote', tokenSymbol, network });
      throw new BadRequestException(`Token ${tokenSymbol} on ${network} is not supported for payment`);
    }

    const toToken = {
      tokenId: fromToken.tokenId,
      chain: fromToken.chain,
      symbol: fromToken.symbol,
      decimals: fromToken.decimals,
    };
    const fromTokenParam = {
      tokenId: fromToken.tokenId,
      chain: fromToken.chain,
      symbol: fromToken.symbol,
      decimals: fromToken.decimals,
    };

    const entriesWithIntents: PayrollRunEntryWithIntent[] = [];
    let anyIntentCreated = false;

    for (const entry of dto.entries) {
      const contrib = contribMap.get(entry.contributorId)!;
      const amount = (entry.amount || '').trim();
      const recipientAddress = (contrib.wallet_address || '').trim();

      const { data: runEntry, error: entryError } = await client
        .from('payroll_run_entries')
        .insert({
          payroll_run_id: run.id,
          contributor_id: contrib.id,
          amount,
          token_symbol: tokenSymbol,
          network,
          recipient_address: recipientAddress,
          status: 'draft',
        })
        .select('id, contributor_id, amount, token_symbol, network, recipient_address, status, created_at')
        .single();

      if (entryError || !runEntry) {
        this.logger.error('Failed to create run entry:', entryError);
        await this.logEvent(run.id, null, 'entry_failed', { contributorId: contrib.id, error: entryError?.message });
        continue;
      }

      let deposit_address: string | null = null;
      let memo: string | null = null;
      let deadline: string | null = null;
      let quote_id: string | null = null;
      let entryStatus = 'draft';

      try {
        const quote = await this.nearIntentsService.getDepositQuote({
          fromToken: fromTokenParam,
          toToken,
          amountIn: amount,
          recipient: recipientAddress,
          useExactOutput: false,
        });

        if (quote.error) {
          this.logger.warn(`Quote failed for entry ${runEntry.id}:`, quote.error);
          await this.logEvent(run.id, runEntry.id, 'intent_quote_failed', { error: quote.error });
        } else if (quote.depositAddress) {
          deposit_address = quote.depositAddress;
          memo = quote.memo ?? null;
          deadline = quote.deadline ?? null;
          quote_id = quote.quoteId ?? null;
          entryStatus = 'intent_created';
          anyIntentCreated = true;

          await client
            .from('payroll_intents')
            .insert({
              payroll_run_entry_id: runEntry.id,
              quote_id,
              deposit_address,
              memo,
              deadline,
              status: 'PENDING',
            });

          await client
            .from('payroll_run_entries')
            .update({ status: 'intent_created', updated_at: new Date().toISOString() })
            .eq('id', runEntry.id);

          await this.logEvent(run.id, runEntry.id, 'intent_created', {
            deposit_address,
            deadline,
            quote_id,
          });
        }
      } catch (err: any) {
        this.logger.warn(`Intent creation failed for entry ${runEntry.id}:`, err?.message);
        await this.logEvent(run.id, runEntry.id, 'intent_created_failed', { error: err?.message });
      }

      entriesWithIntents.push({
        id: runEntry.id,
        contributor_id: runEntry.contributor_id,
        amount: runEntry.amount,
        token_symbol: runEntry.token_symbol,
        network: runEntry.network,
        recipient_address: runEntry.recipient_address,
        status: entryStatus,
        deposit_address: deposit_address ?? null,
        memo: memo ?? null,
        deadline: deadline ?? null,
        created_at: runEntry.created_at,
      });
    }

    const runStatus = anyIntentCreated ? 'pending_deposit' : 'draft';

    // On-chain receipt logger: batch commitment (hash only, no amounts) + nonce for idempotency.
    const batchHash = computeBatchHash(
      entriesWithIntents.map((e) => ({ id: e.id, recipient_address: e.recipient_address, amount: e.amount })),
    );
    const { data: maxNonceRows } = await client
      .from('payroll_runs')
      .select('authorization_nonce')
      .eq('authorizer_id', userId)
      .not('authorization_nonce', 'is', null)
      .order('authorization_nonce', { ascending: false })
      .limit(1);
    const nextNonce = ((maxNonceRows?.[0] as { authorization_nonce?: number } | undefined)?.authorization_nonce ?? 0) + 1;
    const assetId = `${tokenSymbol}:${network}`;

    await client
      .from('payroll_runs')
      .update({
        status: runStatus,
        batch_hash: batchHash,
        authorizer_id: userId,
        authorization_nonce: nextNonce,
        asset_id: assetId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    return {
      ...run,
      status: runStatus,
      entries: entriesWithIntents,
    };
  }

  /**
   * List runs for an organization.
   */
  async listRuns(organizationId: string, userId: string): Promise<any[]> {
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_runs')
      .select('id, organization_id, created_by, status, total_entries, completed_entries, created_at, updated_at, batch_hash, receipt_on_chain_tx_hash')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list runs:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return data || [];
  }

  /**
   * Get a single run with entries and intent details.
   */
  async getRun(organizationId: string, runId: string, userId: string): Promise<PayrollRunResponse> {
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const { data: run, error: runError } = await this.supabaseService.getClient()
      .from('payroll_runs')
      .select('id, organization_id, created_by, status, total_entries, completed_entries, created_at, updated_at, batch_hash, receipt_on_chain_tx_hash')
      .eq('id', runId)
      .eq('organization_id', organizationId)
      .single();

    if (runError || !run) {
      throw new NotFoundException('Run not found');
    }

    const { data: entries, error: entriesError } = await this.supabaseService.getClient()
      .from('payroll_run_entries')
      .select('id, contributor_id, amount, token_symbol, network, recipient_address, status, created_at')
      .eq('payroll_run_id', runId)
      .order('created_at', { ascending: true });

    if (entriesError) {
      this.logger.error('Failed to fetch entries:', entriesError);
      throw new Error(`Database error: ${entriesError.message}`);
    }

    const entryIds = (entries || []).map((e) => e.id);
    const { data: intents } = entryIds.length
      ? await this.supabaseService.getClient()
          .from('payroll_intents')
          .select('payroll_run_entry_id, deposit_address, memo, deadline, status')
          .in('payroll_run_entry_id', entryIds)
      : { data: [] };

    const intentByEntry = new Map((intents || []).map((i) => [i.payroll_run_entry_id, i]));

    const entriesWithIntents: PayrollRunEntryWithIntent[] = (entries || []).map((e) => {
      const intent = intentByEntry.get(e.id);
      return {
        id: e.id,
        contributor_id: e.contributor_id,
        amount: e.amount,
        token_symbol: e.token_symbol,
        network: e.network,
        recipient_address: e.recipient_address,
        status: e.status,
        deposit_address: intent?.deposit_address ?? null,
        memo: intent?.memo ?? null,
        deadline: intent?.deadline ?? null,
        created_at: e.created_at,
      };
    });

    return {
      ...run,
      entries: entriesWithIntents,
    };
  }

  /**
   * Get pending intents for cron processing (entries in intent_created or processing with deadline not passed).
   */
  async getPendingIntents(): Promise<
    Array<{
      entry_id: string;
      run_id: string;
      deposit_address: string;
      deadline: string | null;
    }>
  > {
    const client = this.supabaseService.getClient();
    const { data: intents, error: intErr } = await client
      .from('payroll_intents')
      .select('id, payroll_run_entry_id, deposit_address, deadline')
      .not('deposit_address', 'is', null);

    if (intErr || !intents?.length) return [];

    const entryIds = intents.map((i) => i.payroll_run_entry_id);
    const { data: entries, error: entErr } = await client
      .from('payroll_run_entries')
      .select('id, payroll_run_id, status')
      .in('id', entryIds);

    if (entErr || !entries?.length) return [];

    const entryMap = new Map(entries.map((e) => [e.id, e]));
    const now = new Date().toISOString();
    const out: Array<{ entry_id: string; run_id: string; deposit_address: string; deadline: string | null }> = [];

    for (const i of intents) {
      const entry = entryMap.get(i.payroll_run_entry_id);
      if (!entry) continue;
      if (entry.status !== 'intent_created' && entry.status !== 'pending_deposit' && entry.status !== 'processing') continue;
      if (i.deadline && i.deadline < now) continue;
      out.push({
        entry_id: entry.id,
        run_id: entry.payroll_run_id,
        deposit_address: i.deposit_address,
        deadline: i.deadline,
      });
    }
    return out;
  }

  /**
   * Update entry and intent status after status check (used by cron).
   */
  async updateEntryStatus(
    entryId: string,
    status: 'pending_deposit' | 'processing' | 'completed' | 'failed' | 'expired',
    payload?: { txHash?: string; error?: string; lastStatusPayload?: any },
  ): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: entry, error: entryErr } = await client
      .from('payroll_run_entries')
      .select('id, payroll_run_id, status')
      .eq('id', entryId)
      .single();

    if (entryErr || !entry) return;

    if (entry.status === 'completed' || entry.status === 'failed' || entry.status === 'expired') {
      return;
    }

    await client
      .from('payroll_run_entries')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', entryId);

    const { data: intent } = await client
      .from('payroll_intents')
      .select('id')
      .eq('payroll_run_entry_id', entryId)
      .single();

    if (intent && payload?.lastStatusPayload) {
      await client
        .from('payroll_intents')
        .update({
          status: payload.lastStatusPayload?.status ?? status,
          last_status_payload: payload.lastStatusPayload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', intent.id);
    }

    await this.logEvent(entry.payroll_run_id, entryId, status, payload || {});

    if (status === 'completed' || status === 'failed' || status === 'expired') {
      const { data: run } = await client
        .from('payroll_runs')
        .select('id, total_entries, completed_entries')
        .eq('id', entry.payroll_run_id)
        .single();

      if (run && status === 'completed') {
        const newCompleted = (run.completed_entries || 0) + 1;
        const runNowCompleted = newCompleted >= run.total_entries;
        await client
          .from('payroll_runs')
          .update({
            completed_entries: newCompleted,
            status: runNowCompleted ? 'completed' : 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', entry.payroll_run_id);
        if (runNowCompleted) {
          this.receiptLogger.postReceiptForRunIfCompleted(entry.payroll_run_id).catch((e) => {
            this.logger.warn('Post receipt for run failed:', (e as Error).message);
          });
        }
      } else if (run && (status === 'failed' || status === 'expired')) {
        await client
          .from('payroll_runs')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', entry.payroll_run_id);
      }
    }
  }

  /**
   * Mark entry as expired (deadline passed).
   */
  async markEntryExpired(entryId: string): Promise<void> {
    await this.updateEntryStatus(entryId, 'expired', { error: 'Deadline passed' });
  }

  private async logEvent(
    runId: string,
    entryId: string | null,
    type: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('payroll_events')
      .insert({
        payroll_run_id: runId,
        payroll_run_entry_id: entryId,
        type,
        payload,
      });
    if (error) {
      this.logger.warn('Failed to log payroll event:', error);
    }
  }
}
