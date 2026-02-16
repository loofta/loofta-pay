import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { PaymentEventsService } from './payment-events.service';

export interface RecordPaymentAttestationParams {
  claimId: string;
  amount: string;
  tokenSymbol: string;
  tokenChain: string;
  executionRef: string;
  recipientId?: string | null;
}

/** Canonical preimage for attestation commitment (must match contract docs). Delimiter: newline. */
export function attestationPreimage(
  claimId: string,
  executionRef: string,
  amount: string,
  tokenSymbol: string,
  tokenChain: string,
  recipientId: string,
  nonceHex: string,
): string {
  return [claimId, executionRef, amount, tokenSymbol, tokenChain, recipientId, nonceHex].join('\n');
}

/** SHA256 of preimage; 32-byte buffer. */
export function attestationCommitment(preimage: string): Buffer {
  return createHash('sha256').update(preimage, 'utf8').digest();
}

/**
 * Calls the NEAR Payroll Attestation contract to record a payment (idempotent per claim_id).
 * Stores only a commitment on-chain (no plaintext amount/token/recipient). Returns tx hash + nonce for persistence.
 * Requires NEAR_ATTESTATION_CONTRACT_ID, NEAR_ATTESTATION_NEAR_ACCOUNT_ID, NEAR_ATTESTATION_NEAR_PRIVATE_KEY.
 */
@Injectable()
export class ClaimAttestationService {
  private readonly logger = new Logger(ClaimAttestationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly paymentEventsService: PaymentEventsService,
  ) {}

  /**
   * Record payment attestation on-chain. Idempotent: contract rejects if claim_id already exists.
   * Stores only commitment (hash); no plaintext amount/token/recipient. Generates nonce and returns it for persistence.
   * Returns { txHash, nonceHex } or null if not configured or on failure (caller can retry).
   */
  async recordPayment(
    params: RecordPaymentAttestationParams,
  ): Promise<{ txHash: string; nonceHex: string } | null> {
    const contractId = this.config.get<string>('NEAR_ATTESTATION_CONTRACT_ID');
    const accountId = this.config.get<string>('NEAR_ATTESTATION_NEAR_ACCOUNT_ID');
    const privateKey = this.config.get<string>('NEAR_ATTESTATION_NEAR_PRIVATE_KEY');
    const networkId = this.config.get<string>('NEAR_NETWORK_ID') || 'mainnet';

    if (!contractId || !accountId || !privateKey) {
      this.logger.debug('Claim attestation not configured; skipping on-chain record');
      return null;
    }

    const nonce = randomBytes(32);
    const nonceHex = nonce.toString('hex');
    const recipientId = params.recipientId ?? '';
    const preimage = attestationPreimage(
      params.claimId,
      params.executionRef,
      String(params.amount),
      params.tokenSymbol,
      params.tokenChain,
      recipientId,
      nonceHex,
    );
    const commitment = attestationCommitment(preimage);
    const commitmentArray = Array.from(new Uint8Array(commitment));

    try {
      const nearApi = await import('near-api-js');
      const connect = nearApi.connect;
      const keyStores = nearApi.keyStores;
      const KeyPair = nearApi.KeyPair;

      const keyPair = KeyPair.fromString(
        privateKey.startsWith('ed25519:') ? privateKey : `ed25519:${privateKey}`,
      );
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

      const args = {
        claim_id: params.claimId,
        execution_ref: params.executionRef,
        commitment: commitmentArray,
      };

      const outcome = await account.functionCall({
        contractId,
        methodName: 'record_payment',
        args,
        gas: BigInt(100_000_000_000),
        attachedDeposit: BigInt(0),
      });

      const txHash =
        (outcome as any).transaction_outcome?.id ??
        (outcome as any).transaction?.hash ??
        null;
      if (txHash) {
        this.logger.log(`Attestation recorded on-chain for claim ${params.claimId}, tx=${txHash}`);
        this.paymentEventsService.log({
          claimId: params.claimId,
          eventType: 'attestation_submitted',
          success: true,
          refOrHash: txHash,
        }).catch(() => {});
        return { txHash, nonceHex };
      }
      this.logger.warn('Attestation recorded but could not read tx hash from outcome');
      this.paymentEventsService.log({
        claimId: params.claimId,
        eventType: 'attestation_submitted',
        success: true,
        refOrHash: `on-chain:${params.claimId}`,
      }).catch(() => {});
      return { txHash: `on-chain:${params.claimId}`, nonceHex };
    } catch (e) {
      this.logger.warn(
        'Failed to record attestation on-chain:',
        (e as Error).message,
      );
      this.paymentEventsService.log({
        claimId: params.claimId,
        eventType: 'attestation_failed',
        success: false,
        errorMessage: (e as Error).message,
      }).catch(() => {});
      return null;
    }
  }

  /**
   * Record attestation for a claim and persist attestation_tx_hash and attestation_nonce. Idempotent: skips if already set.
   * Returns the tx hash if recorded, null otherwise.
   */
  async recordAttestationIfNeeded(claimId: string): Promise<string | null> {
    const client = this.supabaseService.getClient();

    const { data: claim, error: claimErr } = await client
      .from('claims')
      .select('id, amount, to_symbol, to_chain, recipient_address, paid_with_token, paid_with_chain, attestation_tx_hash, attestation_nonce, status')
      .eq('id', claimId)
      .single();

    if (claimErr || !claim) {
      this.logger.warn(`Claim not found for attestation: ${claimId}`);
      return null;
    }
    if (claim.status !== 'SUCCESS') {
      return null;
    }
    if ((claim as any).attestation_tx_hash) {
      return (claim as any).attestation_tx_hash;
    }

    const { data: intent } = await client
      .from('claim_intents')
      .select('quote_id, deposit_address')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const executionRef =
      (intent as any)?.quote_id ||
      (intent as any)?.deposit_address ||
      claimId;

    const tokenSymbol = (claim as any).paid_with_token || claim.to_symbol;
    const tokenChain = (claim as any).paid_with_chain || claim.to_chain;

    const result = await this.recordPayment({
      claimId: claim.id,
      amount: claim.amount,
      tokenSymbol,
      tokenChain,
      executionRef,
      recipientId: claim.recipient_address,
    });

    if (result) {
      await client
        .from('claims')
        .update({
          attestation_tx_hash: result.txHash,
          attestation_nonce: result.nonceHex,
        })
        .eq('id', claimId);
    } else {
      this.paymentEventsService.log({
        claimId,
        eventType: 'attestation_failed',
        success: false,
        errorMessage: 'recordPayment returned null (not configured or NEAR error)',
      }).catch(() => {});
    }
    return result?.txHash ?? null;
  }

  /**
   * Retry recording attestation for claims that are SUCCESS but have no attestation_tx_hash yet.
   * Idempotent: contract rejects duplicate claim_id; safe to call repeatedly.
   */
  async retryMissingAttestations(): Promise<{ attempted: number; recorded: number }> {
    const client = this.supabaseService.getClient();
    const { data: claims, error } = await client
      .from('claims')
      .select('id')
      .eq('status', 'SUCCESS')
      .is('attestation_tx_hash', null)
      .limit(50);

    if (error || !claims?.length) {
      return { attempted: 0, recorded: 0 };
    }
    let recorded = 0;
    for (const row of claims) {
      const txHash = await this.recordAttestationIfNeeded(row.id);
      if (txHash) recorded++;
    }
    return { attempted: claims.length, recorded };
  }
}
