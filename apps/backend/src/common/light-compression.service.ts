import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  Rpc,
  bn,
  createRpc,
  selectStateTreeInfo,
  stateTreeLookupTableDevnet,
  stateTreeLookupTableMainnet,
} from '@lightprotocol/stateless.js';
import {
  CompressedTokenProgram,
  getTokenPoolInfos,
  selectMinCompressedTokenAccountsForTransfer,
  selectTokenPoolInfo,
  selectTokenPoolInfosForDecompression,
} from '@lightprotocol/compressed-token';

/**
 * Partner payouts hold their money as Light Protocol compressed USDC instead of in a token account per
 * burner: no rent, no token account, the burner is just a key. See docs/proposals/PARTNER_COMPRESSED_PAYOUTS.md.
 *
 * Devnet spike (2026-11-23): one transaction with 15 recipients fits (1209 of 1232 bytes), 25 does not.
 */
export const COMPRESS_PER_INSTRUCTION = 5;
export const COMPRESS_PER_TX = 15;

export type Cluster = 'mainnet' | 'devnet';

/**
 * Why a compress transaction did not go through, and whether it is SAFE to try those payouts again in a smaller group.
 * `definite`: it can never land (it was never sent, was refused before it was broadcast, failed on chain, or its blockhash
 * expired), so the payouts can be re-sent. Not definite: it might still land, so nothing may be re-sent until the chain says.
 */
export class CompressError extends Error {
  constructor(message: string, readonly definite: boolean, readonly signature?: string) {
    super(message);
    this.name = 'CompressError';
  }
}

/** Errors the network gives back for a transaction it refused to accept at all (too big, too much compute): it was not broadcast. */
const REFUSED_BEFORE_BROADCAST = /simulation failed|too large|encoding overruns|exceeded|exceeds|invalid transaction/i;

/**
 * Light's lookup tables for the state-tree accounts. There are two generations. The SDK exports one per network, but it
 * does not cover every tree we get back: with only that one a 15-payout transaction does not fit (found on devnet,
 * 2026-11-23). The other generation is listed in Light's docs. A transaction only carries the tables it actually uses,
 * so passing both costs nothing.
 */
const EXTRA_LOOKUP_TABLE: Record<Cluster, string> = {
  devnet: 'qAJZMgnQJ8G6vA3WRcjD9Jan1wtKkaCFWLWskxJrR5V',
  mainnet: '9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ',
};
export type CompressTarget = { burner: string; baseUnits: number };

/** Splits recipients into transaction-sized groups. Order is kept. */
export function chunkTargets<T>(items: T[], size = COMPRESS_PER_TX): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The "compress" instruction takes up to 5 recipients; a transaction carries up to 15, so up to 3 instructions. */
export function instructionGroups<T>(chunk: T[]): T[][] {
  return chunkTargets(chunk, COMPRESS_PER_INSTRUCTION);
}

/**
 * Whether NEW payout proposals for this partner use compressed funding. PARTNER_COMPRESSED_PAYOUTS is empty (off, the
 * default), "true" (every partner), or a comma-separated list of partner ids (only those). Payouts already funded this
 * way keep working whatever this says: they carry their own flag.
 */
export function compressedPayoutsEnabledFor(config: ConfigService, partnerId: string): boolean {
  const v = (config.get<string>('PARTNER_COMPRESSED_PAYOUTS') ?? '').trim();
  if (!v) return false;
  if (v === 'true') return true;
  return v.split(',').map((x) => x.trim()).filter(Boolean).includes(partnerId);
}

@Injectable()
export class LightCompressionService {
  private readonly logger = new Logger(LightCompressionService.name);
  private readonly rpcs = new Map<Cluster, Rpc>();
  private readonly tableCache = new Map<Cluster, AddressLookupTableAccount[]>();

  constructor(private readonly config: ConfigService) {}

  /** One Light-aware connection per cluster. Needs HELIUS_API_KEY: validity proofs come from the Helius indexer. */
  rpc(cluster: Cluster): Rpc {
    const cached = this.rpcs.get(cluster);
    if (cached) return cached;
    const key = this.config.get<string>('HELIUS_API_KEY')?.trim();
    if (!key) throw new ServiceUnavailableException('Payouts are temporarily unavailable. Please try again in a little while.');
    const url = `https://${cluster === 'devnet' ? 'devnet' : 'mainnet'}.helius-rpc.com?api-key=${key}`;
    const rpc = createRpc(url, url, url);
    this.rpcs.set(cluster, rpc);
    return rpc;
  }

