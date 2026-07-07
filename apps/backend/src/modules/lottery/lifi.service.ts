import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, createWalletClient, erc20Abi, http, type Address } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  Keypair, Connection, Transaction, VersionedTransaction, SystemProgram, PublicKey,
  TransactionMessage, ComputeBudgetProgram,
} from '@solana/web3.js';

const LIFI_API = 'https://li.quest/v1';
const LIFI_INTEGRATOR_ID = '14bd5b16-4f94-44eb-8c7b-7e2c9a3dfc20';
const LIFI_INTEGRATOR_NAME = 'loofta';
// Priority fee for the burner's bridge tx — the bridge has been the slowest step in practice;
// this nudges validators to prioritize it. Tune based on observed confirmation times.
const BRIDGE_PRIORITY_FEE_MICROLAMPORTS = 50_000;

const BASE_CHAIN = '8453';
const SOL_CHAIN = '1151111081099710';
const BASE_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface LifiQuote {
  transactionRequest: {
    to?: string;
    data: string;       // base64 for Solana, 0x hex for EVM
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    from: string;
    chainId: number | string;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    approvalAddress?: string;
    feeCosts?: { amount: string; amountUSD: string; name: string }[];
  };
  tool: string;
  toolDetails?: { name: string; logoURI?: string };
}

