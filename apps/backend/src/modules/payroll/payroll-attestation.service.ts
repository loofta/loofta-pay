import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/** Ed25519 seed length (same as NEAR / standard Ed25519). */
const ED25519_SEED_LENGTH = 32;
const ED25519_PUBLIC_KEY_LENGTH = 32;

/**
 * Verifiable attestation for payroll payment outcomes (completed / failed / expired).
 * Uses Node built-in Web Crypto (Ed25519) — no external crypto libs, NEAR-compatible.
 * Optionally records attestation on-chain via NEAR when configured.
 */
export interface AttestationPayload {
  runId: string;
  entryId: string;
  status: 'completed' | 'failed' | 'expired';
  amount: string;
  tokenSymbol: string;
  network: string;
  /** SHA-256 hash of recipient address (first 16 hex chars) for correlation without exposing address */
  recipientHash: string;
  txHash?: string;
  error?: string;
  timestamp: string; // ISO
}

export interface AttestationResult {
  payload: AttestationPayload;
  /** Canonical JSON string that was signed */
  message: string;
  /** Base64-encoded Ed25519 signature */
  signature: string;
  /** Public key (base64) so verifiers can verify */
  signerPublicKey: string;
  /** Identifier for the signer key */
  signerKeyId: string;
  /** If on-chain attestation is enabled, NEAR tx hash that recorded this attestation */
  onChainTxHash?: string;
}

@Injectable()
export class PayrollAttestationService {
  private readonly logger = new Logger(PayrollAttestationService.name);
  private readonly signerKeyId = 'payroll-attestation-1';
  private signingKey: CryptoKey | null = null;
  private publicKeyBase64: string | null = null;
  private keyInitPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.keyInitPromise = this.initKey();
  }

  private async initKey(): Promise<void> {
    const seedB64 = this.config.get<string>('PAYROLL_ATTESTATION_PRIVATE_KEY');
    const pubB64 = this.config.get<string>('PAYROLL_ATTESTATION_PUBLIC_KEY');
    if (!seedB64 || !pubB64) {
      this.logger.debug('PAYROLL_ATTESTATION_PRIVATE_KEY/PUBLIC_KEY not set; attestations will not be signed');
      return;
    }
    try {
      const seed = Buffer.from(seedB64, 'base64');
      const pub = Buffer.from(pubB64, 'base64');
      if (seed.length !== ED25519_SEED_LENGTH || pub.length !== ED25519_PUBLIC_KEY_LENGTH) {
        this.logger.warn(
          `PAYROLL_ATTESTATION keys: private must be base64 ${ED25519_SEED_LENGTH}B, public ${ED25519_PUBLIC_KEY_LENGTH}B`,
        );
        return;
      }
      this.publicKeyBase64 = pubB64;
      const subtle = (crypto.webcrypto as unknown as { subtle: SubtleCrypto }).subtle;
      this.signingKey = await subtle.importKey('raw', seed, { name: 'Ed25519' }, false, ['sign']);
      this.logger.log('Payroll attestation signing enabled (Ed25519, NEAR-compatible)');
    } catch (e) {
      this.logger.warn('Failed to init attestation key:', (e as Error).message);
    }
  }

  /**
   * Build and sign an attestation for a terminal payroll entry state.
   * Call when status becomes completed, failed, or expired.
   */
  async createAttestation(params: {
    runId: string;
    entryId: string;
    status: 'completed' | 'failed' | 'expired';
    amount: string;
    tokenSymbol: string;
    network: string;
    recipientAddress: string;
    txHash?: string;
    error?: string;
  }): Promise<AttestationResult | null> {
    const timestamp = new Date().toISOString();
    const recipientHash = this.hashRecipient(params.recipientAddress);

    const payload: AttestationPayload = {
      runId: params.runId,
      entryId: params.entryId,
      status: params.status,
      amount: params.amount,
      tokenSymbol: params.tokenSymbol,
      network: params.network,
      recipientHash,
      timestamp,
      ...(params.txHash && { txHash: params.txHash }),
      ...(params.error && { error: params.error }),
    };

    const message = this.canonicalJson(payload);

    if (this.keyInitPromise) await this.keyInitPromise;
    if (!this.signingKey || !this.publicKeyBase64) {
      return {
        payload,
        message,
        signature: '',
        signerPublicKey: '',
        signerKeyId: this.signerKeyId,
      };
    }

    const subtle = (crypto.webcrypto as unknown as { subtle: SubtleCrypto }).subtle;
    const messageBytes = Buffer.from(message, 'utf8');
    const signature = await subtle.sign(
      { name: 'Ed25519' },
      this.signingKey,
      new Uint8Array(messageBytes),
    );
    const signatureB64 = Buffer.from(signature).toString('base64');

    let onChainTxHash: string | undefined;
    const attestationHash = crypto.createHash('sha256').update(message).digest('hex');
    try {
      onChainTxHash = await this.recordOnChain(attestationHash, message);
    } catch (e) {
      this.logger.warn('On-chain attestation record failed (continuing with off-chain only):', (e as Error).message);
    }

    return {
      payload,
      message,
      signature: signatureB64,
      signerPublicKey: this.publicKeyBase64,
      signerKeyId: this.signerKeyId,
      ...(onChainTxHash && { onChainTxHash }),
    };
  }

  /**
   * Verify a signed attestation (for oracles/auditors). Uses Web Crypto Ed25519.
   */
  static async verify(result: AttestationResult): Promise<boolean> {
    if (!result.signature || !result.signerPublicKey) return false;
    try {
      const subtle = (crypto.webcrypto as unknown as { subtle: SubtleCrypto }).subtle;
      const publicKeyBytes = Buffer.from(result.signerPublicKey, 'base64');
      const signature = Buffer.from(result.signature, 'base64');
      const messageBytes = Buffer.from(result.message, 'utf8');
      const pubKey = await subtle.importKey(
        'raw',
        publicKeyBytes,
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      return await subtle.verify(
        { name: 'Ed25519' },
        pubKey,
        new Uint8Array(signature),
        new Uint8Array(messageBytes),
      );
    } catch {
      return false;
    }
  }

  private hashRecipient(address: string): string {
    return crypto.createHash('sha256').update((address || '').trim().toLowerCase()).digest('hex').slice(0, 16);
  }

  private canonicalJson(obj: Record<string, unknown>): string {
    return JSON.stringify(obj, Object.keys(obj).sort());
  }

  private async recordOnChain(attestationHash: string, payloadJson: string): Promise<string | undefined> {
    const accountId = this.config.get<string>('PAYROLL_ATTESTATION_NEAR_ACCOUNT_ID');
    const privateKey = this.config.get<string>('PAYROLL_ATTESTATION_NEAR_PRIVATE_KEY');
    const contractId = this.config.get<string>('PAYROLL_ATTESTATION_NEAR_CONTRACT_ID');
    if (!accountId || !privateKey || !contractId) return undefined;

    // When NEAR contract is deployed: use near-api-js to call contract.record_attestation(attestation_hash, payload_json)
    this.logger.debug(`On-chain attestation would record hash=${attestationHash.slice(0, 16)}... on ${contractId}`);
    return undefined;
  }
}
