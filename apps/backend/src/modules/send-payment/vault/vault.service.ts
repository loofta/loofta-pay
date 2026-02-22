/**
 * In-repo vault (private payment) flow.
 * Uses claim flow copied from privacy-hack (claimFlowPh) with our send_payment_links adapter.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { createPublicKey, verify } from 'crypto';
import * as nacl from 'tweetnacl';
// bs58 may export default depending on bundler/runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;
import { SESSION_MESSAGE } from './constants';
import type { PrivateClaimLinkState } from './vault-types';
import { SupabaseService } from '@/database/supabase.service';
import { prepareClaimForLink, submitClaimForLink } from './claimFlowPh';

export type { PrivateClaimLinkState } from './vault-types';

/** Read env var from .env.local when ConfigService/process.env don't have it. */
function getEnvFromFile(varName: string): string | null {
  const tryPaths = [
    join(process.cwd(), 'apps', 'backend', '.env.local'),
    join(process.cwd(), '.env.local'),
    join(__dirname, '..', '..', '..', '..', '..', '.env.local'),
    join(__dirname, '..', '..', '..', '..', '.env.local'),
  ];
  for (const p of tryPaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8');
        const regex = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(["']?)([^\\s#'"]+)\\1`);
        const match = content.match(regex);
        if (match?.[2]) return match[2].trim();
      }
    } catch {
      // ignore
    }
  }
  return null;
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private connection: Connection | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    let rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ??
      process.env.SOLANA_RPC_URL ??
      null;
    if (!rpcUrl) {
      const heliusKey =
        this.configService.get<string>('HELIUS_API_KEY') ??
        process.env.HELIUS_API_KEY ??
        getEnvFromFile('HELIUS_API_KEY');
      if (heliusKey) rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    }
    if (!rpcUrl) rpcUrl = getEnvFromFile('SOLANA_RPC_URL');
    if (rpcUrl) {
      this.connection = new Connection(rpcUrl, 'confirmed');
    } else {
      this.logger.warn('VaultService: SOLANA_RPC_URL / HELIUS_API_KEY not set; private vault RPC unavailable until configured.');
    }
  }

  /** Decode session signature from base64 or base58 to 64-byte Buffer; throws if invalid. */
  private decodeSessionSignature(encoded: string): Buffer {
    const normalized = encoded.replace(/\s/g, '').trim();
    const base64Normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64Normalized.length % 4;
    const base64Padded = pad ? base64Normalized + '='.repeat(4 - pad) : base64Normalized;
    let buf = Buffer.from(base64Padded, 'base64');
    if (buf.length !== 64) {
      try {
        buf = Buffer.from(bs58.decode(normalized));
      } catch {
        throw new Error(`Invalid session signature: decoded length ${buf.length}, expected 64`);
      }
    }
    if (buf.length !== 64) throw new Error(`Invalid session signature: length ${buf.length}`);
    return buf;
  }

  /**
   * Verify 64-byte Ed25519 session signature (Node crypto).
   * Accepts signature as base64 or base58 (Solana style).
   * Tries multiple message formats: raw, Solana Signed Message with/without newline after length.
   */
  verifySessionSignature(senderPublicKey: string, sessionSignatureEncoded: string): boolean {
    let sessionSig: Buffer;
    try {
      sessionSig = this.decodeSessionSignature(sessionSignatureEncoded);
    } catch {
      return false;
    }
    const senderPubkey = new PublicKey(senderPublicKey);
    const rawMessage = Buffer.from(SESSION_MESSAGE, 'utf8');
    const len = rawMessage.length;
    const messages: Buffer[] = [
      rawMessage,
      Buffer.from(`\x19Solana Signed Message:\n${len}${SESSION_MESSAGE}`, 'utf8'),
      Buffer.from(`\x19Solana Signed Message:\n${len}\n${SESSION_MESSAGE}`, 'utf8'),
      Buffer.from(`Solana Signed Message:\n${len}\n${SESSION_MESSAGE}`, 'utf8'),
      Buffer.from(`solana signed message:\n${len}\n${SESSION_MESSAGE}`, 'utf8'),
    ];
    const pubKeyBytes = new Uint8Array(senderPubkey.toBytes());
    const sigBytes = new Uint8Array(sessionSig);
    try {
      for (const msg of messages) {
        const msgArr = new Uint8Array(msg);
        if (nacl.sign.detached.verify(msgArr, sigBytes, pubKeyBytes)) return true;
      }
      // Node supports raw Ed25519; @types/node may not include 'raw' in KeyFormat
      const key = createPublicKey(
        { key: Buffer.from(senderPubkey.toBytes()), format: 'raw', type: 'ed25519' } as unknown as Parameters<
          typeof createPublicKey
        >[0],
      );
      for (const msg of messages) {
        if (verify(null, msg, key, sessionSig)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Prepare private payment using flow from privacy-hack (claimFlowPh).
   * Persists state in send_payment_links via claimAdapter.
   * When skipSignatureVerification is true (e.g. sender verified via Privy linked accounts), we still use the
   * provided signature bytes for encryption/key derivation but do not verify them against the message.
   */
  async preparePrivate(
    linkId: string,
    senderPublicKey: string,
    sessionSignatureBase64: string,
    amount: number,
    message?: string | null,
    options?: {
      skipSignatureVerification?: boolean;
      sponsorPublicKey?: string | null;
      /** When true, skip user SOL check (frontend sends tx, e.g. Privy sponsors). */
      skipUserSolCheck?: boolean;
      /** Use link's existing burner (single burner = same as deposit address). */
      existingBurnerSecretKey?: Uint8Array;
    },
  ): Promise<{
    unsignedDepositTx: string;
    lastValidBlockHeight: number;
    activityId: string;
    passphrase: string;
    feeUsdc: number;
    totalDepositUsdc: number;
    unsignedSolTx?: string;
  }> {
    this.logger.log(`[Vault] preparePrivate START linkId=${linkId} amount=${amount} USDC sender=${senderPublicKey.slice(0, 8)}...`);
    const sessionSig = this.decodeSessionSignature(sessionSignatureBase64);
    if (!options?.skipSignatureVerification && !this.verifySessionSignature(senderPublicKey, sessionSignatureBase64)) {
      throw new Error('Invalid session signature for sender address');
    }
    const conn = this.getConnection();
    const supabase = this.supabaseService.getClient();
    const sponsorPubkey = options?.sponsorPublicKey?.trim()
      ? new PublicKey(options.sponsorPublicKey)
      : null;

    try {
      const result = await prepareClaimForLink(supabase, linkId, {
        connection: conn,
        senderPublicKey: new PublicKey(senderPublicKey),
        sessionSignature: new Uint8Array(sessionSig),
        amount,
        token: 'USDC',
        message,
        sponsorPublicKey: sponsorPubkey,
        skipUserSolCheck: options?.skipUserSolCheck,
        existingBurnerSecretKey: options?.existingBurnerSecretKey,
      });
      this.logger.log(`[Vault] preparePrivate DONE linkId=${linkId} amount=${amount} USDC burner=${result.burnerAddress?.slice(0, 8)}...`);
      return {
        unsignedDepositTx: result.unsignedDepositTx,
        lastValidBlockHeight: result.lastValidBlockHeight,
        activityId: result.activityId,
        passphrase: result.passphrase,
        feeUsdc: result.feeUsdc,
        totalDepositUsdc: result.totalDepositUsdc,
        unsignedSolTx: result.unsignedSolTx,
      };
    } catch (e: any) {
      this.logger.warn(`[Vault] prepareClaimForLink failed linkId=${linkId}`, e?.message);
      throw new Error(
        e?.message ?? 'Private payments need privacycash and @lightprotocol/hasher.rs in the backend.',
      );
    }
  }

  /**
   * Submit signed deposit using flow from privacy-hack (claimFlowPh).
   * skipSignatureVerification: when true, sender was already verified via Privy linked accounts.
   */
  async submitPrivate(
    linkId: string,
    senderPublicKey: string,
    sessionSignatureBase64: string,
    signedDepositTxBase64: string,
    lastValidBlockHeight: number | undefined,
    _linkState: PrivateClaimLinkState,
    amount: number,
    options?: { skipSignatureVerification?: boolean; signedSolTx?: string },
  ): Promise<{ depositTxSignature: string; withdrawTxSignature: string }> {
    this.logger.log(`[Vault] submitPrivate START linkId=${linkId} amount=${amount} USDC`);
    const sessionSig = this.decodeSessionSignature(sessionSignatureBase64);
    if (!options?.skipSignatureVerification && !this.verifySessionSignature(senderPublicKey, sessionSignatureBase64)) {
      throw new Error('Invalid session signature for sender address');
    }
    const conn = this.getConnection();
    const supabase = this.supabaseService.getClient();

    const result = await submitClaimForLink(supabase, {
      connection: conn,
      signedDepositTx: signedDepositTxBase64,
      sessionSignature: new Uint8Array(sessionSig),
      activityId: linkId,
      senderPublicKey: new PublicKey(senderPublicKey),
      lastValidBlockHeight,
      signedSolTx: options?.signedSolTx,
    });
    this.logger.log(`[Vault] submitPrivate DONE linkId=${linkId} amount=${amount} USDC depositSig=${result.depositTx?.slice(0, 16)}... withdrawTx=${result.withdrawTx?.slice(0, 16)}...`);
    return {
      depositTxSignature: result.depositTx,
      withdrawTxSignature: result.withdrawTx,
    };
  }

  /**
   * Complete private claim when the deposit tx was already sent from the frontend.
   * Uses existingDepositSignature so no relay is performed.
   */
  async completePrivateWithSignature(
    linkId: string,
    senderPublicKey: string,
    sessionSignatureBase64: string,
    depositTxSignature: string,
    lastValidBlockHeight: number | undefined,
    _linkState: PrivateClaimLinkState,
    amount: number,
    options?: { skipSignatureVerification?: boolean },
  ): Promise<{ depositTxSignature: string; withdrawTxSignature: string }> {
    this.logger.log(`[Vault] completePrivateWithSignature START linkId=${linkId} amount=${amount} USDC existingDepositSig=${depositTxSignature?.slice(0, 16)}...`);
    const sessionSig = this.decodeSessionSignature(sessionSignatureBase64);
    if (!options?.skipSignatureVerification && !this.verifySessionSignature(senderPublicKey, sessionSignatureBase64)) {
      throw new Error('Invalid session signature for sender address');
    }
    const conn = this.getConnection();
    const supabase = this.supabaseService.getClient();

    const result = await submitClaimForLink(supabase, {
      connection: conn,
      sessionSignature: new Uint8Array(sessionSig),
      activityId: linkId,
      senderPublicKey: new PublicKey(senderPublicKey),
      lastValidBlockHeight,
      existingDepositSignature: depositTxSignature,
    });
    this.logger.log(`[Vault] completePrivateWithSignature DONE linkId=${linkId} amount=${amount} USDC withdrawTx=${result.withdrawTx?.slice(0, 16)}...`);
    return {
      depositTxSignature: result.depositTx,
      withdrawTxSignature: result.withdrawTx,
    };
  }

  private getConnection(): Connection {
    if (!this.connection) {
      throw new Error('Solana RPC not configured (SOLANA_RPC_URL or HELIUS_API_KEY)');
    }
    return this.connection;
  }
}