@Injectable()
export class LifiService {
  private readonly logger = new Logger(LifiService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseRpcUrl() {
    return this.config.get<string>('BASE_RPC_URL', 'https://mainnet.base.org');
  }

  private get solRpcUrl() {
    return this.config.get<string>('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
  }

  private get apiKey() {
    const key = this.config.get<string>('LIFI_API_KEY', '');
    if (!key) throw new Error('LIFI_API_KEY not set in environment');
    return key;
  }

  private headers() {
    return { 'x-lifi-api-key': this.apiKey } as const;
  }

  /** Quote: Base USDC (companion) → Solana USDC (shared withdrawal burner). */
  async getBaseToSolQuote(opts: {
    fromAddress: string; // companion EVM address
    toAddress: string;   // Solana burner address
    amountUsdc: number;
  }): Promise<LifiQuote> {
    return this.fetchQuote({
      fromChain: BASE_CHAIN, toChain: SOL_CHAIN,
      fromToken: BASE_USDC, toToken: SOL_USDC,
      fromAddress: opts.fromAddress, toAddress: opts.toAddress,
      amountUsdc: opts.amountUsdc, slippage: '0.005',
    });
  }

  /** Quote: Solana USDC (burner) → Base USDC (companion wallet). */
  async getSolToBaseQuote(opts: {
    fromAddress: string; // Solana burner address
    toAddress: string;   // Base companion address
    amountUsdc: number;
  }): Promise<LifiQuote> {
    return this.fetchQuote({
      fromChain: SOL_CHAIN, toChain: BASE_CHAIN,
      fromToken: SOL_USDC, toToken: BASE_USDC,
      fromAddress: opts.fromAddress, toAddress: opts.toAddress,
      amountUsdc: opts.amountUsdc, slippage: '0.01',
    });
  }

  private async fetchQuote(opts: {
    fromChain: string; toChain: string;
    fromToken: string; toToken: string;
    fromAddress: string; toAddress: string;
    amountUsdc: number; slippage: string;
  }): Promise<LifiQuote> {
    const amountUnits = Math.floor(opts.amountUsdc * 1_000_000).toString();

    const params = new URLSearchParams({
      fromChain: opts.fromChain, toChain: opts.toChain,
      fromToken: opts.fromToken, toToken: opts.toToken,
      fromAmount: amountUnits,
      fromAddress: opts.fromAddress, toAddress: opts.toAddress,
      integrator: LIFI_INTEGRATOR_NAME,
      slippage: opts.slippage,
      order: 'RECOMMENDED', // usually both the cheapest and fastest — FASTEST can pick pricier routes for marginal gains
      // "eco" (Eco Protocol, solver-filled intents) left a $1 order funded on-chain but never
      // filled on the destination side — no solver activity at all after 20+ min against a
      // quoted 7s execution time. Across is equally fast/cheap on this lane and far more
      // established; exclude eco until we have a reason to trust it again.
      denyBridges: 'eco',
    });

    const res = await fetch(`${LIFI_API}/quote?${params}`, { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Li.Fi quote failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    if (!data.transactionRequest) throw new Error('Li.Fi quote returned no transactionRequest');
    return data as LifiQuote;
  }

  /** Extract total fee in USD from a quote. */
  feeFromQuote(quote: LifiQuote): number {
    const fromUsdc = parseFloat(quote.estimate.fromAmount) / 1_000_000;
    const toUsdc = parseFloat(quote.estimate.toAmountMin) / 1_000_000;
    const impliedFee = fromUsdc - toUsdc;
    // Also sum explicit fee costs if provided
    const explicit = (quote.estimate.feeCosts ?? [])
      .reduce((sum, f) => sum + parseFloat(f.amountUSD ?? '0'), 0);
    return Math.max(impliedFee, explicit, 0);
  }

  /** Execute a Base→Solana Li.Fi quote from a companion EVM wallet. Returns EVM tx hash. */
  async executeEvmQuote(opts: { companionPrivateKey: string; quote: LifiQuote }): Promise<string> {
    const { companionPrivateKey, quote } = opts;
    const account = privateKeyToAccount(companionPrivateKey as `0x${string}`);
    const rpc = this.baseRpcUrl;
    const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
    const walletClient = createWalletClient({ chain: base, transport: http(rpc), account });

    // Approve Li.Fi router if needed
    const approvalAddress = quote.estimate?.approvalAddress as Address | undefined;
    if (approvalAddress) {
      const required = BigInt(quote.estimate.fromAmount);
      const allowance = await publicClient.readContract({
        address: BASE_USDC, abi: erc20Abi,
        functionName: 'allowance',
        args: [account.address, approvalAddress],
      }) as bigint;

      if (allowance < required) {
        const approveTx = await walletClient.writeContract({
          address: BASE_USDC, abi: erc20Abi,
          functionName: 'approve',
          args: [approvalAddress, required],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 60_000 });
        this.logger.log(`Li.Fi: approved ${approvalAddress} for ${required} units`);
      }
    }

    const tx = quote.transactionRequest;
    if (!tx.to) throw new Error('Li.Fi EVM quote missing target address');
    const gasPricing = tx.maxFeePerGas
      ? {
          maxFeePerGas: BigInt(tx.maxFeePerGas),
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
        }
      : tx.gasPrice ? { gasPrice: BigInt(tx.gasPrice) } : {};
    const txHash = await walletClient.sendTransaction({
      to: tx.to as Address,
      data: tx.data as `0x${string}`,
      value: tx.value ? BigInt(tx.value) : 0n,
      gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      ...gasPricing,
    } as any);

    this.logger.log(`Li.Fi EVM: tx=${txHash} tool=${quote.tool}`);
    return txHash;
  }

  /**
   * Execute a Solana→Base Li.Fi quote from a Solana burner wallet.
   * Funds burner with SOL for tx fees (via feePayerSecretKey), then signs and sends.
   * Returns the Solana tx signature.
   */
  async executeSolanaQuote(opts: {
    burnerSecretKey: Buffer;
    quote: LifiQuote;
    feePayerSecretKey: string; // base58
  }): Promise<string> {
    const { burnerSecretKey, quote, feePayerSecretKey } = opts;
    const bs58 = await import('bs58');

    const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
    const feePayerKeypair = Keypair.fromSecretKey(bs58.default.decode(feePayerSecretKey));
    const conn = new Connection(this.solRpcUrl, 'confirmed');

    // Fund burner with SOL for Solana tx fees (Li.Fi bridge tx needs SOL gas)
    const burnerSolBalance = await conn.getBalance(burnerKeypair.publicKey);
    if (burnerSolBalance < 2_000_000) { // < 0.002 SOL
      const fundTx = new Transaction();
      fundTx.feePayer = feePayerKeypair.publicKey;
      const { blockhash } = await conn.getLatestBlockhash();
      fundTx.recentBlockhash = blockhash;
      fundTx.add(SystemProgram.transfer({
        fromPubkey: feePayerKeypair.publicKey,
        toPubkey: burnerKeypair.publicKey,
        lamports: 3_000_000, // 0.003 SOL — enough for 1-2 Solana txs
      }));
      fundTx.sign(feePayerKeypair);
      const fundSig = await conn.sendRawTransaction(fundTx.serialize());
      await conn.confirmTransaction(fundSig, 'confirmed');
      this.logger.log(`Li.Fi Solana: funded burner ${burnerKeypair.publicKey.toBase58()} with 0.003 SOL for gas`);
    }

    const txBytes = Buffer.from(quote.transactionRequest.data, 'base64');
    const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BRIDGE_PRIORITY_FEE_MICROLAMPORTS });

    // Li.Fi may return a VersionedTransaction (v0 with address lookup tables)
    let sig: string;
    try {
      const vTx = VersionedTransaction.deserialize(txBytes);
      try {
        // Reconstruct with a priority-fee instruction prepended, resolving any lookup tables.
        // The bridge has been the slowest step in practice — this is a pure speed optimization,
        // so any failure here falls back to sending Li.Fi's original tx unmodified.
        const lookupTableAccounts = await Promise.all(
          vTx.message.addressTableLookups.map(async lookup => {
            const res = await conn.getAddressLookupTable(lookup.accountKey);
            if (!res.value) throw new Error(`Lookup table not found: ${lookup.accountKey.toBase58()}`);
            return res.value;
          }),
        );
        const decompiled = TransactionMessage.decompile(vTx.message, { addressLookupTableAccounts: lookupTableAccounts });
        // Drop any compute-budget instruction Li.Fi may have already set, to avoid duplicates.
        decompiled.instructions = decompiled.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
        decompiled.instructions.unshift(priorityIx);
        const priorityMessage = decompiled.compileToV0Message(lookupTableAccounts);
        const priorityTx = new VersionedTransaction(priorityMessage);
        priorityTx.sign([burnerKeypair]);
        try {
          sig = await conn.sendRawTransaction(priorityTx.serialize(), { skipPreflight: false });
        } catch (sendErr: any) {
          // A freshly gas-funded burner can hit a lagging RPC node in preflight ("no record of
          // a prior credit") even though the funding tx is confirmed — give propagation a
          // moment and retry once before abandoning the priority fee.
          if (!/prior credit/i.test(String(sendErr?.message ?? ''))) throw sendErr;
          await new Promise(r => setTimeout(r, 2000));
          sig = await conn.sendRawTransaction(priorityTx.serialize(), { skipPreflight: false });
        }
        this.logger.log(`Li.Fi Solana: sent with priority fee (${BRIDGE_PRIORITY_FEE_MICROLAMPORTS} microLamports/CU)`);
      } catch (priorityErr: any) {
        this.logger.warn(`Li.Fi Solana: priority-fee injection failed (${priorityErr.message}), sending original quote tx`);
        vTx.sign([burnerKeypair]);
        sig = await conn.sendRawTransaction(vTx.serialize(), { skipPreflight: false });
      }
    } catch {
      // Fall back to legacy Transaction
      const tx = Transaction.from(txBytes);
      tx.instructions = tx.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
      tx.instructions.unshift(priorityIx);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = burnerKeypair.publicKey;
      tx.sign(burnerKeypair);
      sig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    }

    this.logger.log(`Li.Fi Solana: tx=${sig} tool=${quote.tool}`);
    return sig;
  }

  /** Check bridge status. Pass direction so chains are set correctly. */
  async getStatus(
    txHash: string,
    tool: string,
    direction: 'base_to_sol' | 'sol_to_base' = 'base_to_sol',
  ): Promise<'PENDING' | 'DONE' | 'FAILED'> {
    try {
      const fromChain = direction === 'base_to_sol' ? BASE_CHAIN : SOL_CHAIN;
      const toChain = direction === 'base_to_sol' ? SOL_CHAIN : BASE_CHAIN;

      const params = new URLSearchParams({ txHash, bridge: tool, fromChain, toChain });
      const res = await fetch(`${LIFI_API}/status?${params}`, { headers: this.headers() });
      if (!res.ok) return 'PENDING';

      const data = await res.json();
      const s = String(data.status ?? '').toUpperCase();
      if (s === 'DONE') return 'DONE';
      if (s === 'FAILED') return 'FAILED';
      return 'PENDING';
    } catch {
      return 'PENDING';
    }
  }

  /**
   * Get bridge fee estimate from a real Li.Fi quote.
   * Used for display purposes — returns fee in USD and toAmountMin.
   */
  async getWithdrawalFeeEstimate(amountUsdc: number): Promise<{ feeUsd: number; receiveUsdc: number }> {
    try {
      const quote = await this.getBaseToSolQuote({
        fromAddress: '0x000000000000000000000000000000000000dEaD',
        toAddress: '11111111111111111111111111111111',
        amountUsdc,
      });
      const feeUsd = this.feeFromQuote(quote);
      const receiveUsdc = parseFloat(quote.estimate.toAmountMin) / 1_000_000;
      return { feeUsd, receiveUsdc };
    } catch {
      const feeUsd = Math.max(0.03, amountUsdc * 0.005);
      return { feeUsd, receiveUsdc: amountUsdc - feeUsd };
    }
  }
}
