import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { computeTxRefsHash } from './payroll-batch-hash';

export interface PostReceiptParams {
  payrollId: string;
  batchHash: string;
  authorizerId: string;
  nonce: number;
  executorId: string;
  status: 'success' | 'partial' | 'failed';
  txHashes: string[];
}

/**
 * Calls the NEAR Payroll Receipt Logger contract to record a receipt (hash-only, no amounts).
 * Requires PAYROLL_RECEIPT_LOGGER_CONTRACT_ID, PAYROLL_RECEIPT_LOGGER_NEAR_ACCOUNT_ID,
 * PAYROLL_RECEIPT_LOGGER_NEAR_PRIVATE_KEY (format: ed25519:base58key).
 */
@Injectable()
export class PayrollReceiptLoggerService {
  private readonly logger = new Logger(PayrollReceiptLoggerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /** Result of posting a receipt (txHash on success, error message on failure). */
  async postReceipt(params: PostReceiptParams): Promise<{ ok: true; txHash: string } | { ok: false; error: string }> {
    const contractId = this.config.get<string>('PAYROLL_RECEIPT_LOGGER_CONTRACT_ID');
    const accountId = this.config.get<string>('PAYROLL_RECEIPT_LOGGER_NEAR_ACCOUNT_ID');
    const privateKey = this.config.get<string>('PAYROLL_RECEIPT_LOGGER_NEAR_PRIVATE_KEY');
    const networkId = this.config.get<string>('NEAR_NETWORK_ID') || 'mainnet';

    if (!contractId || !accountId || !privateKey) {
      this.logger.debug('Payroll Receipt Logger not configured; skipping on-chain post');
      return { ok: false, error: 'Payroll Receipt Logger not configured (PAYROLL_RECEIPT_LOGGER_* env)' };
    }

    const txRefsHash = computeTxRefsHash(params.txHashes);

    try {
      const nearApi = await import('near-api-js');
      const connect = nearApi.connect;
      const keyStores = nearApi.keyStores;
      const Contract = nearApi.Contract;
      const KeyPair = nearApi.KeyPair;
      const utils = nearApi.utils;

      const keyPair = KeyPair.fromString(privateKey.startsWith('ed25519:') ? privateKey : `ed25519:${privateKey}`);
      const keyStore = new keyStores.InMemoryKeyStore();
      await keyStore.setKey(networkId, accountId, keyPair);

      const nodeUrl =
        this.config.get<string>('NEAR_RPC_URL') ??
        (networkId === 'mainnet' ? 'https://free.rpc.fastnear.com' : 'https://rpc.testnet.fastnear.com');
      const near = await connect({
        networkId,
        keyStore,
        nodeUrl,
      });
      const account = await near.account(accountId);

      const contract = new Contract(account, contractId, {
        viewMethods: ['get_receipt', 'is_nonce_used'],
        changeMethods: ['record_receipt'],
      });

      await (contract as any).record_receipt(
        {
          payroll_id: params.payrollId,
          batch_hash: params.batchHash,
          authorizer_id: params.authorizerId,
          nonce: params.nonce,
          executor_id: params.executorId,
          status: params.status,
          tx_refs_hash: txRefsHash,
        },
        utils.format.parseNearAmount('0.01') ?? '10000000000000000000000',
        '0',
      );

      this.logger.log(`Receipt posted on-chain for run ${params.payrollId}`);
      return { ok: true, txHash: `on-chain:${params.payrollId}` };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn('Failed to post receipt on-chain:', msg);
      return { ok: false, error: msg };
    }
  }

  /**
   * Load completed entry tx hashes for a run and post receipt, then save receipt_on_chain_tx_hash.
   */
  async postReceiptForRunIfCompleted(runId: string): Promise<string | null> {
    const client = this.supabaseService.getClient();

    const { data: run, error: runErr } = await client
      .from('payroll_runs')
      .select('id, status, batch_hash, authorizer_id, authorization_nonce, asset_id, receipt_on_chain_tx_hash')
      .eq('id', runId)
      .single();

    if (runErr || !run) return null;
    if (run.receipt_on_chain_tx_hash) return run.receipt_on_chain_tx_hash;
    if (run.status !== 'completed') return null;
    if (!run.batch_hash || run.authorizer_id == null || run.authorization_nonce == null) {
      this.logger.debug(`Run ${runId} missing batch_hash/authorizer/nonce; skipping receipt`);
      return null;
    }

    const { data: events } = await client
      .from('payroll_events')
      .select('payload')
      .eq('payroll_run_id', runId)
      .eq('type', 'completed')
      .not('payload->txHash', 'is', null);

    const txHashes = (events || [])
      .map((e) => (e.payload as { txHash?: string })?.txHash)
      .filter(Boolean) as string[];

    const executorId = this.config.get<string>('PAYROLL_RECEIPT_LOGGER_NEAR_ACCOUNT_ID') || 'payroll-backend';

    const result = await this.postReceipt({
      payrollId: runId,
      batchHash: run.batch_hash,
      authorizerId: run.authorizer_id,
      nonce: Number(run.authorization_nonce),
      executorId,
      status: 'success',
      txHashes,
    });

    if (result.ok && result.txHash) {
      await client
        .from('payroll_runs')
        .update({ receipt_on_chain_tx_hash: result.txHash, updated_at: new Date().toISOString() })
        .eq('id', runId);
      return result.txHash;
    }
    return null;
  }
}
