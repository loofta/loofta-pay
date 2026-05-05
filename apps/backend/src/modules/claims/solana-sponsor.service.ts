import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  Keypair,
  VersionedTransaction,
  Transaction,
  TransactionMessage,
  AddressLookupTableAccount,
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
    const rpcUrl = this.resolveSolanaRpcUrl();
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.logger.log(`SolanaSponsor: using RPC ${rpcUrl}`);

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

  /**
   * Poll until this connection sees the signature (same RPC we broadcast on).
   * Logs periodically when status is still null (helps debug "stuck" sponsor calls).
   */
  private async waitUntilSignatureVisible(
    signature: string,
    timeoutMs = 90_000,
    pollMs = 400,
    label = 'sponsor',
    conn?: Connection,
  ): Promise<void> {
    const pollConn = conn ?? this.connection;
    const start = Date.now();
    let lastProgressLog = 0;
    const rpcEndpoint = pollConn.rpcEndpoint;
    while (Date.now() - start < timeoutMs) {
      const { value } = await pollConn.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const st = value[0];
      const elapsed = Date.now() - start;
      if (st?.err) {
        throw new Error(`Sponsored transaction failed on-chain: ${JSON.stringify(st.err)}`);
      }
      if (
        st?.confirmationStatus === 'processed' ||
        st?.confirmationStatus === 'confirmed' ||
        st?.confirmationStatus === 'finalized'
      ) {
        this.logger.log(
          `SolanaSponsor[${label}]: signature ${signature.slice(0, 12)}... visible (${st.confirmationStatus}) after ${elapsed}ms rpc=${rpcEndpoint}`,
        );
        return;
      }
      if (elapsed - lastProgressLog >= 5000) {
        lastProgressLog = elapsed;
        const statusHint =
          st === null || st === undefined
            ? 'getSignatureStatuses[0] is null (tx not indexed on this RPC yet)'
            : `status=${JSON.stringify(st)}`;
        this.logger.warn(
          `SolanaSponsor[${label}]: still waiting ${elapsed}ms — ${statusHint} sig=${signature.slice(0, 12)}... rpc=${rpcEndpoint}`,
        );
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      `Sponsored transaction not observed on RPC within ${timeoutMs}ms (signature ${signature}). Check SOLANA_RPC_URL matches the app cluster.`,
    );
  }

  private resolveSolanaRpcUrl(): string {
    const isDevnet = isSolanaDevnetFromConfig(this.config) || (() => {
      const cluster =
        this.config.get<string>('SOLANA_CLUSTER')?.trim() ||
        process.env.SOLANA_CLUSTER?.trim() ||
        getEnvFromFile('SOLANA_CLUSTER')?.trim() ||
        this.config.get<string>('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim() ||
        process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() ||
        getEnvFromFile('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim();
      return cluster === 'devnet' || cluster === 'testnet';
    })();

    const helius = this.config.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY;

    if (isDevnet) {
      const devnetRpc =
        this.config.get<string>('SOLANA_DEVNET_RPC_URL') ??
        process.env.SOLANA_DEVNET_RPC_URL ??
        getEnvFromFile('SOLANA_DEVNET_RPC_URL');
      if (devnetRpc?.trim()) return devnetRpc.trim();
      if (helius) return `https://devnet.helius-rpc.com/?api-key=${helius}`;
      return 'https://api.devnet.solana.com';
    }

    // Mainnet: Helius key > explicit RPC > public fallback
    if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
    const mainnetRpc =
      this.config.get<string>('SOLANA_RPC_URL') ??
      process.env.SOLANA_RPC_URL ??
      getEnvFromFile('SOLANA_RPC_URL');
    if (mainnetRpc?.trim()) return mainnetRpc.trim();
    return 'https://api.mainnet-beta.solana.com';
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
   * Rebuild transaction server-side with sponsor fee payer + fresh blockhash.
   * Keeps instructions unchanged so the user can sign client-side afterwards.
   */
  async prepareSponsoredTransaction(serializedTransactionBase64: string): Promise<{ transaction: string }> {
    if (!this.feePayerKeypair || !this.feePayerAddress) {
      throw new Error('Solana fee sponsorship is not configured');
    }

    const t0 = Date.now();
    const feePayerPk = this.feePayerKeypair.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const txBuffer = Buffer.from(serializedTransactionBase64, 'base64');

    // Try legacy first so legacy-in remains legacy-out (PER Anchor flows expect Transaction).
    try {
      const legacy = Transaction.from(txBuffer);
      legacy.recentBlockhash = blockhash;
      legacy.feePayer = feePayerPk;
      const serialized = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
      this.logger.log(
        `SolanaSponsor[prepare]: legacy tx ${serialized.length}b blockhash=${blockhash.slice(0, 8)}... ${Date.now() - t0}ms rpc=${this.connection.rpcEndpoint}`,
      );
      return { transaction: Buffer.from(serialized).toString('base64') };
    } catch {
      // Fall through to Versioned parsing.
    }

    // Versioned in -> versioned out.
    try {
      const originalV0 = VersionedTransaction.deserialize(txBuffer);
      const originalMsg = TransactionMessage.decompile(originalV0.message);
      const rebuilt = new TransactionMessage({
        payerKey: feePayerPk,
        recentBlockhash: blockhash,
        instructions: originalMsg.instructions,
      }).compileToV0Message();
      const out = new VersionedTransaction(rebuilt);
      const ser = out.serialize();
      this.logger.log(
        `SolanaSponsor[prepare]: legacy parse failed; v0 tx ${ser.length}b blockhash=${blockhash.slice(0, 8)}... ${Date.now() - t0}ms rpc=${this.connection.rpcEndpoint}`,
      );
      return { transaction: Buffer.from(ser).toString('base64') };
    } catch {
      // Fall through to legacy parsing.
    }

    throw new Error('Unsupported or invalid transaction format');
  }

  /**
   * Set our fee payer on the MagicBlock PER transaction, refresh the blockhash, and return the
   * prepared transaction WITHOUT signing. The user wallet signs next via Privy, then the frontend
   * calls signAndBroadcastPER so the fee payer countersigns with the same blockhash the user used.
   *
   * Partial-signing upfront is intentionally avoided: Privy's signTransaction internally calls
   * prepareTransaction which replaces the blockhash, invalidating any existing partial signatures.
   */
  async prepareAndPartialSignTransaction(serializedBase64: string, conn?: Connection): Promise<{
    transactionBase64: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
  }> {
    if (!this.feePayerKeypair) {
      throw new Error('Fee payer not configured for sponsoring');
    }
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    const resolveConn = conn ?? this.connection;
    const { blockhash, lastValidBlockHeight } = await resolveConn.getLatestBlockhash('confirmed');
    const feePayerPk = this.feePayerKeypair.publicKey;

    // Try legacy first — MagicBlock PER private transfer uses legacy transactions
    try {
      const legacy = Transaction.from(txBuffer);
      const originalFeePayer = legacy.feePayer?.toBase58() ?? 'none';
      const originalSignerCount = legacy.signatures.length;
      this.logger.log(
        `SolanaSponsor[prepareAndPartialSign]: overriding feePayer ${originalFeePayer.slice(0, 8)}... → ${feePayerPk.toBase58().slice(0, 8)}... signers=${originalSignerCount} rpc=${this.connection.rpcEndpoint}`,
      );
      legacy.recentBlockhash = blockhash;
      legacy.feePayer = feePayerPk;
      const serialized = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
      this.logger.log(
        `SolanaSponsor[prepareAndPartialSign]: legacy tx ${serialized.length}b feePayer=${feePayerPk.toBase58().slice(0, 8)}... blockhash=${blockhash.slice(0, 8)}... (unsigned, countersign after user)`,
      );
      return {
        transactionBase64: Buffer.from(serialized).toString('base64'),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    } catch {
      // fall through to versioned
    }

    // v0 transaction with LUTs (MagicBlock now uses Address Lookup Tables).
    // MagicBlock builds the tx with the sender as fee payer — we must rebuild it with
    // our sponsor as fee payer. That requires resolving the LUT accounts from chain first.
    const originalV0 = VersionedTransaction.deserialize(txBuffer);
    const vMsg = originalV0.message;
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const lookup of vMsg.addressTableLookups) {
      const result = await resolveConn.getAddressLookupTable(lookup.accountKey);
      if (result.value) altAccounts.push(result.value);
    }
    this.logger.log(
      `SolanaSponsor[prepareAndPartialSign]: v0 tx | ALTs=${vMsg.addressTableLookups.length} resolved=${altAccounts.length} sender=${vMsg.staticAccountKeys[0]?.toBase58().slice(0, 8)}... newFeePayer=${feePayerPk.toBase58().slice(0, 8)}...`,
    );
    const decompiledMsg = TransactionMessage.decompile(vMsg, { addressLookupTableAccounts: altAccounts });

    // The MagicBlock program does a CPI SystemProgram.transfer FROM the sender's wallet to
    // create the ephemeral shuttle account (~2039280 lamports rent). On mainnet an additional
    // 0.002 SOL flat fee is also charged from the sender. We prepend a top-up from our fee payer
    // so the sender can cover both. 5_000_000 = 0.005 SOL covers rent + mainnet fee + buffer.
    const senderPk = vMsg.staticAccountKeys[0];
    const SHUTTLE_TOPUP_LAMPORTS = 5_000_000;
    const senderBalance = await resolveConn.getBalance(senderPk);
    const prefundIxs: ReturnType<typeof SystemProgram.transfer>[] = [];
    if (senderBalance < SHUTTLE_TOPUP_LAMPORTS) {
      const topUp = SHUTTLE_TOPUP_LAMPORTS - senderBalance;
      prefundIxs.push(
        SystemProgram.transfer({ fromPubkey: feePayerPk, toPubkey: senderPk, lamports: topUp }),
      );
      this.logger.log(
        `SolanaSponsor[prepareAndPartialSign]: sender has ${senderBalance} lamports — prepending +${topUp} lamports shuttle top-up`,
      );
    }

    // Rebuild as legacy (not v0) — ALTs are fully resolved above so all accounts can be inlined
    // as static keys. Legacy txs have no ALT references, so Privy's embedded wallet can sign
    // without calling prepareTransaction to look up tables on-chain.
    const legacyMsg = new TransactionMessage({
      payerKey: feePayerPk,
      recentBlockhash: blockhash,
      instructions: [...prefundIxs, ...decompiledMsg.instructions],
    }).compileToLegacyMessage();
    const legacyTx = Transaction.populate(legacyMsg);
    const ser = legacyTx.serialize({ requireAllSignatures: false, verifySignatures: false });
    this.logger.log(
      `SolanaSponsor[prepareAndPartialSign]: v0→legacy rebuilt | ${ser.length}b prefunded=${prefundIxs.length > 0} blockhash=${blockhash.slice(0, 8)}... (unsigned, countersign after user)`,
    );
    return {
      transactionBase64: Buffer.from(ser).toString('base64'),
      recentBlockhash: blockhash,
      lastValidBlockHeight,
    };
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
    const reqStart = Date.now();
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast]: incoming bytes=${transactionBuffer.length} rpc=${this.connection.rpcEndpoint}`,
    );

    let legacy: Transaction | null = null;
    try {
      legacy = Transaction.from(transactionBuffer);
    } catch {
      legacy = null;
    }

    // PER flow should stay legacy; try legacy path first.
    if (legacy) {
      if (!legacy.feePayer || legacy.feePayer.toBase58() !== this.feePayerAddress) {
        throw new Error('Invalid fee payer in transaction');
      }
      for (const ix of legacy.instructions) {
        if (ix.programId.equals(SystemProgram.programId) && ix.data.length > 0 && ix.data[0] === 2) {
          const sender = ix.keys[0]?.pubkey;
          if (sender?.toBase58() === this.feePayerAddress) {
            throw new Error('Transaction attempts to transfer SOL from fee payer');
          }
        }
      }
      legacy.partialSign(this.feePayerKeypair);
      const missingLegacySigners = legacy.signatures
        .filter((s) => !s.signature)
        .map((s) => s.publicKey.toBase58());
      if (missingLegacySigners.length > 0) {
        throw new Error(
          `Missing required signatures (legacy): ${missingLegacySigners.join(', ')}`,
        );
      }
      if (!legacy.verifySignatures()) {
        const signerState = legacy.signatures.map((s) => ({
          signer: s.publicKey.toBase58(),
          signed: Boolean(s.signature),
        }));
        throw new Error(
          `Legacy transaction signature verification failed before broadcast: ${JSON.stringify(signerState)}`,
        );
      }
      const sendT0 = Date.now();
      const sig = await this.connection.sendRawTransaction(
        legacy.serialize({ requireAllSignatures: false, verifySignatures: false }),
        {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: 'confirmed',
        },
      );
      this.logger.log(
        `SolanaSponsor[sign-and-broadcast]: legacy sendRawTransaction done in ${Date.now() - sendT0}ms sig=${sig.slice(0, 12)}...`,
      );
      await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast:legacy').catch((e) => {
        this.logger.warn(
          `SolanaSponsor: signature ${sig.slice(0, 12)}... not yet visible after short wait (${String(
            (e as Error)?.message ?? e,
          )}). Returning signature immediately.`,
        );
      });
      this.logger.log(`SolanaSponsor[sign-and-broadcast]: legacy total ${Date.now() - reqStart}ms`);
      return { signature: sig };
    }

    // Fallback for non-PER flows that are truly versioned.
    const versioned = VersionedTransaction.deserialize(transactionBuffer);
    const message = versioned.message;
    const accountKeys = message.getAccountKeys().staticAccountKeys;

    const feePayerInTx = accountKeys[0];
    if (!feePayerInTx || feePayerInTx.toBase58() !== this.feePayerAddress) {
      throw new Error('Invalid fee payer in transaction');
    }
    const systemProgramId = SystemProgram.programId.toBase58();
    for (const ix of message.compiledInstructions) {
      const programId = accountKeys[ix.programIdIndex];
      if (programId?.toBase58() === systemProgramId && ix.data[0] === 2) {
        const senderIndex = ix.accountKeyIndexes[0];
        const sender = accountKeys[senderIndex];
        if (sender?.toBase58() === this.feePayerAddress) {
          throw new Error('Transaction attempts to transfer SOL from fee payer');
        }
      }
    }
    versioned.sign([this.feePayerKeypair]);
    const missingV0Signers = versioned.signatures
      .map((sigBytes, idx) => ({ idx, hasSig: sigBytes.some((b) => b !== 0) }))
      .filter((x) => !x.hasSig)
      .map((x) => accountKeys[x.idx]?.toBase58?.() || `signer_index_${x.idx}`);
    if (missingV0Signers.length > 0) {
      throw new Error(`Missing required signatures (v0): ${missingV0Signers.join(', ')}`);
    }
    // VersionedTransaction does not expose verifySignatures() in @solana/web3.js v1.95+.
    // The missing-signer check above is sufficient; skip redundant call to avoid TS error.
    const sendT0 = Date.now();
    const sig = await this.connection.sendRawTransaction(versioned.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast]: v0 sendRawTransaction done in ${Date.now() - sendT0}ms sig=${sig.slice(0, 12)}...`,
    );
    await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast:v0').catch((e) => {
      this.logger.warn(
        `SolanaSponsor: signature ${sig.slice(0, 12)}... not yet visible after short wait (${String(
          (e as Error)?.message ?? e,
        )}). Returning signature immediately.`,
      );
    });
    this.logger.log(`SolanaSponsor[sign-and-broadcast]: v0 total ${Date.now() - reqStart}ms`);
    return { signature: sig };
  }

  /**
   * Mainnet path: resolve ALTs and convert a v0 MagicBlock transaction to legacy format so
   * Privy's embedded wallet can sign it without calling prepareTransaction to look up tables.
   * Does NOT inject our fee payer — Privy's gas sponsorship covers the tx fee on mainnet.
   */
  async convertV0ToLegacy(serializedBase64: string, conn?: Connection): Promise<{ transactionBase64: string }> {
    const txBuffer = Buffer.from(serializedBase64, 'base64');
    // Already legacy — nothing to do.
    try {
      Transaction.from(txBuffer);
      return { transactionBase64: serializedBase64 };
    } catch {
      // fall through to v0 handling
    }
    const resolveConn = conn ?? this.connection;
    const v0 = VersionedTransaction.deserialize(txBuffer);
    const vMsg = v0.message;
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const lookup of vMsg.addressTableLookups) {
      const result = await resolveConn.getAddressLookupTable(lookup.accountKey);
      if (result.value) altAccounts.push(result.value);
    }
    this.logger.log(
      `SolanaSponsor[convertV0ToLegacy]: resolved ALTs=${altAccounts.length}/${vMsg.addressTableLookups.length}`,
    );
    const decompiledMsg = TransactionMessage.decompile(vMsg, { addressLookupTableAccounts: altAccounts });
    const legacyMsg = new TransactionMessage({
      payerKey: vMsg.staticAccountKeys[0],
      recentBlockhash: decompiledMsg.recentBlockhash,
      instructions: decompiledMsg.instructions,
    }).compileToLegacyMessage();
    const legacyTx = Transaction.populate(legacyMsg);
    const ser = legacyTx.serialize({ requireAllSignatures: false, verifySignatures: false });
    this.logger.log(`SolanaSponsor[convertV0ToLegacy]: v0→legacy ${ser.length}b`);
    return { transactionBase64: Buffer.from(ser).toString('base64') };
  }

  /**
   * Countersign a user-signed MagicBlock PER transaction with our fee payer and broadcast.
   *
   * Unlike signAndBroadcast, this allows SystemProgram.transfer FROM the fee payer (needed for
   * the shuttle SOL top-up prepended by prepareAndPartialSignTransaction). The total SOL the
   * fee payer can transfer is capped at 5_000_000 lamports (0.005 SOL) to prevent abuse.
   */
  async signAndBroadcastPER(userSignedTxBase64: string, conn?: Connection): Promise<{ signature: string }> {
    if (!this.feePayerKeypair || !this.feePayerAddress) {
      throw new Error('Solana fee sponsorship is not configured');
    }

    const broadcastConn = conn ?? this.connection;
    const transactionBuffer = Buffer.from(userSignedTxBase64, 'base64');
    const reqStart = Date.now();
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast-per]: incoming bytes=${transactionBuffer.length} rpc=${broadcastConn.rpcEndpoint}`,
    );

    const legacy = Transaction.from(transactionBuffer);
    if (!legacy.feePayer || legacy.feePayer.toBase58() !== this.feePayerAddress) {
      throw new Error('Invalid fee payer in PER transaction');
    }

    // Allow SOL transfers from fee payer only up to the shuttle top-up cap (0.005 SOL).
    const MAX_TOPUP_LAMPORTS = 5_000_000;
    let totalFeePayerLamports = 0;
    for (const ix of legacy.instructions) {
      if (ix.programId.equals(SystemProgram.programId) && ix.data.length >= 12 && ix.data.readUInt32LE(0) === 2) {
        const sender = ix.keys[0]?.pubkey;
        if (sender?.toBase58() === this.feePayerAddress) {
          const lamports = Number(ix.data.readBigUInt64LE(4));
          totalFeePayerLamports += lamports;
          if (totalFeePayerLamports > MAX_TOPUP_LAMPORTS) {
            throw new Error(`PER transaction attempts to transfer too much SOL from fee payer (${totalFeePayerLamports} lamports)`);
          }
        }
      }
    }

    legacy.partialSign(this.feePayerKeypair);

    if (!legacy.verifySignatures()) {
      const signerState = legacy.signatures.map((s) => ({
        signer: s.publicKey.toBase58().slice(0, 8) + '...',
        signed: Boolean(s.signature),
      }));
      throw new Error(`PER transaction signature verification failed: ${JSON.stringify(signerState)}`);
    }

    const sendT0 = Date.now();
    const sig = await broadcastConn.sendRawTransaction(
      legacy.serialize({ requireAllSignatures: false, verifySignatures: false }),
      { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' },
    );
    this.logger.log(
      `SolanaSponsor[sign-and-broadcast-per]: sendRawTransaction done in ${Date.now() - sendT0}ms sig=${sig.slice(0, 12)}...`,
    );
    await this.waitUntilSignatureVisible(sig, 12_000, 400, 'sign-and-broadcast-per', broadcastConn).catch((e) => {
      this.logger.warn(
        `SolanaSponsor: PER sig ${sig.slice(0, 12)}... not yet visible after short wait (${String((e as Error)?.message ?? e)}). Returning immediately.`,
      );
    });
    this.logger.log(`SolanaSponsor[sign-and-broadcast-per]: total ${Date.now() - reqStart}ms`);
    return { signature: sig };
  }
}
