import { Injectable } from '@nestjs/common';
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
  const tryPaths = [
    join(process.cwd(), 'apps', 'backend', '.env.local'),
    join(process.cwd(), '.env.local'),
    join(__dirname, '..', '..', '..', '.env.local'),
    join(__dirname, '..', '..', '.env.local'),
  ];
  for (const p of tryPaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8');
        const regex = new RegExp(`${varName}\\s*=\\s*(["']?)([^\\s#'"]+)\\1`);
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
 * Service to sponsor Solana transaction fees for "Pay with Loofta" (embedded wallet with 0 SOL).
 * Uses a dedicated fee-payer keypair; the client builds the transaction with this account as
 * payerKey, user signs, then we add the fee-payer signature and broadcast with skipPreflight.
 * See: https://docs.privy.io/wallets/gas-and-asset-management/gas/solana
 */
@Injectable()
export class SolanaSponsorService {
  private readonly feePayerKeypair: Keypair | null = null;
  private readonly connection: Connection;
  public readonly feePayerAddress: string | null = null;

  constructor(private readonly config: ConfigService) {
    let privateKeyBase58 =
      this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY') ?? process.env.SOLANA_FEE_PAYER_PRIVATE_KEY ?? null;
    if (!privateKeyBase58) {
      privateKeyBase58 = getEnvFromFile('SOLANA_FEE_PAYER_PRIVATE_KEY');
    }
    const rpcUrl =
      this.config.get<string>('SOLANA_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');

    this.connection = new Connection(rpcUrl, 'confirmed');

    if (privateKeyBase58) {
      try {
        const decoded = bs58.decode(privateKeyBase58);
        const secret = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
        this.feePayerKeypair = Keypair.fromSecretKey(secret);
        this.feePayerAddress = this.feePayerKeypair.publicKey.toBase58();
      } catch (e) {
        console.error('[SolanaSponsor] Invalid SOLANA_FEE_PAYER_PRIVATE_KEY:', e);
      }
    } else {
      console.warn('[SolanaSponsor] SOLANA_FEE_PAYER_PRIVATE_KEY not set; sponsorship disabled.');
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