  /** Every Light lookup table that exists for this network, fetched once. */
  async lookupTables(cluster: Cluster): Promise<AddressLookupTableAccount[]> {
    const cached = this.tableCache.get(cluster);
    if (cached) return cached;
    const rpc = this.rpc(cluster);
    const addresses = [cluster === 'devnet' ? stateTreeLookupTableDevnet : stateTreeLookupTableMainnet, EXTRA_LOOKUP_TABLE[cluster]];
    const found: AddressLookupTableAccount[] = [];
    for (const a of addresses) {
      const t = (await rpc.getAddressLookupTable(new PublicKey(a))).value;
      if (t) found.push(t);
    }
    if (found.length) this.tableCache.set(cluster, found);
    return found;
  }

  /** What the burner holds in compressed USDC, in base units. Sums every compressed account it owns for this mint. */
  async compressedBalance(cluster: Cluster, owner: PublicKey, mint: PublicKey): Promise<bigint> {
    const res = await this.rpc(cluster).getCompressedTokenAccountsByOwner(owner, { mint });
    return res.items.reduce((sum, a) => sum + BigInt(a.parsed.amount.toString()), BigInt(0));
  }

  /**
   * The instruction that turns a burner's compressed USDC back into normal USDC in `destinationAta`. The burner must
   * sign the transaction (it owns the compressed balance); `payer` pays the fee. Fetches a validity proof from the
   * indexer. Throws if the burner holds less than `amount`, so nothing is ever built for money that is not there.
   */
  async buildDecompressInstruction(cluster: Cluster, mint: PublicKey, burner: PublicKey, payer: PublicKey, amount: bigint, destinationAta: PublicKey): Promise<TransactionInstruction> {
    if (amount <= BigInt(0)) throw new Error('nothing to decompress');
    const rpc = this.rpc(cluster);
    const held = await rpc.getCompressedTokenAccountsByOwner(burner, { mint });
    const total = held.items.reduce((sum, a) => sum + BigInt(a.parsed.amount.toString()), BigInt(0));
    if (total < amount) throw new Error(`burner holds ${total} but ${amount} is needed`);
    const [inputs] = selectMinCompressedTokenAccountsForTransfer(held.items, bn(amount.toString()));
    const proof = await rpc.getValidityProof(inputs.map((a) => a.compressedAccount.hash));
    const pools = selectTokenPoolInfosForDecompression(await getTokenPoolInfos(rpc, mint), bn(amount.toString()));
    return CompressedTokenProgram.decompress({
      payer,
      inputCompressedTokenAccounts: inputs,
      toAddress: destinationAta,
      amount: bn(amount.toString()),
      tokenPoolInfos: pools,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
    });
  }

