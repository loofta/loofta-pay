import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  Keypair,
  VersionedTransaction,
  Connection,
  SystemProgram,
} from '@solana/web3.js';
// bs58 may export default depending on bundler/runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

/** Read env var from .env.local on disk when ConfigService doesn't have it (e.g. run from monorepo root). */
function getEnvFromFile(varName: string): string | null {
  // Match ConfigModule envFilePath: backend root .env.local (same as SendPaymentService key source)
  const tryPaths = [
    join(process.cwd(), 'apps', 'backend', '.env.local'),
    join(process.cwd(), '.env.local'),
    join(__dirname, '..', '..', '..', '.env.local'), // backend root from src/modules/claims or dist
    join(__dirname, '..', '..', '..', '..', '.env.local'),
    join(__dirname, '..', '..', '.env.local'),
  ];
  for (const p of tryPaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        const lineByLine = content.split(/\r?\n/);
        for (const line of lineByLine) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim().replace(/^\uFEFF/, '');
          if (key === varName) {
            const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
            if (value) return value;
          }
        }
        const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escaped}\\s*=\\s*(["']?)([^\\s#'"]+)\\1`);
        const match = content.match(regex);
        if (match?.[2]) return match[2].trim();
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Service to sponsor Solana transaction fees (claim reclaim sweep, send-payment, etc.).
 * SOLANA_FEE_PAYER_PRIVATE_KEY = Solana wallet keypair (base58) that pays tx fees; this wallet must hold SOL.
 * Not the same as SEND_PAYMENT_ENC_KEY (which is an AES key for encrypting burner secrets in the DB).
 */
@Injectable()
export class SolanaSponsorService {
  private readonly logger = new Logger(SolanaSponsorService.name);
  private readonly feePayerKeypair: Keypair | null = null;
  private readonly connection: Connection;
  public readonly feePayerAddress: string | null = null;

  constructor(private readonly config: ConfigService) {
    // Load same way as SendPaymentService so ClaimsService sponsor is available when key is set
    let privateKeyBase58: string | null =
      this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY') ?? process.env.SOLANA_FEE_PAYER_PRIVATE_KEY ?? null;
    if (privateKeyBase58 && typeof privateKeyBase58 === 'string') privateKeyBase58 = privateKeyBase58.trim() || null;
    let source = privateKeyBase58 ? 'config/env' : '';
    if (!privateKeyBase58) {
      privateKeyBase58 = getEnvFromFile('SOLANA_FEE_PAYER_PRIVATE_KEY');
      source = privateKeyBase58 ? 'file' : '';
    }
    if (privateKeyBase58 && typeof privateKeyBase58 === 'string') {
      privateKeyBase58 = privateKeyBase58.trim().replace(/^["']|["']$/g, '') || null;
    }
    const rpcUrl =
      this.config.get<string>('SOLANA_RPC_URL') ??
      process.env.SOLANA_RPC_URL ??
      (this.config.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${this.config.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY}`
        : 'https://api.mainnet-beta.solana.com');

    this.connection = new Connection(rpcUrl, 'confirmed');

    if (privateKeyBase58) {
      try {
        const decoded = bs58.decode(privateKeyBase58);
        const secret = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
        this.feePayerKeypair = Keypair.fromSecretKey(secret);
        this.feePayerAddress = this.feePayerKeypair.publicKey.toBase58();
        this.logger.log(`SolanaSponsor: SOLANA_FEE_PAYER_PRIVATE_KEY loaded (${source || 'config/env'}); fee payer ${this.feePayerAddress.slice(0, 8)}...`);
      } catch (e) {
        this.logger.error('SolanaSponsor: Invalid SOLANA_FEE_PAYER_PRIVATE_KEY (bad base58 or length)', e);
      }
    } else {
      const fromConfig = !!this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
      const fromEnv = !!process.env.SOLANA_FEE_PAYER_PRIVATE_KEY;
      const fromFile = !!getEnvFromFile('SOLANA_FEE_PAYER_PRIVATE_KEY');
      this.logger.warn(
        `SolanaSponsor: SOLANA_FEE_PAYER_PRIVATE_KEY not loaded. config=${fromConfig} process.env=${fromEnv} file=${fromFile} cwd=${process.cwd()}. Add to apps/backend/.env.local (base58 Solana key, wallet needs SOL).`,
      );
    }
  }

  isAvailable(): boolean {
    return this.feePayerKeypair !== null && this.feePayerAddress !== null;
  }

  getConnection(): Connection {
    return this.connection;
  }

  getFeePayerKeypair(): Keypair | null {
    return this.feePayerKeypair;
  }

  getFeePayerAddress(): string | null {
    return this.feePayerAddress;
  }

  /**
   * Validate that the transaction uses our fee payer and does not transfer SOL from the fee payer.
   * Then sign with fee payer and broadcast with skipPreflight.
   */
  async signAndBroadcast(serializedTransactionBase64: string): Promise<{ signature: string }> {
    if (!this.feePayerKeypair || !this.feePayerAddress) {
      throw new Error('Solana fee sponsorship is not configured');
    }

    const transactionBuffer = Buffer.from(serializedTransactionBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    const message = transaction.message;
    const accountKeys = message.getAccountKeys().staticAccountKeys;

    // Fee payer is the first account (payerKey in TransactionMessage).
    const feePayerInTx = accountKeys[0];
    if (!feePayerInTx || feePayerInTx.toBase58() !== this.feePayerAddress) {
      throw new Error('Invalid fee payer in transaction');
    }

    // Security: reject if any instruction transfers SOL from the fee payer (SystemProgram.transfer from fee payer).
    const systemProgramId = SystemProgram.programId.toBase58();
    for (const ix of message.compiledInstructions) {
      const programId = accountKeys[ix.programIdIndex];
      if (programId?.toBase58() === systemProgramId && ix.data[0] === 2) {
        // Transfer instruction; account at index 0 is the sender
        const senderIndex = ix.accountKeyIndexes[0];
        const sender = accountKeys[senderIndex];
        if (sender?.toBase58() === this.feePayerAddress) {
          throw new Error('Transaction attempts to transfer SOL from fee payer');
        }
      }
    }

    transaction.sign([this.feePayerKeypair]);
    const sig = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
      preflightCommitment: 'processed',
    });

    return { signature: sig };
  }
}
