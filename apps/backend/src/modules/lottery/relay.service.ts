import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair, Connection, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction, SystemProgram, Transaction,
} from '@solana/web3.js';

/**
 * Relay (relay.link) bridge — Solana USDC (burner) → Base USDC (companion), used for Megapot
 * ticket purchases. Chosen for speed: Relay quotes ~3s execution for this lane. Its fee is a
 * mostly-flat ~$0.02 (so ~0.44% on a $5 buy, negligible on larger), comparable to Li.Fi but far
 * faster/more reliable. Loofta absorbs that bridge cost (see tryStartBridge).
 *
 * Confirmed against the live API (POST /quote): the Solana deposit step returns raw `instructions`
 * (hex data + base58 keys) plus `addressLookupTableAddresses`, and status is polled by `requestId`
 * at /intents/status. We quote EXACT_OUTPUT so the companion is guaranteed to receive exactly the
 * ticket cost — Relay computes the required input (cost + fee), which we cover by topping the
 * burner up from the fee wallet.
 */

const RELAY_API = 'https://api.relay.link';
const SOLANA_CHAIN_ID = 792703809; // Relay's chainId for Solana mainnet
const BASE_CHAIN_ID = 8453;
const SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

interface RelayInstruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // hex
}

export interface RelaySolToBaseQuote {
  requestId: string;
  instructions: RelayInstruction[];
  addressLookupTableAddresses: string[];
  /** Base units the burner must hold (ticket cost + bridge fee), from details.currencyIn.amount. */
  requiredInputUnits: bigint;
  /** Base units the companion is guaranteed to receive (= the requested EXACT_OUTPUT). */
  outputUnits: bigint;
  tool: 'relay';
}

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(private readonly config: ConfigService) {}

  private get solRpcUrl() {
    return this.config.get<string>('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
  }

  private headers(): Record<string, string> {
    const key = this.config.get<string>('RELAY_API_KEY', '');
    return { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) };
  }

  /**
   * Quote a Solana USDC → Base USDC bridge that delivers EXACTLY `outputUsdc` to `toAddress`
   * (the companion). Returns the deposit instructions to sign from `fromAddress` (the burner) and
   * the input the burner must hold. tradeType EXACT_OUTPUT → companion nets exactly outputUsdc.
   */
  async getSolToBaseQuote(opts: {
    fromAddress: string; // Solana burner
    toAddress: string;   // Base companion
    outputUnits: bigint; // exact USDC base units the companion should receive
  }): Promise<RelaySolToBaseQuote> {
    const body = {
      user: opts.fromAddress,
      recipient: opts.toAddress,
      originChainId: SOLANA_CHAIN_ID,
      destinationChainId: BASE_CHAIN_ID,
      originCurrency: SOL_USDC_MINT,
      destinationCurrency: BASE_USDC,
      amount: opts.outputUnits.toString(),
      tradeType: 'EXACT_OUTPUT',
    };
    const res = await fetch(`${RELAY_API}/quote`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Relay quote failed (${res.status}): ${text}`);
    }
    const data = await res.json() as any;
    const step = data?.steps?.find((s: any) => s.id === 'deposit') ?? data?.steps?.[0];
    const item = step?.items?.[0];
    const depositData = item?.data;
    if (!depositData?.instructions?.length) {
      throw new Error('Relay quote returned no Solana deposit instructions');
    }
    const requestId: string | undefined = step?.requestId
      ?? (item?.check?.endpoint ? new URLSearchParams(item.check.endpoint.split('?')[1]).get('requestId') ?? undefined : undefined);
    if (!requestId) throw new Error('Relay quote returned no requestId');

    return {
      requestId,
      instructions: depositData.instructions,
      addressLookupTableAddresses: depositData.addressLookupTableAddresses ?? [],
      requiredInputUnits: BigInt(data.details?.currencyIn?.amount ?? opts.outputUnits.toString()),
      outputUnits: BigInt(data.details?.currencyOut?.amount ?? opts.outputUnits.toString()),
      tool: 'relay',
    };
  }

  /**
   * Execute a Relay Solana deposit: build a v0 transaction from the quote's raw instructions +
   * address lookup tables, fund the burner with SOL for gas from the fee wallet, sign with the
   * burner and send. Sending the deposit on-chain is what triggers Relay's relayer to fill the
   * destination — nothing is POSTed back. Returns the Solana signature.
   */
  async executeSolanaQuote(opts: {
    burnerSecretKey: Buffer;
    quote: RelaySolToBaseQuote;
    feePayerSecretKey: string; // base58
  }): Promise<string> {
    const bs58 = await import('bs58');
    const burner = Keypair.fromSecretKey(opts.burnerSecretKey);
    const feePayer = Keypair.fromSecretKey(bs58.default.decode(opts.feePayerSecretKey));
    const conn = new Connection(this.solRpcUrl, 'confirmed');

    // Fund the burner with SOL for tx fees (it is the deposit tx's fee payer + signer).
    const solBalance = await conn.getBalance(burner.publicKey);
    if (solBalance < 2_000_000) {
      const fundTx = new Transaction();
      const { blockhash } = await conn.getLatestBlockhash();
      fundTx.recentBlockhash = blockhash;
      fundTx.feePayer = feePayer.publicKey;
      fundTx.add(SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: burner.publicKey, lamports: 3_000_000 }));
      fundTx.sign(feePayer);
      const fundSig = await conn.sendRawTransaction(fundTx.serialize());
      await conn.confirmTransaction(fundSig, 'confirmed');
      this.logger.log(`Relay: funded burner ${burner.publicKey.toBase58()} with 0.003 SOL for gas`);
    }

    const ixs = opts.quote.instructions.map(ix => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map(k => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(ix.data, 'hex'),
    }));

    const altAccounts = await Promise.all(
      opts.quote.addressLookupTableAddresses.map(async addr => {
        const r = await conn.getAddressLookupTable(new PublicKey(addr));
        if (!r.value) throw new Error(`Relay: address lookup table not found: ${addr}`);
        return r.value;
      }),
    );

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: burner.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(altAccounts);
    const vtx = new VersionedTransaction(message);
    vtx.sign([burner]);

    let sig: string;
    try {
      sig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false });
    } catch (sendErr: any) {
      // A freshly gas-funded burner can hit a lagging RPC node in preflight ("no record of a
      // prior credit") even though the funding tx is confirmed — retry once after a beat.
      if (!/prior credit/i.test(String(sendErr?.message ?? ''))) throw sendErr;
      await new Promise(r => setTimeout(r, 2000));
      sig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false });
    }
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    this.logger.log(`Relay: deposit sent, sig=${sig}, requestId=${opts.quote.requestId}`);
    return sig;
  }

  /**
   * Quote a Base USDC → Solana USDC bridge (withdrawal leg): companion (Base) → burner (Solana).
   * EXACT_INPUT of `amountUnits` — the user receives the net. Returns the EVM deposit tx to run as
   * a Rhinestone-sponsored userOp from the companion (approve the router, then call it). Confirmed
   * against the live API: EVM origin returns an `approve` + `deposit` step; the deposit `to` is
   * Relay's router (also the approval spender).
   */
  async getBaseToSolQuote(opts: {
    fromAddress: string; // Base companion
    toAddress: string;   // Solana burner
    amountUnits: bigint; // USDC base units to send from Base
  }): Promise<{
    requestId: string;
    approvalAddress: string;
    depositTo: string;
    depositData: string;
    depositValue: bigint;
    fromAmountUnits: bigint;
    toAmountMinUnits: bigint;
    feeUsd: number;
    tool: 'relay';
  }> {
    const body = {
      user: opts.fromAddress,
      recipient: opts.toAddress,
      originChainId: BASE_CHAIN_ID,
      destinationChainId: SOLANA_CHAIN_ID,
      originCurrency: BASE_USDC,
      destinationCurrency: SOL_USDC_MINT,
      amount: opts.amountUnits.toString(),
      tradeType: 'EXACT_INPUT',
    };
    const res = await fetch(`${RELAY_API}/quote`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Relay base→sol quote failed (${res.status}): ${text}`);
    }
    const data = await res.json() as any;
    const deposit = data?.steps?.find((s: any) => s.id === 'deposit');
    const item = deposit?.items?.[0];
    const tx = item?.data;
    if (!tx?.to || !tx?.data) throw new Error('Relay base→sol quote returned no deposit transaction');
    const requestId: string | undefined = deposit?.requestId
      ?? (item?.check?.endpoint ? new URLSearchParams(item.check.endpoint.split('?')[1]).get('requestId') ?? undefined : undefined);
    if (!requestId) throw new Error('Relay base→sol quote returned no requestId');

    const fromAmountUnits = BigInt(data.details?.currencyIn?.amount ?? opts.amountUnits.toString());
    const toAmountMinUnits = BigInt(data.details?.currencyOut?.minimumAmount ?? data.details?.currencyOut?.amount ?? '0');
    const feeUsd = Math.max(0, Number(fromAmountUnits - toAmountMinUnits) / 1_000_000);
    return {
      requestId,
      approvalAddress: tx.to, // Relay router == approval spender
      depositTo: tx.to,
      depositData: tx.data,
      depositValue: tx.value ? BigInt(tx.value) : 0n,
      fromAmountUnits,
      toAmountMinUnits,
      feeUsd,
      tool: 'relay',
    };
  }

  /**
   * Display-only fee estimate for a Base→Solana withdrawal of `amountUsdc` — no funds ever move
   * to `toAddress` here, it only exists so Relay has a syntactically valid recipient to quote
   * against. Was '11111111111111111111111111111111' (the System Program ID) — Relay tightened
   * recipient validation and now rejects that as "a token contract [that] cannot receive funds"
   * (broke every withdrawal fee estimate in prod on 2026-07-24). The well-known Solana incinerator
   * address is a plain, ordinary (non-program) account, so it passes that validation.
   */
  async getWithdrawalFeeEstimate(amountUsdc: number): Promise<{ feeUsd: number; receiveUsdc: number }> {
    const q = await this.getBaseToSolQuote({
      fromAddress: '0x000000000000000000000000000000000000dEaD',
      toAddress: '1nc1nerator11111111111111111111111111111111',
      amountUnits: BigInt(Math.round(amountUsdc * 1_000_000)),
    });
    return { feeUsd: q.feeUsd, receiveUsdc: Number(q.toAmountMinUnits) / 1_000_000 };
  }

  /** Poll a Relay intent's status by requestId. */
  async getStatus(requestId: string): Promise<'PENDING' | 'DONE' | 'FAILED'> {
    try {
      const res = await fetch(`${RELAY_API}/intents/status?requestId=${encodeURIComponent(requestId)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return 'PENDING';
      const data = await res.json() as { status?: string };
      const s = String(data.status ?? '').toLowerCase();
      if (s === 'success') return 'DONE';
      if (s === 'failure' || s === 'refund') return 'FAILED';
      return 'PENDING'; // pending, waiting, delayed, unknown
    } catch {
      return 'PENDING';
    }
  }
}