  /** The instructions that move USDC from the staging account into the burners. Up to 15 targets. */
  async buildCompressInstructions(cluster: Cluster, mint: PublicKey, staging: Keypair, stagingAta: PublicKey, targets: CompressTarget[]): Promise<TransactionInstruction[]> {
    if (!targets.length || targets.length > COMPRESS_PER_TX) throw new Error(`a compress transaction carries 1 to ${COMPRESS_PER_TX} payouts`);
    if (targets.some((t) => !Number.isInteger(t.baseUnits) || t.baseUnits < 1)) throw new Error('invalid payout amount');
    const rpc = this.rpc(cluster);
    const treeInfo = selectStateTreeInfo(await rpc.getStateTreeInfos());
    const poolInfo = selectTokenPoolInfo(await getTokenPoolInfos(rpc, mint));
    const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })];
    for (const group of instructionGroups(targets)) {
      ixs.push(
        await CompressedTokenProgram.compress({
          payer: staging.publicKey,
          owner: staging.publicKey,
          source: stagingAta,
          toAddress: group.map((t) => new PublicKey(t.burner)),
          amount: group.map((t) => bn(t.baseUnits)),
          mint,
          outputStateTreeInfo: treeInfo,
          tokenPoolInfo: poolInfo,
        }),
      );
    }
    return ixs;
  }

  /**
   * Compresses one chunk and returns the signature once it is confirmed.
   *
   * The signature is known as soon as the transaction is signed, so `record` stores it (with the last block height it can land in) BEFORE anything is sent.
   * If the process dies after sending, the next run finds the stored signature and asks the chain what happened
   * instead of building a second transaction, so a burner can never be funded twice. `record` must throw if it
   * cannot save: nothing is sent then.
   */
  async compressChunk(
    cluster: Cluster,
    mint: PublicKey,
    staging: Keypair,
    stagingAta: PublicKey,
    targets: CompressTarget[],
    record: (signature: string, lastValidBlockHeight: number) => Promise<void>,
  ): Promise<string> {
    const rpc = this.rpc(cluster);
    // Everything up to and including saving the signature happens before anything is broadcast, so a failure there is definite.
    let signature: string;
    let tx: VersionedTransaction;
    let lastValid: number;
    try {
      const ixs = await this.buildCompressInstructions(cluster, mint, staging, stagingAta, targets);
      const tables = await this.lookupTables(cluster);
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({ payerKey: staging.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables);
      tx = new VersionedTransaction(message);
      tx.sign([staging]);
      signature = bs58.encode(tx.signatures[0]);
      lastValid = lastValidBlockHeight;
      await record(signature, lastValidBlockHeight);
    } catch (e) {
      throw new CompressError((e as Error).message, true);
    }
    try {
      await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    } catch (e) {
      const m = (e as Error).message ?? '';
      throw new CompressError(m, REFUSED_BEFORE_BROADCAST.test(m), signature);
    }
    await this.waitForSignature(cluster, signature, lastValid);
    return signature;
  }

  /**
   * Sends a transaction made of compressed-token instructions plus ordinary ones, using Light's lookup table to keep it
   * small. If a blockhash window passes without it landing it is rebuilt with a fresh one, up to `maxAttempts` times.
   * Rebuilding is safe for decompress: spending a compressed account twice is impossible, so a second copy of a
   * transaction that already landed simply fails. Returns the signature that landed.
   */
  async sendInstructions(
    cluster: Cluster,
    instructions: TransactionInstruction[],
    payer: Keypair,
    extraSigners: Keypair[],
    opts: { computeUnits?: number; maxAttempts?: number } = {},
  ): Promise<string> {
    const rpc = this.rpc(cluster);
    const tables = await this.lookupTables(cluster);
    const maxAttempts = opts.maxAttempts ?? 3;
    let lastSignature: string | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ixs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 * attempt }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 400_000 }),
        ...instructions,
      ];
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables));
      tx.sign([payer, ...extraSigners]);
      const signature = bs58.encode(tx.signatures[0]);
      lastSignature = signature;
      await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: attempt > 1, maxRetries: 3 });
      for (let i = 0; i < 120; i++) {
        const outcome = await this.signatureOutcome(cluster, signature, lastValidBlockHeight);
        if (outcome === 'landed') return signature;
        if (outcome === 'failed') throw new Error('The transaction failed on chain.');
        if (outcome === 'expired') break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`The transaction did not land after ${maxAttempts} attempts${lastSignature ? ` (last ${lastSignature.slice(0, 8)})` : ''}.`);
  }

  /** 'landed': confirmed OK. 'failed': landed and failed, safe to rebuild. 'expired': can never land, safe to rebuild. 'unknown': still possible, do NOT rebuild. */
  async signatureOutcome(cluster: Cluster, signature: string, lastValidBlockHeight?: number): Promise<'landed' | 'failed' | 'expired' | 'unknown'> {
    const rpc = this.rpc(cluster);
    const st = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (st?.err) return 'failed';
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return 'landed';
    if (lastValidBlockHeight !== undefined && (await rpc.getBlockHeight('confirmed')) > lastValidBlockHeight) return 'expired';
    return 'unknown';
  }

  private async waitForSignature(cluster: Cluster, signature: string, lastValidBlockHeight: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const outcome = await this.signatureOutcome(cluster, signature, lastValidBlockHeight);
      if (outcome === 'landed') return;
      if (outcome === 'failed') throw new CompressError('The compress transaction failed on chain.', true, signature);
      if (outcome === 'expired') throw new CompressError('The compress transaction expired before it landed.', true, signature);
      await new Promise((r) => setTimeout(r, 500));
    }
    this.logger.warn(`Compress ${signature} not confirmed after waiting; it stays recorded and will be checked again`);
    throw new CompressError('The compress transaction has not confirmed yet.', false, signature);
  }
}
